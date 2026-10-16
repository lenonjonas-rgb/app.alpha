/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { billOrders, cancelFinanceEntry, applyFinanceRetention, settleFinanceEntry, reverseSettlement } from "./finance";
import { demoDatabase, getOrderDetails, localDay } from "./domain";

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
}, 30000);
beforeEach(async () => {
  await db.exec("reset role");
  await db.exec("alter table public.company_data disable trigger guard_finance_history");
  baseline = fixture();
  await db.query("update public.company_data set payload=$1,revision=1 where company_id=$2", [JSON.stringify(baseline), company]);
  await db.exec("delete from public.finance_change_permits; alter table public.company_data enable trigger guard_finance_history");
  await identity("authenticated");
});
afterAll(async () => { await db.close(); });
describe("proteção financeira no PostgreSQL", () => {
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
