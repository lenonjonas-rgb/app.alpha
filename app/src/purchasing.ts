import { localDay, makeId, nextCode, receivePurchaseStock, validateDatabase } from "./domain";
import type { Database, PurchaseStockReceipt } from "./domain";
import { financeEntrySchema, purchaseOrderSchema, supplierSchema } from "./financeSchema";
import type { PurchaseOrder, Supplier } from "./financeSchema";
import { classifyFinanceEntry } from "./financeManagement";
import { previewFinanceInstallments } from "./financeInstallments";
import { purchaseScheduleForReceived } from "./purchasingValidation";
export { purchaseTotal } from "./purchasingValidation";
export { availablePurchaseReturnItems, returnPurchaseStock } from "./domain";

export function purchasing(data: Database) {
  return data.finance.purchasing ?? { suppliers: [], orders: [] };
}

export function previewPurchaseSchedule(total: number, count: number, firstDueOn: string) {
  if (count !== 1) return previewFinanceInstallments(total, count, firstDueOn);
  return [{ amount: financeEntrySchema.shape.amount.parse(total), dueOn: financeEntrySchema.shape.dueOn.parse(firstDueOn) }];
}

function productNameKey(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}
function productCodeKey(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
}
function linkPurchaseItem(data: Database, item: PurchaseOrder["items"][number]) {
  if (item.productId) {
    const selected = data.products.find((product) => product.id === item.productId);
    if (!selected) throw new Error(`O produto selecionado para "${item.description}" não existe.`);
    if (item.code && productCodeKey(selected.code) !== productCodeKey(item.code))
      throw new Error(`Código divergente para "${item.description}". Confira o produto vinculado.`);
    return { ...item, id: item.id ?? makeId(), productId: selected.id };
  }
  if (item.code) {
    const matches = data.products.filter((product) => productCodeKey(product.code) === productCodeKey(item.code!));
    if (matches.length > 1) throw new Error(`Código de estoque ambíguo para "${item.description}"; selecione o produto manualmente.`);
    if (matches.length === 1) return { ...item, id: item.id ?? makeId(), productId: matches[0].id };
    if (data.products.some((product) => productNameKey(product.name) === productNameKey(item.description)))
      throw new Error(`O nome "${item.description}" já existe com outro código; selecione o produto ou corrija o código.`);
    return { ...item, id: item.id ?? makeId() };
  }
  const matches = data.products.filter((product) => productNameKey(product.name) === productNameKey(item.description));
  if (matches.length > 1) throw new Error(`Nome de produto ambíguo para "${item.description}"; selecione o produto manualmente.`);
  return { ...item, id: item.id ?? makeId(), ...(matches[0] ? { productId: matches[0].id } : {}) };
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
  const order = purchaseOrderSchema.parse({ ...input, items: input.items.map((item) => linkPurchaseItem(data, item)) }), current = purchasing(data);
  const procurement = order.procurement;
  if (!procurement) throw new Error("Registre as cotações e a aprovação antes de cadastrar a compra.");
  if (current.orders.some((item) => item.id === order.id) || order.receipt || order.cancellation)
    throw new Error("Cadastre somente um novo pedido aberto, sem recebimento ou cancelamento.");
  activeReferences(data, order);
  if (procurement.quotes.some((quote) => {
    const supplier = current.suppliers.find((item) => item.id === quote.supplierId);
    return !supplier?.active || supplier.name !== quote.supplierName;
  })) throw new Error("Cotação deve preservar o nome de um fornecedor ativo.");
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
  const receipts = data.inventory!.purchaseReceipts.filter((receipt) => receipt.orderId === order.id);
  const receivedAmount = receipts.reduce((sum, receipt) => sum + receipt.items.reduce((subtotal, receivedItem) => {
    const line = order.items.find((item) => item.id === receivedItem.lineId);
    if (!line) throw new Error("Entrega contém item que não pertence ao pedido.");
    return subtotal + receivedItem.quantity * line.unitCost;
  }, 0), 0);
  const schedule = receivedAmount ? purchaseScheduleForReceived(order, receivedAmount) : [];
  const entries = schedule.map((row) => financeEntrySchema.parse({
    id: makeId(), kind: "Pagar", party: order.supplierName, description: order.description,
    amount: row.amount, dueOn: row.dueOn, issuedOn: order.orderedOn, accountId: order.accountId,
    paymentMethod: order.paymentMethod, purchaseId: order.id, canceled: false, settlements: [],
  }));
  const cancellation = {
    at: new Date().toISOString(), reason,
    ...(receivedAmount ? { receivedAmount, payableEntryIds: entries.map((entry) => entry.id) } : {}),
  };
  const updated = purchaseOrderSchema.parse({ ...order, cancellation });
  let result = validateDatabase({ ...data, finance: { ...data.finance,
    entries: [...data.finance.entries, ...entries],
    purchasing: { ...current, orders: current.orders.map((item) => item.id === order.id ? updated : item) } } });
  if (order.categoryId || order.costCenterId) for (const entry of entries)
    result = classifyFinanceEntry(result, { entryId: entry.id,
      ...(order.categoryId ? { categoryId: order.categoryId } : {}),
      ...(order.costCenterId ? { costCenterId: order.costCenterId } : {}) });
  return result;
}

export function receivePurchaseOrder(data: Database, expected: PurchaseOrder,
  input: { date: string; reference: string; notes: string; quantities?: Record<string, number> }, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme a conferência das quantidades recebidas.");
  const { current, order } = pendingOrder(data, expected);
  activeReferences(data, order);
  if (input.date > localDay()) throw new Error("Recebimento não pode ter data futura.");
  const previousReceipts = data.inventory!.purchaseReceipts.filter((receipt) => receipt.orderId === order.id);
  if (previousReceipts.some((receipt) => input.date < receipt.date))
    throw new Error("A data da entrega não pode ser anterior a um recebimento já registrado.");
  const received = new Map(order.items.map((item) => [item.id!, 0]));
  for (const receipt of previousReceipts) for (const item of receipt.items)
    received.set(item.lineId, (received.get(item.lineId) ?? 0) + item.quantity);
  const quantities = order.items.map((item) => {
    const remaining = item.quantity - (received.get(item.id!) ?? 0);
    const quantity = input.quantities ? input.quantities[item.id!] ?? 0 : remaining;
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > remaining)
      throw new Error(`Quantidade recebida inválida para "${item.description}"; pendente: ${remaining}.`);
    return { item, remaining, quantity };
  });
  if (Object.keys(input.quantities ?? {}).some((lineId) => !order.items.some((item) => item.id === lineId)) ||
    !quantities.some((item) => item.quantity > 0))
    throw new Error("Informe ao menos uma quantidade válida para esta entrega.");
  const batchId = makeId(), at = new Date().toISOString();
  const locationId = data.inventory!.defaultLocationId;
  const batchItems: PurchaseStockReceipt["items"] = [];
  let stockData = data;
  for (const { item, quantity } of quantities) {
    if (!quantity) continue;
    let productId = item.productId ?? previousReceipts.flatMap((receipt) => receipt.items)
      .find((receiptItem) => receiptItem.lineId === item.id)?.productId;
    if (!productId) {
      const code = item.code || nextCode(stockData.products, "PC");
      if (stockData.products.some((product) => productCodeKey(product.code) === productCodeKey(code)))
        throw new Error(`Código ${code} já está cadastrado. Atualize o pedido e selecione o produto correto.`);
      productId = makeId();
      stockData = { ...stockData, products: [...stockData.products, {
        id: productId, name: item.description, code, price: 0, cost: item.unitCost, stock: 0, minimum: 0,
      }] };
    }
    batchItems.push({ lineId: item.id!, productId, quantity });
    stockData = receivePurchaseStock(stockData, productId, locationId, quantity, item.unitCost,
      `Entrega ${batchId} do pedido ${order.id}`, { type: "purchase", referenceId: order.id, lineId: `${batchId}|${item.id}` });
  }
  const batch = { id: batchId, orderId: order.id, date: input.date, at, locationId,
    reference: input.reference, notes: input.notes, items: batchItems };
  stockData = { ...stockData, inventory: { ...stockData.inventory!,
    purchaseReceipts: [...stockData.inventory!.purchaseReceipts, batch] } };
  const isComplete = quantities.every(({ remaining, quantity }) => quantity === remaining);
  const entries = isComplete ? order.schedule.map((row, index) => {
    const count = order.schedule.length, total = order.schedule.reduce((sum, scheduleRow) => sum + scheduleRow.amount, 0);
    return financeEntrySchema.parse({
      id: makeId(), kind: "Pagar", party: order.supplierName, description: order.description,
      amount: row.amount, dueOn: row.dueOn, issuedOn: order.orderedOn, accountId: order.accountId,
      paymentMethod: order.paymentMethod, purchaseId: order.id, canceled: false, settlements: [],
      ...(count > 1 ? { installment: { planId: order.id, number: index + 1, count, total } } : {}),
    });
  }) : [];
  const persistedOrder = isComplete ? purchaseOrderSchema.parse({ ...order, receipt: {
    at, date: input.date, locationId, reference: input.reference, notes: input.notes,
    entryIds: entries.map((entry) => entry.id),
    stockItems: order.items.map((item) => {
      const receiptItem = [...previousReceipts, batch].flatMap((receipt) => receipt.items)
        .find((receivedItem) => receivedItem.lineId === item.id);
      if (!receiptItem) throw new Error("Item completo sem vínculo com produto recebido.");
      return { lineId: item.id!, productId: receiptItem.productId };
    }),
    batchId,
  } }) : order;
  let result = validateDatabase({ ...stockData, finance: { ...stockData.finance,
    entries: [...data.finance.entries, ...entries],
    purchasing: { ...current, orders: current.orders.map((item) => item.id === order.id ? persistedOrder : item) } } });
  if (order.categoryId || order.costCenterId) for (const entry of entries)
    result = classifyFinanceEntry(result, { entryId: entry.id,
      ...(order.categoryId ? { categoryId: order.categoryId } : {}), ...(order.costCenterId ? { costCenterId: order.costCenterId } : {}) });
  return result;
}
