import { localDay, makeId, validateDatabase } from "./domain";
import type { Database } from "./domain";
import { financeEntrySchema, purchaseOrderSchema, supplierSchema } from "./financeSchema";
import type { PurchaseOrder, Supplier } from "./financeSchema";
import { classifyFinanceEntry } from "./financeManagement";
import { previewFinanceInstallments } from "./financeInstallments";
export { purchaseTotal } from "./purchasingValidation";

export function purchasing(data: Database) {
  return data.finance.purchasing ?? { suppliers: [], orders: [] };
}

export function previewPurchaseSchedule(total: number, count: number, firstDueOn: string) {
  if (count !== 1) return previewFinanceInstallments(total, count, firstDueOn);
  return [{ amount: financeEntrySchema.shape.amount.parse(total), dueOn: financeEntrySchema.shape.dueOn.parse(firstDueOn) }];
}

export function saveSupplier(data: Database, input: Supplier, expected?: Supplier) {
  const supplier = supplierSchema.parse(input), current = purchasing(data);
  const previous = current.suppliers.find((item) => item.id === supplier.id);
  if (JSON.stringify(previous) !== JSON.stringify(expected ? supplierSchema.parse(expected) : undefined))
    throw new Error("Fornecedor alterado. Atualize antes de salvar.");
  return validateDatabase({ ...data, finance: { ...data.finance, purchasing: { ...current,
    suppliers: [...current.suppliers.filter((item) => item.id !== supplier.id), supplier] } } });
}

function activeReferences(data: Database, order: PurchaseOrder) {
  if (!purchasing(data).suppliers.some((item) => item.id === order.supplierId && item.active) ||
    !data.finance.accounts.some((item) => item.id === order.accountId && item.active) ||
    (order.categoryId && !data.finance.management?.categories.some((item) => item.id === order.categoryId && item.active && item.kind === "Pagar")) ||
    (order.costCenterId && !data.finance.management?.costCenters.some((item) => item.id === order.costCenterId && item.active)))
    throw new Error("Selecione fornecedor, banco e classificações ativos para cadastrar ou receber a compra.");
}

export function savePurchaseOrder(data: Database, input: PurchaseOrder, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme os itens, o total e os vencimentos do pedido.");
  const order = purchaseOrderSchema.parse(input), current = purchasing(data);
  if (current.orders.some((item) => item.id === order.id) || order.receipt || order.cancellation)
    throw new Error("Cadastre somente um novo pedido aberto, sem recebimento ou cancelamento.");
  activeReferences(data, order);
  const supplier = current.suppliers.find((item) => item.id === order.supplierId)!;
  if (order.supplierName !== supplier.name || order.supplierDocument !== supplier.document || order.orderedOn > localDay())
    throw new Error("Confira os dados atuais do fornecedor e a data não futura do pedido.");
  return validateDatabase({ ...data, finance: { ...data.finance, purchasing: { ...current, orders: [...current.orders, order] } } });
}

function pendingOrder(data: Database, expected: PurchaseOrder) {
  const current = purchasing(data), order = current.orders.find((item) => item.id === expected.id);
  if (!order || JSON.stringify(order) !== JSON.stringify(purchaseOrderSchema.parse(expected)))
    throw new Error("Pedido alterado. Atualize e confira novamente.");
  if (order.receipt || order.cancellation)
    throw new Error("Pedido recebido ou cancelado não aceita novo recebimento/cancelamento.");
  return { current, order };
}

export function cancelPurchaseOrder(data: Database, expected: PurchaseOrder, reason: string, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme o cancelamento definitivo do pedido.");
  const { current, order } = pendingOrder(data, expected);
  const updated = purchaseOrderSchema.parse({ ...order, cancellation: { at: new Date().toISOString(), reason } });
  return validateDatabase({ ...data, finance: { ...data.finance, purchasing: { ...current,
    orders: current.orders.map((item) => item.id === order.id ? updated : item) } } });
}

export function receivePurchaseOrder(data: Database, expected: PurchaseOrder,
  input: { date: string; reference: string; notes: string }, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme a conferência integral e a geração das contas a pagar.");
  const { current, order } = pendingOrder(data, expected);
  activeReferences(data, order);
  if (input.date > localDay()) throw new Error("Recebimento não pode ter data futura.");
  const count = order.schedule.length, total = order.schedule.reduce((sum, row) => sum + row.amount, 0);
  const entries = order.schedule.map((row, index) => financeEntrySchema.parse({
    id: makeId(), kind: "Pagar", party: order.supplierName, description: order.description,
    amount: row.amount, dueOn: row.dueOn, issuedOn: order.orderedOn, accountId: order.accountId,
    paymentMethod: order.paymentMethod, purchaseId: order.id, canceled: false, settlements: [],
    ...(count > 1 ? { installment: { planId: order.id, number: index + 1, count, total } } : {}),
  }));
  const updated = purchaseOrderSchema.parse({ ...order,
    receipt: { ...input, at: new Date().toISOString(), entryIds: entries.map((entry) => entry.id) } });
  let result = validateDatabase({ ...data, finance: { ...data.finance,
    entries: [...data.finance.entries, ...entries],
    purchasing: { ...current, orders: current.orders.map((item) => item.id === order.id ? updated : item) } } });
  if (order.categoryId || order.costCenterId) for (const entry of entries)
    result = classifyFinanceEntry(result, { entryId: entry.id,
      ...(order.categoryId ? { categoryId: order.categoryId } : {}), ...(order.costCenterId ? { costCenterId: order.costCenterId } : {}) });
  return result;
}
