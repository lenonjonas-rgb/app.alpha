import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, type FiscalDocument } from "../src/store.js";
import type { Context, CompanyData } from "../src/auth.js";
import { requireNfeCollection } from "../src/nfeCollection.js";
import { authorizedNfe } from "./collectionFixtures.js";

const context: Context = { tenant: "tenant", actor: "admin", role: "admin", token: "synthetic" };
function fixture(directory = ":memory:") {
  const store = new Store(directory);
  const company: CompanyData = { clients: [{ id: "client", name: "Cliente", document: "52998224725", address: "Rua teste" }],
    finance: { accounts: [], invoices: [{ id: "invoice", clientId: "client", amount: 12345, kind: "Produtos", canceled: false,
      orders: [{ orderId: "order", code: "OS1", amount: 12345 }] }],
    entries: [{ id: "entry", clientId: "client", invoiceId: "invoice", amount: 12345, kind: "Receber", canceled: false, party: "Cliente",
      issuedOn: "2026-10-15", dueOn: "2026-11-15", paymentMethod: "Boleto", accountId: "bank", settlements: [] }] } };
  store.put(context.tenant, "settings", "issuer", { cnpj: "11222333000181", name: "Empresa" });
  const document = authorizedNfe(store, context, company, "invoice");
  return { store, company, document, check: () => requireNfeCollection(store, context, company, "invoice") };
}
test("NF-e exige autorização em produção, origem preservada, assinatura válida e protocolo correspondente", () => {
  const f = fixture();
  try {
    const check = f.check();
    assert.equal(check.amount, 12345);
    assert.equal(check.documentId, f.document.id);
    assert.equal(check.accessKey, f.document.key.slice(3));
    assert.match(check.id, /^[a-f0-9]{64}$/);
    assert.equal(check.protocol, f.document.protocol);
    for (const status of ["rascunho", "processando", "enviando", "incerto", "cancelado", "rejeitado"] as const) {
      f.store.saveDocument(context.tenant, { ...f.document, status });
      assert.throws(f.check, /NF-e autorizada em produção/);
    }
    f.store.saveDocument(context.tenant, { ...f.document, environment: "homologacao" });
    assert.throws(f.check, /homologação não libera/);
    f.store.saveDocument(context.tenant, f.document);
    f.store.put(context.tenant, "externalNfeSource", f.document.id, null);
    assert.throws(f.check, /sem origem comercial/);
    assert.throws(() => requireNfeCollection(f.store, { ...context, tenant: "other" }, f.company, "invoice"), /NF-e autorizada/);
  } finally { f.store.db.close(); }
});
test("NF-e recusa adulteração de chave, ambiente, total, destinatário, XML assinado e protocolo", () => {
  const f = fixture();
  try {
    const replaceArtifact = (before: string, after: string) => ({ artifact: f.document.artifact!.replace(before, after) });
    const modifications: Array<Partial<FiscalDocument>> = [
      { artifact: undefined }, { signedXml: undefined }, { protocol: undefined }, { protocol: "142260000000002" },
      { key: f.document.key.slice(0, -1) + (f.document.key.at(-1) === "0" ? "1" : "0") },
      replaceArtifact("<tpAmb>1</tpAmb>", "<tpAmb>2</tpAmb>"),
      replaceArtifact("<cStat>100</cStat>", "<cStat>110</cStat>"),
      replaceArtifact("<vNF>123.45</vNF>", "<vNF>123.44</vNF>"),
      replaceArtifact("<nProt>142260000000001", "<nProt>142260000000002"),
      replaceArtifact(`<chNFe>${f.document.key.slice(3)}`, `<chNFe>${"9".repeat(44)}`),
      replaceArtifact("<digVal>", "<digVal>FORGED"),
      replaceArtifact("<CPF>52998224725", "<CPF>11111111111"),
      { xml: f.document.xml.replace("<vNF>123.45", "<vNF>123.44") },
      { xml: f.document.xml.replace("<tPag>15", "<tPag>17") },
      { signedXml: f.document.signedXml!.replace("<vPag>123.45", "<vPag>123.44") },
      { artifact: f.document.artifact!.replace("</nfeProc>", "<NFe/></nfeProc>") },
    ];
    for (const update of modifications) {
      f.store.saveDocument(context.tenant, { ...f.document, ...update });
      assert.throws(f.check, undefined, `Alteração não pode liberar cobrança: ${JSON.stringify(update).slice(0, 90)}`);
    }
    // Alterar assinatura em ambos os arquivos não contorna a validação criptográfica.
    const signature = f.document.signedXml!.replace(/(<SignatureValue>)(.)/, (_match, start: string, first: string) => start + (first === "A" ? "B" : "A"));
    f.store.saveDocument(context.tenant, { ...f.document, signedXml: signature,
      artifact: f.document.artifact!.replace(f.document.signedXml!, signature) });
    assert.throws(f.check, /Assinatura|signature|Signature/);
  } finally { f.store.db.close(); }
});
test("conta, faturamento, cliente ou emitente alterados não reutilizam autorização antiga", () => {
  const f = fixture();
  try {
    const original = structuredClone(f.company);
    const changes = [
      (data: CompanyData) => { data.finance.entries[0]!.dueOn = "2026-12-01"; },
      (data: CompanyData) => { data.finance.entries[0]!.accountId = "other-bank"; },
      (data: CompanyData) => { data.finance.invoices[0]!.orders![0]!.code = "OS2"; },
      (data: CompanyData) => { data.clients[0]!.document = "11111111111"; },
      (data: CompanyData) => { data.finance.entries.push({ ...data.finance.entries[0]!, id: "duplicate" }); },
    ];
    for (const change of changes) {
      const data = structuredClone(original); change(data);
      assert.throws(() => requireNfeCollection(f.store, context, data, "invoice"), /origem comercial|Origem da NF-e/);
    }
    f.store.put(context.tenant, "settings", "issuer", { cnpj: "12345678000195", name: "Outro" });
    assert.throws(f.check, /origem comercial/);
  } finally { f.store.db.close(); }
});
test("documento ativo adicional, reserva de cancelamento e retenção pendente bloqueiam cobrança", () => {
  const f = fixture();
  try {
    const second = f.store.createDocument(context.tenant, { invoiceId: "invoice", kind: "nfse",
      environment: "homologacao", key: "DPS-other", xml: "" });
    assert.throws(f.check, /nenhum outro documento ativo/);
    f.store.saveDocument(context.tenant, { ...second, status: "cancelado" });
    assert.doesNotThrow(f.check);
    f.store.stageFinanceChange(context.tenant, { invoiceId: "invoice", invoice: f.company.finance.invoices[0]!, entry: f.company.finance.entries[0]! });
    assert.throws(f.check, /aguardando/);
    f.store.synchronizeFinanceChanges(context.tenant, f.company);
    f.store.put(context.tenant, "invoiceCancellations", "invoice", { entryId: "entry" });
    assert.throws(f.check, /cancelamento interno reservado/);
  } finally { f.store.db.close(); }
});
test("origem e vínculo conferido sobrevivem ao reinício sem depender do certificado no cofre", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-nfe-collection-"));
  let store: Store | undefined;
  try {
    const f = fixture(directory); store = f.store;
    const check = f.check();
    store.db.close(); store = new Store(directory);
    assert.deepEqual(requireNfeCollection(store, context, f.company, "invoice"), check);
  } finally { store?.db.close(); await rm(directory, { recursive: true }); }
});
