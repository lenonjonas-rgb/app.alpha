import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, validateDatabase } from "./domain";
import { cancelFinanceEntry, reverseSettlement, saveBankAccount, saveFinanceEntry, settleFinanceEntry } from "./finance";
import { classifyFinanceEntry, saveFinanceCategory } from "./financeManagement";
import { saveFinanceInstallments } from "./financeInstallments";
import { generateRecurringEntries, previewRecurringEntries, saveFinanceRecurrence } from "./financeRecurrences";
import { filterFinanceEntries, financeEntriesCsv } from "./financeStatements";
import { FinanceEntryDetailsFields } from "./FinanceEntryDetailsFields";
import { readFinanceEntryDetails } from "./financeEntryDetails";
import { FinancePanel } from "./FinancePanel";
import type { FinanceEntry, FinanceRecurrence } from "./financeSchema";
import type { FinanceEntryFilter } from "./financeStatements";

const details = { competenceOn: "2024-01-31", documentNumber: "DOC-123", seller: "Vendedor teste",
  monthlyInterestBasisPoints: 125, lateFineBasisPoints: 200 };
const initialFilter: FinanceEntryFilter = {
  kind: "Receber", query: "", status: "Todas", from: "", through: "", accountId: "", categoryId: "",
};
function fixture() {
  return saveBankAccount(demoDatabase(), { id: "bank", name: "Banco", bank: "Teste",
    agency: "", account: "", kind: "Corrente", active: true });
}
function entry(data = fixture()): FinanceEntry {
  return { id: "entry", kind: "Receber", party: data.clients[0].name, clientId: data.clients[0].id,
    description: "Serviços", amount: 10000, issuedOn: "2024-01-01", dueOn: "2024-01-31",
    accountId: "bank", paymentMethod: "Pix", canceled: false, settlements: [], details };
}
function recurrence(): FinanceRecurrence {
  return { id: "recurrence", kind: "Pagar", party: "Fornecedor", description: "Mensalidade",
    amount: 10000, accountId: "bank", paymentMethod: "Pix", firstDueOn: "2024-01-31", endsOn: "2024-03-31",
    details: { ...details, seller: "" }, createdAt: "2024-01-01T12:00:00Z", events: [] };
}

describe("detalhes de contas financeiras", () => {
  it("preserva dados antigos, detalhes novos e taxas exatas em centésimos de percentual", () => {
    const data = saveFinanceEntry(fixture(), entry());
    expect(validateDatabase(JSON.parse(JSON.stringify(data))).finance.entries[0].details).toEqual(details);
    const old = entry(); delete old.details;
    expect(validateDatabase(saveFinanceEntry(fixture(), old)).finance.entries[0].details).toBeUndefined();
    const form = new FormData();
    for (const [key, value] of Object.entries({ competenceOn: "2024-01-31", documentNumber: " DOC-123 ",
      seller: " Vendedor teste ", monthlyInterestRate: "1.25", lateFineRate: "2.00" })) form.set(key, value);
    expect(readFinanceEntryDetails(form)).toEqual(details);
    form.set("monthlyInterestRate", "1.255");
    expect(() => readFinanceEntryDetails(form)).toThrow("percentuais");
    form.set("monthlyInterestRate", "");
    expect(() => readFinanceEntryDetails(form)).toThrow("percentuais");
    expect(renderToStaticMarkup(<FinanceEntryDetailsFields kind="Receber" />)).toContain("apenas informativos");
  });
  it("mantém detalhes em todas as parcelas e rejeita alteração isolada", () => {
    const data = saveFinanceInstallments(fixture(), entry(), ["2024-01-31", "2024-02-29", "2024-03-31"], true);
    expect(data.finance.entries.map((item) => item.details)).toEqual([details, details, details]);
    const invalid = structuredClone(data);
    invalid.finance.entries[1].details!.documentNumber = "diferente";
    expect(() => validateDatabase(invalid)).toThrow("Parcelamento");
  });
  it("avança competência de recorrência preservando o dia original em meses curtos", () => {
    const item = recurrence();
    const data = saveFinanceRecurrence(fixture(), item, true);
    const preview = previewRecurringEntries(data, item.id, "2024-01", "2024-03");
    const generated = generateRecurringEntries(data, item, "2024-01", "2024-03", preview, true);
    expect(generated.finance.entries.map((value) => value.details?.competenceOn))
      .toEqual(["2024-01-31", "2024-02-29", "2024-03-31"]);
    const invalid = structuredClone(generated);
    invalid.finance.entries[1].details!.seller = "Outro";
    expect(() => validateDatabase(invalid)).toThrow("Conta recorrente");
  });
  it("filtra tipo, documento, vendedor, vencimento, categoria, conta e status parcial vencido", () => {
    let data = saveFinanceEntry(fixture(), entry());
    data = saveFinanceCategory(data, { id: "category", name: "Receita", kind: "Receber", active: true });
    data = classifyFinanceEntry(data, { entryId: "entry", categoryId: "category" });
    data = settleFinanceEntry(data, "entry", { id: "partial", date: "2024-01-20", amount: 3000, accountId: "bank" });
    const filter = { ...initialFilter, query: "doc-123", status: "Parcial" as const, from: "2024-01-01",
      through: "2024-01-31", accountId: "bank", categoryId: "category" };
    expect(filterFinanceEntries(data, filter, "2024-02-01").map((item) => item.id)).toEqual(["entry"]);
    expect(filterFinanceEntries(data, { ...filter, query: "vendedor teste" }, "2024-02-01")).toHaveLength(1);
    expect(filterFinanceEntries(data, { ...filter, through: "2024-01-20" }, "2024-02-01")).toEqual([]);
    expect(() => filterFinanceEntries(data, { ...filter, from: "2024-02-01" })).toThrow("primeiro vencimento");
    expect(() => filterFinanceEntries(data, { ...filter, accountId: "inexistente" })).toThrow("existentes");
    expect(financeEntriesCsv(data, filterFinanceEntries(data, filter, "2024-02-01"), "2024-02-01"))
      .toContain('"DOC-123"');
    const html = renderToStaticMarkup(<FinancePanel data={data} initialTab="Contas a receber" commit={() => {}}
      onSuccess={() => {}} onOpenOrder={() => {}} />);
    expect(html).toContain("Exportar contas CSV");
    expect(html).toMatch(/Juros mensal informativo:.*1,25.*%/);
    expect(html).toContain("Com baixa parcial");
    data = reverseSettlement(data, "entry", "partial");
    data = cancelFinanceEntry(data, "entry");
    expect(filterFinanceEntries(data, { ...initialFilter, status: "Cancelada" })).toHaveLength(1);
  });
});
