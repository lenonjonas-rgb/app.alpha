import type { Finance, PurchaseOrder } from "./financeSchema";

export function purchaseTotal(order: Pick<PurchaseOrder, "items">) {
  return order.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
}

export function purchaseScheduleForReceived(order: PurchaseOrder, receivedAmount: number) {
  const total = purchaseTotal(order);
  if (!Number.isSafeInteger(receivedAmount) || receivedAmount <= 0 || receivedAmount > total)
    throw new Error("Valor recebido da compra inválido.");
  let remainder = BigInt(receivedAmount), allocated = 0;
  const shares = order.schedule.map((row, index) => {
    const amount = Number(BigInt(receivedAmount) * BigInt(row.amount) / BigInt(total));
    allocated += amount;
    return { index, amount, dueOn: row.dueOn };
  });
  remainder -= BigInt(allocated);
  for (const share of shares) {
    if (remainder === 0n) break;
    share.amount += 1;
    remainder -= 1n;
  }
  return shares.filter((share) => share.amount > 0);
}

export function validatePurchases(finance: Finance) {
  const { suppliers, orders } = finance.purchasing ?? { suppliers: [], orders: [] };
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(suppliers.map((item) => item.id)) || !unique(orders.map((item) => item.id)) ||
    !unique(suppliers.filter((item) => item.document).map((item) => item.document)))
    throw new Error("Fornecedores, documentos ou pedidos de compra duplicados.");
  for (const order of orders) {
    const total = purchaseTotal(order), count = order.schedule.length;
    if (order.procurement) {
      const { quotes, selectedQuoteId, quoteExceptionReason, approval } = order.procurement;
      const approvalTime = Date.parse(approval.at), orderCreatedAt = Date.parse(order.createdAt);
      const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
      const selectedQuote = quotes.find((quote) => quote.id === selectedQuoteId);
      if (new Set(quotes.map((quote) => quote.supplierId)).size !== quotes.length ||
        quotes.some((quote) => !suppliersById.has(quote.supplierId) ||
          quote.quotedOn > order.orderedOn ||
          !quote.reference.trim() && !quote.terms.trim()) ||
        (quotes.length < 3 && !quoteExceptionReason?.trim()) ||
        (selectedQuote?.supplierId !== order.supplierId || selectedQuote.amount !== total) ||
        !["owner", "admin", "local"].includes(approval.approverRole) ||
        approvalTime < orderCreatedAt || approvalTime > Date.now() + 5 * 60_000)
        throw new Error("Cotações, exceção ou aprovação da compra inválidas.");
    }
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
      const cancellation = order.cancellation;
      if (!cancellation?.receivedAmount) {
        if (entries.length || cancellation?.payableEntryIds?.length)
          throw new Error("Pedido cancelado sem recebimento não pode gerar contas a pagar.");
        continue;
      }
      const schedule = purchaseScheduleForReceived(order, cancellation.receivedAmount);
      const entryIds = cancellation.payableEntryIds ?? [];
      if (entries.length !== schedule.length || entryIds.length !== schedule.length ||
        !unique(entryIds) || schedule.some((row, index) => {
          const entry = finance.entries.find((item) => item.id === entryIds[index]);
          return !entry || entry.purchaseId !== order.id || entry.kind !== "Pagar" ||
            entry.party !== order.supplierName || entry.description !== order.description ||
            entry.accountId !== order.accountId || entry.paymentMethod !== order.paymentMethod ||
            entry.amount !== row.amount || entry.dueOn !== row.dueOn || entry.issuedOn !== order.orderedOn ||
            entry.invoiceId || entry.retention || entry.recurrence || entry.installment || entry.clientId;
        }))
        throw new Error("Contas a pagar divergem do valor recebido e do rateio aprovado no cancelamento.");
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
