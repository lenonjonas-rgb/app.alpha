import { z } from "zod";

const money = z.number().int().nonnegative().max(100_000_000);
export const fiscalRetentionSchema = z.object({
  calculationId: z.string().regex(/^[a-f0-9]{64}$/), invoiceAmount: money, withheld: money, net: money,
  irrf: money, inss: money, csll: money, confirmedAt: z.iso.datetime(), confirmedBy: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.withheld <= 0 || value.withheld !== value.irrf + value.inss + value.csll ||
    value.net <= 0 || value.net + value.withheld !== value.invoiceAmount)
    context.addIssue({ code: "custom", message: "Conciliação de retenções inconsistente." });
});
export const retentionClearSchema = z.object({ entryId: z.string().min(1), calculationId: z.string().regex(/^[a-f0-9]{64}$/) });
export const retentionConfirmationSchema = z.object({ invoiceId: z.string(), entryId: z.string(), retention: fiscalRetentionSchema });
