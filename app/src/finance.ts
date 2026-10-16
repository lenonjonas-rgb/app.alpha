import { getOrderDetails, localDay, makeId, orderValues, validateDatabase } from "./domain";
import type { Database, OrderDetails } from "./domain";
import { bankAccountSchema, billingKinds, financeEntrySchema } from "./financeSchema";
import type { BankAccount, BillingKind, BillingTerms, FinanceEntry, Invoice } from "./financeSchema";
import type { BillingItem } from "./financeSchema";
import { travelValues } from "./travel";
import { fiscalRetentionSchema } from "./fiscalRetentions";
import type { z } from "zod";

export function splitBillingValues(details: OrderDetails) {
  const products = details.items.filter((item) => item.kind === "produto")
    .reduce((sum, item) => sum + Math.round(item.quantity * item.price) - item.discount, 0);
  const values = orderValues(details);
  const services = values.items - products + values.costs + values.travel;
  const base = products + services;
  if (![products, services, base, values.discount].every((value) => Number.isSafeInteger(value) && value >= 0) || values.discount > base)
    throw new Error("Confira os valores e descontos da OS antes de faturar.");
  // Rateio proporcional arredondado, atribuindo o restante aos serviços sem perder centavos.
  const productDiscount = base ? Number((BigInt(values.discount) * BigInt(products) * 2n + BigInt(base)) / (BigInt(base) * 2n)) : 0;
  return { products: products - productDiscount, services: services - (values.discount - productDiscount) };
}

export function billingItemSnapshots(details: OrderDetails, kind: BillingKind, amount: number): BillingItem[] {
  const items: BillingItem[] = details.items.filter((item) => item.kind === (kind === "Produtos" ? "produto" : "servico")).map((item) => ({
    id: `item:${item.id}`, source: "item", kind: item.kind, referenceId: item.referenceId, name: item.name,
    quantity: item.quantity, price: item.price, gross: Math.round(item.quantity * item.price), itemDiscount: item.discount, orderDiscount: 0,
  }));
  if (kind === "Serviços") {
    const extra = (id: string, source: BillingItem["source"], name: string, value: number) => {
      if (value > 0) items.push({ id, source, kind: "servico", name, quantity: 1, price: value, gross: value, itemDiscount: 0, orderDiscount: 0 });
    };
    for (const cost of details.costs) extra(`cost:${cost.id}`, "cost", cost.name, cost.value);
    if (details.travel?.chargeTravel) {
      extra("travel", "travel", "Deslocamento", travelValues(details.travel).mileageCharge);
      extra("toll", "toll", "Pedágio ida e volta", details.travel.tolls);
    }
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Itens duplicados na OS.");
  const base = items.reduce((sum, item) => sum + item.gross - item.itemDiscount, 0);
  const discount = base - amount;
  if (!Number.isSafeInteger(base) || discount < 0 || discount > base) throw new Error("Snapshot dos itens não confere com o rateio.");
  // Rateio cumulativo limita cada parcela ao item e conserva exatamente o desconto do grupo.
  let accumulated = 0n, allocated = 0n;
  for (const item of items) {
    accumulated += BigInt(item.gross - item.itemDiscount);
    const next = base ? (BigInt(discount) * accumulated * 2n + BigInt(base)) / (BigInt(base) * 2n) : 0n;
    item.orderDiscount = Number(next - allocated); allocated = next;
  }
  return items;
}

function activeInvoices(data: Database, orderId: string) {
  return data.finance.invoices.filter((invoice) => !invoice.canceled && invoice.orders.some((item) => item.orderId === orderId));
}

export function pendingBillingValues(data: Database, order: Database["orders"][number]) {
  const invoices = activeInvoices(data, order.id);
  const allocation = invoices.flatMap((invoice) => invoice.orders).find((item) => item.orderId === order.id)?.allocation
    ?? splitBillingValues(getOrderDetails(order));
  const billed = (kind: BillingKind) => invoices.some((invoice) => invoice.kind === kind || invoice.kind === "Legado");
  return { products: billed("Produtos") ? 0 : allocation.products, services: billed("Serviços") ? 0 : allocation.services };
}

export function pendingBillingOrders(data: Database) {
  return data.orders.filter((order) => {
    if (order.status !== "Finalizada" || getOrderDetails(order).archived) return false;
    const pending = pendingBillingValues(data, order);
    return pending.products + pending.services > 0;
  });
}

export function entryBalance(entry: FinanceEntry) {
  return entry.amount - (entry.retention?.withheld ?? 0) - entry.settlements.filter((item) => !item.reversed).reduce((sum, item) => sum + item.amount, 0);
}
export function applyFinanceRetention(data: Database, entryId: string, input: z.infer<typeof fiscalRetentionSchema>, expected: FinanceEntry) {
  const retention = fiscalRetentionSchema.parse(input);
  const entry = data.finance.entries.find((entry) => entry.id === entryId);
  if (!entry || entry.canceled || JSON.stringify(entry) !== JSON.stringify(expected))
    throw new Error("Conta alterada durante a conciliação. Atualize e confira novamente.");
  if (entry.settlements.some((item) => !item.reversed)) throw new Error("Estorne as baixas antes de conciliar retenções.");
  if (entry.amount !== retention.invoiceAmount) throw new Error("Valor bruto diferente da memória confirmada.");
  return validateDatabase({ ...data, finance: { ...data.finance,
    entries: data.finance.entries.map((item) => item.id === entryId ? { ...item, retention } : item) } });
}
export function clearFinanceRetention(data: Database, entryId: string, calculationId: string, expected: FinanceEntry) {
  const entry = data.finance.entries.find((item) => item.id === entryId);
  if (!entry || entry.canceled || JSON.stringify(entry) !== JSON.stringify(expected) || entry.retention?.calculationId !== calculationId)
    throw new Error("Conta alterada durante a remoção. Atualize e confira novamente.");
  if (entry.settlements.some((item) => !item.reversed)) throw new Error("Estorne as baixas antes de remover retenções.");
  return validateDatabase({ ...data, finance: { ...data.finance, entries: data.finance.entries.map((item) => {
    if (item.id !== entryId) return item;
    const { retention: _retention, ...withoutRetention } = item;
    return withoutRetention;
  }) } });
}

export function entryStatus(entry: FinanceEntry, today = localDay()) {
  return entry.canceled ? "Cancelada" : entryBalance(entry) === 0 ? (entry.kind === "Receber" ? "Recebida" : "Paga")
    : entry.dueOn < today ? "Atrasada" : entry.settlements.some((item) => !item.reversed) ? "Parcial" : "Em aberto";
}

function activeAccount(data: Database, id: string) {
  if (!data.finance.accounts.some((item) => item.id === id && item.active))
    throw new Error("Selecione uma conta bancária ativa.");
}

export function saveBankAccount(data: Database, input: BankAccount) {
  const account = bankAccountSchema.parse(input);
  if (data.finance.accounts.some((item) => item.id !== account.id && item.name.toLocaleLowerCase("pt-BR") === account.name.toLocaleLowerCase("pt-BR")))
    throw new Error("Já existe uma conta com este nome.");
  return validateDatabase({ ...data, finance: { ...data.finance, accounts: [...data.finance.accounts.filter((item) => item.id !== account.id), account] } });
}

export function saveFinanceEntry(data: Database, input: FinanceEntry) {
  const entry = financeEntrySchema.parse(input);
  if (data.finance.entries.some((item) => item.id === entry.id))
    throw new Error("Esta conta já foi cadastrada.");
  if (entry.invoiceId || entry.settlements.length || entry.canceled || entry.retention)
    throw new Error("Uma nova conta deve iniciar em aberto e sem faturamento manual.");
  activeAccount(data, entry.accountId);
  return validateDatabase({ ...data, finance: { ...data.finance, entries: [...data.finance.entries, entry] } });
}

export function previewBilling(data: Database, ids: string[]) {
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error("Selecione as OS para faturar.");
  const available = pendingBillingOrders(data);
  const orders = ids.map((id) => {
    const order = available.find((item) => item.id === id);
    if (!order) throw new Error("Uma OS não está mais disponível para faturamento. Atualize a seleção.");
    return order;
  });
  if (orders.some((order) => order.clientId !== orders[0].clientId))
    throw new Error("Agrupe somente OS do mesmo cliente.");
  if (orders.some((order) => getOrderDetails(order).travel?.tollsConfirmed === false))
    throw new Error("Confirme os pedágios pendentes na OS antes de faturar.");
  const client = data.clients.find((item) => item.id === orders[0].clientId);
  if (!client) throw new Error("Cliente indisponível.");
  const snapshots = orders.map((order) => {
    const allocation = splitBillingValues(getOrderDetails(order));
    const invoices = activeInvoices(data, order.id);
    const previous = invoices.flatMap((invoice) => invoice.orders).find((item) => item.orderId === order.id)?.allocation;
    if (previous && (previous.products !== allocation.products || previous.services !== allocation.services))
      throw new Error(`Os valores da ${order.code} mudaram após faturamento parcial. Estorne as baixas e cancele os dois grupos para refazer o rateio.`);
    return { order, allocation, invoices };
  });
  const preview = billingKinds.map((kind) => {
    const items = snapshots.filter(({ invoices }) => !invoices.some((invoice) => invoice.kind === kind || invoice.kind === "Legado"))
      .map(({ order, allocation }) => {
        const amount = kind === "Produtos" ? allocation.products : allocation.services;
        return { orderId: order.id, code: order.code, title: order.title, allocation, amount,
          items: billingItemSnapshots(getOrderDetails(order), kind, amount) };
      }).filter((item) => item.amount > 0);
    return { kind, clientId: client.id, clientName: client.name, orders: items, amount: items.reduce((sum, item) => sum + item.amount, 0) };
  }).filter((item) => item.amount > 0);
  if (!preview.length) throw new Error("O total do faturamento deve ser maior que zero. Confira os valores das OS.");
  if (snapshots.some(({ order }) => !preview.some((group) => group.orders.some((item) => item.orderId === order.id))))
    throw new Error("Uma OS selecionada está sem valor a faturar. Confira a seleção.");
  return preview;
}

export function billOrders(data: Database, ids: string[], options: Partial<Record<BillingKind, BillingTerms>>, expected?: ReturnType<typeof previewBilling>) {
  const preview = previewBilling(data, ids);
  if (expected && JSON.stringify(expected) !== JSON.stringify(preview))
    throw new Error("Os valores ou grupos mudaram. Reabra o faturamento para conferir.");
  if (Object.keys(options).length !== preview.length || preview.some((item) => !options[item.kind]))
    throw new Error("Informe o pagamento separado para cada grupo de produtos e serviços.");
  const invoices: Invoice[] = [];
  const entries: FinanceEntry[] = [];
  for (const group of preview) {
    const terms = options[group.kind];
    if (!terms) throw new Error("Informe o pagamento separado para cada grupo.");
    activeAccount(data, terms.accountId);
    if (terms.paymentMethod !== "Pix" && terms.paymentMethod !== "Boleto")
      throw new Error("Escolha Boleto ou Pix para cada grupo.");
    const invoice: Invoice = { ...group, id: makeId(), createdOn: localDay(), canceled: false };
    const entry = financeEntrySchema.parse({
      id: makeId(), kind: "Receber", party: group.clientName, clientId: group.clientId,
      description: `${group.kind} · OS: ${group.orders.map((item) => item.code).join(", ")}`, amount: group.amount,
      issuedOn: invoice.createdOn, ...terms, invoiceId: invoice.id,
    });
    invoices.push(invoice);
    entries.push(entry);
  }
  return validateDatabase({ ...data, finance: { ...data.finance, invoices: [...data.finance.invoices, ...invoices], entries: [...data.finance.entries, ...entries] } });
}

export function settleFinanceEntry(data: Database, id: string, settlement: Omit<FinanceEntry["settlements"][number], "reversed">) {
  const entry = data.finance.entries.find((item) => item.id === id);
  if (!entry || entry.canceled) throw new Error("Conta indisponível para baixa.");
  if (settlement.date > localDay()) throw new Error("A data da baixa não pode estar no futuro.");
  activeAccount(data, settlement.accountId);
  if (settlement.amount > entryBalance(entry)) throw new Error("O valor da baixa excede o saldo da conta.");
  const updated = financeEntrySchema.parse({ ...entry, settlements: [...entry.settlements, { ...settlement, reversed: false }] });
  return validateDatabase({ ...data, finance: { ...data.finance, entries: data.finance.entries.map((item) => item.id === id ? updated : item) } });
}

export function reverseSettlement(data: Database, entryId: string, settlementId: string) {
  const entry = data.finance.entries.find((item) => item.id === entryId);
  if (!entry || !entry.settlements.some((item) => item.id === settlementId && !item.reversed)) throw new Error("Baixa indisponível para estorno.");
  return validateDatabase({ ...data, finance: { ...data.finance, entries: data.finance.entries.map((item) => item.id === entryId
    ? { ...item, settlements: item.settlements.map((settlement) => settlement.id === settlementId ? { ...settlement, reversed: true } : settlement) } : item) } });
}

export function cancelFinanceEntry(data: Database, id: string, expected?: { entry: FinanceEntry; invoice?: Invoice }) {
  const entry = data.finance.entries.find((item) => item.id === id);
  if (expected && (JSON.stringify(entry) !== JSON.stringify(expected.entry) ||
    JSON.stringify(data.finance.invoices.find((item) => item.id === entry?.invoiceId)) !== JSON.stringify(expected.invoice)))
    throw new Error("Conta alterada durante a verificação. Cancelamento pode estar reservado no backend; atualize e retente sem recriar o título.");
  if (!entry || entry.canceled) throw new Error("Conta indisponível para cancelamento.");
  if (entry.settlements.some((item) => !item.reversed)) throw new Error("Estorne as baixas antes de cancelar a conta.");
  return validateDatabase({ ...data, finance: { ...data.finance,
    entries: data.finance.entries.map((item) => item.id === id ? { ...item, canceled: true } : item),
    invoices: data.finance.invoices.map((item) => item.id === entry.invoiceId ? { ...item, canceled: true } : item),
  } });
}
