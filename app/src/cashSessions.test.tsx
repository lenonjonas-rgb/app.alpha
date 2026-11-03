import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, localDay, validateDatabase } from "./domain";
import { reverseSettlement, saveBankAccount, saveFinanceEntry, settleFinanceEntry } from "./finance";
import { recordFinanceTransfer, reverseFinanceTransfer } from "./financeTransfers";
import { cashMovementKey } from "./cashSessionSchema";
import { cashMovementReversed, cashSessionCandidates, closeCashSession, openCashSession } from "./cashSessions";
import { FinancePanel } from "./FinancePanel";

function fixture() {
  let data = saveBankAccount(demoDatabase(), { id: "cash", name: "Caixa loja", bank: "Interno",
    agency: "", account: "", kind: "Caixa", active: true });
  return saveBankAccount(data, { id: "bank", name: "Banco", bank: "Teste",
    agency: "", account: "", kind: "Corrente", active: true });
}
function opened() {
  return openCashSession(fixture(), { accountId: "cash", store: "Loja", openingAmount: 10000 }, true, "session");
}
function movements(data = opened()) {
  const day = localDay();
  data = saveFinanceEntry(data, { id: "entry", kind: "Receber", party: "Cliente", description: "Venda",
    amount: 10000, issuedOn: day, dueOn: day, accountId: "cash", paymentMethod: "Dinheiro", canceled: false, settlements: [] });
  data = settleFinanceEntry(data, "entry", { id: "payment", date: day, amount: 5000, accountId: "cash",
    adjustment: { interest: 100, fine: 0, discount: 0, reason: "Juros confirmados", confirmedAt: new Date().toISOString() } }, true);
  return recordFinanceTransfer(data, { id: "transfer", fromAccountId: "cash", toAccountId: "bank", date: day,
    amount: 2000, description: "Sangria", createdAt: new Date().toISOString() }, true);
}

describe("controle interno de caixa", () => {
  it("abre sem movimentar finanças e impede duas sessões simultâneas na mesma conta", () => {
    const data = opened();
    expect(data.finance.entries).toEqual([]);
    expect(data.finance.transfers ?? []).toEqual([]);
    expect(data.finance.cashSessions![0]).toMatchObject({ store: "Loja", openingAmount: 10000 });
    expect(() => openCashSession(data, { accountId: "cash", store: "Outra", openingAmount: 0 }, true)).toThrow("caixa aberto");
    expect(() => openCashSession(data, { accountId: "bank", store: "Outra", openingAmount: 0 }, true)).toThrow("tipo Caixa");
    expect(() => openCashSession(data, { accountId: "cash", store: "Outra", openingAmount: 0 }, false)).toThrow("Confirme");
  });
  it("fecha somente os movimentos selecionados com valor efetivo e preserva contagem e diferença", () => {
    const data = movements(), session = data.finance.cashSessions![0];
    const choices = cashSessionCandidates(data, session);
    expect(choices.map((item) => item.movement.amount).sort((a, b) => a - b)).toEqual([-2000, 5100]);
    const keys = choices.map((item) => cashMovementKey(item.movement));
    const closed = closeCashSession(data, session, choices, keys, 13000, true);
    expect(closed.finance.cashSessions![0].closure).toMatchObject({ expected: 13100, counted: 13000, difference: -100 });
    expect(closed.finance.entries).toEqual(data.finance.entries);
    expect(validateDatabase(JSON.parse(JSON.stringify(closed))).finance.cashSessions).toEqual(closed.finance.cashSessions);
    expect(() => closeCashSession(data, session, choices, keys, 13000, false)).toThrow("Confirme");
    expect(() => closeCashSession(closed, session, choices, keys, 13000, true)).toThrow("já fechado");
    const next = openCashSession(closed, { accountId: "cash", store: "Loja", openingAmount: 13000 }, true, "next");
    expect(cashSessionCandidates(next, next.finance.cashSessions![1])).toEqual([]);
    expect(() => closeCashSession(next, next.finance.cashSessions![1], [], keys, 13000, true)).toThrow("indisponível");
  });
  it("detecta movimentos alterados após a prévia e mantém o fechamento imutável depois de estornos", () => {
    let data = movements();
    const session = data.finance.cashSessions![0], choices = cashSessionCandidates(data, session);
    data = reverseFinanceTransfer(data, data.finance.transfers![0], "Ajuste de registro", true);
    expect(() => closeCashSession(data, session, choices, choices.map((item) => cashMovementKey(item.movement)), 15100, true))
      .toThrow("movimentos mudaram");
    const fresh = cashSessionCandidates(data, session);
    data = closeCashSession(data, session, fresh, fresh.map((item) => cashMovementKey(item.movement)), 15100, true);
    const snapshot = structuredClone(data.finance.cashSessions![0].closure);
    data = reverseSettlement(data, "entry", "payment");
    expect(data.finance.cashSessions![0].closure).toEqual(snapshot);
    expect(cashMovementReversed(data, snapshot!.movements[0])).toBe(true);
    const html = renderToStaticMarkup(<FinancePanel data={data} initialTab="Controle de caixa" commit={() => {}}
      onSuccess={() => {}} onOpenOrder={() => {}} />);
    expect(html).toContain("estornada após o fechamento");
    expect(html).toContain("Nenhuma movimentação ou pagamento é criado automaticamente");
  });
});
