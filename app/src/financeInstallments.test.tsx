import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, validateDatabase } from "./domain";
import type { Database } from "./domain";
import { cancelFinanceEntry, entryBalance, reverseSettlement, saveBankAccount, saveFinanceEntry, settleFinanceEntry } from "./finance";
import { previewFinanceInstallments, saveFinanceInstallments } from "./financeInstallments";
import { managementReport, managementCsv } from "./financeManagement";
import { FinancePanel } from "./FinancePanel";
import type { FinanceEntry } from "./financeSchema";
import { banking, importStatement, matchBankSettlement } from "./bankReconciliation";

const bank = { id: "bank", name: "Banco", bank: "Teste", agency: "", account: "", kind: "Corrente" as const, active: true };
const base: FinanceEntry = { id: "plan", kind: "Pagar", party: "Fornecedor", description: "Compra parcelada", amount: 10000,
  accountId: "bank", issuedOn: "2026-01-01", dueOn: "2026-01-31", paymentMethod: "Pix", canceled: false, settlements: [] };
const dates = ["2026-01-31", "2026-02-28", "2026-03-31"];
const fixture = () => saveBankAccount(demoDatabase(), bank);
const plan = () => saveFinanceInstallments(fixture(), base, dates, true);
const filter = { start: "2026-01-01", end: "2026-12-31", accountId: "", categoryId: "", costCenterId: "" };

describe("parcelamento de contas manuais", () => {
  it("distribui centavos nas primeiras parcelas e conserva soma exata", () => {
    expect(previewFinanceInstallments(10000, 3, dates[0])).toEqual(dates.map((dueOn, index) => ({ dueOn, amount: index ? 3333 : 3334 })));
    for (const count of [2, 3, 7, 120]) for (const total of [count, 10001, 100000000]) {
      const rows = previewFinanceInstallments(total, count, dates[0]);
      expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(total);
      expect(Math.max(...rows.map((row) => row.amount)) - Math.min(...rows.map((row) => row.amount))).toBeLessThanOrEqual(1);
      expect(rows.every((row) => row.amount >= 1)).toBe(true);
    }
  });
  it("preserva dia original após fevereiro, ano bissexto e virada de ano", () => {
    expect(previewFinanceInstallments(300, 3, "2028-01-31").map((row) => row.dueOn)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
    expect(previewFinanceInstallments(300, 3, "2026-12-30").map((row) => row.dueOn)).toEqual(["2026-12-30", "2027-01-30", "2027-02-28"]);
    expect(previewFinanceInstallments(300, 3, "2026-02-28").map((row) => row.dueOn)).toEqual(["2026-02-28", "2026-03-28", "2026-04-28"]);
  });
  it("rejeita quantidades, datas e valores inválidos sem defaults silenciosos", () => {
    for (const count of [0, 1, 121, 2.5, NaN]) expect(() => previewFinanceInstallments(10000, count, dates[0])).toThrow();
    for (const amount of [0, -1, 1, 1.5, 100000001, NaN]) expect(() => previewFinanceInstallments(amount, 3, dates[0])).toThrow();
    for (const date of ["", "2026-02-30", "2026-13-01", "9999-12-31"]) expect(() => previewFinanceInstallments(100, 2, date)).toThrow();
  });
  it("grava somente as parcelas atomicamente, sem titulo adicional nem faturamento", () => {
    const source = fixture(), data = saveFinanceInstallments(source, base, dates, true);
    expect(source.finance.entries).toEqual([]);
    expect(data.finance.entries.map((entry) => entry.id)).toEqual(["plan:1", "plan:2", "plan:3"]);
    expect(data.finance.entries.reduce((sum, entry) => sum + entryBalance(entry), 0)).toBe(10000);
    expect(data.finance.invoices).toEqual([]);
    expect(data.orders).toEqual(source.orders);
    expect(data.finance.entries[0].installment).toEqual({ planId: "plan", number: 1, count: 3, total: 10000 });
    expect(validateDatabase(JSON.parse(JSON.stringify(data)))).toEqual(data);
    expect(() => saveFinanceInstallments(data, base, dates, true)).toThrow("já foi cadastrado");
    const collision = saveFinanceEntry(source, { ...base, id: "plan:2" });
    expect(() => saveFinanceInstallments(collision, base, dates, true)).toThrow("duplicados");
    expect(collision.finance.entries).toHaveLength(1);
  });
  it("aceita datas editadas válidas e exige ordem estrita não anterior à emissão", () => {
    const custom = ["2026-02-02", "2026-03-04", "2026-04-06"];
    expect(saveFinanceInstallments(fixture(), base, custom, true).finance.entries.map((entry) => entry.dueOn)).toEqual(custom);
    for (const invalid of [["2025-12-31", ...dates.slice(1)], [dates[0], dates[0], dates[2]], [dates[0], dates[2], dates[1]],
      [dates[0], "invalid", dates[2]], []]) expect(() => saveFinanceInstallments(fixture(), base, invalid, true)).toThrow();
    expect(() => saveFinanceInstallments(fixture(), base, dates, false)).toThrow("Confirme");
  });
  it("permite pagar/receber e bloqueia banco inativo e origens faturadas/retidas/baixadas", () => {
    const data = fixture();
    expect(saveFinanceInstallments(data, { ...base, kind: "Receber", clientId: data.clients[0].id, party: data.clients[0].name }, dates, true)
      .finance.entries.every((entry) => entry.kind === "Receber")).toBe(true);
    const inactive = saveBankAccount(data, { ...bank, active: false });
    expect(() => saveFinanceInstallments(inactive, base, dates, true)).toThrow("ativa");
    for (const change of [{ invoiceId: "invoice" }, { canceled: true }, { installment: { planId: "other", number: 1, count: 3, total: 10000 } },
      { settlements: [{ id: "payment", amount: 1, date: dates[0], accountId: "bank", reversed: true }] }])
      expect(() => saveFinanceInstallments(data, { ...base, ...change }, dates, true)).toThrow("novas contas manuais");
    expect(() => saveFinanceEntry(data, plan().finance.entries[0])).toThrow("nova conta");
  });
  it("backup inconsistente rejeita parcelas ausentes, duplicadas, totais, datas ou origem alterados", () => {
    for (const mutate of [
      (data: Database) => { data.finance.entries.pop(); },
      (data: Database) => { data.finance.entries[1].installment!.number = 1; },
      (data: Database) => { data.finance.entries[1].installment!.total++; },
      (data: Database) => { data.finance.entries[1].amount++; },
      (data: Database) => { data.finance.entries[0].amount--; data.finance.entries[2].amount++; },
      (data: Database) => { data.finance.entries[1].party = "Outro"; },
      (data: Database) => { data.finance.entries[1].dueOn = dates[0]; },
      (data: Database) => { data.finance.entries[1].invoiceId = "invoice"; },
      (data: Database) => { data.finance.entries[1].accountId = "other"; },
    ]) { const data = plan(); mutate(data); expect(() => validateDatabase(data)).toThrow(); }
  });
  it("baixa parcial, estorno e cancelamento são independentes sem alterar o total original", () => {
    let data = settleFinanceEntry(plan(), "plan:1", { id: "payment", amount: 1000, date: dates[0], accountId: "bank" });
    expect(entryBalance(data.finance.entries[0])).toBe(2334);
    expect(entryBalance(data.finance.entries[1])).toBe(3333);
    expect(() => cancelFinanceEntry(data, "plan:1")).toThrow();
    data = reverseSettlement(data, "plan:1", "payment");
    data = cancelFinanceEntry(data, "plan:1");
    expect(data.finance.entries.map((entry) => entry.canceled)).toEqual([true, false, false]);
    expect(data.finance.entries.every((entry) => entry.installment?.total === 10000)).toBe(true);
    expect(managementReport(data, filter, "2026-01-01").totals.expectedPayments).toBe(6666);
  });
  it("previsão soma só parcelas, realizado considera só baixa e CSV identifica a parcela", () => {
    const source = plan(), report = managementReport(source, filter, "2026-01-01");
    expect(report.totals.expectedPayments).toBe(10000);
    expect(report.movements.map((item) => item.date)).toEqual(dates);
    const data = settleFinanceEntry(source, "plan:1", { id: "payment", amount: 1000, date: dates[0], accountId: "bank" });
    const updated = managementReport(data, filter, "2026-01-01");
    expect(updated.totals.expectedPayments).toBe(9000);
    expect(updated.totals.paid).toBe(1000);
    expect(managementCsv(data, updated)).toContain("Parcela 1/3");
  });
  it("concilia baixa de uma parcela sem conciliar automaticamente as demais", () => {
    let data = settleFinanceEntry(plan(), "plan:1", { id: "payment", amount: 3334, date: dates[0], accountId: "bank" });
    data = importStatement(data, "bank", { format: "CSV", bank: "", account: "",
      lines: [{ externalId: "first", date: dates[0], amount: -3334, description: "Pagamento da primeira parcela" }] }, "teste.csv", true);
    data = matchBankSettlement(data, banking(data).transactions[0].id, "plan:1", "payment");
    expect(banking(data).matches).toHaveLength(1);
    expect(data.finance.entries.slice(1).every((entry) => entry.settlements.length === 0)).toBe(true);
  });
  it("interface apresenta número, grupo e total original das parcelas", () => {
    const html = renderToStaticMarkup(<FinancePanel data={plan()} initialTab="Contas a pagar" commit={() => {}}
      onSuccess={() => {}} onOpenOrder={() => {}} />);
    expect(html).toContain("Parcela 1");
    expect(html).toContain("Total original:");
    expect(html).toContain("Cada parcela possui baixa e cancelamento independentes");
  });
});
