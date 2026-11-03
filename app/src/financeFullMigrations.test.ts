/// <reference types="node" />
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { billOrders, reverseSettlement, saveBankAccount, saveFinanceEntry, settleFinanceEntry } from "./finance";
import { demoDatabase, getOrderDetails, localDay } from "./domain";
import { commissionRelease, previewCommission, recordCommission, saveCommissionSeller } from "./commissions";
import { cashMovementKey } from "./cashSessionSchema";
import { cashMovementReversed, cashSessionCandidates, closeCashSession, openCashSession } from "./cashSessions";
import { saveFinanceInstallments } from "./financeInstallments";
import { generateRecurringEntries, previewRecurringEntries, saveFinanceRecurrence } from "./financeRecurrences";
import type { FinanceRecurrence } from "./financeSchema";

const owner = "00000000-0000-4000-8000-000000000001";
const technician = "00000000-0000-4000-8000-000000000002";
const company = "10000000-0000-4000-8000-000000000001";
const db = new PGlite();
const migrations = new URL("../../supabase/migrations/", import.meta.url);

function fixture() {
  const data = demoDatabase();
  data.finance.accounts = [{ id: "bank", name: "Banco", bank: "Teste", agency: "", account: "", kind: "Corrente", active: true }];
  const order = data.orders[0];
  order.status = "Finalizada";
  order.details = { ...getOrderDetails(order), items: [{ id: "service", kind: "servico", referenceId: data.services[0].id,
    name: "Serviço", quantity: 1, price: 10000, discount: 0 }], costs: [], discount: 0, travel: undefined };
  return billOrders(data, [order.id], { Serviços: { accountId: "bank", dueOn: localDay(), paymentMethod: "Pix" } });
}

let baseline = fixture();

async function identity(actor: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await db.exec("set role authenticated");
}

async function save(payload: unknown, revision: number) {
  return db.query("select public.save_company_data($1::jsonb,$2) as revision", [JSON.stringify(payload), revision]);
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
  const files = (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort();
  const first = files.shift();
  if (first !== "20261008010000_tenant_auth_and_company_data.sql") throw new Error("Sequência inicial de migrações inesperada.");
  await db.exec(await readFile(new URL(first, migrations), "utf8"));
  await db.query("insert into auth.users values ($1,'owner@example.test'),($2,'tech@example.test')", [owner, technician]);
  await db.query("insert into public.companies(id,name,created_by) values ($1,'Empresa',$2)", [company, owner]);
  await db.query("insert into public.company_memberships(user_id,company_id,role) values ($1,$3,'owner'),($2,$3,'technician')",
    [owner, technician, company]);
  baseline = fixture();
  await db.query("insert into public.company_data(company_id,payload,revision) values ($1,$2,1)", [company, JSON.stringify(baseline)]);
  for (const file of files) await db.exec(await readFile(new URL(file, migrations), "utf8"));
}, 60000);

afterAll(async () => { await db.close(); });

describe("financeiro com a sequência completa de migrações", () => {
  it("persiste detalhes, comissão e caixa; protege histórico, estornos e revisões concorrentes", async () => {
    await identity(owner);
    let data = saveBankAccount(baseline, { id: "cash", name: "Caixa", bank: "Interno",
      agency: "", account: "", kind: "Caixa", active: true });
    data = saveFinanceEntry(data, { id: "manual", kind: "Receber", party: "Cliente", description: "Venda",
      amount: 5000, issuedOn: localDay(), dueOn: localDay(), accountId: "cash", paymentMethod: "Dinheiro",
      canceled: false, settlements: [], details: { competenceOn: localDay(), documentNumber: "DOC-123",
        seller: "Vendedor", monthlyInterestBasisPoints: 125, lateFineBasisPoints: 200 } });
    data = saveCommissionSeller(data, { id: "seller", name: "Vendedor", active: true,
      rule: { release: "proportional", calculation: { type: "fixed", rate: 1000 } } });
    data = openCashSession(data, { accountId: "cash", store: "Loja", openingAmount: 10000 }, true, "session");
    await save(data, 1);
    await expect(save(baseline, 1)).rejects.toThrow("changed in another session");

    const invoice = data.finance.invoices[0];
    data = recordCommission(data, previewCommission(data, invoice.id, invoice.orders[0].orderId, "seller"), true, "commission");
    data = settleFinanceEntry(data, "manual", { id: "cash-payment", date: localDay(), amount: 5000, accountId: "cash" });
    const billedEntry = data.finance.entries.find((entry) => entry.invoiceId === invoice.id)!;
    data = settleFinanceEntry(data, billedEntry.id, { id: "partial", date: localDay(), amount: 2000, accountId: "bank" });
    const session = data.finance.cashSessions![0];
    const choices = cashSessionCandidates(data, session);
    data = closeCashSession(data, session, choices, choices.map((item) => cashMovementKey(item.movement)), 14900, true);
    await save(data, 2);
    expect(commissionRelease(data, data.finance.commissions!.records[0]).released).toBe(200);
    expect(data.finance.cashSessions![0].closure).toMatchObject({ expected: 15000, counted: 14900, difference: -100 });

    const oldClient = structuredClone(data);
    delete oldClient.finance.commissions;
    await expect(save(oldClient, 3)).rejects.toThrow("historico de comissoes nao pode ser removido");
    const oldBackup = structuredClone(data);
    delete oldBackup.finance.cashSessions;
    await expect(save(oldBackup, 3)).rejects.toThrow("nao podem ser removidos");
    const withoutDetails = structuredClone(data);
    delete withoutDetails.finance.entries.find((entry) => entry.id === "manual")!.details;
    await expect(save(withoutDetails, 3)).rejects.toThrow("Dados originais");
    const rewritten = structuredClone(data);
    rewritten.finance.cashSessions![0].closure!.counted = 0;
    await expect(save(rewritten, 3)).rejects.toThrow("nao podem ser removidos ou reescritos");

    const closure = structuredClone(data.finance.cashSessions![0].closure!);
    data = reverseSettlement(data, "manual", "cash-payment");
    data = reverseSettlement(data, billedEntry.id, "partial");
    await save(data, 3);
    expect(data.finance.cashSessions![0].closure).toEqual(closure);
    expect(cashMovementReversed(data, closure.movements[0])).toBe(true);
    expect(commissionRelease(data, data.finance.commissions!.records[0]).released).toBe(0);
    const saved = await db.query<{ revision: number; payload: typeof data }>(
      "select revision,payload from public.company_data where company_id=$1", [company]);
    expect(Number(saved.rows[0].revision)).toBe(4);
    expect(saved.rows[0].payload.finance.cashSessions![0].closure).toEqual(closure);

    const details = { competenceOn: "2024-01-31", documentNumber: "DOC-PLAN", seller: "",
      monthlyInterestBasisPoints: 125, lateFineBasisPoints: 200 };
    data = saveFinanceInstallments(data, { id: "plan", kind: "Pagar", party: "Fornecedor", description: "Compra parcelada",
      amount: 12000, issuedOn: "2024-01-01", dueOn: "2024-01-31", accountId: "bank", paymentMethod: "Pix",
      canceled: false, settlements: [], details }, ["2024-01-31", "2024-02-29", "2024-03-31"], true);
    const invalidInstallments = structuredClone(data);
    invalidInstallments.finance.entries.find((entry) => entry.id === "plan:2")!.details!.documentNumber = "Outro";
    await expect(save(invalidInstallments, 4)).rejects.toThrow("Detalhes das parcelas");
    const recurrence: FinanceRecurrence = { id: "recurrence", kind: "Pagar", party: "Fornecedor", description: "Mensalidade",
      amount: 10000, accountId: "bank", paymentMethod: "Pix", firstDueOn: "2024-01-31", endsOn: "2024-03-31",
      details, createdAt: new Date().toISOString(), events: [] };
    data = saveFinanceRecurrence(data, recurrence, true);
    await save(data, 4);
    const recurringPreview = previewRecurringEntries(data, recurrence.id, "2024-01", "2024-03");
    data = generateRecurringEntries(data, recurrence, "2024-01", "2024-03", recurringPreview, true);
    expect(data.finance.entries.filter((entry) => entry.recurrence?.id === recurrence.id).map((entry) => entry.details?.competenceOn))
      .toEqual(["2024-01-31", "2024-02-29", "2024-03-31"]);
    const invalidRecurrence = structuredClone(data);
    invalidRecurrence.finance.entries.find((entry) => entry.recurrence?.period === "2024-02")!.details!.competenceOn = "2024-02-28";
    await expect(save(invalidRecurrence, 5)).rejects.toThrow("Detalhes da conta nao correspondem a recorrencia");
    await save(data, 5);

    await identity(technician);
    const hidden = await db.query<{ count: number }>("select count(*)::int as count from public.company_data");
    expect(hidden.rows[0].count).toBe(0);
    await expect(save(data, 6)).rejects.toThrow("administrator access required");
  }, 30000);
});
