import { z } from "zod";
import type { BillingItem, Finance } from "./financeSchema";

const id = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(160);
const basisPoints = z.number().int().min(0).max(10000);
const money = z.number().int().nonnegative().max(100_000_000);
export const commissionRuleSchema = z.object({
  release: z.enum(["proportional", "billing", "first", "last"]),
  calculation: z.discriminatedUnion("type", [
    z.object({ type: z.literal("fixed"), rate: basisPoints }),
    z.object({ type: z.literal("discount"), tiers: z.array(z.object({ upTo: basisPoints, rate: basisPoints })).min(1).max(20) }),
  ]),
}).superRefine((rule, context) => {
  if (rule.calculation.type === "discount") {
    const tiers = rule.calculation.tiers;
    if (tiers.at(-1)?.upTo !== 10000 || tiers.some((tier, index) => index > 0 && tier.upTo <= tiers[index - 1].upTo))
      context.addIssue({ code: "custom", message: "As faixas devem crescer e terminar em 100% de desconto." });
  }
});
export const commissionSellerSchema = z.object({ id, name, active: z.boolean(), rule: commissionRuleSchema });
const commissionItemSchema = z.object({
  id: z.string().min(1).max(400), name: z.string().trim().min(1).max(1000),
  gross: money, discount: money, base: money, rate: basisPoints, amount: money,
});
export const commissionRecordSchema = z.object({
  id, invoiceId: id, orderId: id, sellerId: id, sellerName: name, rule: commissionRuleSchema,
  items: z.array(commissionItemSchema).min(1).max(200), base: money, amount: money, createdAt: z.iso.datetime(),
});
export const commissionsSchema = z.object({
  sellers: z.array(commissionSellerSchema).max(2000),
  records: z.array(commissionRecordSchema).max(50000),
});
export type CommissionRule = z.infer<typeof commissionRuleSchema>;
export type CommissionSeller = z.infer<typeof commissionSellerSchema>;
export type CommissionRecord = z.infer<typeof commissionRecordSchema>;

export function calculateCommissionItems(items: BillingItem[], rule: CommissionRule) {
  return items.filter((item) => item.source === "item").map((item) => {
    const discount = item.itemDiscount + item.orderDiscount, base = item.gross - discount;
    const rate = rule.calculation.type === "fixed" ? rule.calculation.rate :
      rule.calculation.tiers.find((tier) => item.gross === 0 ||
        BigInt(discount) * 10000n <= BigInt(item.gross) * BigInt(tier.upTo))!.rate;
    const amount = Number((BigInt(base) * BigInt(rate) + 5000n) / 10000n);
    return { id: item.id, name: item.name, gross: item.gross, discount, base, rate, amount };
  });
}

export function validateCommissionHistory(finance: Finance) {
  if (!finance.commissions) return;
  const { sellers, records } = finance.commissions;
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(sellers.map((item) => item.id)) || !unique(sellers.map((item) => item.name.toLocaleLowerCase("pt-BR"))) ||
    !unique(records.map((item) => item.id)) || !unique(records.map((item) => JSON.stringify([item.invoiceId, item.orderId]))))
    throw new Error("Vendedores ou comissões duplicados.");
  for (const record of records) {
    const invoice = finance.invoices.find((item) => item.id === record.invoiceId);
    const order = invoice?.orders.find((item) => item.orderId === record.orderId);
    if (!invoice || !order?.items || !sellers.some((seller) => seller.id === record.sellerId))
      throw new Error("Comissão sem vendedor ou itens de faturamento correspondentes.");
    const expected = calculateCommissionItems(order.items, record.rule);
    if (!expected.length || JSON.stringify(record.items) !== JSON.stringify(expected) ||
      record.base !== expected.reduce((sum, item) => sum + item.base, 0) ||
      record.amount !== expected.reduce((sum, item) => sum + item.amount, 0))
      throw new Error("Snapshot ou valores da comissão não correspondem aos itens e à regra.");
  }
}
