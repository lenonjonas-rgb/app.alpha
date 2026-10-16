import { z } from "zod";

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const nfseCheckSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), documentId: z.string(), invoiceId: z.string(), entryId: z.string(),
  environment: z.enum(["producao", "homologacao"]), accessKey: z.string().regex(/^\d{50}$/), calculationId: z.string(),
  actual: z.object({ invoiceAmount: money, withheld: money, net: money, iss: money, issBase: money, irrf: money, inss: money, csll: money,
    rtcBase: money.nullable(), ibsState: money.nullable(), ibsMunicipal: money.nullable(), ibsTotal: money.nullable(), cbs: money.nullable(), total: money.nullable() }),
  differences: z.array(z.string()), matches: z.boolean(), confirmedAt: z.string().optional(), confirmedBy: z.string().optional(),
}).superRefine((value, context) => {
  if (value.matches !== (value.differences.length === 0))
    context.addIssue({ code: "custom", message: "Resultado da conferência inconsistente." });
});
