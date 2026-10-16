import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { Store, type DocumentStatus } from "../src/store.js";
import { companySchema, type CompanyData, type Context } from "../src/auth.js";
import { financeLinks, reserveFinanceCancellation } from "../src/financeLinks.js";
import { RemittanceService } from "../src/remittance.js";
import { CertificateVault } from "../src/certificate.js";
import { FiscalService } from "../src/service.js";
import { createApi } from "../src/api.js";
import { AppError } from "../src/errors.js";

const context: Context = { tenant: "company", actor: "admin", role: "admin", token: "test" };
function company(): CompanyData {
  return companySchema.parse({
    clients: [{ id: "client", name: "Cliente", document: "52998224725", address: "" }],
    finance: { invoices: [
      { id: "products", clientId: "client", kind: "Produtos", amount: 10000, canceled: false },
      { id: "services", clientId: "client", kind: "Serviços", amount: 20000, canceled: false },
    ], entries: [
      { id: "entry-products", invoiceId: "products", kind: "Receber", party: "Cliente", clientId: "client", amount: 10000,
        dueOn: "2026-11-01", issuedOn: "2026-10-15", paymentMethod: "Boleto", accountId: "bank", canceled: false, settlements: [] },
      { id: "entry-services", invoiceId: "services", kind: "Receber", party: "Cliente", clientId: "client", amount: 20000,
        dueOn: "2026-11-01", issuedOn: "2026-10-15", paymentMethod: "Pix", accountId: "bank", canceled: false, settlements: [] },
    ] },
  });
}
const input = (data: CompanyData, index = 0) => ({
  expectedEntry: data.finance.entries[index]!, expectedInvoice: data.finance.invoices[index]!, confirmation: true,
});
test("vínculos mostram estados reais separados de produção/homologação sem inferir pagamento", () => {
  const store = new Store(":memory:");
  try {
    const data = company();
    const document = store.createDocument(context.tenant, { invoiceId: "products", kind: "nfe", environment: "homologacao", key: "key", xml: "" });
    const linked = financeLinks(store, context, data);
    assert.equal(linked[0]!.documents[0]!.status, "rascunho");
    assert.equal(linked[0]!.documents[0]!.environment, "homologacao");
    assert.equal(linked[0]!.cancellationAllowed, false);
    assert.equal(linked[1]!.cancellationAllowed, true);
    store.saveDocument(context.tenant, { ...document, status: "autorizado", protocol: "12345" });
    assert.equal(financeLinks(store, context, data)[0]!.documents[0]!.protocol, "12345");
    assert.equal(data.finance.entries[0]!.settlements.length, 0);
    assert.equal(financeLinks(store, { ...context, tenant: "other" }, data)[0]!.documents.length, 0);
  } finally { store.db.close(); }
});
test("qualquer documento ativo ou incerto impede cancelamento, inclusive homologação e rascunho", () => {
  const store = new Store(":memory:");
  try {
    const data = company();
    const document = store.createDocument(context.tenant, { invoiceId: "products", kind: "nfe", environment: "homologacao", key: "key", xml: "" });
    const blocked: DocumentStatus[] = ["rascunho", "enviando", "incerto", "processando", "autorizado"];
    for (const status of blocked) {
      store.saveDocument(context.tenant, { ...document, status });
      assert.throws(() => reserveFinanceCancellation(store, context, data, input(data)), /documento fiscal ativo/);
      assert.equal(store.list(context.tenant, "financeCancellations").length, 0);
    }
    for (const status of ["rejeitado", "cancelado"] as const) {
      store.saveDocument(context.tenant, { ...document, status });
      assert.equal(financeLinks(store, context, data)[0]!.cancellationAllowed, true);
    }
    store.put(context.tenant, "remittances", "remittance", { id: "remittance", entryIds: ["entry-products"], createdAt: "now", fileSequence: 1 });
    assert.throws(() => reserveFinanceCancellation(store, context, data, input(data)), /remessa/);
    assert.equal(financeLinks(store, context, data)[0]!.remittances[0]!.fileSequence, 1);
    assert.equal(financeLinks(store, context, data)[1]!.cancellationAllowed, true);
  } finally { store.db.close(); }
});
test("reserva exige confirmação/origem atual e bloqueia emissão/remessa enquanto JSON aguarda sincronização", () => {
  const store = new Store(":memory:");
  try {
    const data = company(); const before = JSON.stringify(data);
    assert.throws(() => reserveFinanceCancellation(store, context, data, { ...input(data), confirmation: false }));
    assert.throws(() => reserveFinanceCancellation(store, context, data, { ...input(data), expectedEntry: { ...data.finance.entries[0], amount: 1 } }), /alterada/);
    assert.throws(() => reserveFinanceCancellation(store, context, data, { ...input(data), expectedInvoice: data.finance.invoices[1] }), /Faturamento/);
    data.finance.entries[0]!.settlements.push({ amount: 1, reversed: false });
    assert.throws(() => reserveFinanceCancellation(store, context, data, input(data)), /Estorne/);
    data.finance.entries[0]!.settlements = [];
    const reservation = reserveFinanceCancellation(store, context, data, input(data));
    assert.equal(JSON.stringify(data), before, "Reserva não modifica payload Supabase");
    assert.deepEqual(reserveFinanceCancellation(store, context, data, input(data)), reservation, "Retentativa idempotente após falha de sincronização");
    assert.equal(financeLinks(store, context, data)[0]!.cancellationPending, true);
    assert.throws(() => store.createDocument(context.tenant, { invoiceId: "products", kind: "nfe", environment: "homologacao", key: "key", xml: "" }), /cancelamento interno reservado/);
    assert.doesNotThrow(() => store.assertInvoiceAvailable(context.tenant, "services"));
    assert.doesNotThrow(() => store.assertInvoiceAvailable("other", "products"));
    store.put(context.tenant, "settings", "issuer", { cnpj: "11222333000181", name: "Empresa teste" });
    const remittance = new RemittanceService(store);
    remittance.saveConfig(context, { accountId: "bank", agencia: "1234", conta: "56789", dac: "0", carteira: "109",
      codigoCarteira: "I", primeiroNossoNumero: "00000001", sequenciaInicialArquivo: 1 });
    assert.throws(() => remittance.create(context, data, { accountId: "bank", entryIds: ["entry-products"], addresses: {} }), /cancelamento interno reservado/);
    assert.equal(remittance.config(context, "bank")!.nextFileSequence, 1);
    assert.equal(remittance.list(context).length, 0);
    data.finance.entries[0]!.canceled = true; data.finance.invoices[0]!.canceled = true;
    assert.equal(financeLinks(store, context, data)[0]!.cancellationPending, false);
    assert.equal(financeLinks(store, context, data)[0]!.cancellationAllowed, false);
  } finally { store.db.close(); }
});
test("reserva persiste entre conexões/reinício e protege contra criação tardia de documento", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-finance-cancel-"));
  let first: Store | undefined, second: Store | undefined;
  try {
    first = new Store(directory); second = new Store(directory);
    const data = company();
    const reservation = reserveFinanceCancellation(first, context, data, input(data));
    assert.throws(() => second!.createDocument(context.tenant, { invoiceId: "products", kind: "nfe", environment: "homologacao", key: "late", xml: "" }), /reservado/);
    first.db.close(); first = undefined; second.db.close(); second = undefined;
    second = new Store(directory);
    assert.equal(second.get<{ id: string }>(context.tenant, "invoiceCancellations", "products")!.id, reservation.id);
    assert.equal(financeLinks(second, context, data)[0]!.cancellationPending, true);
    data.finance.entries[0]!.dueOn = "2026-12-01";
    const retried = reserveFinanceCancellation(second, context, data, input(data));
    assert.notEqual(retried.id, reservation.id, "Nova confirmação explícita permite concluir após mudança canônica, sem liberar emissão");
    assert.equal(second.get<{ id: string }>(context.tenant, "financeCancellationHistory", reservation.id)!.id, reservation.id);
    assert.throws(() => second!.assertInvoiceAvailable(context.tenant, "products"), /reservado/);
  } finally { first?.db.close(); second?.db.close(); await rm(directory, { recursive: true, force: true }); }
});
test("cancelamento de conta manual preserva histórico de baixas estornadas e rejeita vínculos inconsistentes", () => {
  const store = new Store(":memory:");
  try {
    const data = company();
    const manual = { ...data.finance.entries[0]!, id: "manual", kind: "Pagar" as const, invoiceId: undefined,
      settlements: [{ amount: 100, reversed: true }] };
    data.finance.entries.push(manual);
    const reserved = reserveFinanceCancellation(store, context, data, { expectedEntry: manual, confirmation: true });
    assert.equal(reserved.invoiceId, undefined);
    assert.equal(manual.settlements[0]!.reversed, true);
    assert.equal(manual.canceled, false);
    const corrupted = company(); corrupted.finance.entries[0]!.amount = 9999;
    assert.throws(() => reserveFinanceCancellation(store, context, corrupted, input(corrupted)), /inconsistente/);
    const duplicates = company(); duplicates.finance.entries.push({ ...duplicates.finance.entries[0]! });
    assert.throws(() => financeLinks(store, context, duplicates), /duplicados/);
  } finally { store.db.close(); }
});
test("alteração financeira pendente persiste após reinício e somente a origem canônica esperada libera emissão", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-finance-pending-"));
  let store = new Store(directory);
  try {
    const data = company(); const entry = data.finance.entries[1]!, invoice = data.finance.invoices[1]!;
    const retention = { calculationId: "a".repeat(64), invoiceAmount: 20000, withheld: 1000, net: 19000,
      irrf: 1000, inss: 0, csll: 0, confirmedAt: "2026-10-15T12:00:00Z", confirmedBy: context.actor };
    store.stageFinanceChange(context.tenant, { invoiceId: invoice.id, invoice, entry: { ...entry, retention } });
    store.db.close(); store = new Store(directory);
    store.synchronizeFinanceChanges(context.tenant, data);
    assert.throws(() => store.assertInvoiceAvailable(context.tenant, invoice.id), /aguardando/);
    assert.throws(() => reserveFinanceCancellation(store, context, data, input(data, 1)), /aguardando/);
    entry.retention = retention;
    store.synchronizeFinanceChanges("other", data);
    assert.throws(() => store.assertInvoiceAvailable(context.tenant, invoice.id), /aguardando/);
    entry.amount = 21000;
    store.synchronizeFinanceChanges(context.tenant, data);
    assert.throws(() => store.assertInvoiceAvailable(context.tenant, invoice.id), /aguardando/);
    entry.amount = 20000;
    entry.settlements.push({ amount: 100, reversed: false });
    store.synchronizeFinanceChanges(context.tenant, data);
    assert.doesNotThrow(() => store.assertInvoiceAvailable(context.tenant, invoice.id));
    assert.equal(entry.retention.net, 19000);
    assert.equal(store.list(context.tenant, "pendingFinanceChanges").length, 0);
  } finally { store.db.close(); await rm(directory, { recursive: true }); }
});
test("API autentica vínculos/cancelamento e reserva sem escrever ou cancelar nota/boleto", async () => {
  const store = new Store(":memory:"); const data = company();
  let failApproval = true;
  const service = new FiscalService(store, new CertificateVault(store, randomBytes(32)),
    { ready: async () => ({ nfe: false, nfse: false }), validate: async () => {} },
    { transmit: async () => { throw new Error("Não transmitir"); }, consult: async () => { throw new Error("Não consultar"); } }, false);
  const server = createServer(createApi(service, { authenticate: async (header) => {
    if (header !== "Bearer test") throw new AppError(401, "Autenticação necessária.");
    return context;
  }, company: async () => structuredClone(data), approveFinanceChange: async (_context, change) => {
    assert.equal(change.action, "cancel"); assert.equal(change.entry.id, "entry-products");
    assert.throws(() => store.assertInvoiceAvailable(context.tenant, "products"), /reservado/);
    if (failApproval) throw new AppError(502, "Supabase indisponível");
  } }, new Set()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/finance/links`)).status, 401);
    assert.equal((await fetch(`${base}/finance/cancellations`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input(data)) })).status, 401);
    const links = await fetch(`${base}/finance/links`, { headers: { Authorization: "Bearer test" } });
    assert.equal(links.status, 200);
    assert.equal((await links.json() as { entries: unknown[] }).entries.length, 2);
    const failed = await fetch(`${base}/finance/cancellations`, { method: "POST",
      headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: JSON.stringify(input(data)) });
    assert.equal(failed.status, 502);
    const reserved = store.get<{ id: string }>(context.tenant, "financeCancellations", "entry-products")!;
    assert.ok(reserved);
    assert.equal(data.finance.entries[0]!.canceled, false);
    failApproval = false;
    const response = await fetch(`${base}/finance/cancellations`, { method: "POST",
      headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: JSON.stringify(input(data)) });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { entryId: string }).entryId, "entry-products");
    assert.equal(store.get<{ id: string }>(context.tenant, "financeCancellations", "entry-products")!.id, reserved.id);
    assert.equal(data.finance.entries[0]!.canceled, false);
    assert.equal(store.documents(context.tenant).length, 0);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); store.db.close(); }
});
