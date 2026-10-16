import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, validateDatabase } from "./domain";
import type { FinanceRecurrence } from "./financeSchema";
import { financeRecurrenceSchema } from "./financeSchema";
import { saveBankAccount, cancelFinanceEntry, entryBalance, settleFinanceEntry, saveFinanceEntry } from "./finance";
import { saveFinanceCategory, saveCostCenter, managementReport, managementCsv } from "./financeManagement";
import { changeRecurrenceStatus, generateRecurringEntries, previewRecurringEntries, recurrenceStatus, saveFinanceRecurrence } from "./financeRecurrences";
import { saveFinanceInstallments } from "./financeInstallments";
import { FinancePanel } from "./FinancePanel";

const rule: FinanceRecurrence = { id: "monthly", kind: "Pagar", party: "Fornecedor", description: "Mensalidade",
  amount: 10001, accountId: "bank", paymentMethod: "Pix", firstDueOn: "2026-01-31", endsOn: "2026-12-31",
  categoryId: "category", costCenterId: "center", createdAt: "2026-01-01T12:00:00Z", events: [] };
const bank = { id: "bank", name: "Banco", bank: "Teste", agency: "", account: "", kind: "Corrente" as const, active: true };
function fixture() {
  let data = saveBankAccount(demoDatabase(), bank);
  data = saveFinanceCategory(data, { id: "category", kind: "Pagar", name: "Despesas", active: true });
  data = saveCostCenter(data, { id: "center", name: "Operação", active: true });
  return saveFinanceRecurrence(data, rule, true);
}
function generate(data = fixture(), from = "2026-01", through = "2026-03") {
  return generateRecurringEntries(data, data.finance.recurrences![0], from, through, previewRecurringEntries(data, rule.id, from, through), true);
}
describe("recorrências mensais financeiras", () => {
  it("cadastro não cria contas nem movimenta previsão/caixa e preserva bases antigas", () => {
    const data = fixture();
    expect(data.finance.entries).toEqual([]);
    expect(data.finance.invoices).toEqual([]);
    expect(data.finance.recurrences).toEqual([rule]);
    expect(recurrenceStatus(rule)).toBe("Ativa");
    expect(validateDatabase(demoDatabase()).finance.recurrences).toBeUndefined();
    expect(managementReport(data, { start: "2026-01-01", end: "2026-12-31", accountId: "", categoryId: "", costCenterId: "" }).movements).toEqual([]);
    expect(() => saveFinanceRecurrence(data, rule, true)).toThrow("já cadastrada");
    expect(() => saveFinanceRecurrence(demoDatabase(), rule, false)).toThrow("Confirme");
  });
  it("prévia ajusta meses curtos e não perde o dia original, incluindo ano bissexto", () => {
    const data = fixture(), before = structuredClone(data);
    expect(previewRecurringEntries(data, rule.id, "2026-01", "2026-03").map((row) => row.dueOn)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(data).toEqual(before);
    const leap = saveFinanceRecurrence(data, { ...rule, id: "leap", firstDueOn: "2028-01-31", endsOn: "2028-03-31" }, true);
    expect(previewRecurringEntries(leap, "leap", "2028-01", "2028-03").map((row) => row.dueOn)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
  });
  it("limita prévia a 24 meses e à vigência exata, sem gerar fora dela", () => {
    const data = fixture();
    expect(previewRecurringEntries(data, rule.id, "2025-12", "2026-02").map((row) => row.period)).toEqual(["2026-01", "2026-02"]);
    expect(previewRecurringEntries(data, rule.id, "2026-12", "2027-01")).toHaveLength(1);
    expect(previewRecurringEntries(data, rule.id, "2027-01", "2027-03")).toEqual([]);
    expect(() => generate(data, "2027-01", "2027-03")).toThrow("Nenhum mês novo");
    for (const [from, through] of [["2026-03", "2026-01"], ["2026-01", "2028-01"], ["invalid", "2026-03"], ["2026-13", "2026-14"]])
      expect(() => previewRecurringEntries(data, rule.id, from, through)).toThrow();
    const short = saveFinanceRecurrence(data, { ...rule, id: "short", endsOn: "2026-02-27" }, true);
    expect(previewRecurringEntries(short, "short", "2026-01", "2026-03")).toHaveLength(1);
  });
  it("gera meses atomicamente com vínculos e classificação, sem título adicional ou documento", () => {
    const source = fixture(), data = generate(source);
    expect(source.finance.entries).toEqual([]);
    expect(data.finance.entries.map((entry) => entry.amount)).toEqual([10001, 10001, 10001]);
    expect(data.finance.entries.map((entry) => entry.recurrence)).toEqual(["2026-01", "2026-02", "2026-03"].map((period) => ({ id: rule.id, period })));
    expect(data.finance.management!.classifications).toHaveLength(3);
    expect(data.finance.management!.classifications.every((item) => item.categoryId === "category" && item.costCenterId === "center")).toBe(true);
    expect(data.finance.entries.every((entry) => !entry.invoiceId && !entry.installment && !entry.settlements.length)).toBe(true);
    expect(data.finance.invoices).toEqual([]);
    expect(validateDatabase(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
  it("não duplica meses gerados, mesmo cancelados; prévia obsoleta não grava parcialmente", () => {
    const source = fixture(), preview = previewRecurringEntries(source, rule.id, "2026-01", "2026-03");
    let data = generate(source);
    expect(() => generateRecurringEntries(data, rule, "2026-01", "2026-03", preview, true)).toThrow("outra prévia");
    expect(() => generate(data)).toThrow("Nenhum mês novo");
    data = cancelFinanceEntry(data, data.finance.entries[0].id);
    const rows = previewRecurringEntries(data, rule.id, "2026-01", "2026-04");
    expect(rows[0].canceled).toBe(true);
    data = generateRecurringEntries(data, rule, "2026-01", "2026-04", rows, true);
    expect(data.finance.entries).toHaveLength(4);
    expect(data.finance.entries[0].canceled).toBe(true);
    expect(() => generateRecurringEntries(source, rule, "2026-01", "2026-03", preview, false)).toThrow("Confirme");
    expect(() => generateRecurringEntries(source, rule, "2026-01", "2026-03", preview.slice(1), true)).toThrow("outra prévia");
  });
  it("suspende/reativa/cancela com motivo e preserva contas anteriores", () => {
    let data = generate();
    const entries = structuredClone(data.finance.entries);
    data = changeRecurrenceStatus(data, rule, "Suspensa", "Suspensão negociada", true);
    expect(recurrenceStatus(data.finance.recurrences![0])).toBe("Suspensa");
    expect(() => previewRecurringEntries(data, rule.id, "2026-04", "2026-04")).toThrow("ativa");
    expect(() => changeRecurrenceStatus(data, rule, "Ativa", "Retomada", true)).toThrow("alterada");
    data = changeRecurrenceStatus(data, data.finance.recurrences![0], "Ativa", "Retomada negociada", true);
    expect(previewRecurringEntries(data, rule.id, "2026-04", "2026-04")).toHaveLength(1);
    data = changeRecurrenceStatus(data, data.finance.recurrences![0], "Cancelada", "Contrato encerrado", true);
    expect(data.finance.entries).toEqual(entries);
    expect(() => generate(data, "2026-04", "2026-04")).toThrow("ativa");
    expect(() => changeRecurrenceStatus(data, data.finance.recurrences![0], "Ativa", "Reativar", true)).toThrow("definitivo");
    expect(() => changeRecurrenceStatus(fixture(), rule, "Suspensa", "curto", false)).toThrow("Confirme");
    expect(() => changeRecurrenceStatus(fixture(), rule, "Suspensa", "  ", true)).toThrow();
    const preview = previewRecurringEntries(fixture(), rule.id, "2026-01", "2026-01");
    expect(() => generateRecurringEntries(data, rule, "2026-01", "2026-01", preview, true)).toThrow("alterada");
  });
  it("bloqueia cadastro/geração com referências inativas sem impedir histórico e suspensão", () => {
    const data = fixture(), inactive = saveBankAccount(data, { ...bank, active: false });
    expect(() => generate(inactive)).toThrow("ativos");
    expect(() => saveFinanceRecurrence(inactive, { ...rule, id: "new" }, true)).toThrow("ativos");
    expect(() => changeRecurrenceStatus(inactive, rule, "Suspensa", "Banco inativo", true)).not.toThrow();
    const categoryInactive = saveFinanceCategory(data, { id: "category", name: "Despesas", kind: "Pagar", active: false });
    expect(() => generate(categoryInactive)).toThrow("ativos");
    const centerInactive = saveCostCenter(data, { id: "center", name: "Operação", active: false });
    expect(() => generate(centerInactive)).toThrow("ativos");
  });
  it("a receber exige cliente e valida datas e eventos; backup corrompido é recusado", () => {
    const data = fixture();
    const client = data.clients[0];
    const receipt = saveFinanceRecurrence(data, { ...rule, id: "receipt", kind: "Receber", clientId: client.id, party: client.name, categoryId: undefined }, true);
    expect(generateRecurringEntries(receipt, receipt.finance.recurrences![1], "2026-01", "2026-01",
      previewRecurringEntries(receipt, "receipt", "2026-01", "2026-01"), true).finance.entries[0].kind).toBe("Receber");
    expect(() => saveFinanceRecurrence(data, { ...rule, id: "no-client", kind: "Receber", categoryId: undefined }, true)).toThrow("cliente");
    expect(() => financeRecurrenceSchema.parse({ ...rule, endsOn: "2025-12-31" })).toThrow();
    expect(() => financeRecurrenceSchema.parse({ ...rule, events: [{ status: "Ativa", at: rule.createdAt, reason: "Sem mudança" }] })).toThrow();
    expect(() => financeRecurrenceSchema.parse({ ...rule, events: [{ status: "Suspensa", at: "2025-01-01T00:00:00Z", reason: "Data anterior" }] })).toThrow();
    const generated = generate();
    for (const mutate of [
      (copy: typeof generated) => { copy.finance.entries.push({ ...copy.finance.entries[0], id: "duplicate" }); },
      (copy: typeof generated) => { copy.finance.entries[0].amount++; },
      (copy: typeof generated) => { copy.finance.entries[0].dueOn = "2026-01-30"; },
      (copy: typeof generated) => { copy.finance.entries[0].recurrence!.period = "2027-01"; },
      (copy: typeof generated) => { copy.finance.recurrences = []; },
    ]) { const copy = structuredClone(generated); mutate(copy); expect(() => validateDatabase(copy)).toThrow(); }
  });
  it("gera no máximo 24 contas por lote, respeitando limites monetários sem arredondar valor mensal", () => {
    const data = saveFinanceRecurrence(fixture(), { ...rule, id: "long", amount: 1, endsOn: "2027-12-31" }, true);
    const expected = data.finance.recurrences![1];
    const preview = previewRecurringEntries(data, expected.id, "2026-01", "2027-12");
    const generated = generateRecurringEntries(data, expected, "2026-01", "2027-12", preview, true);
    expect(generated.finance.entries).toHaveLength(24);
    expect(generated.finance.entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(24);
    expect(generated.finance.entries.at(-1)?.dueOn).toBe("2027-12-31");
    const longId = "r".repeat(200);
    const long = saveFinanceRecurrence(data, { ...rule, id: longId }, true);
    const rows = previewRecurringEntries(long, longId, "2026-01", "2026-01");
    expect(generateRecurringEntries(long, long.finance.recurrences![2], "2026-01", "2026-01", rows, true).finance.entries[0].recurrence?.id).toBe(longId);
  });
  it("contas geradas participam de previsão, caixa e ajustes sem duplicar recorrência não gerada", () => {
    let data = generate(fixture(), "2026-10", "2026-11");
    const filter = { start: "2026-01-01", end: "2026-12-31", accountId: "", categoryId: "", costCenterId: "" };
    expect(managementReport(data, filter, "2026-01-01").totals.expectedPayments).toBe(20002);
    const entry = data.finance.entries[0];
    data = settleFinanceEntry(data, entry.id, { id: "payment", date: "2026-01-01", amount: 10001, accountId: "bank",
      adjustment: { interest: 0, fine: 0, discount: 1, reason: "Acordo da mensalidade", confirmedAt: rule.createdAt } }, true);
    expect(entryBalance(data.finance.entries[0])).toBe(0);
    expect(managementReport(data, filter, "2026-01-01").totals).toMatchObject({ paid: 10000, expectedPayments: 10001 });
    expect(managementCsv(data, managementReport(data, filter, "2026-01-01"))).toContain("Recorrência 2026-10");
    expect(() => saveFinanceEntry(fixture(), entry)).toThrow("nova conta");
    expect(() => saveFinanceInstallments(fixture(), entry, ["2026-10-31", "2026-11-30"], true)).toThrow("novas contas manuais");
  });
  it("interface lista recorrência e identifica mês nas contas sem alterar a entrada padrão", () => {
    const data = generate(), props = { data, commit: () => {}, onSuccess: () => {}, onOpenOrder: () => {} };
    const html = renderToStaticMarkup(<FinancePanel {...props} initialTab="Recorrências" />);
    expect(html).toContain("Nova recorrência");
    expect(html).toContain("Mensalidade");
    expect(html).toContain("Gerar contas");
    expect(html).toContain("não cancela contas existentes");
    expect(renderToStaticMarkup(<FinancePanel {...props} initialTab="Contas a pagar" />)).toContain("2026-01");
    expect(renderToStaticMarkup(<FinancePanel {...props} />)).toContain("Nenhuma OS finalizada aguardando faturamento");
  });
});
