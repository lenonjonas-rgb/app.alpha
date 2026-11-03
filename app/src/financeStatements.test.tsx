import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, validateDatabase } from "./domain";
import { saveBankAccount, saveFinanceEntry, settleFinanceEntry, reverseSettlement } from "./finance";
import { saveOpeningBalance } from "./financeManagement";
import { recordFinanceTransfer, reverseFinanceTransfer } from "./financeTransfers";
import { cashStatement, cashStatementCsv, customerStatement, customerStatementCsv } from "./financeStatements";
import { FinancePanel } from "./FinancePanel";
import { FinanceCustomerStatementPanel } from "./FinanceStatementsPanel";
import type { Database } from "./domain";

const period = { start: "2024-01-02", end: "2024-01-31" };
const timestamp = "2024-01-03T12:00:00.000Z";
function fixture() {
  let data = saveBankAccount(demoDatabase(), { id: "a", name: "Banco A", bank: "Teste",
    agency: "", account: "", kind: "Corrente", active: true });
  data = saveBankAccount(data, { id: "b", name: "Caixa", bank: "Interno",
    agency: "", account: "", kind: "Caixa", active: true });
  data = saveOpeningBalance(data, { accountId: "a", date: "2024-01-01", amount: 10000 });
  data = saveFinanceEntry(data, { id: "receipt", kind: "Receber", party: data.clients[0].name, clientId: data.clients[0].id,
    description: 'Serviço; "A"', amount: 10000, issuedOn: "2024-01-01", dueOn: "2024-01-31", accountId: "a",
    paymentMethod: "Pix", canceled: false, settlements: [] });
  data = settleFinanceEntry(data, "receipt", { id: "previous", date: "2024-01-01", amount: 2000, accountId: "a" });
  data = settleFinanceEntry(data, "receipt", { id: "partial", date: "2024-01-03", amount: 1000, accountId: "a",
    adjustment: { interest: 50, fine: 20, discount: 10, reason: "Ajuste confirmado", confirmedAt: timestamp } }, true);
  return recordFinanceTransfer(data, { id: "transfer", fromAccountId: "a", toAccountId: "b",
    date: "2024-01-04", amount: 500, description: "Suprimento de caixa", createdAt: timestamp }, true);
}
function reconciled(data: Database) {
  return validateDatabase({ ...data, finance: { ...data.finance, banking: {
    transactions: [
      { id: "t1", accountId: "a", externalId: "1", date: "2024-01-03", description: "Crédito", amount: 1060,
        importedAt: timestamp, fileName: "extrato.ofx" },
      { id: "t2", accountId: "a", externalId: "2", date: "2024-01-04", description: "Transferência", amount: -500,
        importedAt: timestamp, fileName: "extrato.ofx" },
    ],
    matches: [{ id: "m1", transactionId: "t1", entryId: "receipt", settlementId: "partial", createdAt: timestamp, reversed: false }],
    transferMatches: [{ id: "m2", transactionId: "t2", transferId: "transfer", leg: "outgoing", createdAt: timestamp, reversed: false }],
  } } });
}

describe("caixas e bancos", () => {
  it("usa o valor efetivo de baixas, as pontas das transferências e a base gerencial sem duplicar movimentos", () => {
    const report = cashStatement(fixture(), { ...period, accountId: "a" }, "2024-02-01");
    expect(report).toMatchObject({ initialBalance: 12000, incoming: 1060, outgoing: 500, finalBalance: 12560 });
    expect(report.movements.map((item) => [item.source, item.amount])).toEqual([["Transferência", -500], ["Baixa", 1060]]);
    const all = cashStatement(fixture(), { ...period, accountId: "" }, "2024-02-01");
    expect(all).toMatchObject({ initialBalance: 12000, incoming: 1560, outgoing: 500, finalBalance: 13060, missingOpening: true });
  });
  it("reflete conciliação ativa por baixa ou ponta, sem confundir a outra ponta", () => {
    const data = reconciled(fixture());
    const all = cashStatement(data, { ...period, accountId: "" }, "2024-02-01");
    expect(all.movements.find((item) => item.source === "Baixa")?.reconciled).toBe(true);
    expect(all.movements.find((item) => item.amount === -500)?.reconciled).toBe(true);
    expect(all.movements.find((item) => item.amount === 500)?.reconciled).toBe(false);
    const reversed = reverseSettlement(data, "receipt", "partial");
    expect(cashStatement(reversed, { ...period, accountId: "a" }, "2024-02-01").movements)
      .not.toContainEqual(expect.objectContaining({ source: "Baixa" }));
    const transfer = data.finance.transfers![0];
    const undone = reverseFinanceTransfer(data, transfer, "Registro duplicado", true);
    expect(cashStatement(undone, { ...period, accountId: "" }, "2024-02-01").movements)
      .not.toContainEqual(expect.objectContaining({ source: "Transferência" }));
  });
  it("não inventa saldo anterior à data-base e rejeita filtros inválidos", () => {
    const data = fixture();
    const overlap = cashStatement(data, { start: "2023-12-01", end: "2024-01-31", accountId: "a" }, "2024-02-01");
    expect(overlap).toMatchObject({ initialBalance: null, finalBalance: 12560, startsBeforeBase: true });
    const before = cashStatement(data, { start: "2023-11-01", end: "2023-12-01", accountId: "a" }, "2024-02-01");
    expect(before).toMatchObject({ initialBalance: null, finalBalance: null });
    expect(() => cashStatement(data, { ...period, accountId: "missing" })).toThrow("Filtro");
    expect(() => cashStatement(data, { start: period.end, end: period.start, accountId: "" })).toThrow();
  });
  it("protege o CSV e exporta somente as movimentações fornecidas", () => {
    const data = fixture();
    data.finance.entries[0].party = '=HYPERLINK("não")';
    const report = cashStatement(data, { ...period, accountId: "a" }, "2024-02-01");
    const csv = cashStatementCsv(data, report.movements.filter((item) => item.source === "Baixa"));
    expect(csv).toContain('"\'=HYPERLINK(""não"")"');
    expect(csv).toContain('"Serviço; ""A"""');
    expect(csv).toContain('"10,60"');
    expect(csv).not.toContain("Suprimento de caixa");
  });
  it("exporta saídas como valores numéricos negativos sem liberar fórmulas em campos de texto", () => {
    const data = fixture();
    data.finance.transfers![0].description = "-1+2";
    const report = cashStatement(data, { ...period, accountId: "a" }, "2024-02-01");
    const csv = cashStatementCsv(data, report.movements);
    expect(csv).toContain('"-5,00"');
    expect(csv).not.toContain('"\'-5,00"');
    expect(csv).toContain('"\'-1+2"');
  });
});

describe("ficha financeira", () => {
  it("filtra pelo cliente e vencimento, separa caixa recebido de saldo e desconsidera estornos", () => {
    const data = fixture(), clientId = data.clients[0].id;
    const report = customerStatement(data, clientId, period, "2024-02-01");
    expect(report).toMatchObject({ received: 3060, outstanding: 7000, overdue: 7000 });
    expect(report.entries).toHaveLength(1);
    expect(customerStatement(data, data.clients[1].id, period, "2024-02-01").entries).toEqual([]);
    expect(customerStatement(data, clientId, { start: "2024-02-01", end: "2024-02-29" }).entries).toEqual([]);
    const reversed = reverseSettlement(data, "receipt", "partial");
    expect(customerStatement(reversed, clientId, period, "2024-02-01"))
      .toMatchObject({ received: 2000, outstanding: 8000, overdue: 8000 });
    expect(() => customerStatement(data, "missing", period)).toThrow("cliente cadastrado");
    expect(customerStatementCsv(data, clientId, period, "2024-02-01")).toContain('"70,00"');
  });
  it("não associa um título antigo ao cliente apenas pelo nome", () => {
    const data = fixture();
    const legacy = { ...data.finance.entries[0], id: "legacy", clientId: undefined, settlements: [] };
    const updated = saveFinanceEntry(data, legacy);
    expect(customerStatement(updated, data.clients[0].id, period).entries.map((item) => item.id)).toEqual(["receipt"]);
  });
  it("mostra as novas seções sem substituir os fluxos existentes", () => {
    const data = fixture();
    const cash = renderToStaticMarkup(<FinancePanel data={data} initialTab="Caixas e bancos" commit={() => {}}
      onSuccess={() => {}} onOpenOrder={() => {}} />);
    expect(cash).toContain("Caixas e bancos");
    expect(cash).toContain("Exportar extrato CSV");
    expect(cash).toContain("Transferir entre contas");
    expect(cash).toContain("Contas a receber");
    const customer = renderToStaticMarkup(<FinanceCustomerStatementPanel data={data} />);
    expect(customer).toContain("Selecione um cliente");
    expect(customer).toContain("Consultar ficha");
  });
});
