import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { SignedXml } from "xml-crypto";
import { DirectAuthority } from "../src/authority.js";
import { CertificateVault } from "../src/certificate.js";
import type { CompanyData, Context } from "../src/auth.js";
import { nfseCancellationReply, cancelNfse, pendingNfseCancellation } from "../src/nfseCancellation.js";
import { FiscalService } from "../src/service.js";
import { Store, type FiscalDocument } from "../src/store.js";
import { NFSE_NS, parseXml, serialize, signFiscalElement, signXml, single, text } from "../src/xml.js";
import type { Identity } from "../src/certificate.js";
import type { NfseCancellationResult } from "../src/nfseCancellation.js";
import { syntheticIdentity } from "./syntheticIdentity.js";

const context: Context = { tenant: "tenant", actor: "admin", role: "admin", token: "test" };
const issuer = "11222333000181", accessKey = "3".repeat(50);
const credential = (): Identity => syntheticIdentity(issuer);
const input = { confirmation: accessKey, reasonCode: "2", justification: "Serviço não prestado conforme informado pelo cliente" };

function fixture() {
  const store = new Store(":memory:"), identity = credential();
  const company: CompanyData = {
    clients: [{ id: "client", name: "Cliente", document: "52998224725", address: "Rua de teste" }],
    finance: {
      accounts: [],
      invoices: [{ id: "invoice", clientId: "client", amount: 12345, kind: "Serviços", canceled: false }],
      entries: [{ id: "entry", clientId: "client", invoiceId: "invoice", amount: 12345, kind: "Receber", canceled: false,
        party: "Cliente", issuedOn: "2026-10-15", dueOn: "2026-11-15", paymentMethod: "Boleto", accountId: "bank", settlements: [] }],
    },
  };
  store.put(context.tenant, "settings", "issuer", { cnpj: issuer, name: "Empresa" });
  const dpsKey = `DPS${"1".repeat(42)}`;
  const xml = `<DPS xmlns="${NFSE_NS}" versao="1.01"><infDPS Id="${dpsKey}"><tpAmb>2</tpAmb><prest><CNPJ>${issuer}</CNPJ></prest><toma><CPF>52998224725</CPF></toma></infDPS></DPS>`;
  const signedXml = signXml(xml, "nfse", identity);
  const artifact = `<NFSe xmlns="${NFSE_NS}" versao="1.01"><infNFSe Id="NFS${accessKey}"><emit><CNPJ>${issuer}</CNPJ></emit>${signedXml}</infNFSe></NFSe>`;
  const draft = store.createDocument(context.tenant, { invoiceId: "invoice", kind: "nfse", environment: "homologacao", key: dpsKey, xml });
  const document = store.saveDocument(context.tenant, { ...draft, status: "autorizado", signedXml, artifact, accessKey });
  const vault = new CertificateVault(store, randomBytes(32));
  vault.identity = () => identity;
  let sends = 0;
  let sender = async (doc: FiscalDocument, xmlValue: string): Promise<NfseCancellationResult> => {
    sends++;
    assert.equal(store.document(context.tenant, doc.id).status, "incerto");
    assert.equal(pendingNfseCancellation(store, context.tenant, doc.id)?.status, "enviando");
    const request = parseXml(xmlValue), info = single(request, "infPedReg");
    assert.equal(info.getAttribute("Id"), `PRE${accessKey}101101`);
    assert.equal(info.getAttribute("Id")?.length, 59);
    assert.equal(text(info, "chNFSe"), accessKey);
    assert.equal(text(single(info, "e101101"), "cMotivo"), "2");
    return { status: "registrado", response: "ok", artifact: "<evento/>", message: "Registrado" };
  };
  const validator = { ready: async () => ({ nfe: true, nfse: true, nfseCancellation: true }),
    validate: async (value: string, kind: string, event?: boolean | "pedRegEvento") => {
      assert.equal(kind, "nfse");
      if (event === "pedRegEvento") {
        const parsed = parseXml(value), signature = single(parsed, "Signature");
        const verifier = new SignedXml({ publicCert: identity.cert });
        verifier.loadSignature(signature);
        assert.equal(verifier.checkSignature(value), true);
        assert.equal(single(parsed, "Reference").getAttribute("URI"), `#PRE${accessKey}101101`);
        if (process.env.ALPHA_NFSE_CANCEL_XML_OUTPUT) await writeFile(process.env.ALPHA_NFSE_CANCEL_XML_OUTPUT, value);
      }
      if (event === true && process.env.ALPHA_NFSE_CANCEL_EVENT_XML_OUTPUT) await writeFile(process.env.ALPHA_NFSE_CANCEL_EVENT_XML_OUTPUT, value);
    } };
  let consulter = async (): Promise<NfseCancellationResult> => ({ status: "incerto", message: "Não encontrado" });
  const service = new FiscalService(store, vault, validator, {
    transmit: async () => { throw new Error("Sem transmissão de documento"); },
    consult: async () => { throw new Error("Consulta NFS-e não esperada"); },
    cancelNfe: async () => { throw new Error("Cancelamento NF-e não esperado"); },
    cancelNfse: async (doc, xmlValue) => sender(doc, xmlValue),
    consultNfseCancellation: async () => consulter(),
  }, true);
  return { store, company, document, identity, service, validator, setSender: (fn: typeof sender) => { sender = fn; },
    setConsulter: (fn: typeof consulter) => { consulter = fn; },
    state: () => ({ sends }), run: () => cancelNfse({ store, context, id: document.id, input, identity, validator,
      company: async () => structuredClone(company), send: async (doc, xmlValue) => sender(doc, xmlValue) }) };
}

function eventArtifact(xml: string, identity: Identity, env = 2, key = accessKey) {
  const request = parseXml(xml), requestInfo = single(request, "infPedReg"), id = requestInfo.getAttribute("Id")!;
  const requestElement = serialize(single(request, "pedRegEvento"));
  const unsigned = `<evento xmlns="${NFSE_NS}" versao="1.01"><infEvento Id="EVT${id.slice(3)}001"><verAplic>SEFIN 1.0</verAplic><ambGer>2</ambGer><nSeqEvento>001</nSeqEvento><dhProc>2026-10-16T10:00:00-03:00</dhProc><nDFSe>1</nDFSe>${requestElement}</infEvento></evento>`;
  const event = signFiscalElement(unsigned, "infEvento", identity);
  const reason = single(requestInfo, "e101101");
  assert.equal(text(reason, "cMotivo"), "2");
  assert.equal(text(requestInfo, "chNFSe"), key);
  assert.equal(text(requestInfo, "tpAmb"), "2");
  return event;
}

function eventResponse(xml: string, env = 2, key = accessKey) {
  const event = eventArtifact(xml, credential(), env, key);
  return JSON.stringify({ tipoAmbiente: env, versaoAplicativo: "Sefin 1.0",
    dataHoraProcessamento: "2026-10-16T10:00:00.000-03:00", eventoXmlGZipB64: gzipSync(event).toString("base64") });
}

test("pedido de cancelamento NFS-e é assinado, validado e persistido antes do POST; usa chave/tipo do Anexo II", async () => {
  const f = fixture();
  try {
    const result = await f.run();
    assert.equal(result.status, "registrado");
    assert.equal(f.state().sends, 1);
    assert.equal(f.store.document(context.tenant, f.document.id).status, "cancelado");
    assert.equal(pendingNfseCancellation(f.store, context.tenant, f.document.id), undefined);
    assert.equal(f.store.list<{ model: string }>(context.tenant, "fiscalEvents")[0]?.model, "nfse");
  } finally { f.store.db.close(); }
});

test("falha após iniciar o evento persiste incerteza e impede um segundo pedido", async () => {
  const f = fixture();
  try {
    let attempts = 0;
    f.setSender(async () => { attempts++; throw new Error("timeout após envio"); });
    await assert.rejects(f.run(), /timeout/);
    assert.equal(pendingNfseCancellation(f.store, context.tenant, f.document.id)?.status, "incerto");
    await assert.rejects(f.run(), /já enviado ou incerto/);
    assert.equal(attempts, 1);
    assert.throws(() => f.store.collectionDocument(context.tenant, f.document.invoiceId, "nfse"), /Evento fiscal/);
  } finally { f.store.db.close(); }
});

test("baixas ativas, remessas, chave errada e certificado de outro CNPJ bloqueiam antes do envio", async () => {
  const f = fixture();
  try {
    const settled = structuredClone(f.company);
    settled.finance.entries[0]!.settlements = [{ id: "s", amount: 1, settledOn: "2026-10-16", reversed: false }] as never;
    await assert.rejects(cancelNfse({ store: f.store, context, id: f.document.id, input, identity: f.identity, validator: f.validator,
      company: async () => settled, send: async () => { throw new Error("Não enviar"); } }), /baixas ativas/);
    f.store.put(context.tenant, "remittances", "remittance", { entryIds: ["entry"], entries: [] });
    await assert.rejects(f.run(), /remessa vinculada/);
    f.store.db.prepare("DELETE FROM records WHERE tenant=? AND collection='remittances'").run(context.tenant);
    await assert.rejects(cancelNfse({ store: f.store, context, id: f.document.id, input: { ...input, confirmation: "4".repeat(50) },
      identity: f.identity, validator: f.validator, company: async () => f.company, send: async () => { throw new Error("Não enviar"); } }), /chave de acesso completa/);
    await assert.rejects(cancelNfse({ store: f.store, context, id: f.document.id, input,
      identity: { ...f.identity, cnpj: "22333444000181" }, validator: f.validator,
      company: async () => f.company, send: async () => { throw new Error("Não enviar"); } }), /A1 não corresponde/);
  } finally { f.store.db.close(); }
});

test("contrato Swagger envia gzip/base64 e só aceita evento correlacionado à mesma chave/ambiente", async () => {
  const f = fixture();
  try {
    const petition = `<pedRegEvento xmlns="${NFSE_NS}" versao="1.01"><infPedReg Id="PRE${accessKey}101101"><tpAmb>2</tpAmb><verAplic>AlphaTec</verAplic><dhEvento>2026-10-16T10:00:00-03:00</dhEvento><CNPJAutor>${issuer}</CNPJAutor><chNFSe>${accessKey}</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>2</cMotivo><xMotivo>${input.justification}</xMotivo></e101101></infPedReg></pedRegEvento>`;
    const authority = new DirectAuthority(async (url, _identity, method, body, headers) => {
      assert.equal(url, `https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${accessKey}/eventos`);
      assert.equal(method, "POST");
      assert.equal(headers?.["Content-Type"], "application/json");
      const payload = JSON.parse(body!) as { pedidoRegistroEventoXmlGZipB64: string };
      const xml = gunzipSync(Buffer.from(payload.pedidoRegistroEventoXmlGZipB64, "base64")).toString();
      assert.equal(text(single(parseXml(xml), "infPedReg"), "chNFSe"), accessKey);
      return { status: 201, body: eventResponse(xml) };
    });
    const result = await authority.cancelNfse(f.document, petition, f.identity);
    assert.equal(result.status, "registrado");
    assert.match(result.artifact!, /EVT/);
    await assert.rejects(Promise.resolve().then(() => nfseCancellationReply(f.document, petition, eventResponse(petition, 1))), /outro ambiente/);
    const malformed = await new DirectAuthority(async () => ({ status: 201, body: "{}" })).cancelNfse(f.document, petition, f.identity);
    assert.equal(malformed.status, "incerto");
    assert.equal(malformed.response, "{}");
  } finally { f.store.db.close(); }
});

test("consulta do evento usa a rota oficial e ausência permanece incerta", async () => {
  const f = fixture();
  try {
    const petition = `<pedRegEvento xmlns="${NFSE_NS}" versao="1.01"><infPedReg Id="PRE${accessKey}101101"><tpAmb>2</tpAmb><verAplic>AlphaTec</verAplic><dhEvento>2026-10-16T10:00:00-03:00</dhEvento><CNPJAutor>${issuer}</CNPJAutor><chNFSe>${accessKey}</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>2</cMotivo><xMotivo>${input.justification}</xMotivo></e101101></infPedReg></pedRegEvento>`;
    let status = 404;
    const authority = new DirectAuthority(async (url, _identity, method) => {
      assert.equal(url, `https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${accessKey}/eventos/101101/1`);
      assert.equal(method, "GET");
      return { status, body: status === 404 ? "{}" : eventResponse(petition) };
    });
    assert.equal((await authority.consultNfseCancellation!(f.document, petition, f.identity)).status, "incerto");
    status = 200;
    assert.equal((await authority.consultNfseCancellation!(f.document, petition, f.identity)).status, "registrado");
    const service = f.service;
    const persisted = { id: "event", model: "nfse", documentId: f.document.id, invoiceId: f.document.invoiceId, type: "101101",
      environment: "homologacao", key: accessKey, reasonCode: "2", justification: input.justification,
      createdAt: new Date().toISOString(), createdBy: context.actor, xml: petition, status: "incerto" };
    f.store.put(context.tenant, "fiscalEvents", persisted.id, persisted);
    const result = await service.consult(context, f.document.id);
    assert.equal(result.status, "incerto");
    const eventXml = eventArtifact(petition, f.identity);
    f.setConsulter(async () => ({ status: "registrado", artifact: eventXml, response: "event response", message: "Evento confirmado" }));
    const confirmed = await service.consult(context, f.document.id);
    assert.equal(confirmed.status, "cancelado");
    assert.equal(f.store.get<{ status: string }>(context.tenant, "fiscalEvents", persisted.id)?.status, "cancelamento_confirmado");
  } finally { f.store.db.close(); }
});
