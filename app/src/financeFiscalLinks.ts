import { z } from "zod";

export const financeFiscalLinkSchema = z.object({
  entryId: z.string(), invoiceId: z.string().optional(),
  documents: z.array(z.object({ id: z.string(), kind: z.enum(["nfe", "nfse"]), environment: z.enum(["homologacao", "producao"]),
    status: z.enum(["rascunho", "enviando", "incerto", "processando", "autorizado", "rejeitado", "cancelado"]),
    key: z.string(), accessKey: z.string().optional(), protocol: z.string().optional(), message: z.string().optional() })),
  remittances: z.array(z.object({ id: z.string(), createdAt: z.string(), fileSequence: z.number().int().positive() })),
  cancellationPending: z.boolean(), cancellationAllowed: z.boolean(), reasons: z.array(z.string()),
});
export const financeFiscalLinksSchema = z.object({ checkedAt: z.iso.datetime(), entries: z.array(financeFiscalLinkSchema) });
export const financeCancellationSchema = z.object({ id: z.uuid(), entryId: z.string(), invoiceId: z.string().optional(), confirmedAt: z.iso.datetime() });
