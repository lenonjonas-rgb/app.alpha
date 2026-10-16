import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, localDay, validateDatabase } from "./domain";
import { saveBankAccount, saveFinanceEntry } from "./finance";
import { recordFinanceTransfer, reverseFinanceTransfer } from "./financeTransfers";
import { managementCsv, managementReport, saveCostCenter, saveFinanceCategory, saveOpeningBalance } from "./financeManagement";
import { FinancePanel } from "./FinancePanel";
import type { FinanceTransfer } from "./financeSchema";
import type { Database } from "./domain";

const today = localDay();
const prior = new Date(`${today}T12:00:00Z`); prior.setUTCDate(prior.getUTCDate() - 1);
const yesterday = prior.toISOString().slice(0, 10);
const filter = { start: today, end: today, accountId: "", categoryId: "", costCenterId: "" };
const bank = { id: "from", name: "Origem", bank: "Teste", agency: "", account: "", kind: "Corrente" as const, active: true };
function fixture() {
  let data = saveBankAccount(demoDatabase(), bank);
  data = saveBankAccount(data, { ...bank, id: "to", name: "Destino" });
  data = saveOpeningBalance(data, { accountId: "from", date: yesterday, amount: 10000 });
  return saveOpeningBalance(data, { accountId: "to", date: yesterday, amount: 2000 });
}
function transfer(): FinanceTransfer {
  return { id: "transfer", fromAccountId: "from", toAccountId: "to", date: today, amount: 2500,
    description: "Reforço de caixa", createdAt: new Date().toISOString() };
}
describe("transferências internas", () => {
  it("registra duas pontas em uma operação sem criar contas a pagar/receber nem faturamentos", () => {
    const source = fixture(), input = transfer(), data = recordFinanceTransfer(source, input, true);
    expect(data.finance.entries).toEqual(source.finance.entries);
    expect(data.finance.invoices).toEqual(source.finance.invoices);
    expect(source.finance.transfers).toBeUndefined();
    expect(validateDatabase(JSON.parse(JSON.stringify(data))).finance.transfers).toEqual([input]);
  });
  it("atualiza os saldos e conserva o consolidado, sem inflar receitas/despesas/previsões", () => {
    const data = recordFinanceTransfer(fixture(), transfer(), true);
    const report = managementReport(data, filter);
    expect(report.positions.map((item) => [item.accountId, item.balance, item.projected])).toEqual([
      ["from", 7500, 7500], ["to", 4500, 4500],
    ]);
    expect(report.positions.reduce((sum, item) => sum + (item.balance ?? 0), 0)).toBe(12000);
    expect(report.totals).toEqual({ received: 0, paid: 0, expectedReceipts: 0, expectedPayments: 0 });
    expect(report.transferTotals).toEqual({ incoming: 2500, outgoing: 2500 });
    expect(report.categories).toEqual([]);
    expect(report.costCenters).toEqual([]);
    expect(report.daily[0]).toMatchObject({ date: today, transfersIn: 2500, transfersOut: 2500, received: 0, paid: 0 });
  });
  it("filtra cada ponta pelo banco e exclui transferências de filtros por categoria/centro", () => {
    let data = recordFinanceTransfer(fixture(), transfer(), true);
    data = saveFinanceCategory(data, { id: "category", kind: "Receber", name: "Receita", active: true });
    data = saveCostCenter(data, { id: "center", name: "Centro", active: true });
    expect(managementReport(data, { ...filter, accountId: "from" }).transferTotals).toEqual({ incoming: 0, outgoing: 2500 });
    expect(managementReport(data, { ...filter, accountId: "to" }).transferTotals).toEqual({ incoming: 2500, outgoing: 0 });
    expect(managementReport(data, { ...filter, categoryId: "category" }).transfers).toEqual([]);
    expect(managementReport(data, { ...filter, costCenterId: "center" }).transfers).toEqual([]);
  });
  it("respeita bordas do período e bases de saldo próprias, sem somar transferências anteriores à base", () => {
    let data = recordFinanceTransfer(fixture(), { ...transfer(), date: yesterday }, true);
    expect(managementReport(data, filter).transfers).toEqual([]);
    expect(managementReport(data, { ...filter, start: yesterday, end: yesterday }).transfers).toHaveLength(2);
    expect(managementReport(data, filter).positions[0].balance).toBe(7500);
    data = saveOpeningBalance(data, { accountId: "from", date: today, amount: 8000 });
    expect(managementReport(data, filter).positions[0].balance).toBe(8000);
    expect(managementReport(data, filter).positions[1].balance).toBe(4500);
  });
  it("funciona sem base informada e permite saldo negativo sem inventar limite bancário", () => {
    const data = recordFinanceTransfer(saveBankAccount(saveBankAccount(demoDatabase(), bank),
      { ...bank, id: "to", name: "Destino" }), transfer(), true);
    expect(managementReport(data, filter).positions.map((item) => item.balance)).toEqual([-2500, 2500]);
  });
  it("aplica cada transferência uma só vez independentemente da quantidade de títulos financeiros", () => {
    let data = fixture();
    for (const id of ["entry-1", "entry-2"]) data = saveFinanceEntry(data, { id, kind: "Receber", party: "Cliente",
      description: id, amount: 10000, issuedOn: today, dueOn: today, accountId: "from", paymentMethod: "Pix",
      canceled: false, settlements: [] });
    data = recordFinanceTransfer(data, transfer(), true);
    const report = managementReport(data, filter);
    expect(report.positions.map((item) => item.balance)).toEqual([7500, 4500]);
    expect(report.totals).toEqual({ received: 0, paid: 0, expectedReceipts: 20000, expectedPayments: 0 });
  });
  it("exige confirmação, valor positivo exato, data válida não futura e contas distintas/ativas", () => {
    const source = fixture();
    expect(() => recordFinanceTransfer(source, transfer(), false)).toThrow("Confirme");
    for (const update of [
      { amount: 0 }, { amount: -1 }, { amount: 0.5 }, { amount: 100000001 }, { amount: NaN },
      { fromAccountId: "missing" }, { toAccountId: "from" }, { date: "2026-02-30" }, { date: "2099-01-01" },
      { reversal: { at: new Date().toISOString(), reason: "Cancelada" } },
    ]) expect(() => recordFinanceTransfer(source, { ...transfer(), ...update }, true)).toThrow();
    const inactive = saveBankAccount(source, { ...bank, active: false });
    expect(() => recordFinanceTransfer(inactive, transfer(), true)).toThrow("ativas");
    const data = recordFinanceTransfer(source, transfer(), true);
    expect(() => recordFinanceTransfer(data, transfer(), true)).toThrow("já registrada");
  });
  it("estorna ambas as pontas com motivo, preservando dados originais e tornando estorno definitivo", () => {
    const data = recordFinanceTransfer(fixture(), transfer(), true), expected = data.finance.transfers![0];
    const reversed = reverseFinanceTransfer(data, expected, "Operação registrada em duplicidade", true);
    expect(reversed.finance.transfers).toHaveLength(1);
    expect(reversed.finance.transfers![0]).toMatchObject({ ...expected, reversal: { reason: "Operação registrada em duplicidade" } });
    expect(managementReport(reversed, filter).positions.map((item) => item.balance)).toEqual([10000, 2000]);
    expect(managementReport(reversed, filter).transfers).toEqual([]);
    expect(() => reverseFinanceTransfer(reversed, reversed.finance.transfers![0], "Outro motivo", true)).toThrow("já estornada");
    expect(() => reverseFinanceTransfer(reversed, expected, "Outro motivo", true)).toThrow("alterada");
    expect(() => reverseFinanceTransfer(data, expected, "abc", true)).toThrow();
    expect(() => reverseFinanceTransfer(data, expected, "Outro motivo", false)).toThrow("Confirme");
    const inactive = saveBankAccount(data, { ...bank, active: false });
    expect(() => reverseFinanceTransfer(inactive, expected, "Correção necessária", true)).not.toThrow();
  });
  it("backup valida duplicidade/referências e protege contas usadas mesmo após estorno", () => {
    const data = recordFinanceTransfer(fixture(), transfer(), true);
    for (const mutate of [
      (copy: Database) => { copy.finance.transfers!.push(copy.finance.transfers![0]); },
      (copy: Database) => { copy.finance.accounts = copy.finance.accounts.filter((item) => item.id !== "from"); },
      (copy: Database) => { copy.finance.transfers![0].toAccountId = "from"; },
    ]) { const copy = structuredClone(data); mutate(copy); expect(() => validateDatabase(copy)).toThrow(); }
    const old = demoDatabase();
    expect(validateDatabase(JSON.parse(JSON.stringify(old))).finance).not.toHaveProperty("transfers");
  });
  it("exporta as duas pontas identificadas como transferência, fora dos totais de receitas/despesas", () => {
    const data = recordFinanceTransfer(fixture(), transfer(), true);
    const csv = managementCsv(data, managementReport(data, filter));
    expect(csv.match(/"Transferência interna"/g)).toHaveLength(2);
    expect(csv).toContain('"Entrada"');
    expect(csv).toContain('"Saída"');
    const filtered = managementCsv(data, managementReport(data, { ...filter, accountId: "from" }));
    expect(filtered.match(/"Transferência interna"/g)).toHaveLength(1);
    expect(filtered).not.toContain('"Entrada"');
  });
  it("renderiza listagem, histórico e impacto no fluxo sem alterar comportamento de A faturar", () => {
    const data = recordFinanceTransfer(fixture(), transfer(), true);
    const html = renderToStaticMarkup(<FinancePanel data={data} initialTab="Transferências" commit={() => {}} onSuccess={() => {}} onOpenOrder={() => {}} />);
    expect(html).toContain("Registrar transferência");
    expect(html).toContain("Reforço de caixa");
    expect(html).toContain("Estornar duas pontas");
    expect(html).toContain("não envia dinheiro");
    const cash = renderToStaticMarkup(<FinancePanel data={data} initialTab="Fluxo de caixa" commit={() => {}} onSuccess={() => {}} onOpenOrder={() => {}} />);
    expect(cash).toContain("Transferências recebidas");
    expect(cash).toContain("Transferências enviadas");
  });
});
