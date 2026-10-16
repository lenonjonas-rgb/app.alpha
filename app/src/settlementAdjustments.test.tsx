import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, localDay, validateDatabase } from "./domain";
import { entryBalance, entryStatus, reverseSettlement, saveBankAccount, saveFinanceEntry, settleFinanceEntry } from "./finance";
import { financeSettlementSchema, settlementCashAmount } from "./financeSchema";
import { activeBankMatch, banking, importStatement, matchBankSettlement, settlementCandidates } from "./bankReconciliation";
import { managementCsv, managementReport } from "./financeManagement";
import { saveFinanceInstallments } from "./financeInstallments";
import { FinancePanel } from "./FinancePanel";

const today = localDay();
const adjustment = { interest: 1000, fine: 200, discount: 500, reason: "Acordo com o cliente", confirmedAt: new Date().toISOString() };
const settlement = { id: "payment", date: today, accountId: "bank", amount: 10000, adjustment };
const filter = { start: today, end: today, accountId: "", categoryId: "", costCenterId: "" };
function fixture(kind: "Receber" | "Pagar" = "Receber") {
  const data = saveBankAccount(demoDatabase(), { id: "bank", name: "Teste", bank: "Teste", agency: "", account: "", kind: "Corrente", active: true });
  return saveFinanceEntry(data, { id: "entry", kind, party: "Cliente ou fornecedor", description: "Conta manual", amount: 10000,
    issuedOn: today, dueOn: today, accountId: "bank", paymentMethod: "Pix", canceled: false, settlements: [] });
}

describe("ajustes manuais na baixa", () => {
  it.each(["Receber", "Pagar"] as const)("liquida o principal e movimenta apenas caixa efetivo em %s", (kind) => {
    const source = fixture(kind), data = settleFinanceEntry(source, "entry", settlement, true), entry = data.finance.entries[0];
    expect(entry.amount).toBe(10000);
    expect(entryBalance(entry)).toBe(0);
    expect(entryStatus(entry)).toBe(kind === "Receber" ? "Recebida" : "Paga");
    expect(settlementCashAmount(entry.settlements[0])).toBe(10700);
    expect(source.finance.entries[0].settlements).toEqual([]);
    const report = managementReport(data, filter);
    expect(report.totals).toEqual({ received: kind === "Receber" ? 10700 : 0, paid: kind === "Pagar" ? 10700 : 0,
      expectedPayments: 0, expectedReceipts: 0 });
    expect(report.positions[0].balance).toBe(kind === "Receber" ? 10700 : -10700);
    expect(report.daily[0][kind === "Receber" ? "received" : "paid"]).toBe(10700);
    expect(validateDatabase(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
  it("desconto liquida o principal sem inflar caixa e baixa parcial conserva saldo original restante", () => {
    const data = settleFinanceEntry(fixture(), "entry", { ...settlement, amount: 4000,
      adjustment: { ...adjustment, interest: 0, fine: 0, discount: 500 } }, true);
    expect(entryBalance(data.finance.entries[0])).toBe(6000);
    const report = managementReport(data, filter);
    expect(report.totals).toMatchObject({ received: 3500, expectedReceipts: 6000 });
    expect(report.positions[0]).toMatchObject({ balance: 3500, projected: 9500 });
    expect(report.movements.find((item) => item.source === "realized")?.adjustment).toMatchObject({ principal: 4000, discount: 500 });
  });
  it("aceita diferença de um centavo e juros que ultrapassam o saldo sem exceder o principal", () => {
    const data = settleFinanceEntry(fixture(), "entry", { ...settlement, adjustment: { ...adjustment, interest: 1, fine: 0, discount: 0 } }, true);
    expect(settlementCashAmount(data.finance.entries[0].settlements[0])).toBe(10001);
    expect(entryBalance(data.finance.entries[0])).toBe(0);
    expect(() => settleFinanceEntry(fixture(), "entry", { ...settlement, amount: 10001 }, true)).toThrow("excede");
  });
  it("exige confirmação, motivo e valores válidos; não registra desconto integral sem caixa", () => {
    expect(() => settleFinanceEntry(fixture(), "entry", settlement)).toThrow("Confirme");
    for (const change of [{ discount: 10001 }, { interest: -1 }, { fine: 0.5 }, { discount: NaN }, { interest: 100000001 },
      { reason: "  " }, { reason: "abcd" }, { confirmedAt: "invalid" }, { interest: 0, fine: 0, discount: 0 },
      { interest: 0, fine: 0, discount: 10000 }, { interest: 100000000 }])
      expect(() => settleFinanceEntry(fixture(), "entry", { ...settlement, adjustment: { ...adjustment, ...change } }, true)).toThrow();
    expect(() => financeSettlementSchema.parse({ ...settlement, amount: 0, reversed: false })).toThrow();
  });
  it("preserva baixas legadas sem acrescentar metadata ou mudar caixa/saldo", () => {
    const { adjustment: _adjustment, ...legacy } = settlement;
    const data = settleFinanceEntry(fixture(), "entry", legacy);
    expect(data.finance.entries[0].settlements[0]).toEqual({ ...legacy, reversed: false });
    expect(settlementCashAmount(data.finance.entries[0].settlements[0])).toBe(10000);
    expect(managementReport(data, filter).totals.received).toBe(10000);
  });
  it("valida limites exatos de caixa e neutraliza formulas no motivo exportado", () => {
    const low = settleFinanceEntry(fixture(), "entry", { ...settlement, adjustment: { ...adjustment, interest: 0, fine: 0, discount: 9999 } }, true);
    expect(managementReport(low, filter).totals.received).toBe(1);
    const high = settleFinanceEntry(fixture(), "entry", { ...settlement, amount: 1,
      adjustment: { ...adjustment, interest: 99999999, fine: 0, discount: 0, reason: "=SUM(1)" } }, true);
    const report = managementReport(high, filter);
    expect(report.totals.received).toBe(100000000);
    expect(entryBalance(high.finance.entries[0])).toBe(9999);
    expect(managementCsv(high, report)).toContain('"\'=SUM(1)"');
    expect(() => settleFinanceEntry(fixture(), "entry", { ...settlement, amount: 2,
      adjustment: { ...adjustment, interest: 99999999, fine: 0, discount: 0 } }, true)).toThrow("efetivo");
  });
  it("concilia por caixa efetivo, rejeita principal e diferença de um centavo e invalida vínculo após estorno", () => {
    let data = settleFinanceEntry(fixture(), "entry", settlement, true);
    data = importStatement(data, "bank", { format: "CSV", bank: "", account: "", lines: [
      { externalId: "cash", date: today, amount: 10700, description: "Recebido com ajustes" },
      { externalId: "principal", date: today, amount: 10000, description: "Principal não é caixa" },
      { externalId: "cent", date: today, amount: 10699, description: "Um centavo diferente" },
    ] }, "teste.csv", true);
    const transactions = banking(data).transactions;
    expect(settlementCandidates(data, transactions[0])).toHaveLength(1);
    for (const item of transactions.slice(1)) expect(() => matchBankSettlement(data, item.id, "entry", "payment")).toThrow("incompatível");
    data = matchBankSettlement(data, transactions[0].id, "entry", "payment");
    expect(activeBankMatch(data, banking(data).matches[0])).toBe(true);
    const reversed = reverseSettlement(data, "entry", "payment");
    expect(activeBankMatch(reversed, banking(reversed).matches[0])).toBe(false);
    expect(reversed.finance.entries[0].settlements[0].adjustment).toEqual(adjustment);
    expect(entryBalance(reversed.finance.entries[0])).toBe(10000);
    expect(managementReport(reversed, filter).totals).toMatchObject({ received: 0, expectedReceipts: 10000 });
    expect(managementReport(reversed, filter).positions[0].balance).toBe(0);
  });
  it("CSV e interface discriminam principal/juros/multa/desconto sem somar ajustes duas vezes", () => {
    const data = settleFinanceEntry(fixture(), "entry", settlement, true);
    const csv = managementCsv(data, managementReport(data, filter));
    expect(csv).toContain('"107,00";"100,00";"10,00";"2,00";"5,00";"Acordo com o cliente"');
    const props = { data, commit: () => {}, onSuccess: () => {}, onOpenOrder: () => {} };
    const html = renderToStaticMarkup(<FinancePanel {...props} initialTab="Contas a receber" />);
    expect(html).toContain("Principal liquidado:");
    expect(html).toContain(adjustment.reason);
    const report = renderToStaticMarkup(<FinancePanel {...props} initialTab="Relatórios" />);
    expect(report).toContain("Ajustes da baixa");
    expect(report).toContain(adjustment.reason);
  });
  it("ajuste em parcela não modifica total do grupo nem saldo das demais", () => {
    const source = fixture(), entry = source.finance.entries[0];
    const data = saveFinanceInstallments(source, { ...entry, id: "plan", amount: 20000 }, [today, "2027-01-01"], true);
    const settled = settleFinanceEntry(data, "plan:1", settlement, true);
    expect(entryBalance(settled.finance.entries.find((item) => item.id === "plan:1")!)).toBe(0);
    expect(entryBalance(settled.finance.entries.find((item) => item.id === "plan:2")!)).toBe(10000);
    expect(settled.finance.entries.filter((item) => item.installment).map((item) => item.installment?.total)).toEqual([20000, 20000]);
  });
  it("recusa duplicidade de baixa e backup com ajuste em faturamento ou principal excedido", () => {
    const data = settleFinanceEntry(fixture(), "entry", { ...settlement, amount: 1000 }, true);
    expect(() => settleFinanceEntry(data, "entry", { ...settlement, amount: 1000 }, true)).toThrow("baixas inválidas");
    const changed = structuredClone(data); changed.finance.entries[0].settlements[0].amount = 10001;
    expect(() => validateDatabase(changed)).toThrow();
    const billed = fixture(); billed.finance.entries[0].invoiceId = "invoice";
    expect(() => settleFinanceEntry(billed, "entry", settlement, true)).toThrow("somente para contas manuais");
  });
});
