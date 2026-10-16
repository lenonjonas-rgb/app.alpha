import { z } from "zod";
import { fiscalTaxParametersSchema } from "./fiscalTaxParameters";

export const fiscalMatrixSchema = z.object({
  id: z.string(), name: z.string(), kind: z.enum(["nfe", "nfse"]), operation: z.string(), ruleId: z.string(),
  validFrom: z.string(), validUntil: z.string(), destinationState: z.string(), ieIndicator: z.enum(["1", "2", "9"]),
  finalConsumer: z.boolean(), active: z.boolean(), reviewed: z.boolean(), approval: z.string(), updatedAt: z.string(),
  ruleSnapshot: z.object({ reviewed: z.boolean(), scope: z.string(), fields: z.record(z.string(), z.string()) }),
  parameters: fiscalTaxParametersSchema.optional(),
});
export type FiscalMatrixRecord = z.infer<typeof fiscalMatrixSchema>;
