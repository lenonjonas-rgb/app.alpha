import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { encrypt, decrypt, readPfx, CertificateVault } from "../src/certificate.js";
import { Store } from "../src/store.js";
import { checkNfeKey, inspectUnsigned, parseXml, signXml, single } from "../src/xml.js";
import { SignedXml } from "xml-crypto";
import { FiscalService } from "../src/service.js";
import { SupabaseAuth } from "../src/auth.js";
import { blingReferences, importTaxReferences } from "../src/rules.js";
import type { Context, CompanyData } from "../src/auth.js";
import type { Authority } from "../src/service.js";
import { issuerFixture } from "./partyFixtures.js";
import { FiscalNumbering } from "../src/numbering.js";

const cnpj = "12345678000195";
const context: Context = { tenant: "company-a", actor: "owner-a", role: "owner", token: "test" };
const data: CompanyData = { clients: [{ id: "client", name: "Cliente", document: cnpj, address: "Endereço" }],
  finance: { accounts: [], invoices: [{ id: "invoice", kind: "Produtos", clientId: "client", amount: 10000, canceled: false }],
    entries: [{ id: "entry", invoiceId: "invoice", kind: "Receber", clientId: "client", party: "Cliente", amount: 10000, dueOn: "2026-11-20",
      issuedOn: "2026-10-15", paymentMethod: "Boleto", accountId: "account", canceled: false, settlements: [] }] } };
function key() {
  const initial = `422610${cnpj}55001000000001112345678`;
  const sum = [...initial].reverse().reduce((total, digit, index) => total + Number(digit) * (2 + index % 8), 0);
  const dv = 11 - sum % 11;
  return initial + (dv >= 10 ? 0 : dv);
}
function xml() {
  return `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${key()}" versao="4.00"><ide><cUF>42</cUF><tpAmb>2</tpAmb><mod>55</mod><dhEmi>2026-10-15T12:00:00-03:00</dhEmi><serie>1</serie><nNF>1</nNF><tpEmis>1</tpEmis><cNF>12345678</cNF><cDV>${key().at(-1)}</cDV></ide><emit><CNPJ>${cnpj}</CNPJ><CRT>3</CRT></emit><dest><CNPJ>${cnpj}</CNPJ></dest><det nItem="1"><prod><NCM>84821010</NCM><CFOP>5102</CFOP></prod></det><total><ICMSTot><vNF>100.00</vNF></ICMSTot></total><pag><detPag><tPag>15</tPag><vPag>100.00</vPag></detPag></pag></infNFe></NFe>`;
}
test("AES-GCM autentica o tenant e rejeita alterações na cifra/chave", () => {
  const master = randomBytes(32);
  const cipher = encrypt("segredo", master, "company-a");
  assert.equal(decrypt(cipher, master, "company-a"), "segredo");
  assert.throws(() => decrypt(cipher, master, "company-b"));
  assert.throws(() => decrypt(cipher, randomBytes(32), "company-a"));
  const bytes = Buffer.from(cipher, "base64"); bytes[30] = bytes[30]! ^ 1;
  assert.throws(() => decrypt(bytes.toString("base64"), master, "company-a"));
});
test("A1 sintético abre com OpenSSL, confere CNPJ, chave, senha e não salva senha em claro", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-a1-test-"));
  try {
    await writeFile(join(directory, "openssl.cnf"), `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=TESTE SEM VALIDADE FISCAL\n[ext]\nsubjectAltName=otherName:2.16.76.1.3.3;UTF8:${cnpj}\n`);
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem"), "-days", "1", "-nodes", "-config", join(directory, "openssl.cnf")], { stdio: "pipe" });
    execFileSync("openssl", ["pkcs12", "-export", "-inkey", join(directory, "key.pem"), "-in", join(directory, "cert.pem"), "-out", join(directory, "test.p12"), "-passout", "pass:testing-only"], { stdio: "pipe" });
    const pfx = (await readFile(join(directory, "test.p12"))).toString("base64");
    const result = await readPfx(pfx, "testing-only", cnpj);
    assert.equal(result.identity.cnpj, cnpj);
    await assert.rejects(readPfx(pfx, "wrong", cnpj), /senha/);
    await assert.rejects(readPfx(pfx, "testing-only", "00000000000000"), /CNPJ/);
    const store = new Store(":memory:");
    const vault = new CertificateVault(store, randomBytes(32));
    await vault.save(context.tenant, pfx, "testing-only", cnpj);
    assert.equal(vault.identity(context.tenant).cnpj, cnpj);
    assert.equal(JSON.stringify(vault.metadata(context.tenant)).includes("PRIVATE KEY"), false);
    assert.equal(String(store.db.prepare("SELECT payload FROM records").get()?.payload).includes("testing-only"), false);
    const signed = signXml(xml(), "nfe", result.identity);
    assert.equal((signed.match(/<Signature /g) ?? []).length, 1);
    assert.match(signed, /SignatureValue/);
    const verifier = new SignedXml({ publicCert: result.identity.cert, getCertFromKeyInfo: () => result.identity.cert });
    verifier.loadSignature(single(parseXml(signed), "Signature"));
    assert.equal(verifier.checkSignature(signed), true);
    store.db.close();
  } finally { await rm(directory, { recursive: true }); }
});
test("rejeita XXE, XML quebrado, duplicação de assinaturas, total, destinatário e ambiente incompatíveis", () => {
  assert.throws(() => parseXml('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>'));
  assert.throws(() => parseXml("<a><b></a>"));
  assert.equal(inspectUnsigned(xml(), "nfe", "homologacao", cnpj, cnpj, 10000), `NFe${key()}`);
  assert.throws(() => inspectUnsigned(xml(), "nfe", "producao", cnpj, cnpj, 10000), /Ambiente/);
  assert.throws(() => inspectUnsigned(xml(), "nfe", "homologacao", cnpj, cnpj, 10001), /Total/);
  assert.throws(() => inspectUnsigned(xml(), "nfe", "homologacao", cnpj, "11111111111", 10000), /Destinatário/);
  assert.throws(() => inspectUnsigned(xml().replace("</infNFe>", "<Signature /></infNFe>"), "nfe", "homologacao", cnpj, cnpj, 10000), /não assinado/);
  assert.throws(() => checkNfeKey(key().slice(0, 43) + ((Number(key()[43]) + 1) % 10)), /verificador/);
  assert.throws(() => inspectUnsigned(xml().replace("<nNF>1</nNF>", "<nNF>2</nNF>"), "nfe", "homologacao", cnpj, cnpj, 10000), /numeração/);
});
test("persistência isola tenants, bloqueia dupla emissão e não reenvia após falha/incerteza", () => {
  const store = new Store(":memory:");
  const document = store.createDocument("a", { invoiceId: "invoice", kind: "nfe", environment: "homologacao", key: key(), xml: xml() });
  assert.equal(store.documents("b").length, 0);
  assert.throws(() => store.document("b", document.id), /não encontrado/);
  assert.throws(() => store.createDocument("a", { ...document, key: "other-key" }), /Já existe/);
  store.claim("a", document.id);
  assert.throws(() => store.claim("a", document.id), /já foi enviado/);
  store.saveDocument("a", { ...document, status: "incerto" });
  assert.throws(() => store.claim("a", document.id), /já foi enviado/);
  store.db.close();
});
test("reinício transforma transmissão interrompida em incerta sem alterar documentos de outros estados", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-db-test-"));
  try {
    let store = new Store(directory);
    const document = store.createDocument("a", { invoiceId: "i", kind: "nfe", environment: "homologacao", key: key(), xml: xml() });
    store.claim("a", document.id); store.db.close();
    store = new Store(directory);
    assert.equal(store.document("a", document.id).status, "incerto");
    assert.throws(() => store.claim("a", document.id));
    store.db.close();
  } finally { await rm(directory, { recursive: true }); }
});
test("emissão exige regra revisada, XSD, conta compatível e produção liberada", async () => {
  const store = new Store(":memory:");
  let validations = 0;
  let failValidation = false;
  const validator = { ready: async () => ({ nfe: true, nfse: true }), validate: async (signed: string) => {
    assert.match(signed, /SignatureValue/); validations++;
    if (failValidation) throw new Error("XSD inválido no teste");
  } };
  const authority: Authority = { transmit: async () => { throw new Error("Não deve transmitir"); }, consult: async () => { throw new Error("Não deve consultar"); } };
  const vault = new CertificateVault(store, randomBytes(32));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vault.identity = () => ({ key: privateKey.export({ format: "pem", type: "pkcs8" }).toString(), cert: "", cnpj });
  const service = new FiscalService(store, vault, validator, authority, false);
  service.saveProfile(context, issuerFixture);
  const input = { invoiceId: "invoice", kind: "nfe", environment: "homologacao", xml: xml(), ruleId: blingReferences[0]!.id };
  await assert.rejects(service.createDraft(context, data, input), /revisada/);
  service.saveRule(context, { ...blingReferences[0], fields: { NCM: "84821010", CFOP: "5102" }, reviewed: true });
  await assert.rejects(service.createDraft(context, data, { ...input, environment: "producao" }), /Produção bloqueada/);
  const invalid = structuredClone(data); invalid.finance.entries[0]!.amount++;
  await assert.rejects(service.createDraft(context, invalid, input), /inconsistente/);
  const numbering = new FiscalNumbering(store);
  await assert.rejects(service.createDraft(context, data, input), /Configure esta série/);
  assert.equal(store.documents(context.tenant).length, 0);
  numbering.configure(context, cnpj, { environment: "homologacao", series: 1, nextNumber: 1, expectedNextNumber: null, confirmation: true });
  failValidation = true;
  await assert.rejects(service.createDraft(context, data, input), /XSD inválido/);
  assert.equal(numbering.list(context, cnpj)[0]!.nextNumber, 1);
  assert.equal(numbering.reservations(context, cnpj).length, 0);
  assert.equal(store.documents(context.tenant).length, 0);
  failValidation = false;
  const changed = structuredClone(data); changed.finance.entries[0]!.dueOn = "2026-12-01";
  await assert.rejects(service.createDraft(context, data, input, async () => changed), /Origem comercial alterada/);
  assert.equal(numbering.list(context, cnpj)[0]!.nextNumber, 1);
  assert.equal(store.documents(context.tenant).length, 0);
  const draft = await service.createDraft(context, data, input);
  assert.equal(validations, 4);
  assert.equal(numbering.list(context, cnpj)[0]!.nextNumber, 2);
  assert.equal(draft.status, "rascunho");
  assert.ok(store.get(context.tenant, "externalNfeSource", draft.id));
  await assert.rejects(service.transmit(context, data, draft.id, "wrong"), /Confirme/);
  await assert.rejects(service.transmit(context, changed, draft.id, draft.key), /Origem comercial alterada/);
  await assert.rejects(service.transmit(context, data, draft.id, draft.key, async () => changed), /Origem comercial alterada/);
  assert.equal(store.document(context.tenant, draft.id).status, "rascunho");
  assert.equal(service.discardDraft(context, draft.id).status, "cancelado");
  assert.equal(numbering.list(context, cnpj)[0]!.nextNumber, 2);
  assert.throws(() => service.discardDraft(context, draft.id), /Somente rascunhos/);
  await assert.rejects(service.createDraft(context, data, input), /já foi utilizado/);
  store.db.close();
});
test("DPS confere composição do Id, regime Lucro Real e bloqueia retenções incompatíveis com a cobrança", () => {
  const id = `DPS42054072${cnpj}00001000000000000001`;
  const dps = `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse"><infDPS Id="${id}"><tpAmb>2</tpAmb><serie>1</serie><nDPS>1</nDPS><cLocEmi>4205407</cLocEmi><prest><CNPJ>${cnpj}</CNPJ><regTrib><opSimpNac>1</opSimpNac></regTrib></prest><toma><CNPJ>${cnpj}</CNPJ></toma><valores><vServPrest><vServ>100.00</vServ></vServPrest><tpRetISSQN>1</tpRetISSQN><tpRetPisCofins>2</tpRetPisCofins></valores></infDPS></DPS>`;
  assert.equal(inspectUnsigned(dps, "nfse", "homologacao", cnpj, cnpj, 10000), id);
  assert.throws(() => inspectUnsigned(dps.replace("<nDPS>1</nDPS>", "<nDPS>2</nDPS>"), "nfse", "homologacao", cnpj, cnpj, 10000), /Id DPS incompatível/);
  assert.throws(() => inspectUnsigned(dps.replace("<opSimpNac>1", "<opSimpNac>3"), "nfse", "homologacao", cnpj, cnpj, 10000), /Simples/);
  assert.throws(() => inspectUnsigned(dps.replace("<tpRetPisCofins>2", "<tpRetPisCofins>3"), "nfse", "homologacao", cnpj, cnpj, 10000), /retenções/);
});
test("Supabase valida usuário/membership no servidor e não aceita técnico ou tenant do request", async () => {
  const user = "00000000-0000-4000-8000-000000000001";
  const tenant = "00000000-0000-4000-8000-000000000002";
  const fetcher: typeof fetch = async (input) => new Response(JSON.stringify(String(input).endsWith("/user") ? { id: user } : [{ company_id: tenant, role: "technician" }]), { status: 200 });
  const auth = new SupabaseAuth("https://example.test", "public", fetcher);
  await assert.rejects(auth.authenticate("Bearer signed-token"), /Master/);
  await assert.rejects(auth.authenticate(undefined), /Autenticação/);
});
test("referências históricas do Bling iniciam pendentes; ISS observado não vira alíquota global", () => {
  assert.ok(blingReferences.every((rule) => !rule.reviewed));
  assert.equal(blingReferences[1]!.fields.ISS_percent, "5");
  assert.match(blingReferences[1]!.fields.aviso!, /2%/);
  assert.throws(() => importTaxReferences("<NFe><infNFe/></NFe>"), /infProt/);
});
