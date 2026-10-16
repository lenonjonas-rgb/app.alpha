import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { Store } from "../src/store.js";
import { FiscalService } from "../src/service.js";
import { CertificateVault } from "../src/certificate.js";
import { FiscalNumbering } from "../src/numbering.js";
import { FiscalCatalog } from "../src/catalog.js";
import { FiscalParties } from "../src/parties.js";
import { FiscalMatrix } from "../src/matrix.js";
import { InvoiceCalculation } from "../src/invoiceCalculation.js";
import { blingReferences } from "../src/rules.js";
import { generateNfe, type GeneratedNfeInput } from "../src/nfeGenerator.js";
import { checkNfeKey, elements, inspectUnsigned, parseXml, single, text, signXml } from "../src/xml.js";
import { issuerFixture, fiscalAddress } from "./partyFixtures.js";
import { productParameters } from "./taxFixtures.js";
import type { CompanyData, Context } from "../src/auth.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createApi } from "../src/api.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignedXml } from "xml-crypto";
import { syntheticIdentity } from "./syntheticIdentity.js";
import { FiscalPdf } from "../src/fiscalPdf.js";
import { pdfContents } from "./pdfInspection.js";
import { AppError } from "../src/errors.js";
import { danfe } from "@sinete/da/nfe";

const context: Context = { tenant: "test", actor: "owner", role: "owner", token: "test" };
const request: GeneratedNfeInput = { invoiceId: "invoice", environment: "homologacao", series: 1, expectedNumber: 10,
  issuedAt: "2026-10-15T14:00:00-03:00", nature: "VENDA DE MERCADORIA", presence: "1", paymentTiming: "1",
  confirmNoGtin: true, confirmNoFreight: true, confirmScope: true };
let testIdentity: { key: string; cert: string; cnpj: string } | undefined;
function identity() {
  return testIdentity ??= syntheticIdentity(issuerFixture.cnpj);
}
function fixture(directory = ":memory:") {
  const store = new Store(directory);
  const company: CompanyData = {
    products: [{ id: "p1", name: "Peça" }, { id: "p2", name: "Peça 2" }], services: [],
    clients: [{ id: "client", document: "52998224725", name: "Cliente", address: "" }],
    finance: { accounts: [], invoices: [{
      id: "invoice", clientId: "client", kind: "Produtos", amount: 105000, canceled: false,
      orders: [{ orderId: "order", code: "OS-1", amount: 105000, items: [
        { id: "p1", source: "item", kind: "produto", referenceId: "p1", name: "Peça & <especial>", quantity: 2, price: 50000,
          gross: 100000, itemDiscount: 1000, orderDiscount: 9000 },
        { id: "p2", source: "item", kind: "produto", referenceId: "p2", name: "Peça fracionada", quantity: 1.5, price: 10000,
          gross: 15000, itemDiscount: 0, orderDiscount: 0 },
      ] }],
    }], entries: [{
      id: "entry", invoiceId: "invoice", kind: "Receber", clientId: "client", party: "Cliente", amount: 105000,
      dueOn: "2026-11-20", issuedOn: "2026-10-15", paymentMethod: "Boleto", accountId: "bank", canceled: false, settlements: [],
    }] },
  };
  const vault = new CertificateVault(store, randomBytes(32));
  vault.identity = identity;
  let validations = 0, failXsd = false, transmissions = 0;
  const service = new FiscalService(store, vault, {
    ready: async () => ({ nfe: true, nfse: false }),
    validate: async (xml) => {
      validations++;
      assert.match(xml, /SignatureValue/);
      const verifier = new SignedXml({ publicCert: identity().cert });
      verifier.loadSignature(single(parseXml(xml), "Signature"));
      assert.equal(verifier.checkSignature(xml), true);
      if (failXsd) throw new Error("XSD recusado");
      if (process.env.ALPHA_XML_TEST_OUTPUT) await writeFile(process.env.ALPHA_XML_TEST_OUTPUT, xml, "utf8");
    },
  }, { transmit: async () => { transmissions++; return { status: "rejeitado", message: "Teste", response: "<test/>" }; },
    consult: async () => { throw new Error("Não consultar"); } }, false);
  service.saveProfile(context, issuerFixture);
  const rule = service.saveRule(context, { ...blingReferences[0], reviewed: true });
  for (const referenceId of ["p1", "p2"]) new FiscalCatalog(store).save(context, company, [rule], {
    kind: "nfe", referenceId, ruleId: rule.id, active: true, notes: "", unit: "UN", ncm: "84821010", origin: "0",
  });
  new FiscalParties(store).save(context, company, { clientId: "client", document: "52998224725", name: "Cliente",
    address: fiscalAddress, ieIndicator: "9", ie: "", im: "", finalConsumer: true, email: "", phone: "" });
  new FiscalMatrix(store).save(context, [rule], { id: "matrix", kind: "nfe", ruleId: rule.id, name: "Matriz teste",
    operation: "Revenda interna para teste", validFrom: "2026-01-01", validUntil: "2026-12-31", destinationState: "SC",
    ieIndicator: "9", finalConsumer: true, active: true, reviewed: true, approval: "Revisão fictícia para teste",
    parameters: productParameters });
  new FiscalNumbering(store).configure(context, issuerFixture.cnpj, { environment: "homologacao", series: 1,
    nextNumber: 10, expectedNextNumber: null, confirmation: true });
  return { store, company, service, vault, state: () => ({ validations, transmissions }), fail: () => { failXsd = true; } };
}
test("DANFE real autenticado: conteúdo, isolamento, cache persistente, integridade e status sem A1/rede", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-pdf-"));
  const f = fixture(directory);
  let server: ReturnType<typeof createServer> | undefined;
  let reopened: Store | undefined;
  try {
    const before = JSON.stringify(f.company);
    const draft = await f.service.generateNfeDraft(context, f.company, request);
    assert.throws(() => new FiscalPdf(f.store).download(context, draft.id), /autorização/);
    const signedXml = signXml(draft.xml, "nfe", identity());
    const digest = text(single(parseXml(signedXml), "Signature"), "DigestValue");
    const protocol = "142260000000001";
    const document = f.store.saveDocument(context.tenant, { ...draft, status: "autorizado", signedXml, protocol,
      artifact: `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${signedXml.replace(/<\?xml[^?]*\?>/g, "")}<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${draft.key.slice(3)}</chNFe><dhRecbto>2026-10-15T14:01:00-03:00</dhRecbto><nProt>${protocol}</nProt><digVal>${digest}</digVal><cStat>100</cStat></infProt></protNFe></nfeProc>` });
    assert.ok(danfe(document.artifact!).paginas[0]!.ops.some((op) => op.t === "barras"));
    f.vault.identity = () => { throw new Error("Não acessar A1 ao renderizar"); };
    const pdfs = new FiscalPdf(f.store), first = pdfs.download(context, document.id);
    const contents = pdfContents(first.bytes);
    for (const value of ["SEM VALOR FISCAL", "1.050,00", protocol, "especial", "fracionada", "7,12"])
      assert.ok(contents.includes(value), `PDF não contém ${value}`);
    assert.ok(contents.includes(draft.key.slice(3).match(/.{4}/g)!.join(" ")));
    if (process.env.ALPHA_NFE_PDF_TEST_OUTPUT) await writeFile(process.env.ALPHA_NFE_PDF_TEST_OUTPUT, first.bytes);
    assert.match(contents, / re f/);
    assert.deepEqual(pdfs.download(context, document.id).bytes, first.bytes);
    assert.throws(() => pdfs.download({ ...context, tenant: "other" }, document.id), /não encontrado/);
    server = createServer(createApi(f.service, { authenticate: async (header) => {
      if (header === "Bearer test") return context;
      if (header === "Bearer other") return { ...context, tenant: "other" };
      throw new AppError(401, "Sessão necessária.");
    }, company: async () => { throw new Error("Não consultar cadastros para documento histórico"); } }, new Set()));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/documents/${document.id}/pdf`;
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers: { Authorization: "Bearer other" } })).status, 404);
    const response = await fetch(base, { headers: { Authorization: "Bearer test" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(Number(response.headers.get("content-length")), first.bytes.length);
    assert.ok(response.headers.get("content-disposition")!.includes(first.filename));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), first.bytes);
    for (const status of ["cancelado", "incerto", "rejeitado", "processando", "enviando", "rascunho"] as const) {
      f.store.saveDocument(context.tenant, { ...document, status });
      assert.throws(() => pdfs.download(context, document.id), /autorização/);
      const denied = await fetch(base, { headers: { Authorization: "Bearer test" } });
      assert.equal(denied.status, 409);
      assert.ok(denied.headers.get("content-type")!.startsWith("application/json"));
    }
    f.store.saveDocument(context.tenant, document);
    for (const patch of [
      { artifact: document.artifact!.replace(protocol, "142260000000002") }, { protocol: "142260000000002" },
      { artifact: document.artifact!.replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>") },
      { signedXml: signedXml.replace("especial", "adulterado") }, { environment: "producao" as const },
    ]) {
      f.store.saveDocument(context.tenant, { ...document, ...patch });
      assert.throws(() => pdfs.download(context, document.id));
    }
    f.store.saveDocument(context.tenant, document);
    const updatedProtocol = "142260000000002";
    f.store.saveDocument(context.tenant, { ...document, protocol: updatedProtocol,
      artifact: document.artifact!.replace(protocol, updatedProtocol) });
    const changed = pdfs.download(context, document.id);
    assert.notDeepEqual(changed.bytes, first.bytes);
    assert.ok(pdfContents(changed.bytes).includes(updatedProtocol));
    f.store.saveDocument(context.tenant, document);
    assert.deepEqual(pdfs.download(context, document.id).bytes, first.bytes);
    const cached = f.store.get<Record<string, unknown>>(context.tenant, "fiscalPdfs", document.id)!;
    f.store.put(context.tenant, "fiscalPdfs", document.id, { ...cached, base64: Buffer.from("NOT PDF").toString("base64") });
    assert.throws(() => pdfs.download(context, document.id), /PDF fiscal inválido/);
    f.store.put(context.tenant, "fiscalPdfs", document.id, { ...cached, sha256: "corrupted" });
    assert.throws(() => pdfs.download(context, document.id), /integridade/);
    f.store.put(context.tenant, "fiscalPdfs", document.id, cached);
    f.store.saveDocument(context.tenant, { ...document,
      artifact: document.artifact!.replace("<NFe ", '<?xml version="1.0"?><NFe ') });
    assert.throws(() => pdfs.download(context, document.id), /xml_invalido/);
    assert.deepEqual(f.store.get(context.tenant, "fiscalPdfs", document.id), cached);
    // A mensagem pode mudar em uma consulta sem alterar o conteúdo autorizado.
    f.store.saveDocument(context.tenant, { ...document, message: "Consulta confirmada" });
    assert.deepEqual(pdfs.download(context, document.id).bytes, first.bytes);
    assert.equal(JSON.stringify(f.company), before);
    assert.deepEqual(f.state(), { validations: 1, transmissions: 0 });
    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    server = undefined;
    f.store.db.close();
    reopened = new Store(directory);
    assert.deepEqual(new FiscalPdf(reopened).download(context, document.id).bytes, first.bytes);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (reopened) reopened.db.close(); else f.store.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("DANFE mantém todos os itens em múltiplas páginas sem truncar descrições", async () => {
  const f = fixture();
  try {
    f.company.finance.invoices[0]!.orders![0]!.items = Array.from({ length: 60 }, (_, index) => ({
      id: `line-${index + 1}`, source: "item", kind: "produto", referenceId: "p1", name: `Produto completo linha ${index + 1}`,
      quantity: 1, price: 1750, gross: 1750, itemDiscount: 0, orderDiscount: 0,
    }));
    const draft = await f.service.generateNfeDraft(context, f.company, request);
    const signedXml = signXml(draft.xml, "nfe", identity()), protocol = "142260000000001";
    const digest = text(single(parseXml(signedXml), "Signature"), "DigestValue");
    const document = f.store.saveDocument(context.tenant, { ...draft, status: "autorizado", signedXml, protocol,
      artifact: `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${signedXml.replace(/<\?xml[^?]*\?>/g, "")}<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${draft.key.slice(3)}</chNFe><nProt>${protocol}</nProt><digVal>${digest}</digVal><cStat>100</cStat></infProt></protNFe></nfeProc>` });
    const layout = danfe(document.artifact!);
    assert.ok(layout.paginas.length >= 2);
    const contents = pdfContents(new FiscalPdf(f.store).download(context, document.id).bytes);
    for (let index = 1; index <= 60; index++) assert.ok(contents.includes(`Produto completo linha ${index}`));
  } finally { f.store.db.close(); }
});
test("gera XML com chave/DV, itens fracionados, escapes, descontos e totalizadores RTC sem somar IBS/CBS em2026", async () => {
  const { store, company, service, state } = fixture();
  try {
    const before = JSON.stringify(company);
    const draft = await service.generateNfeDraft(context, company, request);
    assert.equal(draft.status, "rascunho");
    checkNfeKey(draft.key.slice(3));
    const doc = parseXml(draft.xml);
    assert.equal(inspectUnsigned(draft.xml, "nfe", "homologacao", issuerFixture.cnpj, "52998224725", 105000), draft.key);
    assert.equal(text(single(doc, "ide"), "nNF"), "10");
    assert.equal(text(single(doc, "dest"), "xNome"), "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL");
    const items = elements(doc, "det");
    assert.equal(items.length, 2);
    assert.equal(text(single(items[0]!, "prod"), "xProd"), "Peça & <especial>");
    assert.equal(text(single(items[1]!, "prod"), "qCom"), "1.5000");
    assert.equal(text(single(items[0]!, "prod"), "vDesc"), "100.00");
    const old = single(doc, "ICMSTot");
    assert.equal(text(old, "vProd"), "1150.00");
    assert.equal(text(old, "vDesc"), "100.00");
    assert.equal(text(old, "vNF"), "1050.00");
    assert.equal(text(old, "vICMS"), "178.50");
    assert.equal(text(old, "vPIS"), "14.38");
    assert.equal(text(old, "vCOFINS"), "66.23");
    assert.equal(text(single(doc, "total"), "vNFTot"), "1050.00");
    assert.equal(text(single(doc, "IBSCBSTot"), "vBCIBSCBS"), "790.89");
    assert.equal(text(single(single(doc, "IBSCBSTot"), "gCBS"), "vCBS"), "7.12");
    assert.equal(text(single(doc, "detPag"), "tPag"), "15");
    assert.equal(text(single(doc, "dup"), "vDup"), "1050.00");
    assert.equal(text(single(doc, "dup"), "dVenc"), "2026-11-20");
    assert.equal(new FiscalNumbering(store).list(context, issuerFixture.cnpj)[0]!.nextNumber, 11);
    assert.equal(store.get<{ calculationId: string }>(context.tenant, "generatedNfe", draft.id)!.calculationId.length, 64);
    assert.equal(JSON.stringify(company), before);
    assert.deepEqual(state(), { validations: 1, transmissions: 0 });
  } finally { store.db.close(); }
});
test("XSD falho, dados inválidos e produção bloqueada não consomem numeração nem geram documento", async () => {
  const { store, company, service, fail } = fixture();
  try {
    for (const invalid of [
      { ...request, environment: "producao" }, { ...request, issuedAt: "2027-01-01T10:00:00-03:00" },
      { ...request, confirmNoGtin: false }, { ...request, confirmNoFreight: false }, { ...request, expectedNumber: 9 },
      { ...request, confirmScope: false }, { ...request, issuedAt: "2026-10-15T10:00:00Z" },
    ]) await assert.rejects(service.generateNfeDraft(context, company, invalid));
    fail();
    await assert.rejects(service.generateNfeDraft(context, company, request), /XSD recusado/);
    assert.equal(store.documents(context.tenant).length, 0);
    assert.equal(new FiscalNumbering(store).list(context, issuerFixture.cnpj)[0]!.nextNumber, 10);
    assert.equal(new FiscalNumbering(store).reservations(context, issuerFixture.cnpj).length, 0);
  } finally { store.db.close(); }
});
test("geração concorrente não duplica documento/contador; rascunho alterado não pode ser transmitido", async () => {
  const { store, company, service, state } = fixture();
  try {
    const results = await Promise.allSettled([service.generateNfeDraft(context, company, request), service.generateNfeDraft(context, company, request)]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(store.documents(context.tenant).length, 1);
    const draft = store.documents(context.tenant)[0]!;
    company.finance.invoices[0]!.orders![0]!.items![0]!.name = "Mudou sem mudar total";
    await assert.rejects(service.transmit(context, company, draft.id, draft.key), /alterados/);
    assert.equal(state().transmissions, 0);
    assert.equal(store.document(context.tenant, draft.id).status, "rascunho");
    assert.equal(new FiscalNumbering(store).list(context, issuerFixture.cnpj)[0]!.nextNumber, 11);
  } finally { store.db.close(); }
});
test("gera pagamento Pix e permite apenas transmissão explícita em homologação após revalidar fontes", async () => {
  const { store, company, service, state } = fixture();
  try {
    company.finance.entries[0]!.paymentMethod = "Pix";
    const draft = await service.generateNfeDraft(context, company, { ...request, paymentTiming: "0" });
    assert.equal(text(single(parseXml(draft.xml), "detPag"), "tPag"), "17");
    assert.equal(elements(parseXml(draft.xml), "cobr").length, 0);
    await assert.rejects(service.transmit(context, company, draft.id, "wrong"), /Confirme/);
    assert.equal(state().transmissions, 0);
    await service.transmit(context, company, draft.id, draft.key);
    assert.equal(state().transmissions, 1);
  } finally { store.db.close(); }
});
test("releitura da nuvem detecta alteração durante o XSD antes de consumir número ou iniciar transmissão", async () => {
  const { store, company, service, state } = fixture();
  try {
    const changed = structuredClone(company);
    changed.finance.invoices[0]!.orders![0]!.items![0]!.name = "Mudou na nuvem";
    await assert.rejects(service.generateNfeDraft(context, company, request, async () => changed), /alterados durante/);
    assert.equal(new FiscalNumbering(store).list(context, issuerFixture.cnpj)[0]!.nextNumber, 10);
    assert.equal(store.documents(context.tenant).length, 0);
    const draft = await service.generateNfeDraft(context, company, request);
    await assert.rejects(service.transmit(context, company, draft.id, draft.key, async () => changed), /alterados após/);
    assert.equal(state().transmissions, 0);
    assert.equal(store.document(context.tenant, draft.id).status, "rascunho");
  } finally { store.db.close(); }
});
test("metadados de geração participam da mesma transação do número/documento", async () => {
  const { store, company, service } = fixture();
  try {
    store.db.exec("CREATE TRIGGER fail_generated BEFORE INSERT ON records WHEN NEW.collection='generatedNfe' BEGIN SELECT RAISE(ABORT,'forced metadata failure'); END");
    await assert.rejects(service.generateNfeDraft(context, company, request), /forced metadata failure/);
    assert.equal(store.documents(context.tenant).length, 0);
    assert.equal(new FiscalNumbering(store).list(context, issuerFixture.cnpj)[0]!.nextNumber, 10);
    assert.equal(new FiscalNumbering(store).reservations(context, issuerFixture.cnpj).length, 0);
  } finally { store.db.close(); }
});
test("não trunca descrição/código nem arredonda quantidade não suportada silenciosamente", () => {
  const { store, company, service } = fixture();
  try {
    const calculation = new InvoiceCalculation(store).prepare(context, company, service.rules(context), { invoiceId: "invoice", date: "2026-10-15" });
    for (const mutate of [
      (copy: typeof calculation) => { copy.lines[0]!.item.name = "x".repeat(121); },
      (copy: typeof calculation) => { copy.lines[0]!.item.quantity = 1.12345; },
      (copy: typeof calculation) => { copy.lines[0]!.item.price = 1; },
      (copy: typeof calculation) => { copy.lines[0]!.item.name = "Invalid\u0000text"; },
      (copy: typeof calculation) => { copy.payment.dueOn = "2026-10-14"; },
    ]) {
      const copy = structuredClone(calculation); mutate(copy);
      assert.throws(() => generateNfe(copy, request, "12345678"));
    }
  } finally { store.db.close(); }
});
test("origem gerada, XML e numeração sobrevivem ao reinício e seguem bloqueando fonte alterada", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-generated-restart-"));
  const fixtureData = fixture(directory);
  let store = fixtureData.store;
  try {
    const draft = await fixtureData.service.generateNfeDraft(context, fixtureData.company, request);
    store.db.close(); store = new Store(directory);
    const vault = new CertificateVault(store, randomBytes(32)); vault.identity = identity;
    const service = new FiscalService(store, vault, fixtureData.service.validator, fixtureData.service.authority, false);
    assert.equal(store.document(context.tenant, draft.id).xml, draft.xml);
    assert.ok(store.get(context.tenant, "generatedNfe", draft.id));
    assert.equal(new FiscalNumbering(store).list(context, issuerFixture.cnpj)[0]!.nextNumber, 11);
    fixtureData.company.finance.invoices[0]!.orders![0]!.items![0]!.name = "Mudou após reinício";
    await assert.rejects(service.transmit(context, fixtureData.company, draft.id, draft.key), /alterados/);
    assert.equal(fixtureData.state().transmissions, 0);
  } finally { store.db.close(); await rm(directory, { recursive: true }); }
});
test("API gera rascunho sem upload XML, devolve download e preserva consumo após descarte", async () => {
  const { store, company, service, state } = fixture();
  const server = createServer(createApi(service, { authenticate: async () => context, company: async () => structuredClone(company) }, new Set()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const response = await post("/documents/generate-nfe", request);
    assert.equal(response.status, 201, await response.clone().text());
    const result = await response.json() as { id: string; key: string; status: string };
    assert.equal(result.status, "rascunho");
    const xml = await (await fetch(`${base}/documents/${result.id}/xml`)).text();
    assert.match(xml, /IBSCBSTot/);
    assert.equal((await post(`/documents/${result.id}/discard`, {})).status, 200);
    assert.equal(new FiscalNumbering(store).list(context, issuerFixture.cnpj)[0]!.nextNumber, 11);
    assert.equal(state().transmissions, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.db.close();
  }
});
