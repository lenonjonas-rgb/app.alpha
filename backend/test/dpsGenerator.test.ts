import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignedXml } from "xml-crypto";
import { Store } from "../src/store.js";
import { FiscalService } from "../src/service.js";
import { CertificateVault } from "../src/certificate.js";
import { FiscalNumbering } from "../src/numbering.js";
import { FiscalCatalog } from "../src/catalog.js";
import { FiscalParties } from "../src/parties.js";
import { FiscalMatrix } from "../src/matrix.js";
import { InvoiceCalculation } from "../src/invoiceCalculation.js";
import { blingReferences } from "../src/rules.js";
import { generateDps, generatedDpsSchema, type GeneratedDpsInput } from "../src/dpsGenerator.js";
import { elements, inspectUnsigned, parseXml, single, text, signXml } from "../src/xml.js";
import { issuerFixture, fiscalAddress } from "./partyFixtures.js";
import { serviceParameters } from "./taxFixtures.js";
import { syntheticIdentity } from "./syntheticIdentity.js";
import type { CompanyData, Context } from "../src/auth.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createApi } from "../src/api.js";
import { companySchema } from "../src/auth.js";
import { confirmNfse, inspectNfse, requireNfseCollection } from "../src/nfseReconciliation.js";
import type { FiscalDocument } from "../src/store.js";
import { RemittanceService } from "../src/remittance.js";
import { reserveFinanceCancellation } from "../src/financeLinks.js";
import { AppError } from "../src/errors.js";
import { FiscalPdf } from "../src/fiscalPdf.js";
import { pdfContents } from "./pdfInspection.js";
import { danfse } from "@sinete/da/nfse";

const context: Context = { tenant: "test", actor: "owner", role: "owner", token: "test" };
const request: GeneratedDpsInput = { invoiceId: "invoice", additionalServiceId: "s1", environment: "homologacao",
  series: 1, expectedNumber: 10, issuedAt: "2026-10-15T14:00:00-03:00", competence: "2026-10-14",
  operationIndicator: "050102", personalUse: "0", totalTaxPercent: { federal: "0", state: "0", municipal: "5" },
  confirmScope: true, confirmUnconditionalDiscount: true };
let identity: ReturnType<typeof syntheticIdentity> | undefined;
function fixture(directory = ":memory:") {
  const store = new Store(directory);
  const company: CompanyData = {
    products: [], services: [{ id: "s1", name: "Manutenção" }],
    clients: [{ id: "client", document: "52998224725", name: "Cliente", address: "" }],
    finance: { accounts: [], invoices: [{
      id: "invoice", clientId: "client", kind: "Serviços", amount: 105000, canceled: false,
      orders: [{ orderId: "order", code: "OS-1", amount: 105000, items: [
        { id: "s1", source: "item", kind: "servico", referenceId: "s1", name: "Manutenção & <teste>", quantity: 2, price: 50000,
          gross: 100000, itemDiscount: 1000, orderDiscount: 9000 },
        { id: "travel", source: "travel", kind: "servico", name: "Deslocamento", quantity: 1, price: 10000,
          gross: 10000, itemDiscount: 0, orderDiscount: 0 },
        { id: "toll", source: "toll", kind: "servico", name: "Pedágio", quantity: 1, price: 5000,
          gross: 5000, itemDiscount: 0, orderDiscount: 0 },
      ] }],
    }], entries: [{
      id: "entry", invoiceId: "invoice", kind: "Receber", clientId: "client", party: "Cliente", amount: 105000,
      dueOn: "2026-11-20", issuedOn: "2026-10-15", paymentMethod: "Boleto", accountId: "bank", canceled: false, settlements: [],
    }] },
  };
  const vault = new CertificateVault(store, randomBytes(32));
  vault.identity = () => identity ??= syntheticIdentity(issuerFixture.cnpj);
  let validations = 0, transmissions = 0, fail = false;
  const service = new FiscalService(store, vault, {
    ready: async () => ({ nfe: true, nfse: true }),
    validate: async (xml) => {
      validations++;
      const verifier = new SignedXml({ publicCert: vault.identity(context.tenant).cert });
      verifier.loadSignature(single(parseXml(xml), "Signature"));
      assert.equal(verifier.checkSignature(xml), true);
      if (fail) throw new Error("XSD recusado");
      if (process.env.ALPHA_DPS_TEST_OUTPUT) await writeFile(process.env.ALPHA_DPS_TEST_OUTPUT, xml, "utf8");
    },
  }, { transmit: async () => { transmissions++; return { status: "rejeitado", message: "Teste", response: "{}" }; },
    consult: async () => { throw new Error("Não consultar"); } }, false);
  service.saveProfile(context, issuerFixture);
  const reference = blingReferences.find((rule) => rule.kind === "nfse")!;
  const rule = service.saveRule(context, { ...reference, reviewed: true });
  new FiscalCatalog(store).save(context, company, [rule], {
    kind: "nfse", referenceId: "s1", ruleId: rule.id, active: true, notes: "",
    nationalCode: "140101", municipalCode: "", nbs: "120029000",
  });
  new FiscalParties(store).save(context, company, { clientId: "client", document: "52998224725", name: "Cliente",
    address: fiscalAddress, ieIndicator: "9", ie: "", im: "", finalConsumer: true, email: "", phone: "" });
  new FiscalMatrix(store).save(context, [rule], { id: "matrix", kind: "nfse", ruleId: rule.id, name: "Matriz teste",
    operation: "Serviço local para teste", validFrom: "2026-01-01", validUntil: "2026-12-31", destinationState: "SC",
    ieIndicator: "9", finalConsumer: true, active: true, reviewed: true, approval: "Revisão fictícia para teste",
    parameters: serviceParameters });
  const numbering = new FiscalNumbering(store, "nfse");
  numbering.configure(context, issuerFixture.cnpj, { environment: "homologacao", series: 1,
    nextNumber: 10, expectedNextNumber: null, confirmation: true });
  return { store, service, company, numbering, fail: () => { fail = true; }, state: () => ({ validations, transmissions }) };
}
function retainedCalculation(f: ReturnType<typeof fixture>) {
  const matrices = new FiscalMatrix(f.store);
  const matrix = matrices.list(context)[0]!;
  const parameters = structuredClone(matrix.parameters);
  assert.equal(parameters.kind, "nfse");
  if (parameters.kind !== "nfse") throw new Error("Fixture requires nfse");
  parameters.federalWithholding = { pisRate: "0", cofinsRate: "0", csllRate: "1", inssRate: "11", irrfRate: "1.5" };
  matrices.save(context, f.service.rules(context), { ...matrix, parameters });
  return new InvoiceCalculation(f.store).prepare(context, f.company, f.service.rules(context),
    { invoiceId: request.invoiceId, date: request.competence, additionalServiceId: request.additionalServiceId });
}
async function authorizedFixture(retained = true, directory = ":memory:") {
  const f = fixture(directory);
  if (retained) {
    const calculation = retainedCalculation(f);
    f.company.finance.entries[0]!.retention = f.service.confirmRetentions(context, f.company,
      { calculationId: calculation.id, confirmation: true }).retention;
  }
  const draft = await f.service.generateDpsDraft(context, f.company, { ...request, ...(retained ? { confirmRetentions: true } : {}) });
  const key = "2".repeat(50);
  const document = f.store.saveDocument(context.tenant, { ...draft, status: "autorizado", accessKey: key,
    artifact: `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${key}"><nNFSe>1</nNFSe>
      <emit><CNPJ>${issuerFixture.cnpj}</CNPJ></emit><valores><vBC>1050.00</vBC><vISSQN>52.50</vISSQN>
      ${retained ? "<vTotalRet>141.75</vTotalRet>" : ""}<vLiq>${retained ? "908.25" : "1050.00"}</vLiq></valores>
      <IBSCBS><valores><vBC>997.50</vBC></valores><totCIBS><vTotNF>${retained ? "908.25" : "1050.00"}</vTotNF>
      <gIBS><vIBSTot>1.01</vIBSTot><gIBSUFTot><vIBSUF>1.01</vIBSUF></gIBSUFTot><gIBSMunTot><vIBSMun>0.00</vIBSMun></gIBSMunTot></gIBS>
      <gCBS><vCBS>8.99</vCBS></gCBS></totCIBS></IBSCBS>${draft.xml}</infNFSe></NFSe>` });
  return { ...f, document };
}
test("DANFSe real com retenções e RTC: usa XML autorizado, rejeita divergências e nunca corta texto", async () => {
  const f = await authorizedFixture();
  try {
    const d = f.document;
    const signedXml = signXml(d.xml, "nfse", identity!);
    const document = f.store.saveDocument(context.tenant, { ...d, signedXml,
      artifact: d.artifact!.replace("<nNFSe>1</nNFSe>", `<nNFSe>1</nNFSe><xLocEmi>Florianópolis</xLocEmi><xLocPrestacao>Florianópolis</xLocPrestacao><dhProc>2026-10-15T14:01:00-03:00</dhProc><ambGer>2</ambGer><tpEmis>1</tpEmis>`)
        .replace(`<CNPJ>${issuerFixture.cnpj}</CNPJ></emit>`, `<CNPJ>${issuerFixture.cnpj}</CNPJ><xNome>EMITENTE DE TESTE</xNome></emit>`)
        .replace(/<\?xml[^?]*\?>/g, "") });
    assert.ok(danfse(document.artifact!).paginas[0]!.ops.some((op) => op.t === "qr"));
    const before = JSON.stringify(f.company);
    const pdfs = new FiscalPdf(f.store), pdf = pdfs.download(context, document.id);
    const contents = pdfContents(pdf.bytes);
    for (const value of ["SEM VALIDADE", "1.050,00", "908,25", "15,75", "115,50", "10,50", "8,99", "Florian", "teste"])
      assert.ok(contents.includes(value), `PDF não contém ${value}`);
    if (process.env.ALPHA_NFSE_PDF_TEST_OUTPUT) await writeFile(process.env.ALPHA_NFSE_PDF_TEST_OUTPUT, pdf.bytes);
    assert.deepEqual(pdfs.download(context, document.id).bytes, pdf.bytes);
    for (const patch of [
      { accessKey: "3".repeat(50) }, { key: "DPSinvalid" }, { environment: "producao" as const },
      { signedXml: signedXml.replace("teste", "adulterado") }, { signedXml: undefined },
      { artifact: document.artifact!.replace("teste", "adulterado") },
      { artifact: document.artifact!.replace(`NFS${document.accessKey}`, `NFS${"3".repeat(50)}`) },
    ]) {
      f.store.saveDocument(context.tenant, { ...document, ...patch });
      assert.throws(() => pdfs.download(context, document.id));
    }
    const xml = d.xml.replace("teste", "teste ".repeat(5000));
    const cached = f.store.get(context.tenant, "fiscalPdfs", document.id);
    const long = f.store.saveDocument(context.tenant, { ...document, xml, signedXml: signXml(xml, "nfse", identity!),
      artifact: document.artifact!.replace("teste", "teste ".repeat(5000)) });
    assert.throws(() => pdfs.download(context, long.id), /cortaria texto/);
    assert.deepEqual(f.store.get(context.tenant, "fiscalPdfs", document.id), cached);
    f.store.saveDocument(context.tenant, { ...document, xml: d.xml.replace("teste", "測試"),
      signedXml: signXml(d.xml.replace("teste", "測試"), "nfse", identity!),
      artifact: document.artifact!.replace("teste", "測試") });
    assert.throws(() => pdfs.download(context, document.id), /caracteres não suportados/);
    assert.equal(JSON.stringify(f.company), before);
    assert.deepEqual(f.state(), { validations: 1, transmissions: 0 });
  } finally { f.store.db.close(); }
});
test("confere bruto, ISS, retenções e líquido oficial sem alterar conta; homologação nunca libera cobrança", async () => {
  for (const retained of [false, true]) {
    const f = await authorizedFixture(retained);
    try {
      const before = JSON.stringify(f.company);
      const check = inspectNfse(f.store, context, f.company, f.document);
      assert.deepEqual(check.differences, []);
      assert.equal(check.actual.net, retained ? 90825 : 105000);
      assert.equal(check.actual.iss, 5250);
      assert.equal(check.actual.withheld, retained ? 14175 : 0);
      const confirmed = confirmNfse(f.store, context, f.company, f.document, { checkId: check.id, confirmation: true });
      assert.ok(confirmed.confirmedAt); assert.equal(confirmed.confirmedBy, context.actor);
      assert.equal(JSON.stringify(f.company), before);
      assert.throws(() => requireNfseCollection(f.store, context, f.company, "invoice"), /homologação não libera/);
      f.store.saveDocument(context.tenant, { ...f.document, status: "cancelado" });
      assert.throws(() => requireNfseCollection(f.store, context, f.company, "invoice"), /NFS-e autorizada/);
      assert.throws(() => confirmNfse(f.store, context, f.company, f.document, { checkId: check.id, confirmation: false }));
      f.company.finance.entries[0]!.dueOn = "2026-12-15";
      assert.throws(() => confirmNfse(f.store, context, f.company, f.document, { checkId: check.id, confirmation: true }), /obsoleta/);
    } finally { f.store.db.close(); }
  }
});
test("divergências oficiais bloqueiam confirmação sem sobrescrever valores; XML adulterado é recusado", async () => {
  const f = await authorizedFixture();
  try {
    for (const [old, replacement] of [["<vLiq>908.25", "<vLiq>908.24"], ["<vISSQN>52.50", "<vISSQN>52.51"],
      ["<vTotalRet>141.75", "<vTotalRet>141.74"], ["<vBC>1050.00", "<vBC>1049.00"], ["<vCBS>8.99", "<vCBS>8.98"],
      ["<vTotNF>908.25", "<vTotNF>909.25"], ["<vIBSUF>1.01", "<vIBSUF>1.00"]]) {
      const document = { ...f.document, artifact: f.document.artifact!.replace(old!, replacement!) };
      const check = inspectNfse(f.store, context, f.company, document);
      assert.equal(check.matches, false); assert.ok(check.differences.length);
      assert.throws(() => confirmNfse(f.store, context, f.company, document, { checkId: check.id, confirmation: true }), /divergentes/);
    }
    for (const [old, replacement] of [["<vRetCP>115.50", "<vRetCP>115.51"], ["<tpAmb>2", "<tpAmb>1"],
      ["<vServ>1150.00", "<vServ>1150.01"], [f.document.key, `DPS${"9".repeat(42)}`],
      [`NFS${f.document.accessKey}`, `NFS${"9".repeat(50)}`]]) {
      assert.throws(() => inspectNfse(f.store, context, f.company, { ...f.document,
        artifact: f.document.artifact!.replace(old!, replacement!) }));
    }
    assert.throws(() => inspectNfse(f.store, context, f.company, { ...f.document,
      artifact: f.document.artifact!.replace("<vLiq>908.25</vLiq>", "<vLiq>908.25</vLiq><vLiq>908.25</vLiq>") }), /exatamente um/);
    const modified = structuredClone(f.company);
    modified.finance.entries[0]!.retention!.confirmedBy = "forged";
    assert.equal(inspectNfse(f.store, context, modified, f.document).matches, false);
    assert.throws(() => inspectNfse(f.store, { ...context, tenant: "other" }, f.company, f.document), /origem e memória/);
    assert.throws(() => inspectNfse(f.store, context, f.company, { ...f.document, status: "cancelado" }), /autorizada/);
    assert.equal(f.company.finance.entries[0]!.amount, 105000);
    assert.equal(f.store.list(context.tenant, "nfseChecks").length, 0);
    const missingRtc = { ...f.document, artifact: f.document.artifact!.replace(/<IBSCBS>[\s\S]*?<\/IBSCBS>/, "") };
    const incomplete = inspectNfse(f.store, context, f.company, missingRtc);
    assert.equal(incomplete.actual.ibsTotal, null);
    assert.equal(incomplete.matches, false);
    assert.match(incomplete.differences.join(" "), /IBS\/CBS oficial ausente/);
  } finally { f.store.db.close(); }
});
test("conferência tolera somente prefixos e indentação da DPS, não alterações comerciais", async () => {
  const f = await authorizedFixture();
  try {
    const prefixed = f.document.xml.replace(/<(\/?)([A-Za-z][\w]*)/g, "<$1n:$2")
      .replace('xmlns="http://www.sped.fazenda.gov.br/nfse"', 'xmlns:n="http://www.sped.fazenda.gov.br/nfse"')
      .replace(/></g, ">\n  <");
    const document = { ...f.document, artifact: f.document.artifact!.replace(f.document.xml, prefixed) };
    assert.equal(inspectNfse(f.store, context, f.company, document).matches, true);
    assert.throws(() => inspectNfse(f.store, context, f.company, { ...document,
      artifact: document.artifact.replace("Manutenção &amp;", "Manutenção alterada &amp;") }), /declaração enviada/);
  } finally { f.store.db.close(); }
});
test("cancelamento reservado durante geração DPS impede documento e consumo mesmo com JSON antigo", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.generateDpsDraft(context, f.company, request, async () => {
      reserveFinanceCancellation(f.store, context, f.company, { expectedEntry: f.company.finance.entries[0],
        expectedInvoice: f.company.finance.invoices[0], confirmation: true });
      return f.company;
    }), /cancelamento interno reservado/);
    assert.equal(f.store.documents(context.tenant).length, 0);
    assert.equal(f.numbering.list(context, issuerFixture.cnpj)[0]!.nextNumber, 10);
    await assert.rejects(f.service.generateDpsDraft(context, f.company, request), /cancelamento interno reservado/);
    assert.equal(f.company.finance.entries[0]!.canceled, false);
  } finally { f.store.db.close(); }
});
test("conferência oficial confirmada persiste após reinício e permanece isolada por empresa", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-nfse-check-"));
  let active: Store | undefined;
  try {
    const f = await authorizedFixture(true, directory); active = f.store;
    const check = inspectNfse(f.store, context, f.company, f.document);
    const saved = confirmNfse(f.store, context, f.company, f.document, { checkId: check.id, confirmation: true });
    f.store.db.close(); active = undefined;
    const store = new Store(directory); active = store;
    assert.deepEqual(store.get(context.tenant, "nfseChecks", f.document.id), saved);
    assert.equal(inspectNfse(store, context, f.company, store.document(context.tenant, f.document.id)).id, check.id);
    assert.equal(store.get("other", "nfseChecks", f.document.id), undefined);
    assert.throws(() => store.document("other", f.document.id), /não encontrado/);
  } finally { active?.db.close(); await rm(directory, { recursive: true, force: true }); }
});
test("remessa de produção usa líquido oficial conferido e recusa conferência obsoleta ou nota cancelada", async () => {
  const f = await authorizedFixture();
  try {
    // Documento sintético em produção somente para testar o gate, sem transmissão externa.
    const document: FiscalDocument = { ...f.document, environment: "producao",
      xml: f.document.xml.replace("<tpAmb>2", "<tpAmb>1"), artifact: f.document.artifact!.replace("<tpAmb>2", "<tpAmb>1") };
    f.store.saveDocument(context.tenant, document);
    const remittances = new RemittanceService(f.store);
    remittances.saveConfig(context, { accountId: "bank", agencia: "1234", conta: "56789", dac: "0", carteira: "109",
      codigoCarteira: "I", primeiroNossoNumero: "00000001", sequenciaInicialArquivo: 1 });
    const input = { accountId: "bank", entryIds: ["entry"],
      addresses: { client: { logradouro: "Rua Teste 1", bairro: "Centro", cep: "88010000", cidade: "Florianopolis", uf: "SC" } } };
    assert.throws(() => remittances.create(context, f.company, input), /aguarda conferência/);
    assert.equal(remittances.config(context, "bank")!.nextFileSequence, 1);
    const check = inspectNfse(f.store, context, f.company, document);
    confirmNfse(f.store, context, f.company, document, { checkId: check.id, confirmation: true });
    const altered = structuredClone(f.company); altered.finance.entries[0]!.dueOn = "2026-12-01";
    assert.throws(() => remittances.create(context, altered, input), /aguarda conferência/);
    f.store.saveDocument(context.tenant, { ...document, status: "cancelado" });
    assert.throws(() => remittances.create(context, f.company, input), /NFS-e autorizada/);
    f.store.saveDocument(context.tenant, document);
    const result = remittances.create(context, f.company, input);
    assert.equal(result.file.split("\r\n")[1]!.slice(126, 139), "0000000090825");
    assert.equal(result.entries[0]!.nfseCheckId, check.id);
    assert.equal(result.entries[0]!.fiscalKind, "nfse");
    assert.equal(result.entries[0]!.fiscalDocumentId, document.id);
    assert.equal(result.entries[0]!.fiscalAccessKey, document.accessKey);
    assert.equal(result.entries[0]!.amount, 90825);
    assert.equal(f.company.finance.entries[0]!.amount, 105000);
    assert.equal(f.company.finance.entries[0]!.settlements.length, 0);
  } finally { f.store.db.close(); }
});
test("API de conferência retorna valores canônicos e persiste somente confirmação atual na mesma empresa", async () => {
  const f = await authorizedFixture();
  const server = createServer(createApi(f.service, { authenticate: async () => context, company: async () => f.company, approveFinanceChange: async () => {} }, new Set()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/documents/${f.document.id}/reconciliation`;
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const check = await response.json() as { id: string; matches: boolean };
    assert.equal(check.matches, true);
    const confirmed = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkId: check.id, confirmation: true }) });
    assert.equal(confirmed.status, 200);
    assert.ok((await confirmed.json() as { confirmedAt: string }).confirmedAt);
    assert.ok((await (await fetch(url)).json() as { confirmedAt: string }).confirmedAt);
    f.company.finance.entries[0]!.dueOn = "2026-12-01";
    assert.equal((await (await fetch(url)).json() as { confirmedAt?: string }).confirmedAt, undefined);
    const stale = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkId: "a".repeat(64), confirmation: true }) });
    assert.equal(stale.status, 409);
    assert.equal(f.state().transmissions, 0);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); f.store.db.close(); }
});
test("concilia IRRF/INSS/CSLL preservando bruto, exige sincronização/confirmação e gera campos federais exatos", async () => {
  const f = fixture();
  try {
    const calculation = retainedCalculation(f);
    assert.equal(calculation.totals.withheld, "141.75");
    assert.equal(calculation.totals.afterWithholding, "908.25");
    const before = JSON.stringify(f.company);
    await assert.rejects(f.service.generateDpsDraft(context, f.company, { ...request, confirmRetentions: true }), /Confirme e sincronize/);
    const confirmed = f.service.confirmRetentions(context, f.company, { calculationId: calculation.id, confirmation: true });
    assert.equal(JSON.stringify(f.company), before);
    assert.deepEqual(confirmed.retention, { calculationId: calculation.id, invoiceAmount: 105000, withheld: 14175, net: 90825,
      irrf: 1575, inss: 11550, csll: 1050, confirmedAt: confirmed.retention.confirmedAt, confirmedBy: context.actor });
    assert.deepEqual(f.service.confirmRetentions(context, f.company, { calculationId: calculation.id, confirmation: true }), confirmed);
    f.company.finance.entries[0]!.retention = confirmed.retention;
    assert.deepEqual(companySchema.parse(f.company).finance.entries[0]!.retention, confirmed.retention);
    const invalid = structuredClone(f.company); invalid.finance.invoices[0]!.kind = "Produtos";
    assert.throws(() => companySchema.parse(invalid), /Conciliação exige/);
    const recalculated = new InvoiceCalculation(f.store).prepare(context, f.company, f.service.rules(context),
      { invoiceId: request.invoiceId, date: request.competence, additionalServiceId: request.additionalServiceId });
    assert.equal(recalculated.id, calculation.id);
    await assert.rejects(f.service.generateDpsDraft(context, f.company, request), /Confirme a revisão/);
    const draft = await f.service.generateDpsDraft(context, f.company, { ...request, confirmRetentions: true });
    const xml = parseXml(draft.xml);
    assert.equal(text(xml, "vServ"), "1150.00"); assert.equal(text(xml, "vDescIncond"), "100.00");
    assert.equal(text(xml, "vRetCP"), "115.50"); assert.equal(text(xml, "vRetIRRF"), "15.75"); assert.equal(text(xml, "vRetCSLL"), "10.50");
    assert.equal(elements(xml, "piscofins").length, 0);
    assert.equal(inspectUnsigned(draft.xml, "nfse", "homologacao", issuerFixture.cnpj, "52998224725", 105000, confirmed.retention), draft.key);
    assert.throws(() => inspectUnsigned(draft.xml, "nfse", "homologacao", issuerFixture.cnpj, "52998224725", 105000), /retenções/);
    assert.throws(() => inspectUnsigned(draft.xml.replace("<vRetCP>115.50", "<vRetCP>115.51"), "nfse", "homologacao",
      issuerFixture.cnpj, "52998224725", 105000, confirmed.retention), /Retenção XML/);
    assert.throws(() => inspectUnsigned(draft.xml.replace("</vRetCP>", "</vRetCP><vRetCP>115.50</vRetCP>"), "nfse", "homologacao",
      issuerFixture.cnpj, "52998224725", 105000, confirmed.retention), /Retenção XML/);
    assert.throws(() => inspectUnsigned(draft.xml.replace("<vRetCP>115.50</vRetCP>", ""), "nfse", "homologacao",
      issuerFixture.cnpj, "52998224725", 105000, confirmed.retention), /Retenção XML/);
    assert.throws(() => f.service.confirmRetentions(context, f.company, { calculationId: calculation.id, confirmation: true }), /documento fiscal ativo/);
    if (process.env.ALPHA_DPS_RETENTION_TEST_OUTPUT)
      await writeFile(process.env.ALPHA_DPS_RETENTION_TEST_OUTPUT, signXml(draft.xml, "nfse", f.service.vault.identity(context.tenant)));
    await f.service.transmit(context, f.company, draft.id, draft.key);
    assert.equal(f.state().transmissions, 1);
    assert.equal(f.company.finance.entries[0]!.amount, 105000);
    assert.equal(f.company.finance.entries[0]!.settlements.length, 0);
  } finally { f.store.db.close(); }
});
test("confirmação de retenções recusa revisão obsoleta, sem confirmação, outra empresa, baixas e remessas", () => {
  const f = fixture();
  try {
    const calculation = retainedCalculation(f);
    const input = { calculationId: calculation.id, confirmation: true };
    assert.throws(() => f.service.confirmRetentions(context, f.company, { ...input, confirmation: false }));
    assert.throws(() => f.service.confirmRetentions({ ...context, tenant: "another" }, f.company, input), /não encontrada/);
    f.company.finance.entries[0]!.settlements.push({ amount: 1, reversed: false });
    assert.throws(() => f.service.confirmRetentions(context, f.company, input), /obsoleta/);
    const withSettlement = new InvoiceCalculation(f.store).prepare(context, f.company, f.service.rules(context),
      { invoiceId: request.invoiceId, date: request.competence, additionalServiceId: request.additionalServiceId });
    assert.throws(() => f.service.confirmRetentions(context, f.company, { calculationId: withSettlement.id, confirmation: true }), /Estorne as baixas/);
    f.company.finance.entries[0]!.settlements = [];
    f.store.put(context.tenant, "remittances", "test", { entryIds: ["entry"] });
    assert.throws(() => f.service.confirmRetentions(context, f.company, input), /já consta de remessa/);
    f.company.finance.entries[0]!.dueOn = "2026-12-01";
    assert.throws(() => f.service.confirmRetentions(context, f.company, input), /obsoleta/);
  } finally { f.store.db.close(); }
});
test("retenções adulteradas, não confirmadas e removidas durante XSD bloqueiam antes da reserva", async () => {
  const f = fixture();
  try {
    const calculation = retainedCalculation(f);
    const confirmed = f.service.confirmRetentions(context, f.company, { calculationId: calculation.id, confirmation: true });
    f.company.finance.entries[0]!.retention = { ...confirmed.retention, irrf: 1576, withheld: 14176, net: 90824 };
    await assert.rejects(f.service.generateDpsDraft(context, f.company, { ...request, confirmRetentions: true }), /obsoleta ou diferente/);
    f.company.finance.entries[0]!.retention = { ...confirmed.retention, confirmedBy: "forged" };
    await assert.rejects(f.service.generateDpsDraft(context, f.company, { ...request, confirmRetentions: true }), /Confirmação.*divergente/);
    f.company.finance.entries[0]!.retention = confirmed.retention;
    const removed = structuredClone(f.company); delete removed.finance.entries[0]!.retention;
    await assert.rejects(f.service.generateDpsDraft(context, f.company, { ...request, confirmRetentions: true }, async () => removed), /Confirme e sincronize/);
    assert.equal(f.numbering.list(context, issuerFixture.cnpj)[0]!.nextNumber, 10);
    assert.equal(f.store.documents(context.tenant).length, 0);
    const draft = await f.service.generateDpsDraft(context, f.company, { ...request, confirmRetentions: true });
    await assert.rejects(f.service.transmit(context, f.company, draft.id, draft.key, async () => removed), /Confirme e sincronize/);
    assert.equal(f.state().transmissions, 0);
  } finally { f.store.db.close(); }
});
test("retenções positivas não são confundidas com débitos próprios PIS/COFINS ou ISS nacional", () => {
  const f = fixture();
  try {
    const matrices = new FiscalMatrix(f.store);
    const original = structuredClone(matrices.list(context)[0]!);
    for (const update of [{ iss: true }, { pisRate: "0.0001" }, { cofinsRate: "3" }]) {
      const matrix = structuredClone(original);
      if (matrix.parameters.kind !== "nfse") throw new Error("Fixture nfse");
      if ("iss" in update) matrix.parameters.iss.retained = true;
      if ("pisRate" in update) matrix.parameters.federalWithholding.pisRate = update.pisRate!;
      if ("cofinsRate" in update) matrix.parameters.federalWithholding.cofinsRate = update.cofinsRate!;
      matrices.save(context, f.service.rules(context), matrix);
      const calculation = new InvoiceCalculation(f.store).prepare(context, f.company, f.service.rules(context),
        { invoiceId: request.invoiceId, date: request.competence, additionalServiceId: request.additionalServiceId });
      assert.throws(() => generateDps(calculation, request), /ainda não liberad/);
    }
    assert.equal(f.numbering.list(context, issuerFixture.cnpj)[0]!.nextNumber, 10);
  } finally { f.store.db.close(); }
});
test("API confirma retenções com origem canônica sem alterar o financeiro automaticamente", async () => {
  const f = fixture(); const calculation = retainedCalculation(f);
  let failApproval = true;
  const server = createServer(createApi(f.service, { authenticate: async () => context, company: async () => f.company,
    approveFinanceChange: async () => {
      assert.throws(() => f.store.assertInvoiceAvailable(context.tenant, "invoice"), /aguardando/);
      if (failApproval) throw new AppError(502, "Supabase indisponível");
    } }, new Set()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const failed = await fetch(`${base}/invoices/retentions/confirm`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calculationId: calculation.id, confirmation: true }) });
    assert.equal(failed.status, 502);
    assert.equal(f.company.finance.entries[0]!.retention, undefined);
    await assert.rejects(f.service.generateDpsDraft(context, f.company, request), /aguardando/);
    failApproval = false;
    const response = await fetch(`${base}/invoices/retentions/confirm`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calculationId: calculation.id, confirmation: true }) });
    assert.equal(response.status, 200);
    const result = await response.json() as { retention: { net: number; withheld: number }; entryId: string };
    assert.equal(result.entryId, "entry"); assert.equal(result.retention.net, 90825); assert.equal(result.retention.withheld, 14175);
    assert.equal(f.company.finance.entries[0]!.retention, undefined);
    f.company.finance.entries[0]!.retention = f.service.confirmRetentions(context, f.company,
      { calculationId: calculation.id, confirmation: true }).retention;
    const synced = await fetch(`${base}/finance/links`);
    assert.equal(synced.status, 200);
    assert.doesNotThrow(() => f.store.assertInvoiceAvailable(context.tenant, "invoice"));
    const clear = await fetch(`${base}/invoices/retentions/clear`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calculationId: calculation.id, entryId: "entry", confirmation: true }) });
    assert.equal(clear.status, 200);
    assert.deepEqual(await clear.json(), { entryId: "entry", calculationId: calculation.id });
    assert.ok(f.company.finance.entries[0]!.retention, "API only confirms; frontend must save canonically");
    assert.throws(() => f.store.assertInvoiceAvailable(context.tenant, "invoice"), /aguardando/);
    delete f.company.finance.entries[0]!.retention;
    assert.equal((await fetch(`${base}/finance/links`)).status, 200);
    assert.doesNotThrow(() => f.store.assertInvoiceAvailable(context.tenant, "invoice"));
    assert.equal(f.state().transmissions, 0);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); f.store.db.close(); }
});
test("remoção explícita permite corrigir matriz sem retenção e preserva proteções de baixas/documentos/remessas", async () => {
  const f = fixture();
  try {
    const calculation = retainedCalculation(f);
    f.company.finance.entries[0]!.retention = f.service.confirmRetentions(context, f.company,
      { calculationId: calculation.id, confirmation: true }).retention;
    const input = { entryId: "entry", calculationId: calculation.id, confirmation: true };
    assert.throws(() => f.service.clearRetentions(context, f.company, { ...input, confirmation: false }));
    assert.throws(() => f.service.clearRetentions({ ...context, tenant: "other" }, f.company, input), /nesta empresa/);
    f.company.finance.entries[0]!.settlements.push({ amount: 1, reversed: false });
    assert.throws(() => f.service.clearRetentions(context, f.company, input), /Estorne/);
    f.company.finance.entries[0]!.settlements = [];
    const draft = await f.service.generateDpsDraft(context, f.company, { ...request, confirmRetentions: true });
    assert.throws(() => f.service.clearRetentions(context, f.company, input), /documento fiscal ativo/);
    f.service.discardDraft(context, draft.id);
    const matrices = new FiscalMatrix(f.store);
    const matrix = matrices.list(context)[0]!;
    if (matrix.parameters.kind !== "nfse") throw new Error("Fixture nfse");
    matrix.parameters.federalWithholding = { irrfRate: "0", inssRate: "0", csllRate: "0", pisRate: "0", cofinsRate: "0" };
    matrices.save(context, f.service.rules(context), matrix);
    assert.deepEqual(f.service.clearRetentions(context, f.company, input), { entryId: "entry", calculationId: calculation.id });
    f.store.put(context.tenant, "remittances", "old", { entryIds: ["entry"] });
    assert.throws(() => f.service.clearRetentions(context, f.company, input), /remessa/);
    delete f.company.finance.entries[0]!.retention;
    assert.equal(f.company.finance.entries[0]!.amount, 105000);
    assert.ok(f.store.get(context.tenant, "retentionReviews", calculation.id), "audit history survives removal");
  } finally { f.store.db.close(); }
});
test("conciliação persistente e XML com retenções continuam válidos após reinício", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-retention-"));
  let active: Store | undefined;
  try {
    const first = fixture(directory); active = first.store;
    const calculation = retainedCalculation(first);
    first.company.finance.entries[0]!.retention = first.service.confirmRetentions(context, first.company,
      { calculationId: calculation.id, confirmation: true }).retention;
    const draft = await first.service.generateDpsDraft(context, first.company, { ...request, confirmRetentions: true });
    first.store.db.close(); active = undefined;
    const store = new Store(directory); active = store;
    const vault = new CertificateVault(store, randomBytes(32));
    vault.identity = () => identity!;
    const service = new FiscalService(store, vault,
      { validate: async () => {}, ready: async () => ({ nfse: true, nfe: true }) },
      { transmit: async () => ({ status: "incerto", message: "Test", response: "{}" }),
        consult: async () => ({ status: "incerto", message: "Test", response: "{}" }) });
    await service.transmit(context, first.company, draft.id, draft.key);
    assert.ok(store.document(context.tenant, draft.id).signedXml?.includes("<vRetIRRF>15.75</vRetIRRF>"));
  } finally { active?.db.close(); await rm(directory, { recursive: true, force: true }); }
});
test("DPS discrimina serviços, descontos, deslocamento/pedágio e RTC sem duplicar valores ou inventar pagamento XML", async () => {
  const f = fixture();
  try {
    const before = JSON.stringify(f.company);
    const draft = await f.service.generateDpsDraft(context, f.company, request);
    const xml = parseXml(draft.xml);
    assert.equal(draft.status, "rascunho");
    assert.equal(draft.key, `DPS42054072${issuerFixture.cnpj}00001000000000000010`);
    assert.equal(inspectUnsigned(draft.xml, "nfse", "homologacao", issuerFixture.cnpj, "52998224725", 105000), draft.key);
    assert.equal(text(xml, "vServ"), "1150.00");
    assert.equal(text(xml, "vDescIncond"), "100.00");
    for (const description of ["Manutenção & <teste>", "Deslocamento", "Pedágio"]) assert.ok(text(xml, "xDescServ").includes(description));
    assert.equal(text(xml, "dCompet"), "2026-10-14");
    assert.equal(text(xml, "cIndOp"), request.operationIndicator);
    assert.equal(text(single(single(xml, "IBSCBS"), "gIBSCBS"), "CST"), "000");
    assert.equal(elements(xml, "pAliq").length, 0);
    assert.equal(elements(xml, "vISSQN").length, 0);
    assert.equal(elements(xml, "detPag").length, 0);
    assert.equal(f.numbering.list(context, issuerFixture.cnpj)[0]!.nextNumber, 11);
    assert.equal(new FiscalNumbering(f.store).list(context, issuerFixture.cnpj).length, 0);
    assert.equal(JSON.stringify(f.company), before);
    assert.deepEqual(f.state(), { validations: 1, transmissions: 0 });
  } finally { f.store.db.close(); }
});
test("retenções, parâmetros distintos, município, textos longos e adicionais sem classificação bloqueiam geração", async () => {
  const f = fixture();
  try {
    const calculation = new InvoiceCalculation(f.store).prepare(context, f.company, f.service.rules(context),
      { invoiceId: "invoice", date: request.competence, additionalServiceId: "s1" });
    for (const mutate of [
      (copy: typeof calculation) => { if (copy.lines[0]!.matrix.parameters.kind === "nfse") copy.lines[0]!.matrix.parameters.iss.retained = true; },
      (copy: typeof calculation) => { if (copy.lines[0]!.matrix.parameters.kind === "nfse") copy.lines[0]!.matrix.parameters.federalWithholding.pisRate = "1"; },
      (copy: typeof calculation) => { if (copy.lines[1]!.classification.kind === "nfse") copy.lines[1]!.classification.nbs = "999999999"; },
      (copy: typeof calculation) => { if (copy.lines[0]!.matrix.parameters.kind === "nfse") copy.lines[0]!.matrix.parameters.iss.incidenceMunicipality = "3550308"; },
      (copy: typeof calculation) => { copy.lines[0]!.item.name = "x".repeat(2001); },
      (copy: typeof calculation) => { copy.lines[0]!.item.name = "invalid\u0000"; },
      (copy: typeof calculation) => { copy.lines[0]!.matrix.ruleSnapshot.fields.cIndOp = "999999"; },
      (copy: typeof calculation) => { copy.lines[0]!.matrix.ruleSnapshot.fields.regEspTrib = "6"; },
    ]) {
      const copy = structuredClone(calculation); mutate(copy);
      assert.throws(() => generateDps(copy, request));
    }
    const { additionalServiceId: _additional, ...noAdditional } = request;
    await assert.rejects(f.service.generateDpsDraft(context, f.company, noAdditional), /Classifique os adicionais/);
    assert.equal(f.numbering.list(context, issuerFixture.cnpj)[0]!.nextNumber, 10);
  } finally { f.store.db.close(); }
});
test("DPS suporta último número de 15 dígitos e histórico externo impede retrocesso/reuso", async () => {
  const f = fixture();
  try {
    f.numbering.configure(context, issuerFixture.cnpj, { environment: "homologacao", series: 1,
      nextNumber: 999999999999999, expectedNextNumber: 10, confirmation: true });
    const draft = await f.service.generateDpsDraft(context, f.company, { ...request, expectedNumber: 999999999999999 });
    assert.ok(draft.key.endsWith("999999999999999"));
    assert.equal(text(parseXml(draft.xml), "nDPS"), "999999999999999");
    assert.equal(f.numbering.list(context, issuerFixture.cnpj)[0]!.nextNumber, 1000000000000000);
    f.service.discardDraft(context, draft.id);
    await assert.rejects(f.service.generateDpsDraft(context, f.company, { ...request, expectedNumber: 999999999999999 }), /esgotada/);
    const historical = f.store.createDocument(context.tenant, { invoiceId: "legacy", kind: "nfse", environment: "homologacao",
      key: `DPS42054072${issuerFixture.cnpj}00002000000000000015`, xml: "<legacy/>" });
    f.store.saveDocument(context.tenant, { ...historical, status: "cancelado" });
    assert.throws(() => f.numbering.configure(context, issuerFixture.cnpj, { environment: "homologacao", series: 2,
      nextNumber: 15, expectedNextNumber: null, confirmation: true }), /superar todos/);
    f.numbering.configure(context, issuerFixture.cnpj, { environment: "homologacao", series: 2,
      nextNumber: 16, expectedNextNumber: null, confirmation: true });
  } finally { f.store.db.close(); }
});
test("DPS externa e gerada compartilham contador sem alterar as conferências da referência", async () => {
  const f = fixture();
  try {
    const calculation = new InvoiceCalculation(f.store).prepare(context, f.company, f.service.rules(context),
      { invoiceId: "invoice", date: request.competence, additionalServiceId: "s1" });
    const xml = generateDps(calculation, request).xml.replace("</tribMun>", "<pAliq>5.00</pAliq></tribMun>");
    await assert.rejects(f.service.createDraft(context, f.company, { invoiceId: "invoice", kind: "nfse",
      environment: "homologacao", ruleId: "bling-service-reference", xml: xml.replace("<nDPS>10</nDPS>", "<nDPS>9</nDPS>") }), /Id DPS incompatível/);
    const external = await f.service.createDraft(context, f.company, { invoiceId: "invoice", kind: "nfse",
      environment: "homologacao", ruleId: "bling-service-reference", xml });
    assert.equal(f.numbering.list(context, issuerFixture.cnpj)[0]!.nextNumber, 11);
    f.service.discardDraft(context, external.id);
    await assert.rejects(f.service.generateDpsDraft(context, f.company, request), /número alterado/);
    const next = await f.service.generateDpsDraft(context, f.company, { ...request, expectedNumber: 11 });
    assert.equal(f.numbering.reservations(context, issuerFixture.cnpj).length, 2);
    assert.notEqual(external.key, next.key);
  } finally { f.store.db.close(); }
});
test("DPS falha de XSD, dados alterados durante validação e rollback de origem não consomem número", async () => {
  const f = fixture();
  try {
    const changed = structuredClone(f.company); changed.finance.entries[0]!.paymentMethod = "Pix";
    await assert.rejects(f.service.generateDpsDraft(context, f.company, request, async () => changed), /alterados durante/);
    f.store.db.exec("CREATE TRIGGER fail_dps BEFORE INSERT ON records WHEN NEW.collection='generatedDps' BEGIN SELECT RAISE(ABORT,'forced rollback'); END");
    await assert.rejects(f.service.generateDpsDraft(context, f.company, request), /forced rollback/);
    f.fail();
    await assert.rejects(f.service.generateDpsDraft(context, f.company, request), /XSD recusado/);
    assert.equal(f.numbering.list(context, issuerFixture.cnpj)[0]!.nextNumber, 10);
    assert.equal(f.store.documents(context.tenant).length, 0);
    assert.equal(f.numbering.reservations(context, issuerFixture.cnpj).length, 0);
  } finally { f.store.db.close(); }
});
test("concorrência DPS gera um único documento e transmissão explícita revalida fontes antes e depois do XSD", async () => {
  const f = fixture();
  try {
    const result = await Promise.allSettled([f.service.generateDpsDraft(context, f.company, request), f.service.generateDpsDraft(context, f.company, request)]);
    assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
    const draft = f.store.documents(context.tenant)[0]!;
    const changed = structuredClone(f.company); changed.finance.invoices[0]!.orders![0]!.items![0]!.name = "Alterado";
    await assert.rejects(f.service.transmit(context, changed, draft.id, draft.key), /alterados após/);
    await assert.rejects(f.service.transmit(context, f.company, draft.id, draft.key, async () => changed), /alterados após/);
    assert.equal(f.state().transmissions, 0);
    await f.service.transmit(context, f.company, draft.id, draft.key);
    assert.equal(f.state().transmissions, 1);
    assert.equal(f.numbering.list(context, issuerFixture.cnpj)[0]!.nextNumber, 11);
  } finally { f.store.db.close(); }
});
test("configuração DPS por empresa/CNPJ/série é Master, monotônica e não reutiliza descartados", async () => {
  const f = fixture();
  try {
    assert.throws(() => f.numbering.configure({ ...context, role: "admin" }, issuerFixture.cnpj, {}), /Somente Master/);
    for (const update of [
      { nextNumber: 9, expectedNextNumber: 10 }, { nextNumber: 11, expectedNextNumber: 9 },
      { nextNumber: 10, expectedNextNumber: null },
    ]) assert.throws(() => f.numbering.configure(context, issuerFixture.cnpj,
      { environment: "homologacao", series: 1, confirmation: true, ...update }));
    assert.equal(f.numbering.list({ ...context, tenant: "another" }, issuerFixture.cnpj).length, 0);
    assert.equal(f.numbering.list(context, "00000000000000").length, 0);
    const draft = await f.service.generateDpsDraft(context, f.company, request);
    f.service.discardDraft(context, draft.id);
    await assert.rejects(f.service.generateDpsDraft(context, f.company, request), /número alterado/);
    const next = await f.service.generateDpsDraft(context, f.company, { ...request, expectedNumber: 11 });
    assert.notEqual(next.key, draft.key);
    assert.equal(f.numbering.reservations(context, issuerFixture.cnpj).length, 2);
  } finally { f.store.db.close(); }
});
test("DPS validadores rejeitam produção, competência futura, 2027 e falta de confirmações", () => {
  for (const change of [{ environment: "producao" }, { competence: "2026-10-16" }, { issuedAt: "2027-01-01T12:00:00-03:00" },
    { confirmScope: false }, { confirmUnconditionalDiscount: false }, { operationIndicator: "" }, { series: 50000 },
    { expectedNumber: Number.MAX_SAFE_INTEGER }, { totalTaxPercent: { federal: "101", state: "0", municipal: "5" } }])
    assert.equal(generatedDpsSchema.safeParse({ ...request, ...change }).success, false);
});
test("origem DPS e numeração persistem após reinício e impedem transmissão de fonte antiga", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-dps-restart-"));
  const f = fixture(directory);
  let store = f.store;
  try {
    const draft = await f.service.generateDpsDraft(context, f.company, request);
    store.db.close(); store = new Store(directory);
    const vault = new CertificateVault(store, randomBytes(32)); vault.identity = f.service.vault.identity;
    const service = new FiscalService(store, vault, f.service.validator, f.service.authority, false);
    assert.ok(store.get(context.tenant, "generatedDps", draft.id));
    assert.equal(new FiscalNumbering(store, "nfse").list(context, issuerFixture.cnpj)[0]!.nextNumber, 11);
    f.company.finance.entries[0]!.dueOn = "2026-11-21";
    await assert.rejects(service.transmit(context, f.company, draft.id, draft.key), /alterados após/);
  } finally { store.db.close(); await rm(directory, { recursive: true }); }
});
test("API DPS configura contador, gera, baixa XML e mantém consumo após descarte", async () => {
  const f = fixture();
  const server = createServer(createApi(f.service, { authenticate: async () => context, company: async () => f.company }, new Set()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const headers = { "Content-Type": "application/json" };
    const config = await fetch(`${base}/dps-numbering`, { method: "PUT", headers, body: JSON.stringify({
      environment: "homologacao", series: 2, nextNumber: 1, expectedNextNumber: null, confirmation: true }) });
    assert.equal(config.status, 200);
    const response = await fetch(`${base}/documents/generate-dps`, { method: "POST", headers, body: JSON.stringify(request) });
    assert.equal(response.status, 201);
    const draft = await response.json() as { id: string; key: string; status: string };
    assert.equal(draft.status, "rascunho");
    const download = await fetch(`${base}/documents/${draft.id}/xml`);
    assert.match(await download.text(), /<DPS/);
    const status = await (await fetch(`${base}/status`)).json() as { dpsNumbering: unknown[]; dpsNumberReservations: unknown[] };
    assert.equal(status.dpsNumbering.length, 2);
    assert.equal(status.dpsNumberReservations.length, 1);
    assert.equal((await fetch(`${base}/documents/${draft.id}/discard`, { method: "POST", headers, body: "{}" })).status, 200);
    assert.equal(f.numbering.list(context, issuerFixture.cnpj).find((record) => record.series === 1)!.nextNumber, 11);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); f.store.db.close(); }
});
