import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, localDay, validateDatabase } from "./domain";
import { saveBankAccount, saveFinanceEntry, settleFinanceEntry, reverseSettlement } from "./finance";
import { parseBankStatement } from "./bankStatement";
import { activeBankMatch, banking, importStatement, matchBankSettlement, previewStatementImport, settleAndMatch,
  settlementCandidates, unmatchBankSettlement, matchBankSettlementGroup, transactionReconciled,
  activeBankReconciliationGroup } from "./bankReconciliation";
import { managementReport } from "./financeManagement";
import { FinancePanel } from "./FinancePanel";
import type { ParsedStatement } from "./bankStatement";
import type { Database } from "./domain";

const today = localDay();
const bank = { id: "bank", name: "Banco teste", bank: "Teste", agency: "1234", account: "999", kind: "Corrente" as const, active: true };
function fixture() {
  const data = saveBankAccount(demoDatabase(), bank);
  return saveFinanceEntry(data, { id: "entry", kind: "Receber", party: "Cliente", description: "Serviço", amount: 10000,
    issuedOn: today, dueOn: today, accountId: bank.id, paymentMethod: "Pix", canceled: false, settlements: [] });
}
const csv = (body = `id-1;${today};Recebimento;100,00`) => `id;data;descricao;valor\r\n${body}\r\n`;
function statement(amount = 10000): ParsedStatement {
  return { format: "CSV", bank: "", account: "", lines: [{ externalId: "id-1", date: today, description: "Recebimento", amount }] };
}
function daysBefore(value: string, days: number) {
  return new Date(Date.parse(`${value}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}
function imported(data = fixture(), amount = 10000) { return importStatement(data, "bank", statement(amount), "extrato.csv", true); }
function settled(data = fixture(), amount = 10000) {
  return settleFinanceEntry(data, "entry", { id: "payment", date: today, amount, accountId: "bank" });
}
function ofx(block = `<STMTTRN><TRNTYPE>CREDIT\n<DTPOSTED>20261008120000[-3:BRT]\n<TRNAMT>100.00\n<FITID>bank-1\n<MEMO>Serviço &amp; peças\n</STMTTRN>`) {
  return `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL\n<BANKACCTFROM><BANKID>341\n<ACCTID>1234\n</BANKACCTFROM><BANKTRANLIST>${block}</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}
describe("leitura de extratos", () => {
  it("lê CSV com BOM, aspas, separadores, quebras e centavos exatos", () => {
    const result = parseBankStatement("\uFEFF" + csv(`id-1;${today};"Recebimento; ""ABC""\nLinha";1.234,56\nid-2;${today};Tarifa;-0,01`), "EXTRATO.CSV");
    expect(result.lines).toEqual([
      { externalId: "id-1", date: today, description: 'Recebimento; "ABC"\nLinha', amount: 123456 },
      { externalId: "id-2", date: today, description: "Tarifa", amount: -1 },
    ]);
  });
  it.each([
    ["cabeçalho inválido", "data;valor\n2026-10-08;10,00"],
    ["sem movimentos", "id;data;descricao;valor"],
    ["valor zero", csv(`x;${today};Teste;0,00`)],
    ["valor ambíguo", csv(`x;${today};Teste;100.00`)],
    ["data inválida", csv("x;2026-02-30;Teste;10,00")],
    ["IDs repetidos", csv(`x;${today};Teste;10,00\nx;${today};Teste;10,00`)],
    ["aspas abertas", csv(`x;${today};"Teste;10,00`)],
    ["campos excedentes", csv(`x;${today};Teste;10,00;extra`)],
    ["valor excessivo", csv(`x;${today};Teste;1000000,01`)],
    ["codificação inválida", csv(`x;${today};Teste\uFFFD;10,00`)],
  ])("recusa CSV %s sem importação parcial", (_, content) => {
    expect(() => parseBankStatement(content, "extrato.csv")).toThrow();
  });
  it("lê OFX SGML/XML, FITID, data local bancária e entidades de texto", () => {
    const result = parseBankStatement(ofx(), "extrato.ofx");
    expect(result).toMatchObject({ format: "OFX", bank: "341", account: "1234",
      lines: [{ externalId: "bank-1", date: "2026-10-08", amount: 10000, description: "Serviço & peças" }] });
    expect(parseBankStatement(ofx("<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261008</DTPOSTED><TRNAMT>-50.01</TRNAMT><FITID>debit-1</FITID><NAME>Pagamento</NAME></STMTTRN>"), "xml.ofx").lines[0].amount).toBe(-5001);
  });
  it.each([
    ofx().replace("<CURDEF>BRL", "<CURDEF>USD"),
    ofx().replace("<FITID>bank-1", ""),
    ofx().replace("</STMTTRN>", ""),
    ofx().replace("<TRNAMT>100.00", "<TRNAMT>100.0"),
    ofx().replace("<ACCTID>1234", "<ACCTID>1234\n<ACCTID>5678"),
    ofx().replace("</OFX>", ""),
    ofx().replace("<FITID>bank-1", "<CORRECTFITID>old-ref\n<FITID>bank-1"),
    "<!DOCTYPE OFX>" + ofx(),
  ])("recusa OFX incompleto, ambíguo, com moeda não suportada ou entidades externas", (content) => {
    expect(() => parseBankStatement(content, "extrato.ofx")).toThrow();
  });
});
describe("importação e conciliação", () => {
  it("importa sem criar contas/baixas e deduplica por banco + ID estável", () => {
    const source = fixture(), data = imported(source);
    expect(data.finance.entries).toEqual(source.finance.entries);
    expect(data.finance.invoices).toEqual(source.finance.invoices);
    expect(previewStatementImport(data, "bank", statement())).toEqual({ fresh: [], duplicates: 1 });
    expect(() => importStatement(data, "bank", statement(), "outronome.csv", true)).toThrow("já foram importados");
    const updated = saveBankAccount(data, { ...bank, id: "other", name: "Outro" });
    expect(previewStatementImport(updated, "other", statement()).fresh).toHaveLength(1);
    expect(validateDatabase(JSON.parse(JSON.stringify(data))).finance.banking).toEqual(data.finance.banking);
  });
  it("recusa conflito sem importar as demais linhas, falta de confirmação, conta inativa e futuro", () => {
    const data = imported();
    const conflict = statement(9000); conflict.lines.push({ externalId: "new", date: today, description: "Novo", amount: 1 });
    expect(() => importStatement(data, "bank", conflict, "extrato.csv", true)).toThrow("dados diferentes");
    expect(banking(data).transactions).toHaveLength(1);
    expect(() => importStatement(fixture(), "bank", statement(), "extrato.csv", false)).toThrow("Confirme");
    expect(() => importStatement(saveBankAccount(fixture(), { ...bank, active: false }), "bank", statement(), "extrato.csv", true)).toThrow("ativo");
    const future = statement(); future.lines[0].date = "2099-01-01";
    expect(() => importStatement(fixture(), "bank", future, "extrato.csv", true)).toThrow("futuro");
  });
  it("vincula baixa exata sem duplicar recebimento e impede conciliação duplicada", () => {
    const source = imported(settled()), transaction = banking(source).transactions[0];
    const data = matchBankSettlement(source, transaction.id, "entry", "payment");
    expect(data.finance.entries).toEqual(source.finance.entries);
    expect(banking(data).matches).toHaveLength(1);
    expect(activeBankMatch(data, banking(data).matches[0])).toBe(true);
    expect(() => matchBankSettlement(data, transaction.id, "entry", "payment")).toThrow("já conciliado");
    const another = statement(); another.lines[0].externalId = "another";
    const extended = importStatement(data, "bank", another, "extrato.csv", true);
    expect(() => matchBankSettlement(extended, banking(extended).transactions[1].id, "entry", "payment")).toThrow("incompatível");
  });
  it("rejeita diferença de um centavo, sinal, banco ou data; não decide automaticamente entre candidatos", () => {
    const source = imported(settled());
    const transaction = banking(source).transactions[0];
    for (const change of [{ amount: 9999 }, { amount: -10000 }, { accountId: "other" }, { date: "2020-01-01" }])
      expect(settlementCandidates(source, { ...transaction, ...change })).toHaveLength(0);
    expect(() => matchBankSettlement(source, transaction.id, "missing", "payment")).toThrow("incompatível");
    expect(() => matchBankSettlement(source, "missing", "entry", "payment")).toThrow("indisponível");
  });
  it("dá baixa parcial e concilia atomicamente; relatório considera somente uma baixa", () => {
    const source = imported(fixture(), 2500), transaction = banking(source).transactions[0];
    expect(() => settleAndMatch(source, transaction.id, "entry", false)).toThrow("Confirme");
    const data = settleAndMatch(source, transaction.id, "entry", true);
    expect(data.finance.entries[0].settlements).toHaveLength(1);
    expect(data.finance.entries[0].settlements[0]).toMatchObject({ amount: 2500, date: today, accountId: "bank" });
    expect(banking(data).matches).toHaveLength(1);
    expect(managementReport(data, { start: today, end: today, accountId: "", categoryId: "", costCenterId: "" }).totals)
      .toEqual({ received: 2500, paid: 0, expectedReceipts: 7500, expectedPayments: 0 });
    expect(() => settleAndMatch(data, transaction.id, "entry", true)).toThrow("já conciliado");
    const stale = settled(source, 9000);
    expect(() => settleAndMatch(stale, transaction.id, "entry", true)).toThrow("insuficiente");
    expect(source.finance.entries[0].settlements).toEqual([]);
  });
  it("concilia pagamentos negativos com título a pagar sem interpretar débito como receita", () => {
    let data = fixture();
    data = saveFinanceEntry(data, { ...data.finance.entries[0], id: "payable", kind: "Pagar" });
    data = imported(data, -2500);
    const transaction = banking(data).transactions[0];
    expect(() => settleAndMatch(data, transaction.id, "entry", true)).toThrow("incompatível");
    data = settleAndMatch(data, transaction.id, "payable", true);
    expect(data.finance.entries.find((item) => item.id === "payable")?.settlements[0].amount).toBe(2500);
  });
  it("desfaz vínculo preservando baixa e histórico, permitindo nova conferência explícita", () => {
    const source = imported(settled()), transaction = banking(source).transactions[0];
    let data = matchBankSettlement(source, transaction.id, "entry", "payment");
    const match = banking(data).matches[0];
    data = unmatchBankSettlement(data, match.id);
    expect(data.finance.entries).toEqual(source.finance.entries);
    expect(activeBankMatch(data, banking(data).matches[0])).toBe(false);
    expect(() => unmatchBankSettlement(data, match.id)).toThrow("já desfeito");
    data = matchBankSettlement(data, transaction.id, "entry", "payment");
    expect(banking(data).matches).toHaveLength(2);
    expect(banking(data).matches[0].reversed).toBe(true);
  });
  it("concilia varios movimientos y bajas por total exacto dentro de tres dias", () => {
    let data = fixture();
    const firstDate = today, secondDate = daysBefore(today, 2);
    data = importStatement(data, "bank", { format: "CSV", bank: "", account: "", lines: [
      { externalId: "group-1", date: firstDate, description: "Crédito lote A", amount: 4000 },
      { externalId: "group-2", date: secondDate, description: "Crédito lote B", amount: 6000 },
    ] }, "grupo.csv", true);
    data = saveFinanceEntry(data, { ...data.finance.entries[0], id: "entry-a", amount: 2500, settlements: [] });
    data = saveFinanceEntry(data, { ...data.finance.entries[0], id: "entry-b", amount: 7500, settlements: [] });
    data = settleFinanceEntry(data, "entry-a", { id: "settlement-a", date: daysBefore(today, 1), amount: 2500, accountId: "bank" });
    data = settleFinanceEntry(data, "entry-b", { id: "settlement-b", date: secondDate, amount: 7500, accountId: "bank" });
    const [firstTransaction, secondTransaction] = banking(data).transactions;
    const group = {
      transactionIds: [firstTransaction.id, secondTransaction.id],
      settlements: [{ entryId: "entry-a", settlementId: "settlement-a" }, { entryId: "entry-b", settlementId: "settlement-b" }],
    };
    expect(() => matchBankSettlementGroup(data, group.transactionIds, group.settlements, false)).toThrow("Confirme");
    data = matchBankSettlementGroup(data, group.transactionIds, group.settlements, true);
    const savedGroup = banking(data).reconciliationGroups![0];
    expect(activeBankReconciliationGroup(data, savedGroup)).toBe(true);
    expect(transactionReconciled(data, firstTransaction.id)).toBe(true);
    expect(transactionReconciled(data, secondTransaction.id)).toBe(true);
    const settlementReversed = reverseSettlement(data, "entry-a", "settlement-a");
    expect(activeBankReconciliationGroup(settlementReversed, savedGroup)).toBe(false);
    expect(transactionReconciled(settlementReversed, firstTransaction.id)).toBe(false);
    expect(transactionReconciled(settlementReversed, secondTransaction.id)).toBe(false);
    expect(managementReport(data, { start: secondDate, end: today, accountId: "", categoryId: "", costCenterId: "" }).totals.received).toBe(10000);
    expect(() => matchBankSettlementGroup(data, group.transactionIds, group.settlements, true)).toThrow("já conciliado");
    const undone = unmatchBankSettlement(data, savedGroup.id);
    expect(undone.finance.entries).toEqual(data.finance.entries);
    expect(transactionReconciled(undone, firstTransaction.id)).toBe(false);
    expect(transactionReconciled(undone, secondTransaction.id)).toBe(false);
    expect(banking(undone).reconciliationGroups![0].reversed).toBe(true);
  });
  it("recusa diferença de total e grupo com datas fora da janela de três dias", () => {
    let data = imported(settled());
    const transaction = banking(data).transactions[0];
    data = importStatement(data, "bank", { format: "CSV", bank: "", account: "", lines: [
      { externalId: "extra", date: today, description: "Crédito adicional", amount: 1 },
    ] }, "grupo.csv", true);
    const secondTransaction = banking(data).transactions[1];
    const extraEntry = { ...data.finance.entries[0], id: "entry-extra", settlements: [] };
    data = saveFinanceEntry(data, extraEntry);
    data = settleFinanceEntry(data, extraEntry.id, { id: "settlement-extra", date: today, amount: 1, accountId: "bank" });
    const settlement = [{ entryId: extraEntry.id, settlementId: "settlement-extra" }];
    expect(() => matchBankSettlementGroup(data, [transaction.id, secondTransaction.id], settlement, true)).toThrow("exatamente");
    const tooFar = structuredClone(data);
    const farEntry = saveFinanceEntry(tooFar, { ...tooFar.finance.entries[0], id: "entry-far", settlements: [] });
    const farSettlement = settleFinanceEntry(farEntry, "entry-far", {
      id: "settlement-far", date: daysBefore(today, 4), amount: 1, accountId: "bank",
    });
    expect(() => matchBankSettlementGroup(farSettlement, [transaction.id, secondTransaction.id],
      [{ entryId: "entry-far", settlementId: "settlement-far" }], true)).toThrow("tres dias");
  });
  it("estornar baixa invalida conciliação sem apagar histórico e permite nova baixa", () => {
    const source = imported(settled()), transaction = banking(source).transactions[0];
    let data = matchBankSettlement(source, transaction.id, "entry", "payment");
    data = reverseSettlement(data, "entry", "payment");
    expect(activeBankMatch(data, banking(data).matches[0])).toBe(false);
    data = settleAndMatch(data, transaction.id, "entry", true);
    expect(banking(data).matches).toHaveLength(2);
    expect(data.finance.entries[0].settlements).toHaveLength(2);
  });
  it("valida integridade de vínculos e duplicidades em backups", () => {
    const source = imported(settled()), transaction = banking(source).transactions[0];
    const data = matchBankSettlement(source, transaction.id, "entry", "payment");
    for (const mutate of [
      (copy: Database) => { banking(copy).transactions[0].amount = 1; },
      (copy: Database) => { banking(copy).matches.push({ ...banking(copy).matches[0], id: "other" }); },
      (copy: Database) => { banking(copy).transactions.push({ ...banking(copy).transactions[0], id: "other" }); },
      (copy: Database) => { banking(copy).matches[0].settlementId = "missing"; },
    ]) { const copy = structuredClone(data); mutate(copy); expect(() => validateDatabase(copy)).toThrow(); }
  });
  it("renderiza importação, confirmação e histórico na aba integrada", () => {
    const source = imported(settled()), transaction = banking(source).transactions[0];
    const data = matchBankSettlement(source, transaction.id, "entry", "payment");
    const html = renderToStaticMarkup(<FinancePanel data={data} initialTab="Conciliação bancária" commit={() => {}} onSuccess={() => {}} onOpenOrder={() => {}} />);
    for (const text of ["Banco do extrato", "Arquivo CSV ou OFX", "Baixar modelo CSV", "Somente movimentos pendentes", "não movimenta dinheiro"])
      expect(html).toContain(text);
    expect(html).toContain("Nenhum movimento para os filtros selecionados");
  });
});
