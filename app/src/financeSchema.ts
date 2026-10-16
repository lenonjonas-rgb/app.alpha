import { z } from "zod";
import { fiscalRetentionSchema } from "./fiscalRetentions";
import { bankingSchema } from "./bankingSchema";
import { isValidCnpj } from "./cnpj";
import { isValidCpf } from "./cpf";
import { validatePurchases } from "./purchasingValidation";

const id = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(1000);
const money = z.number().int().nonnegative().max(100_000_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Data inválida.");
export const financeCategorySchema = z.object({
  id, name, kind: z.enum(["Receber", "Pagar"]), active: z.boolean(),
});
export const costCenterSchema = z.object({ id, name, active: z.boolean() });
export const financeClassificationSchema = z.object({
  entryId: id, categoryId: id.optional(), costCenterId: id.optional(),
});
export const openingBalanceSchema = z.object({
  accountId: id, date, amount: z.number().int().min(-100_000_000).max(100_000_000),
});
export const financeTransferSchema = z.object({
  id, fromAccountId: id, toAccountId: id, date,
  amount: money.refine((value) => value > 0, "Informe um valor maior que zero."),
  description: name, createdAt: z.iso.datetime(),
  reversal: z.object({ at: z.iso.datetime(), reason: z.string().trim().min(5).max(1000) }).optional(),
}).refine((value) => value.fromAccountId !== value.toAccountId, "Origem e destino devem ser contas diferentes.");
export const financeManagementSchema = z.object({
  categories: z.array(financeCategorySchema).default([]),
  costCenters: z.array(costCenterSchema).default([]),
  classifications: z.array(financeClassificationSchema).default([]),
  openingBalances: z.array(openingBalanceSchema).default([]),
});

export const bankAccountSchema = z.object({
  id, name, bank: name, agency: z.string().trim().max(100), account: z.string().trim().max(100),
  kind: z.enum(["Corrente", "Poupança", "Caixa"]), active: z.boolean(),
});
export const installmentSchema = z.object({
  planId: id, number: z.number().int().min(1).max(120), count: z.number().int().min(2).max(120),
  total: money.refine((value) => value > 0),
});
export const settlementAdjustmentSchema = z.object({
  interest: money, fine: money, discount: money,
  reason: z.string().trim().min(5).max(1000), confirmedAt: z.iso.datetime(),
}).refine((value) => value.interest + value.fine + value.discount > 0, "Informe ao menos um ajuste maior que zero.");
export const financeSettlementSchema = z.object({
  id, date, amount: money.refine((value) => value > 0), accountId: id, reversed: z.boolean().default(false),
  adjustment: settlementAdjustmentSchema.optional(),
}).superRefine((value, context) => {
  const cash = settlementCashAmount(value);
  if (value.adjustment && (value.adjustment.discount > value.amount || cash <= 0 || cash > 100_000_000))
    context.addIssue({ code: "custom", message: "Desconto não pode exceder o principal e o valor efetivo deve estar entre R$ 0,01 e R$ 1.000.000,00." });
});
export function settlementCashAmount(settlement: { amount: number; adjustment?: { interest: number; fine: number; discount: number } }) {
  return settlement.amount + (settlement.adjustment?.interest ?? 0) + (settlement.adjustment?.fine ?? 0) - (settlement.adjustment?.discount ?? 0);
}
export const recurrencePeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export function monthlyDueDate(firstDueOn: string, monthOffset: number) {
  date.parse(firstDueOn);
  if (!Number.isInteger(monthOffset) || monthOffset < 0 || monthOffset > 120000)
    throw new Error("Intervalo mensal inválido.");
  const first = new Date(`${firstDueOn}T12:00:00Z`), target = new Date(first);
  target.setUTCDate(1); target.setUTCMonth(target.getUTCMonth() + monthOffset + 1, 0);
  target.setUTCDate(Math.min(first.getUTCDate(), target.getUTCDate()));
  return date.parse(target.toISOString().slice(0, 10));
}
export const financeEntrySchema = z.object({
  id, kind: z.enum(["Receber", "Pagar"]), party: name, clientId: id.optional(),
  description: name, amount: money.refine((value) => value > 0, "Informe um valor maior que zero."),
  issuedOn: date, dueOn: date, accountId: id,
  paymentMethod: z.enum(["Pix", "Boleto", "Transferência", "Dinheiro", "Cartão", "Outro"]),
  invoiceId: id.optional(), canceled: z.boolean().default(false),
  retention: fiscalRetentionSchema.optional(),
  installment: installmentSchema.optional(),
  recurrence: z.object({ id, period: recurrencePeriodSchema }).optional(),
  purchaseId: id.optional(),
  settlements: z.array(financeSettlementSchema).default([]),
});
export const financeRecurrenceSchema = z.object({
  id, kind: financeEntrySchema.shape.kind, party: name, clientId: id.optional(),
  description: name, amount: financeEntrySchema.shape.amount, accountId: id,
  paymentMethod: financeEntrySchema.shape.paymentMethod, firstDueOn: date, endsOn: date,
  categoryId: id.optional(), costCenterId: id.optional(), createdAt: z.iso.datetime(),
  events: z.array(z.object({
    status: z.enum(["Ativa", "Suspensa", "Cancelada"]), at: z.iso.datetime(), reason: z.string().trim().min(5).max(1000),
  })).max(1000),
}).superRefine((item, context) => {
  if (item.firstDueOn > item.endsOn || item.events.some((event, index) =>
    event.at < (index ? item.events[index - 1].at : item.createdAt) ||
    (index ? item.events[index - 1].status : "Ativa") === "Cancelada" ||
    event.status === (index ? item.events[index - 1].status : "Ativa")))
    context.addIssue({ code: "custom", message: "Vigência ou histórico de situação da recorrência inválido." });
});
export const supplierSchema = z.object({
  id, name, document: z.string().refine((value) => value === "" ||
    (/^\d{11}$/.test(value) && isValidCpf(value)) || (/^[A-Z0-9]{12}\d{2}$/.test(value) && isValidCnpj(value)), "Informe um CPF/CNPJ válido ou deixe em branco."),
  phone: z.string().trim().max(100), email: z.union([z.literal(""), z.email().max(254)]),
  address: z.string().trim().max(1000), active: z.boolean(),
});
export const purchaseOrderSchema = z.object({
  id, supplierId: id, supplierName: name, supplierDocument: supplierSchema.shape.document,
  description: name, orderedOn: date, createdAt: z.iso.datetime(), accountId: id,
  paymentMethod: financeEntrySchema.shape.paymentMethod, categoryId: id.optional(), costCenterId: id.optional(),
  items: z.array(z.object({
    description: name, quantity: z.number().int().min(1).max(10000),
    unitCost: money.refine((value) => value > 0),
  })).min(1).max(100),
  schedule: z.array(z.object({ dueOn: date, amount: financeEntrySchema.shape.amount })).min(1).max(120),
  cancellation: z.object({ at: z.iso.datetime(), reason: z.string().trim().min(5).max(1000) }).optional(),
  receipt: z.object({
    at: z.iso.datetime(), date, reference: z.string().trim().max(200),
    notes: z.string().trim().min(5).max(1000), entryIds: z.array(id).min(1).max(120),
  }).optional(),
});
export const billingItemSchema = z.object({
  id: z.string().min(1).max(400), source: z.enum(["item", "cost", "travel", "toll"]), kind: z.enum(["produto", "servico"]),
  referenceId: id.optional(), name, quantity: z.number().positive().max(10000), price: money,
  gross: money, itemDiscount: money, orderDiscount: money,
}).superRefine((item, context) => {
  if (item.gross !== Math.round(item.quantity * item.price) || item.itemDiscount + item.orderDiscount > item.gross ||
    (item.source === "item" && !item.referenceId) || (item.source !== "item" && (item.kind !== "servico" || item.referenceId !== undefined)))
    context.addIssue({ code: "custom", message: "Snapshot de item faturado inconsistente." });
});
export type BillingItem = z.infer<typeof billingItemSchema>;
export const invoiceSchema = z.object({
  id, clientId: id, clientName: name, createdOn: date, canceled: z.boolean().default(false),
  kind: z.enum(["Produtos", "Serviços", "Legado"]).default("Legado"),
  orders: z.array(z.object({
    orderId: id, code: name, title: name, amount: money,
    allocation: z.object({ products: money, services: money }).optional(),
    items: z.array(billingItemSchema).min(1).max(200).optional(),
  })).min(1),
  amount: money.refine((value) => value > 0),
});
export const financeSchema = z.object({
  accounts: z.array(bankAccountSchema).default([]),
  entries: z.array(financeEntrySchema).default([]),
  invoices: z.array(invoiceSchema).default([]),
  management: financeManagementSchema.optional(),
  banking: bankingSchema.optional(),
  transfers: z.array(financeTransferSchema).max(10000).optional(),
  recurrences: z.array(financeRecurrenceSchema).max(1000).optional(),
  purchasing: z.object({
    suppliers: z.array(supplierSchema).max(2000),
    orders: z.array(purchaseOrderSchema).max(5000),
  }).optional(),
});
export type BankAccount = z.infer<typeof bankAccountSchema>;
export type FinanceEntry = z.infer<typeof financeEntrySchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type Finance = z.infer<typeof financeSchema>;
export type FinanceManagement = z.infer<typeof financeManagementSchema>;
export type FinanceCategory = z.infer<typeof financeCategorySchema>;
export type CostCenter = z.infer<typeof costCenterSchema>;
export type FinanceClassification = z.infer<typeof financeClassificationSchema>;
export type OpeningBalance = z.infer<typeof openingBalanceSchema>;
export type FinanceTransfer = z.infer<typeof financeTransferSchema>;
export type FinanceRecurrence = z.infer<typeof financeRecurrenceSchema>;
export type Supplier = z.infer<typeof supplierSchema>;
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export const billingKinds = ["Produtos", "Serviços"] as const;
export type BillingKind = typeof billingKinds[number];
export type BillingTerms = Pick<FinanceEntry, "accountId" | "dueOn" | "paymentMethod">;

export function validateFinance(finance: Finance, clientIds: Set<string>, orderClients: Map<string, string>) {
  validatePurchases(finance);
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (![finance.accounts, finance.entries, finance.invoices].every((items) => unique(items.map((item) => item.id))))
    throw new Error("Identificadores financeiros duplicados.");
  const accounts = new Set(finance.accounts.map((item) => item.id));
  const recurrences = finance.recurrences ?? [];
  if (!unique(recurrences.map((item) => item.id))) throw new Error("Recorrências duplicadas.");
  for (const item of recurrences) {
    if (!accounts.has(item.accountId) || (item.clientId && !clientIds.has(item.clientId)) ||
      (item.kind === "Receber" && !item.clientId) ||
      (item.categoryId && !finance.management?.categories.some((category) => category.id === item.categoryId && category.kind === item.kind)) ||
      (item.costCenterId && !finance.management?.costCenters.some((center) => center.id === item.costCenterId)))
      throw new Error("Recorrência com banco, cliente ou classificação inválidos.");
  }
  const generated = new Set<string>();
  for (const entry of finance.entries) if (entry.recurrence) {
    const item = recurrences.find((item) => item.id === entry.recurrence!.id);
    const period = entry.recurrence.period;
    const offset = item ? (Number(period.slice(0, 4)) - Number(item.firstDueOn.slice(0, 4))) * 12 +
      Number(period.slice(5)) - Number(item.firstDueOn.slice(5, 7)) : -1;
    const dueOn = item && offset >= 0 ? monthlyDueDate(item.firstDueOn, offset) : "";
    const key = JSON.stringify([entry.recurrence.id, period]);
    if (!item || !dueOn || dueOn > item.endsOn || generated.has(key) || entry.dueOn !== dueOn ||
      entry.kind !== item.kind || entry.amount !== item.amount || entry.party !== item.party ||
      entry.clientId !== item.clientId || entry.accountId !== item.accountId || entry.paymentMethod !== item.paymentMethod ||
      entry.description !== item.description || entry.invoiceId || entry.retention || entry.installment || entry.purchaseId)
      throw new Error("Conta recorrente com período duplicado ou origem, vigência ou valores incompatíveis.");
    generated.add(key);
  }
  const plans = new Map<string, FinanceEntry[]>();
  for (const entry of finance.entries) if (entry.installment) {
    const items = plans.get(entry.installment.planId) ?? [];
    items.push(entry); plans.set(entry.installment.planId, items);
  }
  for (const items of plans.values()) {
    items.sort((a, b) => a.installment!.number - b.installment!.number);
    const first = items[0], plan = first.installment!;
    if (items.length !== plan.count || plan.total < plan.count || items.some((entry, index) => {
      const link = entry.installment!;
      return link.number !== index + 1 || link.count !== plan.count || link.total !== plan.total ||
        entry.invoiceId !== undefined || entry.retention !== undefined || entry.kind !== first.kind || entry.party !== first.party ||
        entry.clientId !== first.clientId || entry.accountId !== first.accountId || entry.paymentMethod !== first.paymentMethod ||
        entry.description !== first.description || entry.issuedOn !== first.issuedOn || entry.dueOn < entry.issuedOn ||
        (index > 0 && entry.dueOn <= items[index - 1].dueOn) ||
        entry.amount !== Math.floor(plan.total / plan.count) + (index < plan.total % plan.count ? 1 : 0);
    })) throw new Error("Parcelamento incompleto ou com valores, datas ou vínculos inconsistentes.");
  }
  if (finance.transfers && (!unique(finance.transfers.map((item) => item.id)) ||
    finance.transfers.some((item) => !accounts.has(item.fromAccountId) || !accounts.has(item.toAccountId))))
    throw new Error("Transferências com identificadores duplicados ou contas inválidas.");
  const billed = new Map<string, Invoice["kind"][]>();
  const allocations = new Map<string, { products: number; services: number }>();
  for (const invoice of finance.invoices) {
    for (const order of invoice.orders) if (order.items) {
      if (!unique(order.items.map((item) => item.id)) || invoice.kind === "Legado" ||
        order.items.some((item) => item.kind !== (invoice.kind === "Produtos" ? "produto" : "servico")) ||
        order.items.reduce((sum, item) => sum + item.gross - item.itemDiscount - item.orderDiscount, 0) !== order.amount)
        throw new Error("Snapshot dos itens diverge do faturamento.");
    }
    if (!clientIds.has(invoice.clientId) || !unique(invoice.orders.map((item) => item.orderId)) ||
      invoice.orders.some((item) => !orderClients.has(item.orderId) || (!invoice.canceled && orderClients.get(item.orderId) !== invoice.clientId)) ||
      invoice.amount !== invoice.orders.reduce((sum, item) => sum + item.amount, 0) ||
      (invoice.kind !== "Legado" && invoice.orders.some((item) => item.amount <= 0 || !item.allocation ||
        item.amount !== (invoice.kind === "Produtos" ? item.allocation.products : item.allocation.services))))
      throw new Error("Faturamento com referências ou total inválidos.");
    const entries = finance.entries.filter((item) => item.invoiceId === invoice.id);
    if (entries.length !== 1 || entries[0].kind !== "Receber" || entries[0].clientId !== invoice.clientId ||
      entries[0].amount !== invoice.amount || entries[0].canceled !== invoice.canceled ||
      (invoice.kind !== "Legado" && entries[0].paymentMethod !== "Boleto" && entries[0].paymentMethod !== "Pix"))
      throw new Error("Faturamento sem conta a receber correspondente.");
    if (!invoice.canceled) for (const item of invoice.orders) {
      const kinds = billed.get(item.orderId) ?? [];
      if (kinds.includes(invoice.kind) || kinds.includes("Legado") || (invoice.kind === "Legado" && kinds.length))
        throw new Error("Esta parte da OS já está vinculada a outro faturamento.");
      billed.set(item.orderId, [...kinds, invoice.kind]);
      if (item.allocation) {
        const allocation = allocations.get(item.orderId);
        if (allocation && (allocation.products !== item.allocation.products || allocation.services !== item.allocation.services))
          throw new Error("Rateio divergente entre produtos e serviços da OS.");
        allocations.set(item.orderId, item.allocation);
      }
    }
  }
  for (const entry of finance.entries) {
    if ((entry.invoiceId || entry.retention) && entry.settlements.some((item) => item.adjustment))
      throw new Error("Ajustes de baixa estão disponíveis somente para contas manuais sem retenções ou faturamento de OS.");
    if (entry.retention && (entry.kind !== "Receber" || !entry.invoiceId || entry.retention.invoiceAmount !== entry.amount ||
      !finance.invoices.some((invoice) => invoice.id === entry.invoiceId && invoice.kind === "Serviços")))
      throw new Error("Retenções exigem conta a receber de serviços com valor bruto preservado.");
    if (!accounts.has(entry.accountId) || (entry.clientId && !clientIds.has(entry.clientId)) ||
      (entry.invoiceId && !finance.invoices.some((item) => item.id === entry.invoiceId)) ||
      !unique(entry.settlements.map((item) => item.id)) ||
      entry.settlements.some((item) => !accounts.has(item.accountId)) ||
      entry.settlements.filter((item) => !item.reversed).reduce((sum, item) => sum + item.amount, 0) > entry.amount - (entry.retention?.withheld ?? 0) ||
      (entry.canceled && entry.settlements.some((item) => !item.reversed)))
      throw new Error("Conta financeira com referências ou baixas inválidas.");
  }
  if (finance.management) {
    const { categories, costCenters, classifications, openingBalances } = finance.management;
    if (!unique(categories.map((item) => item.id)) || !unique(costCenters.map((item) => item.id)) ||
      !unique(classifications.map((item) => item.entryId)) || !unique(openingBalances.map((item) => item.accountId)))
      throw new Error("Identificadores gerenciais duplicados.");
    for (const item of classifications) {
      const entry = finance.entries.find((entry) => entry.id === item.entryId);
      if (!entry || (item.categoryId && !categories.some((category) => category.id === item.categoryId && category.kind === entry.kind)) ||
        (item.costCenterId && !costCenters.some((center) => center.id === item.costCenterId)))
        throw new Error("Classificação gerencial com referências inválidas.");
    }
    if (openingBalances.some((item) => !accounts.has(item.accountId)))
      throw new Error("Saldo inicial com conta bancária inválida.");
  }
  if (finance.banking) {
    const { transactions, matches } = finance.banking;
    if (!unique(transactions.map((item) => item.id)) || !unique(matches.map((item) => item.id)) ||
      !unique(transactions.map((item) => JSON.stringify([item.accountId, item.externalId]))) ||
      transactions.some((item) => !accounts.has(item.accountId)))
      throw new Error("Movimentos de extrato duplicados ou com banco inválido.");
    const matchedTransactions = new Set<string>(), matchedSettlements = new Set<string>();
    for (const match of matches) {
      const transaction = transactions.find((item) => item.id === match.transactionId);
      const entry = finance.entries.find((item) => item.id === match.entryId);
      const settlement = entry?.settlements.find((item) => item.id === match.settlementId);
      if (!transaction || !entry || !settlement || settlement.accountId !== transaction.accountId ||
        settlement.date !== transaction.date || settlementCashAmount(settlement) !== Math.abs(transaction.amount) ||
        entry.kind !== (transaction.amount > 0 ? "Receber" : "Pagar"))
        throw new Error("Vínculo de conciliação incompatível com o extrato e a baixa.");
      if (!match.reversed && !settlement.reversed && !entry.canceled) {
        const key = JSON.stringify([entry.id, settlement.id]);
        if (matchedTransactions.has(transaction.id) || matchedSettlements.has(key))
          throw new Error("Movimento ou baixa já conciliado.");
        matchedTransactions.add(transaction.id); matchedSettlements.add(key);
      }
    }
    const transferMatches = finance.banking.transferMatches ?? [];
    if (!unique(transferMatches.map((item) => item.id))) throw new Error("Vínculos de transferência duplicados.");
    const matchedLegs = new Set<string>();
    for (const match of transferMatches) {
      const transaction = transactions.find((item) => item.id === match.transactionId);
      const transfer = finance.transfers?.find((item) => item.id === match.transferId);
      const outgoing = match.leg === "outgoing";
      if (!transaction || !transfer || transaction.accountId !== (outgoing ? transfer.fromAccountId : transfer.toAccountId) ||
        transaction.date !== transfer.date || transaction.amount !== (outgoing ? -transfer.amount : transfer.amount))
        throw new Error("Vínculo de transferência incompatível com conta, data, sinal ou valor do extrato.");
      if (!match.reversed && !transfer.reversal) {
        const key = JSON.stringify([transfer.id, match.leg]);
        if (matchedTransactions.has(transaction.id) || matchedLegs.has(key))
          throw new Error("Movimento ou ponta de transferência já conciliado.");
        matchedTransactions.add(transaction.id); matchedLegs.add(key);
      }
    }
  }
}
