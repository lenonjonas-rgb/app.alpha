import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, localDay, validateDatabase } from "./domain";
import type { Database } from "./domain";
import { saveBankAccount, saveFinanceEntry, settleFinanceEntry, reverseSettlement } from "./finance";
import { recordFinanceTransfer, reverseFinanceTransfer } from "./financeTransfers";
import { banking, activeTransferMatch, importStatement, matchBankTransfer, unmatchBankTransfer, transferCandidates,
  transactionReconciled, matchBankSettlement, settleAndMatch } from "./bankReconciliation";
import { managementReport } from "./financeManagement";
import { FinancePanel } from "./FinancePanel";

const today = localDay(), createdAt = new Date().toISOString();
const filter = { start: today, end: today, accountId: "", categoryId: "", costCenterId: "" };
const bank = { id: "from", name: "Origem", bank: "Teste", agency: "", account: "", kind: "Corrente" as const, active: true };
function fixture() {
  let data = saveBankAccount(saveBankAccount(demoDatabase(), bank), { ...bank, id: "to", name: "Destino" });
  data = recordFinanceTransfer(data, { id: "transfer", fromAccountId: "from", toAccountId: "to", date: today,
    amount: 2500, description: "Reforço", createdAt }, true);
  for (const [accountId, amount] of [["from", -2500], ["to", 2500]] as const) data = importStatement(data, accountId,
    { format: "CSV", account: "", bank: "", lines: [{ externalId: "ref", date: today, amount, description: "Transferência" }] }, "extrato.csv", true);
  return data;
}
function payable(data: Database) {
  return saveFinanceEntry(data, { id: "payable", kind: "Pagar", party: "Fornecedor", description: "Pagamento",
    amount: 2500, issuedOn: today, dueOn: today, accountId: "from", paymentMethod: "Pix", canceled: false, settlements: [] });
}
function outgoing(data: Database) { return banking(data).transactions[0].id; }
function incoming(data: Database) { return banking(data).transactions[1].id; }
function matchBoth(data = fixture()) {
  return matchBankTransfer(matchBankTransfer(data, outgoing(data), "transfer", true), incoming(data), "transfer", true);
}

describe("conciliação de transferências internas", () => {
  it("concilia ambas as pontas sem criar títulos/baixas nem alterar saldos/resultado", () => {
    const source = fixture(), report = managementReport(source, filter), data = matchBoth(source);
    expect(data.finance.transfers).toEqual(source.finance.transfers);
    expect(data.finance.entries).toEqual(source.finance.entries);
    expect(data.finance.invoices).toEqual(source.finance.invoices);
    expect(banking(data).matches).toEqual([]);
    expect(banking(data).transferMatches?.map((item) => item.leg)).toEqual(["outgoing", "incoming"]);
    expect(transactionReconciled(data, outgoing(data))).toBe(true);
    expect(transactionReconciled(data, incoming(data))).toBe(true);
    expect(managementReport(data, filter)).toEqual(report);
    expect(validateDatabase(JSON.parse(JSON.stringify(data))).finance).toEqual(data.finance);
  });
  it("aceita ponta única e mantém a outra pendente, inclusive importada posteriormente", () => {
    const source = fixture();
    const data = matchBankTransfer(source, outgoing(source), "transfer", true);
    expect(transactionReconciled(data, outgoing(data))).toBe(true);
    expect(transactionReconciled(data, incoming(data))).toBe(false);
    expect(transferCandidates(data, banking(data).transactions[1])).toHaveLength(1);
    const copy = structuredClone(source); banking(copy).transactions.pop();
    const partial = matchBankTransfer(copy, outgoing(copy), "transfer", true);
    const imported = importStatement(partial, "to", { format: "CSV", account: "", bank: "",
      lines: [{ externalId: "incoming-later", date: today, amount: 2500, description: "Entrada" }] }, "outro.csv", true);
    expect(() => matchBankTransfer(imported, incoming(imported), "transfer", true)).not.toThrow();
  });
  it("exige confirmação e revalida data, valor exato, sinal e conta; nunca seleciona automaticamente", () => {
    const data = fixture(), transaction = banking(data).transactions[0];
    expect(() => matchBankTransfer(data, transaction.id, "transfer", false)).toThrow("Confirme");
    expect(() => matchBankTransfer(data, transaction.id, "missing", true)).toThrow("incompatível");
    for (const change of [{ amount: -2499 }, { amount: 2500 }, { accountId: "to" }, { date: "2020-01-01" }])
      expect(transferCandidates(data, { ...transaction, ...change })).toEqual([]);
    const another = recordFinanceTransfer(data, { ...data.finance.transfers![0], id: "another" }, true);
    expect(transferCandidates(another, transaction)).toHaveLength(2);
    expect(banking(another).transferMatches).toBeUndefined();
  });
  it("impede reutilizar movimento entre transferência/baixa em ambas as ordens", () => {
    const source = settleFinanceEntry(payable(fixture()), "payable", { id: "payment", date: today, amount: 2500, accountId: "from" });
    const matched = matchBankTransfer(source, outgoing(source), "transfer", true);
    expect(() => matchBankSettlement(matched, outgoing(matched), "payable", "payment")).toThrow("já conciliado");
    expect(() => settleAndMatch(matched, outgoing(matched), "payable", true)).toThrow("já conciliado");
    const settled = matchBankSettlement(source, outgoing(source), "payable", "payment");
    expect(() => matchBankTransfer(settled, outgoing(settled), "transfer", true)).toThrow("já conciliado");
    const reversed = reverseSettlement(settled, "payable", "payment");
    expect(() => matchBankTransfer(reversed, outgoing(reversed), "transfer", true)).not.toThrow();
  });
  it("impede dois extratos para a mesma ponta e aceita somente a outra ponta livre", () => {
    let data = fixture();
    data = importStatement(data, "from", { format: "CSV", account: "", bank: "",
      lines: [{ externalId: "other", date: today, amount: -2500, description: "Outro débito" }] }, "outro.csv", true);
    data = matchBankTransfer(data, outgoing(data), "transfer", true);
    expect(() => matchBankTransfer(data, outgoing(data), "transfer", true)).toThrow("já conciliado");
    expect(() => matchBankTransfer(data, banking(data).transactions[2].id, "transfer", true)).toThrow("ponta já conciliada");
    expect(() => matchBankTransfer(data, incoming(data), "transfer", true)).not.toThrow();
  });
  it("desfaz uma ponta preservando a outra, saldos e histórico, permitindo nova conferência", () => {
    const source = matchBoth(), match = banking(source).transferMatches![0];
    let data = unmatchBankTransfer(source, match.id);
    expect(data.finance.transfers).toEqual(source.finance.transfers);
    expect(managementReport(data, filter)).toEqual(managementReport(source, filter));
    expect(transactionReconciled(data, outgoing(data))).toBe(false);
    expect(transactionReconciled(data, incoming(data))).toBe(true);
    expect(() => unmatchBankTransfer(data, match.id)).toThrow("já desfeito");
    data = matchBankTransfer(data, outgoing(data), "transfer", true);
    expect(banking(data).transferMatches).toHaveLength(3);
    expect(banking(data).transferMatches![0].reversed).toBe(true);
    expect(banking(data).transferMatches!.filter((item) => activeTransferMatch(data, item))).toHaveLength(2);
  });
  it("estorno invalida ambas as conciliações mantendo histórico e bloqueia vínculo novo na transferência estornada", () => {
    const source = matchBoth(), data = reverseFinanceTransfer(source, source.finance.transfers![0], "Registro incorreto", true);
    expect(banking(data).transferMatches).toEqual(banking(source).transferMatches);
    expect(transactionReconciled(data, outgoing(data))).toBe(false);
    expect(transactionReconciled(data, incoming(data))).toBe(false);
    expect(() => matchBankTransfer(data, outgoing(data), "transfer", true)).toThrow("estornada");
    expect(() => unmatchBankTransfer(data, banking(data).transferMatches![0].id)).toThrow("estornada");
    const replacement = recordFinanceTransfer(data, { ...source.finance.transfers![0], id: "replacement" }, true);
    expect(() => matchBankTransfer(replacement, outgoing(replacement), "replacement", true)).not.toThrow();
  });
  it("mantém os vínculos após inativar conta e permite conferência de transferência histórica", () => {
    let data = fixture();
    data = saveBankAccount(data, { ...bank, active: false });
    data = matchBankTransfer(data, outgoing(data), "transfer", true);
    expect(transactionReconciled(data, outgoing(data))).toBe(true);
  });
  it("valida backup e duplicidades inclusive vínculos mistos", () => {
    const source = matchBoth();
    for (const mutate of [
      (copy: Database) => { banking(copy).transferMatches!.push({ ...banking(copy).transferMatches![0], id: "other" }); },
      (copy: Database) => { banking(copy).transferMatches![0].leg = "incoming"; },
      (copy: Database) => { banking(copy).transferMatches![0].transferId = "missing"; },
      (copy: Database) => { banking(copy).transferMatches![0].transactionId = "missing"; },
    ]) { const copy = structuredClone(source); mutate(copy); expect(() => validateDatabase(copy)).toThrow(); }
    let data = settleFinanceEntry(payable(fixture()), "payable", { id: "payment", date: today, amount: 2500, accountId: "from" });
    data = matchBankSettlement(data, outgoing(data), "payable", "payment");
    data.finance.banking!.transferMatches = [{ ...banking(source).transferMatches![0], transactionId: outgoing(data) }];
    expect(() => validateDatabase(data)).toThrow("já conciliado");
  });
  it("interface exibe status separado de cada ponta e esconde transferências conciliadas dos pendentes", () => {
    const partial = fixture(), data = matchBankTransfer(partial, outgoing(partial), "transfer", true);
    const props = { data, commit: () => {}, onSuccess: () => {}, onOpenOrder: () => {} };
    const transfers = renderToStaticMarkup(<FinancePanel {...props} initialTab="Transferências" />);
    expect(transfers).toContain("Saída conciliada");
    expect(transfers).toContain("Entrada não conciliada");
    const pending = renderToStaticMarkup(<FinancePanel {...props} initialTab="Conciliação bancária" />);
    expect(pending).not.toContain("-R$");
    expect(pending).toContain("uma ponta pode ficar pendente");
    const full = renderToStaticMarkup(<FinancePanel {...props} data={matchBoth()} initialTab="Conciliação bancária" />);
    expect(full).toContain("Nenhum movimento para os filtros selecionados");
  });
});
