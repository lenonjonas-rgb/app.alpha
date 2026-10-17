/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { billOrders, cancelFinanceEntry, applyFinanceRetention, settleFinanceEntry, reverseSettlement } from "./finance";
import { demoDatabase, getOrderDetails, localDay } from "./domain";
import { classifyFinanceEntry, saveCostCenter, saveFinanceCategory, saveOpeningBalance } from "./financeManagement";
import { banking, importStatement, matchBankSettlement, unmatchBankSettlement, matchBankTransfer, unmatchBankTransfer,
  activeBankMatch, matchBankSettlementGroup } from "./bankReconciliation";
import { recordFinanceTransfer, reverseFinanceTransfer } from "./financeTransfers";
import { saveBankAccount } from "./finance";
import { saveFinanceInstallments } from "./financeInstallments";
import { saveFinanceEntry, entryBalance } from "./finance";
import { changeRecurrenceStatus, generateRecurringEntries, previewRecurringEntries, saveFinanceRecurrence } from "./financeRecurrences";
import type { FinanceRecurrence } from "./financeSchema";
import { cancelPurchaseOrder, previewPurchaseSchedule, purchasing, receivePurchaseOrder, savePurchaseOrder, saveSupplier } from "./purchasing";

const owner = "00000000-0000-4000-8000-000000000001";
const tech = "00000000-0000-4000-8000-000000000002";
const company = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const db = new PGlite();
function fixture() {
  const data = demoDatabase();
  data.finance.accounts = [{ id: "bank", name: "Teste", bank: "Teste", agency: "", account: "", kind: "Corrente", active: true }];
  const order = data.orders[0];
  order.status = "Finalizada";
  order.details = { ...getOrderDetails(order), items: [{ id: "service-line", kind: "servico", referenceId: data.services[0].id,
    name: "Servico", quantity: 1, price: 10000, discount: 0 }], costs: [], discount: 0, travel: undefined };
  return billOrders(data, [order.id], { Serviços: { accountId: "bank", dueOn: localDay(), paymentMethod: "Boleto" } });
}
let baseline = fixture();
async function identity(role: string, actor = owner) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await db.exec(`set role ${role}`);
}
async function save(payload: unknown, revision = 1) {
  return db.query("select public.save_company_data($1::jsonb,$2) as revision", [JSON.stringify(payload), revision]);
}
async function approve(action: string, data = baseline, retention: unknown = null) {
  await identity("service_role");
  await db.query("select public.approve_finance_change($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb)",
    [company, owner, JSON.stringify(data.finance.entries[0]), JSON.stringify(data.finance.invoices[0]), action, JSON.stringify(retention)]);
  await identity("authenticated");
}
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
  `);
  await db.exec(await readFile(new URL("../../supabase/migrations/20261008010000_tenant_auth_and_company_data.sql", import.meta.url), "utf8"));
  await db.query("insert into auth.users values ($1,'owner@test'),($2,'tech@test')", [owner, tech]);
  await db.query("insert into public.companies(id,name,created_by) values ($1,'Empresa',$2),($3,'Outra',$2)", [company, owner, otherCompany]);
  await db.query("insert into public.company_memberships(user_id,company_id,role) values ($1,$2,'owner'),($3,$2,'technician')", [owner, company, tech]);
  // A migração protege o histórico existente, sem migrar/recalcular valores.
  await db.query("insert into public.company_data(company_id,payload) values ($1,$2)", [company, JSON.stringify(baseline)]);
  await db.exec(await readFile(new URL("../../supabase/migrations/20261015040000_finance_history_guards.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261016010000_bank_reconciliation_guards.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261016020000_finance_transfer_guards.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261016030000_bank_transfer_match_guards.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261016040000_finance_installment_guards.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261016050000_settlement_adjustment_guards.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261016060000_finance_recurrence_guards.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261016070000_purchase_guards.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261020010000_bank_reconciliation_groups.sql", import.meta.url), "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("reset role");
  await db.exec("alter table public.company_data disable trigger guard_purchases");
  await db.exec("alter table public.company_data disable trigger guard_finance_recurrences");
  await db.exec("alter table public.company_data disable trigger guard_finance_history; alter table public.company_data disable trigger guard_bank_reconciliation; alter table public.company_data disable trigger guard_finance_transfers; alter table public.company_data disable trigger guard_bank_transfer_matches; alter table public.company_data disable trigger guard_finance_installments; alter table public.company_data disable trigger guard_finance_settlement_adjustments; alter table public.company_data disable trigger guard_bank_reconciliation_groups");
  baseline = fixture();
  await db.query("update public.company_data set payload=$1,revision=1 where company_id=$2", [JSON.stringify(baseline), company]);
  await db.exec("delete from public.finance_change_permits; alter table public.company_data enable trigger guard_finance_history; alter table public.company_data enable trigger guard_bank_reconciliation; alter table public.company_data enable trigger guard_finance_transfers; alter table public.company_data enable trigger guard_bank_transfer_matches; alter table public.company_data enable trigger guard_finance_installments; alter table public.company_data enable trigger guard_finance_settlement_adjustments; alter table public.company_data enable trigger guard_bank_reconciliation_groups");
  await db.exec("alter table public.company_data enable trigger guard_finance_recurrences");
  await db.exec("alter table public.company_data enable trigger guard_purchases");
  await identity("authenticated");
});
afterAll(async () => { await db.close(); });
describe("proteção financeira no PostgreSQL", () => {
  const supplier = { id: "supplier", name: "Fornecedor", document: "11222333000181",
    phone: "", email: "compras@example.test", address: "", active: true };
  function purchaseFixture(count = 3, total = 10000) {
    let data = saveSupplier(baseline, supplier);
    data = saveFinanceCategory(data, { id: "purchase-category", name: "Compras", kind: "Pagar", active: true });
    data = saveCostCenter(data, { id: "purchase-center", name: "Compras", active: true });
    const quoteId = "purchase-quote";
    return savePurchaseOrder(data, { id: "purchase", supplierId: supplier.id, supplierName: supplier.name, supplierDocument: supplier.document,
      description: "Compra de peças", items: [{ description: "Peça", quantity: 1, unitCost: total }],
      schedule: previewPurchaseSchedule(total, count, "2026-01-31"), accountId: "bank", paymentMethod: "Pix",
      categoryId: "purchase-category", costCenterId: "purchase-center",
      orderedOn: "2026-01-01", createdAt: "2026-01-01T12:00:00Z",
      procurement: {
        quotes: [{ id: quoteId, supplierId: supplier.id, supplierName: supplier.name,
          amount: total, quotedOn: "2026-01-01", reference: "Cotação registrada", terms: "" }],
        selectedQuoteId: quoteId, quoteExceptionReason: "Somente um fornecedor disponível para esta compra.",
        approval: { at: "2026-01-01T12:00:00Z", approverUserId: owner, approverName: "Administrador",
          approverRole: "owner", reason: "Compra aprovada conforme necessidade operacional." },
      } }, true);
  }
  function receivePurchase(data = purchaseFixture()) {
    return receivePurchaseOrder(data, purchasing(data).orders[0], { date: localDay(), reference: "NF 123", notes: "Recebimento integral conferido" }, true);
  }
  it("persiste recebimento integral atomico, parcelas e classificacao sem regerar apos cancelamento de conta", async () => {
    const source = purchaseFixture();
    await save(source);
    const data = receivePurchase(source);
    await save(data, 2);
    await expect(save(receivePurchase(source), 2)).rejects.toThrow();
    expect(data.finance.entries.slice(1).map((entry) => entry.amount)).toEqual([3334, 3333, 3333]);
    const stored = await db.query<{ payload: typeof data }>("select payload from public.company_data where company_id=$1", [company]);
    expect(stored.rows[0].payload.finance.purchasing).toEqual(data.finance.purchasing);
    const canceled = cancelFinanceEntry(data, data.finance.entries[1].id);
    await save(canceled, 3);
    const duplicate = structuredClone(canceled);
    duplicate.finance.entries.push({ ...duplicate.finance.entries[1], id: "duplicate", canceled: false });
    await expect(save(duplicate, 4)).rejects.toThrow();
    const reclassified = classifyFinanceEntry(canceled, { entryId: canceled.finance.entries[1].id });
    await save(reclassified, 4);
  });
  it("permite pagamento unico e liquidacao posterior sem alterar recebimento", async () => {
    const source = purchaseFixture(1, 1);
    await save(source);
    let data = receivePurchase(source);
    await save(data, 2);
    data = settleFinanceEntry(data, data.finance.entries[1].id, { id: "pay", date: localDay(), amount: 1, accountId: "bank" });
    await save(data, 3);
    expect(data.finance.entries[1].installment).toBeUndefined();
  });
  it("rejeita reescrita/remocao de pedido, recebimento, fornecedor e origem da conta em escrita direta", async () => {
    const source = purchaseFixture();
    await save(source);
    const data = receivePurchase(source);
    await save(data, 2);
    const attempts = [
      (value: typeof data) => { delete value.finance.purchasing; },
      (value: typeof data) => { value.finance.purchasing!.orders = []; },
      (value: typeof data) => { value.finance.purchasing!.suppliers = []; },
      (value: typeof data) => { value.finance.purchasing!.orders[0].description = "Alterado"; },
      (value: typeof data) => { delete value.finance.purchasing!.orders[0].receipt; },
      (value: typeof data) => { value.finance.purchasing!.orders[0].receipt!.notes = "Reescrito"; },
      (value: typeof data) => { value.finance.purchasing!.orders[0].receipt!.entryIds.reverse(); },
      (value: typeof data) => { delete value.finance.entries[1].purchaseId; },
    ];
    for (const mutate of attempts) { const value = structuredClone(data); mutate(value); await expect(save(value, 3)).rejects.toThrow(); }
    await identity("service_role");
    await expect(db.query("delete from public.company_data where company_id=$1", [company])).rejects.toThrow();
  });
  it("valida fornecedores por escrita direta, CPF/CNPJ numerico e alfanumerico sem duplicidade", async () => {
    const source = purchaseFixture();
    const attempts = [
      { ...supplier, document: "11222333000182" }, { ...supplier, document: "00000000000" },
      { ...supplier, name: "" }, { ...supplier, email: "invalid" }, { ...supplier, email: "a..b@example.test" },
      { ...supplier, active: "true" },
    ];
    for (const item of attempts) {
      const value = structuredClone(source);
      await expect(save({ ...value, finance: { ...value.finance, purchasing: { ...value.finance.purchasing, suppliers: [item] } } })).rejects.toThrow();
    }
    const duplicate = structuredClone(source);
    duplicate.finance.purchasing!.suppliers.push({ ...supplier, id: "duplicate" });
    await expect(save(duplicate)).rejects.toThrow("duplicados");
    const valid = structuredClone(source);
    valid.finance.purchasing!.suppliers.push({ ...supplier, id: "cpf", document: "52998224725" },
      { ...supplier, id: "alpha", document: "ABCDEF12345680" });
    await save(valid);
    const edited = saveSupplier(valid, { ...supplier, name: "Cadastro atualizado", active: false }, supplier);
    await save(edited, 2);
    expect(purchasing(edited).orders[0].supplierName).toBe(supplier.name);
  });
  it("rejeita pedido novo invalido, total/rateio incorreto, datas repetidas e referencias inexistentes/inativas", async () => {
    const source = purchaseFixture();
    const attempts = [
      (value: typeof source) => { value.finance.purchasing!.orders[0].items[0].quantity = 1.5; },
      (value: typeof source) => { value.finance.purchasing!.orders[0].items[0].unitCost = 100000001; },
      (value: typeof source) => { value.finance.purchasing!.orders[0].schedule[0].amount++; },
      (value: typeof source) => { value.finance.purchasing!.orders[0].schedule[1].dueOn = "2026-01-31"; },
      (value: typeof source) => { value.finance.purchasing!.orders[0].supplierName = "Outro"; },
      (value: typeof source) => { value.finance.purchasing!.orders[0].supplierId = "missing"; },
      (value: typeof source) => { value.finance.purchasing!.suppliers[0].active = false; },
      (value: typeof source) => { value.finance.accounts[0].active = false; },
      (value: typeof source) => { value.finance.purchasing!.orders[0].orderedOn = "2099-01-01"; },
      (value: typeof source) => { value.finance.purchasing!.orders[0].schedule[0].dueOn = "2025-12-31"; },
      (value: typeof source) => { value.finance.management!.categories[0].active = false; },
    ];
    for (const mutate of attempts) { const value = structuredClone(source); mutate(value); await expect(save(value)).rejects.toThrow(); }
    await expect(save(receivePurchase(source))).rejects.toThrow("Novo pedido");
  });
  it("rejeita recebimento parcial, contas adulteradas, sem classificacao e referencia inativa atomicamente", async () => {
    const source = purchaseFixture();
    await save(source);
    const data = receivePurchase(source);
    const premature = structuredClone(data);
    delete premature.finance.purchasing!.orders[0].receipt;
    await expect(save(premature, 2)).rejects.toThrow("nao recebido");
    const attempts = [
      (value: typeof data) => { value.finance.purchasing!.orders[0].receipt!.entryIds.pop(); value.finance.entries.pop(); },
      (value: typeof data) => { value.finance.purchasing!.orders[0].receipt!.entryIds[1] = value.finance.entries[1].id; },
      (value: typeof data) => { value.finance.purchasing!.orders[0].receipt!.notes = ""; },
      (value: typeof data) => { value.finance.purchasing!.orders[0].receipt!.date = "2099-01-01"; },
      (value: typeof data) => { value.finance.purchasing!.orders[0].receipt!.date = "2025-12-31"; },
      (value: typeof data) => { value.finance.purchasing!.suppliers[0].active = false; },
      (value: typeof data) => { value.finance.management!.classifications = []; },
      (value: typeof data) => { value.finance.entries.slice(1).forEach((entry) => { entry.party = "Outro"; }); },
      (value: typeof data) => { value.finance.entries.slice(1).forEach((entry) => { entry.purchaseId = "unknown"; }); },
      (value: typeof data) => { value.finance.entries.slice(1).forEach((entry) => { entry.kind = "Receber"; }); },
    ];
    for (const mutate of attempts) { const value = structuredClone(data); mutate(value); await expect(save(value, 2)).rejects.toThrow(); }
    await save(data, 2);
    const changed = saveSupplier(data, { ...supplier, active: false }, supplier);
    await save(changed, 3);
  });
  it("preserva cancelamento definitivo e impede recebimento ou contas de pedido cancelado", async () => {
    const source = purchaseFixture();
    await save(source);
    const data = cancelPurchaseOrder(source, purchasing(source).orders[0], "Fornecedor não entregou", true);
    await save(data, 2);
    const restored = structuredClone(data);
    delete restored.finance.purchasing!.orders[0].cancellation;
    await expect(save(restored, 3)).rejects.toThrow("reescritos");
    const received = receivePurchase(source);
    received.finance.purchasing!.orders[0].cancellation = data.finance.purchasing!.orders[0].cancellation;
    await expect(save(received, 3)).rejects.toThrow();
    const withoutReceipt = receivePurchase(source);
    delete withoutReceipt.finance.purchasing!.orders[0].receipt;
    await expect(save(withoutReceipt, 3)).rejects.toThrow();
  });
  const recurrence: FinanceRecurrence = { id: "monthly", kind: "Pagar", party: "Fornecedor", description: "Mensalidade",
    amount: 10001, accountId: "bank", paymentMethod: "Pix", firstDueOn: "2026-01-31", endsOn: "2026-12-31",
    createdAt: "2026-01-01T12:00:00Z", events: [] };
  const recurrenceFixture = () => saveFinanceRecurrence(baseline, recurrence, true);
  function recurring(data = recurrenceFixture(), from = "2026-01", through = "2026-03") {
    return generateRecurringEntries(data, data.finance.recurrences![0], from, through,
      previewRecurringEntries(data, recurrence.id, from, through), true);
  }
  it("persiste recorrencia e geracao mensal sem duplicidade e preserva mes de conta cancelada", async () => {
    const source = recurrenceFixture();
    await save(source);
    const data = recurring(source);
    await save(data, 2);
    const stored = await db.query<{ payload: typeof data }>("select payload from public.company_data where company_id=$1", [company]);
    expect(stored.rows[0].payload.finance.recurrences).toEqual([recurrence]);
    expect(stored.rows[0].payload.finance.entries.slice(1).map((entry) => entry.dueOn)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    const canceled = cancelFinanceEntry(data, data.finance.entries[1].id);
    await save(canceled, 3);
    const duplicate = structuredClone(canceled);
    duplicate.finance.entries.push({ ...duplicate.finance.entries[1], id: "duplicate", canceled: false });
    await expect(save(duplicate, 4)).rejects.toThrow("ja gerado");
    await expect(save(data, 3)).rejects.toThrow("another session");
    await save(recurring(canceled, "2026-01", "2026-04"), 4);
  });
  it("protege definicao e historico de situacao; suspensao/cancelamento bloqueiam geracao mas preservam contas", async () => {
    let data = recurring();
    await save(data);
    for (const mutate of [
      (copy: typeof data) => { copy.finance.recurrences = []; },
      (copy: typeof data) => { copy.finance.recurrences![0].amount++; },
      (copy: typeof data) => { copy.finance.recurrences![0].endsOn = "2027-12-31"; },
    ]) {
      const changed = structuredClone(data); mutate(changed);
      await expect(save(changed, 2)).rejects.toThrow(/reescritos|incompativel/);
    }
    const extra = recurring(data, "2026-04", "2026-04").finance.entries.at(-1)!;
    data = changeRecurrenceStatus(data, data.finance.recurrences![0], "Suspensa", "Pausa negociada", true);
    await save(data, 2);
    const forbidden = structuredClone(data); forbidden.finance.entries.push(extra);
    await expect(save(forbidden, 3)).rejects.toThrow("ativas");
    const rewritten = structuredClone(data); rewritten.finance.recurrences![0].events[0].reason = "Outro motivo";
    await expect(save(rewritten, 3)).rejects.toThrow("imutavel");
    const cleared = structuredClone(data); cleared.finance.recurrences![0].events = [];
    await expect(save(cleared, 3)).rejects.toThrow("imutavel");
    data = changeRecurrenceStatus(data, data.finance.recurrences![0], "Ativa", "Retomar pagamentos", true);
    await save(data, 3);
    data = recurring(data, "2026-04", "2026-04");
    await save(data, 4);
    data = changeRecurrenceStatus(data, data.finance.recurrences![0], "Cancelada", "Vigencia encerrada", true);
    await save(data, 5);
    const reactivated = structuredClone(data);
    reactivated.finance.recurrences![0].events.push({ status: "Ativa", at: new Date().toISOString(), reason: "Tentar reativar" });
    await expect(save(reactivated, 6)).rejects.toThrow("definitivo");
    await db.exec("reset role");
    const removed = structuredClone(data); delete removed.finance.recurrences;
    await expect(db.query("update public.company_data set payload=$1 where company_id=$2", [JSON.stringify(removed), company])).rejects.toThrow("removidos");
    await identity("authenticated");
  });
  it("SQL valida origem, vencimento mensal, vigencia e estado ativo sem confiar no frontend", async () => {
    const source = recurrenceFixture();
    await save(source);
    const data = recurring(source);
    for (const change of [{ amount: 1 }, { dueOn: "2026-01-30" }, { party: "Outro" }, { accountId: "missing" },
      { recurrence: { id: "missing", period: "2026-01" } }, { recurrence: { id: recurrence.id, period: "2027-01" } },
      { recurrence: { id: recurrence.id, period: "2026-13" } }, { recurrence: null }, { invoiceId: baseline.finance.invoices[0].id }]) {
      const changed = structuredClone(data); Object.assign(changed.finance.entries[1], change);
      await expect(save(changed, 2)).rejects.toThrow();
    }
    const inactive = structuredClone(data); inactive.finance.accounts[0].active = false;
    await expect(save(inactive, 2)).rejects.toThrow("ativas");
    await save(data, 2);
    inactive.finance.entries = structuredClone(data.finance.entries);
    await save(inactive, 3);
  });
  it("SQL rejeita recorrencias invalidas e historico inicial adulterado", async () => {
    for (const change of [{ amount: 0 }, { amount: 1.5 }, { accountId: "missing" }, { firstDueOn: "2026-02-30" },
      { endsOn: "2025-12-31" }, { kind: "Receber" }, { createdAt: "invalid" }, { categoryId: "missing" },
      { costCenterId: "missing" }, { events: null }, { description: "" }, { paymentMethod: "invalid" },
      { events: [{ status: "Suspensa", at: new Date().toISOString(), reason: "Novo suspenso" }] }]) {
      const changed = recurrenceFixture(); Object.assign(changed.finance.recurrences![0], change);
      await expect(save(changed)).rejects.toThrow();
    }
    const inactive = recurrenceFixture(); inactive.finance.accounts[0].active = false;
    await expect(save(inactive)).rejects.toThrow("ativas");
    const duplicate = recurrenceFixture(); duplicate.finance.recurrences!.push(recurrence);
    await expect(save(duplicate)).rejects.toThrow("duplicadas");
    await save(recurrenceFixture());
    const multiple = changeRecurrenceStatus(recurrenceFixture(), recurrence, "Suspensa", "Pausa negociada", true);
    const two = changeRecurrenceStatus(multiple, multiple.finance.recurrences![0], "Ativa", "Retomar servico", true);
    await expect(save(two, 2)).rejects.toThrow("uma transicao");
  });
  it("preserva classificacao inicial e bloqueia novas geracoes com categorias ou centros inativos", async () => {
    let source = saveFinanceCategory(baseline, { id: "category", kind: "Pagar", name: "Mensalidade", active: true });
    source = saveCostCenter(source, { id: "center", name: "Operacao", active: true });
    source = saveFinanceRecurrence(source, { ...recurrence, categoryId: "category", costCenterId: "center" }, true);
    await save(source);
    const data = recurring(source);
    const noClassification = structuredClone(data); noClassification.finance.management!.classifications = [];
    await expect(save(noClassification, 2)).rejects.toThrow("classificacao inicial");
    const inactiveCategory = structuredClone(data); inactiveCategory.finance.management!.categories[0].active = false;
    await expect(save(inactiveCategory, 2)).rejects.toThrow("ativas");
    const inactiveCenter = structuredClone(data); inactiveCenter.finance.management!.costCenters[0].active = false;
    await expect(save(inactiveCenter, 2)).rejects.toThrow("ativas");
    await save(data, 2);
    const reclassified = structuredClone(data); reclassified.finance.management!.classifications = [];
    await save(reclassified, 3);
    await save({ ...reclassified, clients: reclassified.clients.map((client) => ({ ...client, name: client.name + " " })) }, 4);
  });
  it("limita novos meses por gravacao mas preserva historico maior que 24 meses", async () => {
    const source = saveFinanceRecurrence(baseline, { ...recurrence, endsOn: "2028-12-31" }, true);
    await save(source);
    const first = recurring(source, "2026-01", "2027-12");
    const combined = recurring(first, "2028-01", "2028-01");
    await expect(save(combined, 2)).rejects.toThrow("24 meses");
    await save(first, 2);
    await save(combined, 3);
    expect(combined.finance.entries.filter((entry) => entry.recurrence)).toHaveLength(25);
  });
  const adjustment = { interest: 1000, fine: 200, discount: 500, reason: "Acordo de pagamento", confirmedAt: new Date().toISOString() };
  function adjustmentFixture() {
    return saveFinanceEntry(baseline, { id: "manual", kind: "Receber", party: "Cliente", description: "Conta manual",
      amount: 10000, accountId: "bank", issuedOn: localDay(), dueOn: localDay(), paymentMethod: "Pix", canceled: false, settlements: [] });
  }
  it("persiste ajustes, concilia por caixa e estorna preservando metadata e saldo principal", async () => {
    const source = adjustmentFixture();
    await save(source);
    const payment = { id: "payment", amount: 10000, date: localDay(), accountId: "bank", adjustment };
    let data = settleFinanceEntry(source, "manual", payment, true);
    await save(data, 2);
    data = importStatement(data, "bank", { format: "CSV", bank: "", account: "", lines: [
      { externalId: "cash", date: localDay(), amount: 10700, description: "Recebido com ajustes" },
      { externalId: "principal", date: localDay(), amount: 10000, description: "Principal nao e caixa" },
    ] }, "teste.csv", true);
    data = matchBankSettlement(data, banking(data).transactions[0].id, "manual", "payment");
    await save(data, 3);
    const wrong = structuredClone(data);
    wrong.finance.banking!.matches[0].transactionId = banking(data).transactions[1].id;
    await expect(save(wrong, 4)).rejects.toThrow("reescritos");
    const stored = await db.query<{ payload: typeof data }>("select payload from public.company_data where company_id=$1", [company]);
    expect(stored.rows[0].payload.finance.entries.find((item) => item.id === "manual")?.settlements[0].adjustment).toEqual(adjustment);
    const reversed = reverseSettlement(data, "manual", "payment");
    await save(reversed, 4);
    expect(activeBankMatch(reversed, banking(reversed).matches[0])).toBe(false);
    expect(entryBalance(reversed.finance.entries.find((item) => item.id === "manual")!)).toBe(10000);
    const changed = structuredClone(reversed);
    changed.finance.entries.find((item) => item.id === "manual")!.settlements[0].adjustment!.reason = "Outro acordo";
    await expect(save(changed, 5)).rejects.toThrow("Baixas nao");
    await expect(save(data, 5)).rejects.toThrow("estorno desfeito");
    await expect(save(reversed, 4)).rejects.toThrow("another session");
  });
  it("persiste grupos de conciliacao, valida totais no SQL e impede apagar/reativar historico", async () => {
    const entryId = baseline.finance.entries[0].id;
    let data = settleFinanceEntry(baseline, entryId, {
      id: "group-settlement-a", date: localDay(), amount: 2500, accountId: "bank",
    });
    data = settleFinanceEntry(data, entryId, {
      id: "group-settlement-b", date: localDay(), amount: 7500, accountId: "bank",
    });
    data = importStatement(data, "bank", { format: "CSV", bank: "", account: "", lines: [
      { externalId: "group-movement-a", date: localDay(), amount: 4000, description: "Grupo A" },
      { externalId: "group-movement-b", date: localDay(), amount: 6000, description: "Grupo B" },
    ] }, "grupo.csv", true);
    const transactionIds = banking(data).transactions.map((transaction) => transaction.id);
    data = matchBankSettlementGroup(data, transactionIds, [
      { entryId, settlementId: "group-settlement-a" }, { entryId, settlementId: "group-settlement-b" },
    ], true);
    const wrongTotal = structuredClone(data);
    wrongTotal.finance.banking!.reconciliationGroups![0].settlements.pop();
    await expect(save(wrongTotal)).rejects.toThrow("total divergente");
    await save(data);
    const withTransfer = saveBankAccount(data, { ...data.finance.accounts[0], id: "group-destination", name: "Destino grupo" });
    const transfer = recordFinanceTransfer(withTransfer, { id: "group-transfer", fromAccountId: "bank",
      toAccountId: "group-destination", date: localDay(), amount: 4000, description: "Transferencia em conflito",
      createdAt: new Date().toISOString() }, true);
    transfer.finance.banking!.transferMatches = [{
      id: "group-transfer-match", transactionId: transactionIds[0], transferId: "group-transfer",
      leg: "outgoing", createdAt: new Date().toISOString(), reversed: false,
    }];
    await expect(save(transfer, 2)).rejects.toThrow("Movimento ja conciliado");
    const stored = await db.query<{ payload: typeof data }>("select payload from public.company_data where company_id=$1", [company]);
    expect(stored.rows[0].payload.finance.banking!.reconciliationGroups).toEqual(banking(data).reconciliationGroups);

    const removed = structuredClone(data);
    removed.finance.banking!.reconciliationGroups = [];
    await expect(save(removed, 2)).rejects.toThrow("removido");

    const reversed = unmatchBankSettlement(data, banking(data).reconciliationGroups![0].id);
    await save(reversed, 2);
    const farDate = new Date(Date.parse(`${localDay()}T12:00:00Z`) - 4 * 86_400_000).toISOString().slice(0, 10);
    const tooFar = importStatement(reversed, "bank", { format: "CSV", bank: "", account: "", lines: [
      { externalId: "group-too-far", date: farDate, amount: 6000, description: "Movimento fora da janela" },
    ] }, "grupo.csv", true);
    tooFar.finance.banking!.reconciliationGroups!.push({
      id: "group-too-far", transactionIds: [transactionIds[0], banking(tooFar).transactions.at(-1)!.id],
      settlements: [{ entryId, settlementId: "group-settlement-a" }, { entryId, settlementId: "group-settlement-b" }],
      createdAt: new Date().toISOString(), reversed: false,
    });
    await expect(save(tooFar, 3)).rejects.toThrow("tres dias");
    await expect(save(data, 3)).rejects.toThrow("reativado");
  });
  it("SQL rejeita ajustes invalidos, caixa zerado, origem faturada e vinculo pelo principal", async () => {
    const source = adjustmentFixture();
    await save(source);
    const settlement = { id: "payment", amount: 10000, date: localDay(), accountId: "bank", adjustment };
    for (const change of [{ interest: -1 }, { fine: 0.5 }, { discount: 10001 }, { interest: 100000001 },
      { interest: 0, fine: 0, discount: 10000 }, { interest: 100000000 }, { reason: "" }, { confirmedAt: "invalid" },
      { interest: 0, fine: 0, discount: 0 }, { confirmedAt: "2026-99-99T12:00:00Z" }, { interest: null }]) {
      const changed = structuredClone(source);
      const invalid = { ...settlement, reversed: false, adjustment: { ...adjustment } };
      Object.assign(invalid.adjustment, change);
      changed.finance.entries.find((item) => item.id === "manual")!.settlements.push(invalid);
      await expect(save(changed, 2)).rejects.toThrow();
    }
    const billed = structuredClone(source);
    billed.finance.entries[0].settlements.push({ ...settlement, reversed: false });
    await expect(save(billed, 2)).rejects.toThrow("somente contas manuais");
    let data = settleFinanceEntry(source, "manual", settlement, true);
    data = importStatement(data, "bank", { format: "CSV", bank: "", account: "", lines: [
      { externalId: "principal", date: localDay(), amount: 10000, description: "Principal nao e caixa" },
    ] }, "teste.csv", true);
    data.finance.banking!.matches = [{ id: "invalid-match", transactionId: banking(data).transactions[0].id,
      entryId: "manual", settlementId: "payment", createdAt: new Date().toISOString(), reversed: false }];
    await expect(save(data, 2)).rejects.toThrow("incompativel");
    const tooMuchPrincipal = structuredClone(source);
    tooMuchPrincipal.finance.entries.find((item) => item.id === "manual")!.settlements.push({
      ...settlement, amount: 10001, reversed: false, adjustment: { ...adjustment, interest: 0, fine: 0, discount: 500 },
    });
    await expect(save(tooMuchPrincipal, 2)).rejects.toThrow("saldo liquido");
  });
  it("desconto liquida principal maior que caixa e escrita direta nao permite alterar os ajustes", async () => {
    const source = adjustmentFixture();
    await save(source);
    const data = settleFinanceEntry(source, "manual", { id: "payment", amount: 10000, date: localDay(), accountId: "bank",
      adjustment: { ...adjustment, interest: 0, fine: 0, discount: 500 } }, true);
    await save(data, 2);
    expect(entryBalance(data.finance.entries.find((item) => item.id === "manual")!)).toBe(0);
    await db.exec("reset role");
    const changed = structuredClone(data);
    changed.finance.entries.find((item) => item.id === "manual")!.settlements[0].adjustment!.discount = 1000;
    await expect(db.query("update public.company_data set payload=$1 where company_id=$2", [JSON.stringify(changed), company]))
      .rejects.toThrow("Baixas nao");
    await identity("authenticated");
    await expect(db.query("select public.settlement_cash_amount($1::jsonb)", [JSON.stringify(data.finance.entries[1].settlements[0])]))
      .rejects.toThrow("permission");
  });
  function installmentFixture() {
    return saveFinanceInstallments(baseline, { id: "plan", kind: "Pagar", party: "Fornecedor", description: "Compra parcelada",
      amount: 10000, accountId: "bank", issuedOn: "2026-01-01", dueOn: "2026-01-31", paymentMethod: "Pix", canceled: false, settlements: [] },
    ["2026-01-31", "2026-02-28", "2026-03-31"], true);
  }
  it("grava parcelas juntas, preserva metadata e permite baixas/cancelamentos independentes", async () => {
    const data = installmentFixture();
    await save(data);
    const stored = await db.query<{ payload: typeof data }>("select payload from public.company_data where company_id=$1", [company]);
    expect(stored.rows[0].payload.finance.entries).toEqual(data.finance.entries);
    for (const mutate of [
      (copy: typeof data) => { copy.finance.entries.pop(); },
      (copy: typeof data) => { delete copy.finance.entries[1].installment; },
      (copy: typeof data) => { copy.finance.entries[1].installment!.planId = "other"; },
      (copy: typeof data) => { copy.finance.entries[1].dueOn = "2026-02-27"; },
    ]) {
      const changed = structuredClone(data); mutate(changed);
      await expect(save(changed, 2)).rejects.toThrow(/imutaveis|removido/);
    }
    let updated = settleFinanceEntry(data, "plan:1", { id: "payment", amount: 1000, date: "2026-01-31", accountId: "bank" });
    await save(updated, 2);
    updated = reverseSettlement(updated, "plan:1", "payment");
    await save(updated, 3);
    updated = cancelFinanceEntry(updated, "plan:1");
    await save(updated, 4);
    expect(updated.finance.entries.filter((entry) => entry.installment).map((entry) => entry.canceled)).toEqual([true, false, false]);
    await expect(save(data, 4)).rejects.toThrow("another session");
  });
  it("SQL rejeita grupos incompletos, totais/rateios alterados e datas invalidas sem depender do frontend", async () => {
    for (const mutate of [
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.entries.pop(); },
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.entries[2].installment!.number = 1; },
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.entries[1].installment!.count = 4; },
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.entries[1].installment!.total++; },
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.entries[1].amount++; },
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.entries[1].amount--; copy.finance.entries[3].amount++; },
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.entries[2].party = "Outro"; },
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.entries[2].dueOn = "2026-01-31"; },
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.entries[2].dueOn = "2026-02-30"; },
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.entries[1].dueOn = "2025-12-31"; },
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.accounts[0].active = false; },
      (copy: ReturnType<typeof installmentFixture>) => { copy.finance.entries[1].invoiceId = baseline.finance.invoices[0].id; },
    ]) {
      const changed = installmentFixture(); mutate(changed);
      await expect(save(changed)).rejects.toThrow();
    }
    for (const installment of [null, {}, { planId: "x", number: null, count: 3, total: 10000 },
      { planId: "x", number: 1, count: 121, total: 10000 }, { planId: "x", number: 1.5, count: 3, total: 10000 },
      { planId: 5, number: 1, count: 3, total: 10000 }, { planId: "x", number: 1, count: 3, total: 2 }]) {
      const changed = installmentFixture();
      Object.assign(changed.finance.entries[1], { installment });
      await expect(save(changed)).rejects.toThrow();
    }
    await save(installmentFixture());
  });
  it("escrita direta tambem preserva vinculos e legado sem parcelamento continua editavel", async () => {
    await save(baseline);
    const data = installmentFixture();
    await save(data, 2);
    await db.exec("reset role");
    const changed = structuredClone(data);
    changed.finance.entries[1].installment!.total++;
    await expect(db.query("update public.company_data set payload=$1 where company_id=$2", [JSON.stringify(changed), company]))
      .rejects.toThrow("imutaveis");
    await identity("authenticated");
    const inactive = structuredClone(data); inactive.finance.accounts[0].active = false;
    await save(inactive, 3);
  });
  function transferFixture() {
    let data = saveBankAccount(baseline, { ...baseline.finance.accounts[0], id: "destination", name: "Destino" });
    data = recordFinanceTransfer(data, { id: "transfer", fromAccountId: "bank", toAccountId: "destination",
      date: localDay(), amount: 10000, description: "Transferencia", createdAt: new Date().toISOString() }, true);
    for (const [accountId, amount] of [["bank", -10000], ["destination", 10000], ["bank", -10000], ["bank", 10000]] as const)
      data = importStatement(data, accountId, { format: "CSV", account: "", bank: "",
        lines: [{ externalId: String(banking(data).transactions.length), date: localDay(), amount, description: "Movimento" }] }, "teste.csv", true);
    return data;
  }
  it("persiste as duas pontas e preserva historico de vinculos em backups e escrita SQL direta", async () => {
    const source = transferFixture(), transactions = banking(source).transactions;
    const data = matchBankTransfer(matchBankTransfer(source, transactions[0].id, "transfer", true), transactions[1].id, "transfer", true);
    await save(data);
    const stored = await db.query<{ payload: typeof data }>("select payload from public.company_data where company_id=$1", [company]);
    expect(stored.rows[0].payload.finance.banking).toEqual(data.finance.banking);
    for (const mutate of [
      (copy: typeof data) => { delete copy.finance.banking!.transferMatches; },
      (copy: typeof data) => { copy.finance.banking!.transferMatches![0].createdAt = new Date(0).toISOString(); },
      (copy: typeof data) => { copy.finance.banking!.transferMatches![0].transactionId = transactions[2].id; },
    ]) {
      const changed = structuredClone(data); mutate(changed);
      await expect(save(changed, 2)).rejects.toThrow("Vinculos de transferencia");
    }
    await db.exec("reset role");
    const changed = structuredClone(data); changed.finance.banking!.transferMatches = [];
    await expect(db.query("update public.company_data set payload=$1 where company_id=$2", [JSON.stringify(changed), company]))
      .rejects.toThrow("Vinculos de transferencia");
    await identity("authenticated");
    const undone = unmatchBankTransfer(data, banking(data).transferMatches![0].id);
    await save(undone, 2);
    await expect(save(data, 3)).rejects.toThrow("reativados");
    const rematched = matchBankTransfer(undone, transactions[0].id, "transfer", true);
    await save(rematched, 3);
    await expect(save(rematched, 3)).rejects.toThrow("another session");
  });
  it("recusa vinculos novos adulterados, referencias inexistentes e pontas duplicadas no servidor", async () => {
    const source = transferFixture(), transactions = banking(source).transactions;
    const data = matchBankTransfer(source, transactions[0].id, "transfer", true);
    for (const change of [{ leg: "incoming" }, { leg: "invalid" }, { transferId: "missing" }, { transactionId: transactions[1].id },
      { transactionId: transactions[3].id }, { transactionId: "missing" }, { createdAt: "invalid" }, { createdAt: "2026-99-99T12:00:00Z" },
      { reversed: null }, { reversed: true }, { id: "" }, { id: 123 }]) {
      const changed = structuredClone(data);
      Object.assign(changed.finance.banking!.transferMatches![0], change);
      await expect(save(changed)).rejects.toThrow();
    }
    const duplicate = structuredClone(data);
    duplicate.finance.banking!.transferMatches!.push({ ...duplicate.finance.banking!.transferMatches![0], id: "other", transactionId: transactions[2].id });
    await expect(save(duplicate)).rejects.toThrow("ponta de transferencia ja conciliado");
    duplicate.finance.banking!.transferMatches![1].id = duplicate.finance.banking!.transferMatches![0].id;
    await expect(save(duplicate)).rejects.toThrow("duplicados");
    await save(data);
  });
  it("bloqueia ocupacao cruzada baixa/transferencia mesmo se apenas os vinculos de baixa mudarem", async () => {
    let source = transferFixture();
    source = recordFinanceTransfer(source, { ...source.finance.transfers![0], id: "incoming-transfer",
      fromAccountId: "destination", toAccountId: "bank" }, true);
    source = settleFinanceEntry(source, source.finance.entries[0].id,
      { id: "payment", date: localDay(), amount: 10000, accountId: "bank" });
    const transaction = banking(source).transactions[3];
    const transferred = matchBankTransfer(source, transaction.id, "incoming-transfer", true);
    const settled = matchBankSettlement(source, transaction.id, source.finance.entries[0].id, "payment");
    await save(transferred);
    const conflict = structuredClone(transferred); conflict.finance.banking!.matches = settled.finance.banking!.matches;
    await expect(save(conflict, 2)).rejects.toThrow("ja conciliado");
    const undone = unmatchBankTransfer(transferred, banking(transferred).transferMatches![0].id);
    await save(undone, 2);
    const settlementOnly = { ...undone, finance: { ...undone.finance, banking: { ...banking(undone), matches: banking(settled).matches } } };
    await save(settlementOnly, 3);
    const reverseConflict = structuredClone(settlementOnly);
    reverseConflict.finance.banking!.transferMatches!.push({ ...banking(transferred).transferMatches![0], id: "new" });
    await expect(save(reverseConflict, 4)).rejects.toThrow("ja conciliado");
    const reversed = reverseSettlement(settlementOnly, source.finance.entries[0].id, "payment");
    await save(reversed, 4);
    await save(matchBankTransfer(reversed, transaction.id, "incoming-transfer", true), 5);
  });
  it("estorno libera ambas as transacoes sem alterar vinculos antigos e recusa novos na transferencia estornada", async () => {
    const source = transferFixture(), transactions = banking(source).transactions;
    const data = matchBankTransfer(matchBankTransfer(source, transactions[0].id, "transfer", true), transactions[1].id, "transfer", true);
    await save(data);
    const reversed = reverseFinanceTransfer(data, data.finance.transfers![0], "Registro incorreto", true);
    await save(reversed, 2);
    const invalid = structuredClone(reversed);
    invalid.finance.banking!.transferMatches!.push({ ...banking(data).transferMatches![0], id: "new" });
    await expect(save(invalid, 3)).rejects.toThrow("transferencia ativa");
    const replacement = recordFinanceTransfer(reversed, { ...data.finance.transfers![0], id: "replacement" }, true);
    const rematched = matchBankTransfer(matchBankTransfer(replacement, transactions[0].id, "replacement", true), transactions[1].id, "replacement", true);
    await save(rematched, 3);
    const stored = await db.query<{ payload: typeof data }>("select payload from public.company_data where company_id=$1", [company]);
    expect(stored.rows[0].payload.finance.banking!.transferMatches).toHaveLength(4);
  });
  it("preserva transferencias e estornos e impede remocao/reescrita em gravacoes e backups", async () => {
    const source = saveBankAccount(baseline, { ...baseline.finance.accounts[0], id: "destination", name: "Destino" });
    const data = recordFinanceTransfer(source, { id: "transfer", fromAccountId: "bank", toAccountId: "destination",
      date: localDay(), amount: 12345, description: "Transferencia interna", createdAt: new Date().toISOString() }, true);
    await save(data);
    const stored = await db.query<{ payload: typeof data }>("select payload from public.company_data where company_id=$1", [company]);
    expect(stored.rows[0].payload.finance.transfers).toEqual(data.finance.transfers);
    expect(stored.rows[0].payload.finance.entries).toEqual(baseline.finance.entries);
    for (const mutate of [
      (copy: typeof data) => { delete copy.finance.transfers; },
      (copy: typeof data) => { copy.finance.transfers![0].amount++; },
      (copy: typeof data) => { copy.finance.transfers![0].toAccountId = "bank"; },
      (copy: typeof data) => { copy.finance.transfers!.push(copy.finance.transfers![0]); },
      (copy: typeof data) => { copy.finance.accounts = copy.finance.accounts.filter((item) => item.id !== "destination"); },
    ]) {
      const changed = structuredClone(data); mutate(changed);
      await expect(save(changed, 2)).rejects.toThrow(/Transferencias|transferencias|Transferencia/);
    }
    const reversed = reverseFinanceTransfer(data, data.finance.transfers![0], "Registro em duplicidade", true);
    await save(reversed, 2);
    await expect(save(data, 3)).rejects.toThrow("Estorno");
    const edited = structuredClone(reversed); edited.finance.transfers![0].reversal!.reason = "Outro motivo";
    await expect(save(edited, 3)).rejects.toThrow("Estorno");
    await expect(save(reversed, 2)).rejects.toThrow("another session");
  });
  it("valida ambas as contas e valores de transferencias novas no servidor", async () => {
    const source = saveBankAccount(baseline, { ...baseline.finance.accounts[0], id: "destination", name: "Destino" });
    const transfer = { id: "transfer", fromAccountId: "bank", toAccountId: "destination", date: localDay(),
      amount: 1000, description: "Transferencia", createdAt: new Date().toISOString() };
    for (const change of [{ amount: 0 }, { amount: -1 }, { amount: 0.5 }, { amount: 100000001 }, { fromAccountId: "missing" },
      { toAccountId: "bank" }, { date: "2099-01-01" }, { date: "2026-02-30" }, { description: "" },
      { createdAt: "invalid" }, { reversal: { at: new Date().toISOString(), reason: "Novo estorno" } }]) {
      await expect(save({ ...source, finance: { ...source.finance, transfers: [{ ...transfer, ...change }] } })).rejects.toThrow();
    }
    const inactive = structuredClone(source); inactive.finance.accounts[1].active = false;
    await expect(save({ ...inactive, finance: { ...inactive.finance, transfers: [transfer] } })).rejects.toThrow("ativas");
    await save({ ...source, finance: { ...source.finance, transfers: [transfer] } });
    const malformed = { ...source, finance: { ...source.finance, transfers: [{ ...transfer, reversal: { at: "invalid", reason: "abcd" } }] } };
    await expect(save(malformed, 2)).rejects.toThrow("Estorno");
  });
  it("preserva extratos/vinculos, rejeita adulteracao e concilia sem duplicar baixas", async () => {
    const settled = settleFinanceEntry(baseline, baseline.finance.entries[0].id,
      { id: "bank-payment", date: localDay(), amount: 10000, accountId: "bank" });
    const imported = importStatement(settled, "bank", { format: "CSV", bank: "", account: "", lines: [
      { externalId: "bank-ref", date: localDay(), description: "Pagamento", amount: 10000 },
    ] }, "extrato.csv", true);
    const data = matchBankSettlement(imported, banking(imported).transactions[0].id, baseline.finance.entries[0].id, "bank-payment");
    await save(data);
    for (const mutate of [
      (copy: typeof data) => { delete copy.finance.banking; },
      (copy: typeof data) => { banking(copy).transactions[0].description = "Alterado"; },
      (copy: typeof data) => { banking(copy).matches = []; },
      (copy: typeof data) => { banking(copy).matches[0].entryId = "missing"; },
      (copy: typeof data) => { banking(copy).matches.push({ ...banking(copy).matches[0], id: "duplicate-link" }); },
      (copy: typeof data) => { banking(copy).transactions.push({ ...banking(copy).transactions[0], id: "duplicate-line" }); },
    ]) {
      const copy = structuredClone(data); mutate(copy);
      await expect(save(copy, 2)).rejects.toThrow(/Extratos|Vinculos|Vinculo|conciliado|duplicados/);
    }
    const unmatched = unmatchBankSettlement(data, banking(data).matches[0].id);
    await save(unmatched, 2);
    await expect(save(data, 3)).rejects.toThrow("desfazimento");
    const reversed = reverseSettlement(unmatched, baseline.finance.entries[0].id, "bank-payment");
    await save(reversed, 3);
    const stored = await db.query<{ payload: typeof data }>("select payload from public.company_data where company_id=$1", [company]);
    expect(stored.rows[0].payload.finance.banking).toEqual(unmatched.finance.banking);
  });
  it("recusa movimentos novos invalidos e vinculos com divergencias pela gravacao direta", async () => {
    const settled = settleFinanceEntry(baseline, baseline.finance.entries[0].id,
      { id: "bank-payment", date: localDay(), amount: 10000, accountId: "bank" });
    const imported = importStatement(settled, "bank", { format: "CSV", bank: "", account: "", lines: [
      { externalId: "bank-ref", date: localDay(), description: "Pagamento", amount: 10000 },
    ] }, "extrato.csv", true);
    const data = matchBankSettlement(imported, banking(imported).transactions[0].id, baseline.finance.entries[0].id, "bank-payment");
    for (const mutate of [
      (copy: typeof data) => { banking(copy).transactions[0].amount = 9999; },
      (copy: typeof data) => { banking(copy).transactions[0].amount = -10000; },
      (copy: typeof data) => { banking(copy).transactions[0].accountId = "missing"; },
      (copy: typeof data) => { banking(copy).transactions[0].date = "2099-01-01"; },
      (copy: typeof data) => { banking(copy).transactions[0].date = "2026-02-30"; },
    ]) {
      const copy = structuredClone(data); mutate(copy);
      await expect(save(copy)).rejects.toThrow();
    }
    await save(data);
    const reversed = reverseSettlement(data, baseline.finance.entries[0].id, "bank-payment");
    await save(reversed, 2);
    const newPayment = settleFinanceEntry(reversed, baseline.finance.entries[0].id,
      { id: "replacement", date: localDay(), amount: 10000, accountId: "bank" });
    const rematched = matchBankSettlement(newPayment, banking(data).transactions[0].id, baseline.finance.entries[0].id, "replacement");
    await save(rematched, 3);
    await expect(db.query("delete from public.company_data where company_id=$1", [company])).rejects.toThrow();
  });
  it("sincroniza cadastros e classificações gerenciais sem alterar o histórico nem exigir novo SQL", async () => {
    let data = saveFinanceCategory(baseline, { id: "services", name: "Serviços", kind: "Receber", active: true });
    data = saveCostCenter(data, { id: "operation", name: "Operação", active: true });
    data = classifyFinanceEntry(data, { entryId: baseline.finance.entries[0].id, categoryId: "services", costCenterId: "operation" });
    data = saveOpeningBalance(data, { accountId: "bank", date: localDay(), amount: 25000 });
    await save(data);
    const stored = await db.query<{ payload: typeof data }>("select payload from public.company_data where company_id=$1", [company]);
    expect(stored.rows[0].payload.finance.management).toEqual(data.finance.management);
    expect(stored.rows[0].payload.finance.entries).toEqual(baseline.finance.entries);
    await approve("cancel", data);
    await save(cancelFinanceEntry(data, data.finance.entries[0].id), 2);
    const canceled = await db.query<{ payload: typeof data }>("select payload from public.company_data where company_id=$1", [company]);
    expect(canceled.rows[0].payload.finance.management).toEqual(data.finance.management);
  });
  it("restaurar backup não apaga contas/faturas nem altera snapshots ou valor bruto", async () => {
    for (const mutate of [
      (data: typeof baseline) => { data.finance.entries = []; },
      (data: typeof baseline) => { data.finance.invoices = []; },
      (data: typeof baseline) => { data.finance.entries[0].amount++; },
      (data: typeof baseline) => { data.finance.invoices[0].orders[0].items![0].name = "Adulterado"; },
    ]) {
      const changed = structuredClone(baseline); mutate(changed);
      await expect(save(changed)).rejects.toThrow(/Historico|imutaveis|snapshots/);
    }
    await expect(save({ ...baseline, finance: undefined })).rejects.toThrow("Historico");
    const duplicate = structuredClone(baseline); duplicate.finance.entries.push(duplicate.finance.entries[0]);
    await expect(save(duplicate)).rejects.toThrow("duplicados");
  });
  it("cancelamento direto ou RPC antigo não contorna a autorização privada, mas alterações não financeiras passam", async () => {
    const canceled = cancelFinanceEntry(baseline, baseline.finance.entries[0].id);
    await expect(save(canceled)).rejects.toThrow("autorizacao atual");
    await expect(db.query("select public.approve_finance_change($1,$2,$3,$4,'cancel',null)",
      [company, owner, baseline.finance.entries[0], baseline.finance.invoices[0]])).rejects.toThrow("permission");
    const changed = structuredClone(baseline); changed.clients[0].name = "Nome atualizado";
    await save(changed);
    await expect(save(changed)).rejects.toThrow("another session");
  });
  it("consome autorização na mesma gravação, preserva histórico cancelado e impede reativação", async () => {
    await approve("cancel");
    const canceled = cancelFinanceEntry(baseline, baseline.finance.entries[0].id);
    await save(canceled);
    await identity("service_role");
    await expect(db.query("select * from public.finance_change_permits")).rejects.toThrow("permission");
    await identity("authenticated");
    await expect(save(baseline, 2)).rejects.toThrow("autorizacao atual");
    const deleted = structuredClone(canceled); deleted.finance.entries = [];
    await expect(save(deleted, 2)).rejects.toThrow("Historico");
    await db.exec("reset role");
    const permits = await db.query("select * from public.finance_change_permits");
    expect(permits.rows).toHaveLength(0);
  });
  it("baixas e estornos são preservados, saldo líquido respeitado e cancelamento obsoleto falha atomicamente", async () => {
    await approve("cancel");
    const entry = baseline.finance.entries[0];
    const settled = settleFinanceEntry(baseline, entry.id, { id: "payment", date: localDay(), amount: 500, accountId: "bank" });
    await save(settled);
    const canceled = structuredClone(settled); canceled.finance.entries[0].canceled = true; canceled.finance.invoices[0].canceled = true;
    await expect(save(canceled, 2)).rejects.toThrow("autorizacao atual");
    const deleted = structuredClone(settled); deleted.finance.entries[0].settlements = [];
    await expect(save(deleted, 2)).rejects.toThrow("Baixas nao");
    const edited = structuredClone(settled); edited.finance.entries[0].settlements[0].amount++;
    await expect(save(edited, 2)).rejects.toThrow("Baixas nao");
    const reversed = reverseSettlement(settled, entry.id, "payment");
    await save(reversed, 2);
    await expect(save(settled, 3)).rejects.toThrow("estorno desfeito");
  });
  it("retenção exige autorização privada e backup não pode removê-la nem exceder o líquido", async () => {
    const entry = baseline.finance.entries[0];
    const retention = { calculationId: "a".repeat(64), invoiceAmount: entry.amount, withheld: 1000, net: entry.amount - 1000,
      irrf: 1000, inss: 0, csll: 0, confirmedAt: "2026-10-15T12:00:00Z", confirmedBy: owner };
    const updated = applyFinanceRetention(baseline, entry.id, retention, entry);
    await expect(save(updated)).rejects.toThrow("autorizacao atual");
    await approve("retention", baseline, retention);
    await save(updated);
    await expect(save(baseline, 2)).rejects.toThrow("autorizacao atual");
    const excessive = structuredClone(updated);
    excessive.finance.entries[0].settlements.push({ id: "over", date: localDay(), accountId: "bank", amount: entry.amount, reversed: false });
    await expect(save(excessive, 2)).rejects.toThrow("saldo liquido");
    await approve("retention", updated);
    await save(baseline, 2);
  });
  it("autorizações são isoladas por empresa/ator e escrita direta/exclusão também passam pelo trigger", async () => {
    await identity("service_role");
    await expect(db.query("select public.approve_finance_change($1,$2,$3,$4,'cancel',null)",
      [otherCompany, owner, baseline.finance.entries[0], baseline.finance.invoices[0]])).rejects.toThrow("nao pertence");
    await expect(db.query("select public.approve_finance_change($1,$2,$3,$4,'cancel',null)",
      [company, tech, baseline.finance.entries[0], baseline.finance.invoices[0]])).rejects.toThrow("nao pertence");
    await identity("authenticated", tech);
    await expect(save(baseline)).rejects.toThrow("administrator");
    await identity("authenticated");
    await expect(db.query("delete from public.company_data where company_id=$1", [company])).rejects.toThrow("permission");
    await db.exec("reset role");
    await expect(db.query("delete from public.company_data where company_id=$1", [company])).rejects.toThrow("Historico");
    await expect(db.query("update public.company_data set payload=$1 where company_id=$2",
      [JSON.stringify(cancelFinanceEntry(baseline, baseline.finance.entries[0].id)), company])).rejects.toThrow("autorizacao atual");
  });
  it("legado sem financeiro continua editável e novos faturamentos exigem vínculo único aberto", async () => {
    await db.exec("reset role; alter table public.company_data disable trigger guard_finance_history");
    const legacy = { ...baseline, finance: undefined };
    await db.query("update public.company_data set payload=$1 where company_id=$2", [JSON.stringify(legacy), company]);
    await db.exec("alter table public.company_data enable trigger guard_finance_history");
    await identity("authenticated");
    await save(legacy);
    const invalid = structuredClone(baseline); invalid.finance.invoices[0].canceled = true;
    await expect(save(invalid, 2)).rejects.toThrow("iniciar aberto");
    invalid.finance.invoices[0].canceled = false; invalid.finance.entries = [];
    await expect(save(invalid, 2)).rejects.toThrow("unica conta");
    await save(baseline, 2);
    const duplicate = structuredClone(baseline);
    duplicate.finance.entries.push({ ...duplicate.finance.entries[0], id: "second" });
    await expect(save(duplicate, 3)).rejects.toThrow("unica conta");
  });
  it("autorização privada rejeita projeções obsoletas e valores de retenção incompletos/nulos/fracionários", async () => {
    await identity("service_role");
    const entry = baseline.finance.entries[0], invoice = baseline.finance.invoices[0];
    const values = { calculationId: "a".repeat(64), invoiceAmount: entry.amount, withheld: 1000, net: entry.amount - 1000,
      irrf: 1000, inss: 0, csll: 0, confirmedAt: "2026-10-15T12:00:00Z", confirmedBy: owner };
    for (const retention of [{}, { ...values, irrf: null }, { ...values, irrf: -1 }, { ...values, irrf: 1000.5 },
      { ...values, confirmedBy: null }, { ...values, net: "9000" }]) {
      await expect(db.query("select public.approve_finance_change($1,$2,$3,$4,'retention',$5)",
        [company, owner, entry, invoice, retention])).rejects.toThrow("inconsistente");
    }
    await expect(db.query("select public.approve_finance_change($1,$2,$3,$4,'cancel',null)",
      [company, owner, { ...entry, amount: 1 }, invoice])).rejects.toThrow("alterada");
    // O backend envia somente sua projeção; o permit preserva todos os campos raw.
    const { description: _description, ...projection } = entry;
    const { clientName: _clientName, createdOn: _createdOn, ...invoiceProjection } = invoice;
    await db.query("select public.approve_finance_change($1,$2,$3,$4,'cancel',null)",
      [company, owner, projection, invoiceProjection]);
    await identity("authenticated");
    const canceled = cancelFinanceEntry(baseline, entry.id);
    const adulterated = structuredClone(canceled); adulterated.finance.invoices[0].orders[0].title = "Outro";
    await expect(save(adulterated)).rejects.toThrow("nao corresponde");
    await save(canceled);
  });
  it("baixas inválidas, bancos utilizados removidos e cancelamento apenas da fatura são recusados", async () => {
    const onlyInvoice = structuredClone(baseline); onlyInvoice.finance.invoices[0].canceled = true;
    await expect(save(onlyInvoice)).rejects.toThrow("conta correspondente");
    const missingBank = structuredClone(baseline); missingBank.finance.accounts = [];
    await expect(save(missingBank)).rejects.toThrow("invalidas");
    for (const invalid of [null, -1, 0, 0.5]) {
      const data = structuredClone(baseline);
      const raw: Record<string, unknown> = data.finance.entries[0];
      raw.settlements = [{ id: "invalid", amount: invalid, accountId: "bank", reversed: false }];
      await expect(save(data)).rejects.toThrow("invalidas");
    }
  });
  it("normalização de defaults legados não exige cancelamento nem reescreve os valores originais", async () => {
    const normalized = structuredClone(baseline);
    normalized.finance.invoices[0].kind = "Legado";
    normalized.finance.invoices[0].orders.forEach((order) => { delete order.items; delete order.allocation; });
    const legacy = structuredClone(normalized);
    const entry: Record<string, unknown> = legacy.finance.entries[0], invoice: Record<string, unknown> = legacy.finance.invoices[0];
    delete entry.canceled; delete entry.settlements; delete invoice.canceled; delete invoice.kind;
    await db.exec("reset role; alter table public.company_data disable trigger guard_finance_history");
    await db.query("update public.company_data set payload=$1 where company_id=$2", [JSON.stringify(legacy), company]);
    await db.exec("alter table public.company_data enable trigger guard_finance_history");
    await identity("authenticated");
    await save(legacy);
    await save(normalized, 2);
    expect(normalized.finance.entries[0].amount).toBe(legacy.finance.entries[0].amount);
    const canceled = cancelFinanceEntry(normalized, normalized.finance.entries[0].id);
    await expect(save(canceled, 3)).rejects.toThrow("autorizacao atual");
  });
});
