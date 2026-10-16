import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, localDay, validateDatabase } from "./domain";
import { applyFinanceRetention, billOrders } from "./finance";
import { getOrderDetails } from "./domain";
import { saveBankAccount, saveFinanceEntry, settleFinanceEntry, reverseSettlement, cancelFinanceEntry } from "./finance";
import { classifyFinanceEntry, defaultManagementFilter, financeManagement, managementCsv, managementReport,
  saveCostCenter, saveFinanceCategory, saveOpeningBalance } from "./financeManagement";
import { FinanceManagementPanel, FinanceClassificationFields } from "./FinanceManagementPanel";
import { FinancePanel } from "./FinancePanel";
import type { ManagementFilter } from "./financeManagement";
import type { Database } from "./domain";
import type { FinanceEntry } from "./financeSchema";

const today = localDay();
const previous = new Date(`${today}T12:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 1);
const yesterday = previous.toISOString().slice(0, 10);
const next = new Date(`${today}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
const tomorrow = next.toISOString().slice(0, 10);
const filter: ManagementFilter = { start: yesterday, end: tomorrow, accountId: "", categoryId: "", costCenterId: "" };
const bank = { id: "bank", name: "Banco A", bank: "Teste", agency: "", account: "", kind: "Corrente" as const, active: true };
function fixture() {
  let data = saveBankAccount(demoDatabase(), bank);
  data = saveBankAccount(data, { ...bank, id: "other", name: "Banco B" });
  data = saveFinanceCategory(data, { id: "income", name: "Atendimentos", kind: "Receber", active: true });
  data = saveFinanceCategory(data, { id: "expense", name: "Materiais", kind: "Pagar", active: true });
  return saveCostCenter(data, { id: "center", name: "Operação", active: true });
}
function entry(data: Database, id: string, kind: FinanceEntry["kind"] = "Receber", dueOn = today) {
  return saveFinanceEntry(data, { id, kind, party: "Empresa teste", description: id, amount: 10000, issuedOn: yesterday,
    dueOn, accountId: bank.id, paymentMethod: "Pix", canceled: false, settlements: [] });
}
function classify(data: Database, entryId: string, categoryId = "income") {
  return classifyFinanceEntry(data, { entryId, categoryId, costCenterId: "center" });
}
function settle(data: Database, id: string, amount: number, date = today, accountId = bank.id) {
  return settleFinanceEntry(data, id, { id: `${id}-payment`, date, amount, accountId });
}

describe("cadastros e persistência gerencial", () => {
  it("mantém bases antigas sem alterar sua estrutura financeira e usa defaults apenas ao cadastrar", () => {
    const data = demoDatabase();
    expect(data.finance).not.toHaveProperty("management");
    expect(financeManagement(data)).toEqual({ categories: [], costCenters: [], classifications: [], openingBalances: [] });
    const updated = fixture();
    expect(validateDatabase(JSON.parse(JSON.stringify(updated))).finance).toEqual(updated.finance);
    expect(updated.finance.management?.categories).toHaveLength(2);
  });
  it("classifica títulos existentes sem alterar valores, baixas ou faturamentos", () => {
    const data = settle(entry(fixture(), "income-entry"), "income-entry", 2500);
    const updated = classify(data, "income-entry");
    expect(updated.finance.entries).toEqual(data.finance.entries);
    expect(updated.finance.invoices).toEqual(data.finance.invoices);
    expect(validateDatabase(JSON.parse(JSON.stringify(updated))).finance.management).toEqual(updated.finance.management);
    const cleared = classifyFinanceEntry(updated, { entryId: "income-entry" });
    expect(cleared.finance.management?.classifications[0]).toEqual({ entryId: "income-entry" });
  });
  it("rejeita referências ausentes, categoria de outro tipo e identificadores duplicados", () => {
    const data = entry(fixture(), "title");
    expect(() => classify(data, "missing")).toThrow("referências");
    expect(() => classify(data, "title", "expense")).toThrow("referências");
    expect(() => classifyFinanceEntry(data, { entryId: "title", costCenterId: "missing" })).toThrow("ativos");
    const updated = classify(data, "title");
    updated.finance.management!.classifications.push(updated.finance.management!.classifications[0]);
    expect(() => validateDatabase(updated)).toThrow("duplicados");
    expect(() => saveOpeningBalance(data, { accountId: "missing", date: today, amount: 0 })).toThrow("ativa");
  });
  it("permite inativar e preservar histórico mas não usar cadastros inativos em novos títulos", () => {
    let data = classify(entry(entry(fixture(), "old"), "new"), "old");
    data = saveFinanceCategory(data, { id: "income", name: "Atendimentos", kind: "Receber", active: false });
    data = saveCostCenter(data, { id: "center", name: "Operação", active: false });
    expect(() => classify(data, "old")).not.toThrow();
    expect(() => classify(data, "new")).toThrow("ativos");
    expect(() => saveFinanceCategory(data, { id: "income", name: "Atendimentos", kind: "Pagar", active: false })).toThrow("referências");
    const report = managementReport(data, filter, today);
    expect(report.totals.expectedReceipts).toBe(20000);
  });
  it("impede nomes duplicados por tipo, mas permite receita e despesa de mesmo nome", () => {
    const data = fixture();
    expect(() => saveFinanceCategory(data, { id: "duplicate", name: " atendimentos ", kind: "Receber", active: true })).toThrow("Já existe");
    expect(() => saveFinanceCategory(data, { id: "other-kind", name: "Atendimentos", kind: "Pagar", active: true })).not.toThrow();
    expect(() => saveCostCenter(data, { id: "duplicate", name: "operação", active: true })).toThrow("Já existe");
  });
});

describe("fluxo de caixa e relatórios", () => {
  it("separa realizado parcial de previsão, por data e banco da baixa, sem duplicar valores", () => {
    let data = classify(entry(fixture(), "receipt"), "receipt");
    data = classify(entry(data, "payment", "Pagar", tomorrow), "payment", "expense");
    data = settle(data, "receipt", 2500, yesterday, "other");
    data = settle(data, "payment", 1000);
    const report = managementReport(data, filter, today);
    expect(report.totals).toEqual({ received: 2500, paid: 1000, expectedReceipts: 7500, expectedPayments: 9000 });
    expect(report.movements.find((item) => item.source === "realized" && item.kind === "Receber")?.accountId).toBe("other");
    expect(report.daily.find((item) => item.date === yesterday)?.received).toBe(2500);
    expect(report.costCenters[0]).toMatchObject({ id: "center", ...report.totals });
    expect(managementReport(data, { ...filter, accountId: "other" }, today).totals).toEqual({
      received: 2500, paid: 0, expectedReceipts: 0, expectedPayments: 0,
    });
    expect(managementReport(data, { ...filter, categoryId: "income" }, today).totals).toEqual({
      received: 2500, paid: 0, expectedReceipts: 7500, expectedPayments: 0,
    });
  });
  it("exclui estornos e cancelamentos e não altera a base ao calcular relatórios", () => {
    let data = settle(entry(fixture(), "receipt"), "receipt", 10000);
    data = reverseSettlement(data, "receipt", "receipt-payment");
    data = cancelFinanceEntry(data, "receipt");
    const before = JSON.stringify(data);
    expect(managementReport(data, filter, today).movements).toEqual([]);
    expect(JSON.stringify(data)).toBe(before);
  });
  it("baixas estornadas reabrem apenas a previsão e contas sem categoria aparecem no agrupamento", () => {
    let data = settle(entry(fixture(), "receipt"), "receipt", 2500);
    data = reverseSettlement(data, "receipt", "receipt-payment");
    const report = managementReport(data, filter, today);
    expect(report.totals).toEqual({ received: 0, paid: 0, expectedReceipts: 10000, expectedPayments: 0 });
    expect(report.categories[0]).toMatchObject({ id: "", expectedReceipts: 10000 });
  });
  it("usa o líquido após retenções, sem transformar imposto retido em recebimento", () => {
    let data = fixture();
    const order = data.orders[0]; order.status = "Finalizada";
    order.details = { ...getOrderDetails(order), archived: false, items: [{
      id: "line", kind: "servico", referenceId: data.services[0].id, name: "Serviço", quantity: 1, price: 10000, discount: 0,
    }], costs: [], discount: 0, travel: undefined };
    data = billOrders(data, [order.id], { Serviços: { accountId: bank.id, dueOn: today, paymentMethod: "Pix" } });
    const title = data.finance.entries[0];
    data = applyFinanceRetention(data, title.id, { calculationId: "a".repeat(64), invoiceAmount: 10000,
      withheld: 1000, net: 9000, irrf: 1000, inss: 0, csll: 0, confirmedAt: `${today}T12:00:00Z`, confirmedBy: "admin" }, title);
    data = settle(data, title.id, 2500);
    expect(managementReport(data, filter, today).totals).toEqual({ received: 2500, paid: 0, expectedReceipts: 6500, expectedPayments: 0 });
  });
  it("traz vencidos para hoje e agrupa vencimentos sem incluir contas já liquidadas", () => {
    let data = entry(entry(entry(fixture(), "overdue", "Receber", yesterday), "today", "Pagar"), "future", "Receber", tomorrow);
    data = settle(entry(data, "settled"), "settled", 10000);
    const report = managementReport(data, filter, today);
    expect(report.aging).toEqual([
      { label: "Vencidas", receivable: 10000, payable: 0 },
      { label: "Vencem hoje", receivable: 0, payable: 10000 },
      { label: "A vencer", receivable: 10000, payable: 0 },
    ]);
    expect(report.movements.find((item) => item.id === "overdue")?.date).toBe(today);
    expect(managementReport(data, { ...filter, start: tomorrow }, today).movements.find((item) => item.id === "overdue")?.date).toBe(tomorrow);
  });
  it("não inventa previsões retroativas e mantém realizado nas bordas inclusivas do período", () => {
    const data = settle(entry(fixture(), "receipt"), "receipt", 1000, yesterday);
    const report = managementReport(data, { ...filter, start: yesterday, end: yesterday }, today);
    expect(report.totals).toEqual({ received: 1000, paid: 0, expectedReceipts: 0, expectedPayments: 0 });
    expect(managementReport(data, { ...filter, start: today, end: today }, today).totals.received).toBe(0);
  });
  it("calcula posição a partir da base no início do dia, incluindo baixas na base e excluindo anteriores", () => {
    let data = settle(entry(fixture(), "old"), "old", 1000, yesterday);
    data = settle(entry(data, "new"), "new", 2500);
    data = settle(entry(data, "payment", "Pagar"), "payment", 500);
    data = saveOpeningBalance(data, { accountId: bank.id, date: today, amount: -1000 });
    const report = managementReport(data, filter, today);
    expect(report.positions.find((item) => item.accountId === bank.id)).toMatchObject({ balance: 1000, projected: 8000 });
    expect(managementReport(data, { ...filter, end: yesterday }, today).positions[0]).toMatchObject({ balance: null, projected: null });
    expect(managementReport(data, { ...filter, costCenterId: "center" }, today).positions).toEqual([]);
    expect(() => saveOpeningBalance(data, { accountId: bank.id, date: tomorrow, amount: 0 })).toThrow("futura");
  });
  it("sem base considera zero mais movimentos anteriores e usa banco real de cada baixa", () => {
    const data = settle(entry(fixture(), "receipt"), "receipt", 2500, yesterday, "other");
    const report = managementReport(data, { ...filter, start: today }, today);
    expect(report.totals.received).toBe(0);
    expect(report.positions.find((item) => item.accountId === "other")).toMatchObject({ opening: undefined, balance: 2500, projected: 2500 });
    expect(report.positions.find((item) => item.accountId === bank.id)).toMatchObject({ balance: 0, projected: 7500 });
  });
  it("valida datas reais, intervalo e filtros inexistentes e calcula fim de mês bissexto", () => {
    expect(defaultManagementFilter("2028-02-12")).toMatchObject({ start: "2028-02-01", end: "2028-02-29" });
    for (const change of [{ start: tomorrow, end: yesterday }, { start: "2026-02-30" }, { accountId: "missing" },
      { categoryId: "missing" }, { costCenterId: "missing" }])
      expect(() => managementReport(fixture(), { ...filter, ...change }, today)).toThrow();
  });
  it("exporta CSV com acentos, centavos, aspas, delimitadores e proteção contra fórmulas", () => {
    let data = entry(fixture(), "receipt");
    data.finance.entries[0].party = '=HYPERLINK("evil")';
    data.finance.entries[0].description = 'Serviço; "A"\nLinha';
    data = settle(data, "receipt", 101);
    const csv = managementCsv(data, managementReport(data, filter, today));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""evil"")"');
    expect(csv).toContain('"Serviço; ""A""\nLinha"');
    expect(csv).toContain('"1,01"');
    expect(csv).toContain('"98,99"');
    expect(csv).toContain('"Realizado"');
    expect(csv).toContain('"Previsto"');
  });
});

describe("interface gerencial", () => {
  it.each(["Painel gerencial", "Fluxo de caixa", "Relatórios", "Cadastros gerenciais"] as const)("renderiza %s integrado ao financeiro", (tab) => {
    const data = classify(settle(entry(fixture(), "receipt"), "receipt", 2500), "receipt");
    const html = renderToStaticMarkup(<FinancePanel data={data} initialTab={tab} commit={() => {}} onSuccess={() => {}} onOpenOrder={() => {}} />);
    expect(html).toContain(tab);
    if (tab === "Cadastros gerenciais") {
      expect(html).toContain("Nova categoria"); expect(html).toContain("Novo centro de custo"); expect(html).toContain("Informar base");
    } else {
      expect(html).toContain("Aplicar filtros"); expect(html).toContain("Exportar movimentos CSV");
      expect(html).toContain("regime de caixa"); expect(html).toContain("Retenções não são recebimentos");
    }
  });
  it("preserva o estado vazio e restringe opções de classificação ao tipo e aos ativos", () => {
    let data = fixture();
    data = saveCostCenter(data, { id: "center", name: "Operação", active: false });
    const html = renderToStaticMarkup(<FinanceClassificationFields data={data} kind="Pagar" />);
    expect(html).toContain("Materiais"); expect(html).not.toContain("Atendimentos"); expect(html).not.toContain("Operação");
    const empty = renderToStaticMarkup(<FinanceManagementPanel data={demoDatabase()} tab="Fluxo de caixa" commit={() => {}} onSuccess={() => {}} />);
    expect(empty).toContain("Sem movimentos no período"); expect(empty).toContain("Cadastre uma conta");
  });
});
