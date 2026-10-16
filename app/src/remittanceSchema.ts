import { z } from "zod";

export const remittanceHistorySchema = z.array(z.object({
  id: z.string(), accountId: z.string(), fileSequence: z.number(), entryIds: z.array(z.string()), createdAt: z.string(), notice: z.string(),
  entries: z.array(z.object({ entryId: z.string(), amount: z.number().int().positive().optional(),
    fiscalKind: z.enum(["nfe", "nfse"]).optional(), fiscalDocumentId: z.string().optional(),
    fiscalAccessKey: z.string().optional(), fiscalProtocol: z.string().optional(), fiscalCheckId: z.string().optional(),
  }).superRefine((entry, context) => {
    if (entry.fiscalDocumentId && (!entry.fiscalKind || !entry.fiscalAccessKey || !entry.fiscalCheckId || entry.amount === undefined ||
      (entry.fiscalKind === "nfe" && !entry.fiscalProtocol)))
      context.addIssue({ code: "custom", message: "Vínculo fiscal incompleto no histórico da remessa." });
  })).optional(),
}));
