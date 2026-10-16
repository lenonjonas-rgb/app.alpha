import { z } from "zod";
import { fiscalRetentionSchema } from "./fiscalRetentions";

const id = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(1000);
const money = z.number().int().nonnegative().max(100_000_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Data inválida.");

export const bankAccountSchema = z.object({
  id, name, bank: name, agency: z.string().trim().max(100), account: z.string().trim().max(100),
  kind: z.enum(["Corrente", "Poupança", "Caixa"]), active: z.boolean(),
});
export const financeEntrySchema = z.object({
  id, kind: z.enum(["Receber", "Pagar"]), party: name, clientId: id.optional(),
  description: name, amount: money.refine((value) => value > 0, "Informe um valor maior que zero."),
  issuedOn: date, dueOn: date, accountId: id,
  paymentMethod: z.enum(["Pix", "Boleto", "Transferência", "Dinheiro", "Cartão", "Outro"]),
  invoiceId: id.optional(), canceled: z.boolean().default(false),
  retention: fiscalRetentionSchema.optional(),
  settlements: z.array(z.object({ id, date, amount: money.refine((value) => value > 0), accountId: id, reversed: z.boolean().default(false) })).default([]),
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
});
export type BankAccount = z.infer<typeof bankAccountSchema>;
export type FinanceEntry = z.infer<typeof financeEntrySchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type Finance = z.infer<typeof financeSchema>;
export const billingKinds = ["Produtos", "Serviços"] as const;
export type BillingKind = typeof billingKinds[number];
export type BillingTerms = Pick<FinanceEntry, "accountId" | "dueOn" | "paymentMethod">;

export function validateFinance(finance: Finance, clientIds: Set<string>, orderClients: Map<string, string>) {
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (![finance.accounts, finance.entries, finance.invoices].every((items) => unique(items.map((item) => item.id))))
    throw new Error("Identificadores financeiros duplicados.");
  const accounts = new Set(finance.accounts.map((item) => item.id));
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
}
