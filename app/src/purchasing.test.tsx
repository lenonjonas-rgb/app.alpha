import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, localDay, validateDatabase } from "./domain";
import { saveBankAccount, cancelFinanceEntry, entryBalance, settleFinanceEntry, reverseSettlement, saveFinanceEntry } from "./finance";
import { saveFinanceInstallments } from "./financeInstallments";
import { classifyFinanceEntry, managementCsv, managementReport, saveFinanceCategory, saveCostCenter } from "./financeManagement";
import { cancelPurchaseOrder, previewPurchaseSchedule, purchaseTotal, purchasing, receivePurchaseOrder, savePurchaseOrder, saveSupplier } from "./purchasing";
import type { PurchaseOrder, Supplier } from "./financeSchema";
import { FinancePanel } from "./FinancePanel";
import { importStatement, matchBankSettlement } from "./bankReconciliation";

const supplier: Supplier = { id: "supplier", name: "Fornecedor", document: "11222333000181",
  phone: "11999999999", email: "compras@example.test", address: "Rua A, 10", active: true };
const order: PurchaseOrder = { id: "purchase", supplierId: supplier.id, supplierName: supplier.name, supplierDocument: supplier.document,
  description: "Compra de peças", orderedOn: "2026-01-01", createdAt: "2026-01-01T12:00:00Z",
  accountId: "bank", paymentMethod: "Pix", items: [{ description: "Peça", quantity: 1, unitCost: 10000 }],
  schedule: previewPurchaseSchedule(10000, 3, "2026-01-31"), categoryId: "category", costCenterId: "center" };
function fixture() {
  let data = saveBankAccount(demoDatabase(), { id: "bank", name: "Banco", bank: "Teste", agency: "", account: "", kind: "Corrente", active: true });
  data = saveFinanceCategory(data, { id: "category", name: "Compras", kind: "Pagar", active: true });
  data = saveCostCenter(data, { id: "center", name: "Operação", active: true });
  return saveSupplier(data, supplier);
}
function placed() { return savePurchaseOrder(fixture(), order, true); }
const receipt = { date: localDay(), reference: "NF informativa 123", notes: "Todos os itens conferidos" };
function received(data = placed(), expected = order) { return receivePurchaseOrder(data, expected, receipt, true); }
const filter = { start: "2026-01-01", end: "2099-12-31", accountId: "", categoryId: "", costCenterId: "" };

describe("compras e fornecedores", () => {
  it("mantém compatibilidade, cadastro/pedido sem conta, previsão, documento fiscal ou estoque", () => {
    expect(validateDatabase(demoDatabase()).finance.purchasing).toBeUndefined();
    const data = placed();
    expect(data.finance.entries).toEqual([]);
    expect(data.finance.invoices).toEqual([]);
    expect(data.products).toEqual(demoDatabase().products);
    expect(managementReport(data, filter).movements).toEqual([]);
    expect(purchasing(data).orders).toEqual([order]);
  });
  it("valida documentos, contatos e duplicidades e protege edição concorrente de fornecedor", () => {
    const data = fixture();
    for (const document of ["1", "00000000000", "11222333000182", "112223330001810"])
      expect(() => saveSupplier(data, { ...supplier, id: "other", document })).toThrow();
    expect(() => saveSupplier(data, { ...supplier, id: "other" })).toThrow("duplicados");
    expect(() => saveSupplier(data, { ...supplier, email: "inválido" }, supplier)).toThrow();
    expect(() => saveSupplier(data, supplier)).toThrow("alterado");
    const updated = saveSupplier(data, { ...supplier, name: "Novo nome", active: false }, supplier);
    expect(() => saveSupplier(updated, supplier, supplier)).toThrow("alterado");
    expect(() => saveSupplier(data, { ...supplier, id: "cpf", document: "52998224725" })).not.toThrow();
    expect(() => saveSupplier(data, { ...supplier, id: "alpha", document: "ABCDEF12345680" })).not.toThrow();
    expect(() => saveSupplier(data, { ...supplier, id: "blank", document: "" })).not.toThrow();
  });
  it("divide centavos e preserva calendário mensal com datas editáveis e pagamento único", () => {
    expect(order.schedule).toEqual([{ amount: 3334, dueOn: "2026-01-31" }, { amount: 3333, dueOn: "2026-02-28" }, { amount: 3333, dueOn: "2026-03-31" }]);
    expect(previewPurchaseSchedule(1, 1, "2028-02-29")).toEqual([{ amount: 1, dueOn: "2028-02-29" }]);
    expect(previewPurchaseSchedule(120, 120, "2026-01-31")).toHaveLength(120);
    for (const [amount, count] of [[0, 1], [100, 0], [100, 1.5], [100, 121], [2, 3], [100000001, 1]])
      expect(() => previewPurchaseSchedule(amount, count, "2026-01-31")).toThrow();
    expect(() => previewPurchaseSchedule(100, 1, "2026-02-30")).toThrow();
    const edited = { ...order, schedule: order.schedule.map((row, i) => i === 1 ? { ...row, dueOn: "2026-03-01" } : row) };
    expect(() => savePurchaseOrder(fixture(), edited, true)).not.toThrow();
  });
  it("exige confirmação e valida itens, limites, datas e fornecedor atual sem gravação parcial", () => {
    const data = fixture(), before = structuredClone(data);
    expect(() => savePurchaseOrder(data, order, false)).toThrow("Confirme");
    const invalid: PurchaseOrder[] = [
      { ...order, supplierName: "Outro" }, { ...order, orderedOn: "2099-01-01" },
      { ...order, items: [] }, { ...order, items: [{ description: "Peça", quantity: 1.5, unitCost: 10000 }] },
      { ...order, items: [{ description: "Peça", quantity: 10000, unitCost: 100000000 }] },
      { ...order, schedule: [{ dueOn: "2026-01-01", amount: 9999 }] },
      { ...order, schedule: order.schedule.map((row) => ({ ...row, dueOn: "2026-01-31" })) },
      { ...order, schedule: order.schedule.map((row, i) => i === 0 ? { ...row, dueOn: "2025-12-31" } : row) },
      { ...order, receipt: { ...receipt, at: new Date().toISOString(), entryIds: ["fake"] } },
    ];
    for (const input of invalid) expect(() => savePurchaseOrder(data, input, true)).toThrow();
    expect(() => savePurchaseOrder(placed(), order, true)).toThrow("novo pedido");
    expect(data).toEqual(before);
  });
  it("recebe integralmente e gera somente parcelas exatas com vínculo e classificação, preservando histórico no backup", () => {
    const data = placed(), result = received(data), saved = purchasing(result).orders[0];
    expect(data.finance.entries).toEqual([]);
    expect(result.finance.entries.map((entry) => entry.amount)).toEqual([3334, 3333, 3333]);
    expect(result.finance.entries.every((entry) => entry.kind === "Pagar" && entry.purchaseId === order.id && !entry.settlements.length && !entry.invoiceId)).toBe(true);
    expect(result.finance.entries.map((entry) => entry.id)).toEqual(saved.receipt!.entryIds);
    expect(result.finance.entries.map((entry) => entry.installment?.number)).toEqual([1, 2, 3]);
    expect(result.finance.management!.classifications).toHaveLength(3);
    expect(result.finance.management!.classifications.every((item) => item.categoryId === "category" && item.costCenterId === "center")).toBe(true);
    expect(purchaseTotal(saved)).toBe(10000);
    expect(result.products).toEqual(data.products);
    expect(result.finance.invoices).toEqual([]);
    expect(validateDatabase(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(managementReport(result, filter).totals).toMatchObject({ paid: 0, expectedPayments: 10000 });
    expect(managementCsv(result, managementReport(result, filter))).toContain("Compra purchase");
  });
  it("recebe pagamento único de um centavo e limite monetário sem parcela artificial", () => {
    for (const amount of [1, 100000000]) {
      const single = { ...order, items: [{ description: "Único", quantity: 1, unitCost: amount }], schedule: previewPurchaseSchedule(amount, 1, "2026-01-31") };
      const data = received(savePurchaseOrder(fixture(), single, true), single);
      expect(data.finance.entries).toHaveLength(1);
      expect(data.finance.entries[0].amount).toBe(amount);
      expect(data.finance.entries[0].installment).toBeUndefined();
    }
  });
  it("não recebe/cancela duas vezes, nem após cancelamento de contas, e recusa snapshot obsoleto", () => {
    let data = received();
    expect(() => received(data)).toThrow("alterado");
    const saved = purchasing(data).orders[0];
    expect(() => received(data, saved)).toThrow("recebido ou cancelado");
    expect(() => cancelPurchaseOrder(data, saved, "Compra recebida", true)).toThrow("recebido ou cancelado");
    data = cancelFinanceEntry(data, data.finance.entries[0].id);
    expect(() => received(data, saved)).toThrow("recebido ou cancelado");
    expect(data.finance.entries).toHaveLength(3);
    expect(() => receivePurchaseOrder(placed(), order, receipt, false)).toThrow("Confirme");
    for (const input of [{ ...receipt, date: "2025-12-31" }, { ...receipt, date: "2099-01-01" }, { ...receipt, notes: "" }])
      expect(() => receivePurchaseOrder(placed(), order, input, true)).toThrow();
    expect(() => received(placed(), { ...order, description: "Alterado" })).toThrow("alterado");
  });
  it("cancela somente pedido aberto com motivo, sem efeitos financeiros e cancelamento definitivo", () => {
    const data = cancelPurchaseOrder(placed(), order, "Fornecedor não entregou", true);
    expect(data.finance.entries).toEqual([]);
    expect(purchasing(data).orders[0].cancellation?.reason).toBe("Fornecedor não entregou");
    expect(() => received(data, purchasing(data).orders[0])).toThrow("recebido ou cancelado");
    expect(() => cancelPurchaseOrder(placed(), order, "", true)).toThrow();
    expect(() => cancelPurchaseOrder(placed(), order, "Não entregue", false)).toThrow("Confirme");
  });
  it("preserva snapshot do fornecedor e histórico mesmo inativado; bloqueia novas operações inativas", () => {
    let data = saveSupplier(placed(), { ...supplier, name: "Nome atualizado" }, supplier);
    expect(purchasing(data).orders[0].supplierName).toBe(supplier.name);
    data = received(data);
    expect(data.finance.entries[0].party).toBe(supplier.name);
    for (const dimension of ["supplier", "bank", "category", "center"]) {
      const inactive = placed();
      if (dimension === "supplier") inactive.finance.purchasing!.suppliers[0].active = false;
      if (dimension === "bank") inactive.finance.accounts[0].active = false;
      if (dimension === "category") inactive.finance.management!.categories[0].active = false;
      if (dimension === "center") inactive.finance.management!.costCenters[0].active = false;
      expect(() => validateDatabase(inactive)).not.toThrow();
      expect(() => received(inactive)).toThrow("ativos");
      expect(() => savePurchaseOrder(inactive, { ...order, id: "new" }, true)).toThrow("ativos");
      expect(() => cancelPurchaseOrder(inactive, order, "Referência inativa", true)).not.toThrow();
    }
  });
  it("rejeita referências, vínculos incompletos ou misturados, parcelas alteradas e contas antes do recebimento", () => {
    const valid = received();
    const corruptions = [
      (data: typeof valid) => { delete data.finance.purchasing; },
      (data: typeof valid) => { delete data.finance.purchasing!.orders[0].receipt; },
      (data: typeof valid) => { data.finance.entries.pop(); },
      (data: typeof valid) => { data.finance.entries[0].purchaseId = "unknown"; },
      (data: typeof valid) => { data.finance.entries[0].kind = "Receber"; },
      (data: typeof valid) => { data.finance.entries[0].accountId = "unknown"; },
      (data: typeof valid) => { data.finance.entries[0].dueOn = "2026-02-01"; },
      (data: typeof valid) => { data.finance.entries[0].recurrence = { id: "unknown", period: "2026-01" }; },
      (data: typeof valid) => { data.finance.purchasing!.orders[0].receipt!.entryIds[1] = data.finance.entries[0].id; },
      (data: typeof valid) => { data.finance.purchasing!.orders[0].cancellation = { at: new Date().toISOString(), reason: "Cancelado" }; },
    ];
    for (const mutate of corruptions) { const data = structuredClone(valid); mutate(data); expect(() => validateDatabase(data)).toThrow(); }
    expect(() => saveFinanceEntry(fixture(), valid.finance.entries[0])).toThrow();
    expect(() => saveFinanceInstallments(fixture(), valid.finance.entries[0], ["2026-01-31", "2026-02-28"], true)).toThrow();
  });
  it("baixas, ajustes, estornos, reclassificação e conciliação usam contas recebidas sem duplicar compra", () => {
    let data = received();
    const id = data.finance.entries[0].id;
    data = classifyFinanceEntry(data, { entryId: id });
    data = settleFinanceEntry(data, id, { id: "settlement", date: localDay(), amount: 1000, accountId: "bank",
      adjustment: { interest: 0, fine: 0, discount: 100, reason: "Desconto negociado", confirmedAt: new Date().toISOString() } }, true);
    expect(entryBalance(data.finance.entries[0])).toBe(2334);
    expect(managementReport(data, filter).totals).toMatchObject({ paid: 900, expectedPayments: 9000 });
    data = importStatement(data, "bank", { format: "CSV", bank: "", account: "",
      lines: [{ externalId: "movement", date: localDay(), amount: -900, description: "Pagamento" }] }, "teste.csv", true);
    data = matchBankSettlement(data, data.finance.banking!.transactions[0].id, id, "settlement");
    expect(data.finance.banking!.matches).toHaveLength(1);
    data = reverseSettlement(data, id, "settlement");
    expect(entryBalance(data.finance.entries[0])).toBe(3334);
    expect(purchasing(data).orders).toHaveLength(1);
  });
  it("expõe aba, ações, limites e vínculo nos títulos pela interface existente", () => {
    const data = received();
    const html = renderToStaticMarkup(<FinancePanel data={data} commit={() => {}} onSuccess={() => {}} onOpenOrder={() => {}} initialTab="Compras e fornecedores" />);
    for (const text of ["Novo fornecedor", "Novo pedido de compra", "Recebido", "Itens, parcelas e histórico", "sem movimentar caixa"])
      expect(html).toContain(text);
    const accounts = renderToStaticMarkup(<FinancePanel data={data} commit={() => {}} onSuccess={() => {}} onOpenOrder={() => {}} initialTab="Contas a pagar" />);
    expect(accounts).toContain("Pedido de compra: ");
    expect(accounts).toContain("purchase");
  });
});
