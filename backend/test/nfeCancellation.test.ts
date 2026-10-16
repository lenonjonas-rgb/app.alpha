import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { SignedXml } from "xml-crypto";
import { Store, type FiscalDocument } from "../src/store.js";
import { CertificateVault } from "../src/certificate.js";
import { FiscalService, type AuthorityResult } from "../src/service.js";
import { DirectAuthority } from "../src/authority.js";
import { createApi } from "../src/api.js";
import { AppError } from "../src/errors.js";
import type { CompanyData, Context } from "../src/auth.js";
import { cancelNfe, cancellationReply, pendingCancellation, type CancellationEvent, type CancellationResult } from "../src/nfeCancellation.js";
import { authorizedNfe } from "./collectionFixtures.js";
import { syntheticIdentity } from "./syntheticIdentity.js";
import { NFE_NS, parseXml, single, text, signXml } from "../src/xml.js";
import { financeLinks } from "../src/financeLinks.js";
import { FiscalPdf } from "../src/fiscalPdf.js";

const context: Context = { tenant: "tenant", actor: "admin", role: "admin", token: "test" };
const identity = () => syntheticIdentity("11222333000181");
function fixture(directory = ":memory:", production = true) {
  const store = new Store(directory);
  const company: CompanyData = { clients: [{ id: "client", name: "Cliente", document: "52998224725", address: "Rua teste" }],
    finance: { accounts: [], invoices: [{ id: "invoice", clientId: "client", amount: 12345, kind: "Produtos", canceled: false }],
      entries: [{ id: "entry", clientId: "client", invoiceId: "invoice", amount: 12345, kind: "Receber", canceled: false, party: "Cliente",
        issuedOn: "2026-10-15", dueOn: "2026-11-15", paymentMethod: "Boleto", accountId: "bank", settlements: [] }] } };
  store.put(context.tenant, "settings", "issuer", { cnpj: "11222333000181", name: "Empresa" });
  const raw = authorizedNfe(store, context, company, "invoice");
  const document = store.saveDocument(context.tenant, { ...raw,
    artifact: raw.artifact!.replace("<cStat>100", `<dhRecbto>${new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "-00:00")}</dhRecbto><cStat>100`) });
  const credential = identity();
  const vault = new CertificateVault(store, randomBytes(32));
  vault.identity = () => credential;
  let sends = 0, validations = 0;
  let validateHook = async () => {};
  let send = async (_document: FiscalDocument, _xml: string): Promise<CancellationResult> => ({
    status: "registrado", protocol: "142260000000002", response: "<teste/>", artifact: "<procEventoNFe/>", message: "135 · Vinculado",
  });
  let consult = async (): Promise<AuthorityResult> => ({ status: "autorizado", response: "<teste/>", message: "100 · Autorizada" });
  const service = new FiscalService(store, vault, { ready: async () => ({ nfe: true }), validate: async (xml, kind, event) => {
    validations++;
    assert.equal(kind, "nfe"); assert.equal(event, true);
    const parsed = parseXml(xml), verifier = new SignedXml({ publicCert: credential.cert });
    verifier.loadSignature(single(parsed, "Signature"));
    assert.equal(verifier.checkSignature(xml), true);
    assert.equal(single(parsed, "Reference").getAttribute("URI"), `#ID110111${document.key.slice(3)}01`);
    assert.equal(text(single(parsed, "detEvento"), "nProt"), document.protocol);
    if (process.env.ALPHA_CANCELLATION_XML_OUTPUT) await writeFile(process.env.ALPHA_CANCELLATION_XML_OUTPUT, xml);
    await validateHook();
  } }, { transmit: async () => { throw new Error("Não emitir"); }, consult: () => consult(),
    cancelNfe: async (d, xml) => { sends++; return send(d, xml); } }, production);
  const input = { confirmation: document.key.slice(3), justification: "Operação não realizada & cancelada <teste>",
    noCirculation: true, noService: true, noBookEntry: true };
  return { store, company, service, document, credential, input, request: () => service.cancelNfe(context, document.id, input, async () => structuredClone(company)),
    state: () => ({ sends, validations }), setSend: (hook: typeof send) => { send = hook; },
    setValidation: (hook: typeof validateHook) => { validateHook = hook; }, setConsult: (hook: typeof consult) => { consult = hook; } };
}
function response(document: FiscalDocument, code = "135") {
  return `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><tpAmb>1</tpAmb><verAplic>teste</verAplic><cOrgao>42</cOrgao><cStat>128</cStat><xMotivo>Lote processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><verAplic>teste</verAplic><cOrgao>42</cOrgao><cStat>${code}</cStat><xMotivo>Resultado teste</xMotivo><chNFe>${document.key.slice(3)}</chNFe><tpEvento>110111</tpEvento><xEvento>Cancelamento</xEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-10-15T14:01:00-03:00</dhRegEvento><nProt>142260000000002</nProt></infEvento></retEvento></retEnvEvento>`;
}
test("cancelamento assinado, validado e durável antes do envio; não altera financeiro nem XML original", async () => {
  const f = fixture();
  try {
    const before = JSON.stringify(f.company);
    f.setSend(async (document, xml) => {
      assert.equal(f.store.document(context.tenant, document.id).status, "incerto");
      assert.equal(pendingCancellation(f.store, context.tenant, document.id)!.status, "enviando");
      assert.throws(() => f.store.collectionDocument(context.tenant, document.invoiceId, "nfe"), /Evento fiscal/);
      assert.throws(() => new FiscalPdf(f.store).download(context, document.id), /autorização/);
      assert.equal(text(single(parseXml(xml), "detEvento"), "xJust"), f.input.justification);
      return cancellationReply(document, xml, response(document));
    });
    const event = await f.request();
    assert.equal(event.status, "registrado");
    assert.equal(event.protocol, "142260000000002");
    assert.deepEqual(event.declarations, { noCirculation: true, noService: true, noBookEntry: true });
    assert.equal(f.store.document(context.tenant, f.document.id).status, "cancelado");
    assert.equal(f.store.document(context.tenant, f.document.id).artifact, f.document.artifact);
    assert.equal(f.store.document(context.tenant, f.document.id).protocol, f.document.protocol);
    assert.match(event.artifact!, /procEventoNFe/);
    assert.match(event.artifact!, /SignatureValue/);
    assert.equal(JSON.stringify(f.company), before);
    assert.equal(financeLinks(f.store, context, f.company)[0]!.cancellationAllowed, true);
    await assert.rejects(f.request(), /autorização/);
    assert.equal(f.state().sends, 1);
  } finally { f.store.db.close(); }
});
test("rejeição explícita preserva autorização; duplicidade/não vinculado/retorno desconhecido ficam incertos", async () => {
  const f = fixture();
  try {
    for (const code of ["135", "155", "225", "580", "136", "573", "999"]) {
      const reply = cancellationReply(f.document, `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe"><evento/></envEvento>`, response(f.document, code));
      assert.equal(reply.status, ["135", "155"].includes(code) ? "registrado" : ["225", "580"].includes(code) ? "rejeitado" : "incerto");
    }
    f.setSend(async (document, xml) => cancellationReply(document, xml, response(document, "580")));
    assert.equal((await f.request()).status, "rejeitado");
    assert.equal(f.store.document(context.tenant, f.document.id).status, "autorizado");
    f.setSend(async (document, xml) => cancellationReply(document, xml, response(document, "573")));
    assert.equal((await f.request()).status, "incerto");
    assert.equal(f.store.document(context.tenant, f.document.id).status, "incerto");
    assert.equal(financeLinks(f.store, context, f.company)[0]!.cancellationAllowed, false);
    await assert.rejects(f.request());
    assert.equal(f.state().sends, 2);
  } finally { f.store.db.close(); }
});
test("retorno SVRS deve vincular chave/ambiente/órgão/tipo/sequência e protocolo; lote sem confirmação não cancela", () => {
  const f = fixture();
  try {
    const xml = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe"><evento/></envEvento>`;
    for (const [from, to] of [[f.document.key.slice(3), "9".repeat(44)], ["<tpAmb>1", "<tpAmb>2"],
      ["<tpEvento>110111", "<tpEvento>110110"], ["<nSeqEvento>1", "<nSeqEvento>2"],
      ["<cOrgao>42", "<cOrgao>43"], ["142260000000002", "123"], ["http://www.portalfiscal.inf.br/nfe", "urn:other"]]) {
      assert.throws(() => cancellationReply(f.document, xml, response(f.document).replaceAll(from!, to!)));
    }
    assert.equal(cancellationReply(f.document, xml, response(f.document).replace("<cStat>128", "<cStat>108")).status, "incerto");
  } finally { f.store.db.close(); }
});
test("SVRS usa endpoint/WSDL SOAP1.2 de evento e ambiente da nota, sem mudar autorização de emissão", async () => {
  const f = fixture();
  try {
    let calls = 0;
    const authority = new DirectAuthority(async (url, credential, method, body, headers) => {
      assert.equal(credential, f.credential);
      assert.match(url, /^https:\/\/nfe\.svrs\.rs\.gov\.br\/ws\/recepcaoevento\/recepcaoevento4\.asmx/);
      if (method === "GET") return { status: 200, body: `<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:s="http://schemas.xmlsoap.org/wsdl/soap12/" targetNamespace="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><binding><operation><s:operation soapAction="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"/></operation></binding></definitions>` };
      calls++;
      assert.match(headers!["Content-Type"]!, /nfeRecepcaoEvento/);
      assert.match(body!, /envEvento/);
      return { status: 200, body: response(f.document) };
    });
    f.setSend((document, xml) => authority.cancelNfe(document, xml, f.credential));
    assert.equal((await f.request()).status, "registrado");
    assert.equal(calls, 1);
  } finally { f.store.db.close(); }
});
test("homologação envia evento exclusivamente ao host de testes e preserva baixas já estornadas", async () => {
  const f = fixture(":memory:", false);
  try {
    const xml = f.document.xml.replace("<tpAmb>1", "<tpAmb>2"), signedXml = signXml(xml, "nfe", f.credential);
    const digest = text(single(parseXml(signedXml), "Signature"), "DigestValue");
    const stamp = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
    const artifact = `<nfeProc xmlns="${NFE_NS}" versao="4.00">${signedXml}<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${f.document.key.slice(3)}</chNFe><nProt>${f.document.protocol}</nProt><digVal>${digest}</digVal><dhRecbto>${stamp}</dhRecbto><cStat>100</cStat></infProt></protNFe></nfeProc>`;
    f.store.saveDocument(context.tenant, { ...f.document, environment: "homologacao", xml, signedXml, artifact });
    f.company.finance.entries[0]!.settlements.push({ amount: 50, reversed: true });
    const authority = new DirectAuthority(async (url, _credential, method, body) => {
      assert.match(url, /^https:\/\/nfe-homologacao\.svrs\.rs\.gov\.br/);
      if (method === "GET") return { status: 200, body: `<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:s="http://schemas.xmlsoap.org/wsdl/soap12/" targetNamespace="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><binding><operation><s:operation soapAction="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"/></operation></binding></definitions>` };
      assert.match(body!, /<tpAmb>2<\/tpAmb>/);
      return { status: 200, body: response(f.document).replaceAll("<tpAmb>1", "<tpAmb>2") };
    });
    f.setSend((document, xml) => authority.cancelNfe(document, xml, f.credential));
    assert.equal((await f.request()).status, "registrado");
    assert.deepEqual(f.company.finance.entries[0]!.settlements, [{ amount: 50, reversed: true }]);
  } finally { f.store.db.close(); }
});
test("falha ao salvar retorno não apaga a reserva nem permite repetição", async () => {
  const f = fixture();
  try {
    const put = f.store.put.bind(f.store);
    f.store.put = (tenant, collection, id, value) => {
      if (collection === "fiscalEvents" && (value as CancellationEvent).status === "registrado") throw new Error("Falha ao persistir retorno");
      put(tenant, collection, id, value);
    };
    await assert.rejects(f.request(), /Falha ao persistir/);
    assert.equal(f.store.document(context.tenant, f.document.id).status, "incerto");
    assert.equal(pendingCancellation(f.store, context.tenant, f.document.id)!.status, "incerto");
    await assert.rejects(f.request());
    assert.equal(f.state().sends, 1);
  } finally { f.store.db.close(); }
});
test("condições legais, prazo, A1, produção, baixas e remessas bloqueiam antes do envio/XSD", async () => {
  const f = fixture();
  try {
    for (const patch of [{ confirmation: "9".repeat(44) }, { justification: "curta" }, { noCirculation: false },
      { noService: false }, { noBookEntry: false }, { justification: "Texto\ncom quebra inválida" }]) {
      await assert.rejects(f.service.cancelNfe(context, f.document.id, { ...f.input, ...patch }, async () => f.company));
    }
    const artifact = f.document.artifact!;
    for (const stamp of ["invalid", new Date(Date.now() - 86400_001).toISOString(), new Date(Date.now() + 60_000).toISOString()]) {
      f.store.saveDocument(context.tenant, { ...f.document, artifact: artifact.replace(/<dhRecbto>[^<]+/, `<dhRecbto>${stamp}`) });
      await assert.rejects(f.request(), /prazo|24 horas/);
    }
    f.store.saveDocument(context.tenant, f.document);
    f.company.finance.entries[0]!.settlements.push({ amount: 10, reversed: false });
    await assert.rejects(f.request(), /baixas ativas/);
    f.company.finance.entries[0]!.settlements = [];
    for (const remittance of [{ entryIds: ["entry"] }, { entryIds: ["old"], entries: [{ invoiceId: "invoice" }] },
      { entryIds: ["old"], entries: [{ invoiceId: "old", fiscalDocumentId: f.document.id }] }]) {
      f.store.put(context.tenant, "remittances", "test", remittance);
      await assert.rejects(f.request(), /remessa vinculada/);
    }
    assert.equal(f.state().sends, 0);
    assert.equal(f.state().validations, 0);
  } finally { f.store.db.close(); }
  const blocked = fixture(":memory:", false);
  try { await assert.rejects(blocked.request(), /Produção bloqueada/); } finally { blocked.store.db.close(); }
});
test("falha XSD e alteração canônica/documento durante validação não reservam nem enviam evento", async () => {
  for (const change of ["xsd", "settlement", "document"]) {
    const f = fixture();
    try {
      f.setValidation(async () => {
        if (change === "xsd") throw new Error("XSD recusado");
        if (change === "settlement") f.company.finance.entries[0]!.settlements.push({ amount: 10, reversed: false });
        if (change === "document") f.store.saveDocument(context.tenant, { ...f.document, message: "Consulta concorrente" });
      });
      await assert.rejects(f.request(), /XSD recusado|baixas ativas|Documento alterado/);
      assert.equal(f.store.list(context.tenant, "fiscalEvents").length, 0);
      assert.equal(f.store.document(context.tenant, f.document.id).status, "autorizado");
      assert.equal(f.state().sends, 0);
    } finally { f.store.db.close(); }
  }
});
test("fronteira exata de 24h é inclusiva, milissegundo posterior bloqueia e não consome evento", async () => {
  for (const offset of [0, 1]) {
    const f = fixture();
    try {
      const timestamp = "2026-10-15T10:00:00-03:00";
      f.store.saveDocument(context.tenant, { ...f.document,
        artifact: f.document.artifact!.replace(/<dhRecbto>[^<]+/, `<dhRecbto>${timestamp}`) });
      let sends = 0;
      const operation = cancelNfe({ store: f.store, context, id: f.document.id, input: f.input, identity: f.credential,
        validator: f.service.validator, company: async () => f.company,
        now: () => new Date(Date.parse(timestamp) + 86400_000 + offset),
        send: async () => { sends++; return { status: "rejeitado", message: "Teste sintético", response: "" }; } });
      if (offset === 0) assert.equal((await operation).status, "rejeitado");
      else await assert.rejects(operation, /24 horas/);
      assert.equal(sends, offset === 0 ? 1 : 0);
      assert.equal(f.store.list(context.tenant, "fiscalEvents").length, offset === 0 ? 1 : 0);
    } finally { f.store.db.close(); }
  }
});
test("documento errado, A1 de outra empresa e autorização incompleta não liberam evento", async () => {
  const f = fixture();
  try {
    for (const change of [{ kind: "nfse" as const }, { artifact: undefined }, { status: "cancelado" as const }]) {
      f.store.saveDocument(context.tenant, { ...f.document, ...change });
      await assert.rejects(f.request());
    }
    f.store.saveDocument(context.tenant, f.document);
    await assert.rejects(cancelNfe({ store: f.store, context, id: f.document.id, input: f.input,
      identity: { ...f.credential, cnpj: "12345678000195" }, validator: f.service.validator, company: async () => f.company,
      send: async () => { throw new Error("Não enviar"); } }), /A1 não corresponde/);
    assert.equal(f.store.list(context.tenant, "fiscalEvents").length, 0);
    assert.equal(f.state().sends, 0);
  } finally { f.store.db.close(); }
});
test("timeout/reinício preservam bloqueio; consulta autorizada não permite reenviar; cancelamento confirmado resolve evento", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-cancel-"));
  const f = fixture(directory);
  let reopened: Store | undefined;
  try {
    f.setSend(async () => { throw new Error("Timeout sintético"); });
    await assert.rejects(f.request(), /Timeout/);
    const event = pendingCancellation(f.store, context.tenant, f.document.id)!;
    assert.equal(event.status, "incerto");
    await f.service.consult(context, f.document.id);
    assert.equal(f.store.document(context.tenant, f.document.id).status, "incerto");
    assert.equal(f.store.list(context.tenant, "fiscalEventConsultations").length, 1);
    await assert.rejects(f.request());
    f.store.put(context.tenant, "fiscalEvents", event.id, { ...event, status: "enviando" });
    f.store.db.close();
    reopened = new Store(directory);
    assert.equal(pendingCancellation(reopened, context.tenant, f.document.id)!.status, "incerto");
    assert.throws(() => reopened!.assertInvoiceAvailable(context.tenant, "invoice"), /Evento fiscal/);
    assert.equal(reopened.get("other", "fiscalEvents", event.id), undefined);
    const vault = new CertificateVault(reopened, randomBytes(32));
    vault.identity = () => f.credential;
    const service = new FiscalService(reopened, vault, f.service.validator, { ...f.service.authority,
      consult: async () => ({ status: "cancelado", message: "101 · Cancelada", response: "<retConsSitNFe/>" }) }, true);
    await service.consult(context, f.document.id);
    assert.equal(reopened.document(context.tenant, f.document.id).status, "cancelado");
    assert.equal(reopened.get<CancellationEvent>(context.tenant, "fiscalEvents", event.id)!.status, "cancelamento_confirmado");
    assert.equal(pendingCancellation(reopened, context.tenant, f.document.id), undefined);
  } finally { if (reopened) reopened.db.close(); else f.store.db.close(); await rm(directory, { recursive: true, force: true }); }
});
test("evento em voo impede nova solicitação/consulta e leitura antiga não libera faturamento", async () => {
  const f = fixture();
  let release!: (value: CancellationResult) => void;
  try {
    f.setSend(async () => new Promise((resolve) => { release = resolve; }));
    const request = f.request();
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(f.request(), /andamento/);
    await assert.rejects(f.service.consult(context, f.document.id), /andamento/);
    assert.throws(() => f.store.createDocument(context.tenant, { ...f.document, key: "new", environment: "homologacao" }), /Evento fiscal/);
    release({ status: "incerto", response: "", message: "Resultado pendente" });
    assert.equal((await request).status, "incerto");
    assert.equal(f.state().sends, 1);
  } finally { f.store.db.close(); }
});
test("API autentica/isola evento, mantém resposta explícita e oferece XML sem alterar conta", async () => {
  const f = fixture();
  const server = createServer(createApi(f.service, { authenticate: async (header) => {
    if (header === "Bearer test") return context;
    if (header === "Bearer other") return { ...context, tenant: "other" };
    throw new AppError(401, "Sessão necessária.");
  }, company: async () => structuredClone(f.company) }, new Set()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const before = JSON.stringify(f.company), base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = (path: string, token = "test", body?: unknown) => fetch(base + path, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal((await call(`/documents/${f.document.id}/events`, "invalid")).status, 401);
    assert.equal((await call(`/documents/${f.document.id}/cancel`, "other", f.input)).status, 404);
    const sent = await call(`/documents/${f.document.id}/cancel`, "test", f.input);
    assert.equal(sent.status, 200);
    const event = await sent.json() as CancellationEvent;
    assert.equal(event.status, "registrado");
    assert.equal((await call(`/fiscal-events/${event.id}/xml`, "other")).status, 404);
    const xml = await call(`/fiscal-events/${event.id}/xml`);
    assert.equal(xml.headers.get("content-type"), "application/xml; charset=utf-8");
    assert.match(await xml.text(), /procEventoNFe/);
    const history = await (await call(`/documents/${f.document.id}/events`)).json() as Record<string, unknown>[];
    assert.equal(history.length, 1);
    assert.equal(history[0]!.status, "registrado");
    assert.equal(history[0]!.xml, undefined);
    assert.equal(history[0]!.response, undefined);
    assert.equal(history[0]!.consultation, undefined);
    assert.equal(JSON.stringify(f.company), before);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); f.store.db.close(); }
});
