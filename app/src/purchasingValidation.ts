import type { Finance, PurchaseOrder } from "./financeSchema";

export function purchaseTotal(order: Pick<PurchaseOrder, "items">) {
  return order.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
}

export function validatePurchases(finance: Finance) {
  const { suppliers, orders } = finance.purchasing ?? { suppliers: [], orders: [] };
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(suppliers.map((item) => item.id)) || !unique(orders.map((item) => item.id)) ||
    !unique(suppliers.filter((item) => item.document).map((item) => item.document)))
    throw new Error("Fornecedores, documentos ou pedidos de compra duplicados.");
  for (const order of orders) {
    const total = purchaseTotal(order), count = order.schedule.length;
    if (total < count || total > 100_000_000 || !suppliers.some((item) => item.id === order.supplierId) ||
      !finance.accounts.some((item) => item.id === order.accountId) ||
      (order.categoryId && !finance.management?.categories.some((item) => item.id === order.categoryId && item.kind === "Pagar")) ||
      (order.costCenterId && !finance.management?.costCenters.some((item) => item.id === order.costCenterId)) ||
      order.schedule.some((row, index) => row.dueOn < order.orderedOn ||
        (index > 0 && row.dueOn <= order.schedule[index - 1].dueOn) ||
        row.amount !== Math.floor(total / count) + (index < total % count ? 1 : 0)) ||
      (order.cancellation && order.receipt) || (order.cancellation && order.cancellation.at < order.createdAt))
      throw new Error("Pedido de compra com total, parcelas, datas ou referências inválidos.");
    const entries = finance.entries.filter((entry) => entry.purchaseId === order.id);
    if (!order.receipt) {
      if (entries.length) throw new Error("Pedido não recebido não pode gerar contas a pagar.");
      continue;
    }
    const receipt = order.receipt;
    if (receipt.at < order.createdAt || receipt.date < order.orderedOn || entries.length !== count ||
      receipt.entryIds.length !== count || !unique(receipt.entryIds))
      throw new Error("Recebimento de compra incompleto ou com datas inválidas.");
    order.schedule.forEach((row, index) => {
      const entry = entries.find((entry) => entry.id === receipt.entryIds[index]);
      if (!entry || entry.kind !== "Pagar" || entry.party !== order.supplierName || entry.description !== order.description ||
        entry.accountId !== order.accountId || entry.paymentMethod !== order.paymentMethod || entry.amount !== row.amount ||
        entry.dueOn !== row.dueOn || entry.issuedOn !== order.orderedOn ||
        entry.invoiceId || entry.retention || entry.recurrence || entry.clientId ||
        (count === 1 ? entry.installment !== undefined : !entry.installment ||
          entry.installment.planId !== order.id || entry.installment.number !== index + 1 ||
          entry.installment.count !== count || entry.installment.total !== total))
        throw new Error("Conta a pagar diverge do recebimento ou das parcelas da compra.");
    });
  }
  if (finance.entries.some((entry) => entry.purchaseId && !orders.some((order) => order.id === entry.purchaseId)))
    throw new Error("Conta a pagar vinculada a compra inexistente.");
}
