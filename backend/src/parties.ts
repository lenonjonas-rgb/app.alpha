import { z } from "zod";
import { addressSchema, documentSchema } from "./identification.js";
import type { CompanyData, Context } from "./auth.js";
import type { Store } from "./store.js";
import { requireValue } from "./errors.js";

export const recipientSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  document: documentSchema,
  name: z.string().trim().min(1).max(60),
  address: addressSchema,
  ieIndicator: z.enum(["1", "2", "9"]),
  ie: z.string().regex(/^\d{2,14}$|^$/),
  im: z.string().trim().max(30),
  finalConsumer: z.boolean(),
  email: z.union([z.literal(""), z.email().max(80)]),
  phone: z.string().regex(/^\d{6,14}$|^$/),
}).superRefine((party, context) => {
  if (party.ieIndicator === "1" && !party.ie)
    context.addIssue({ code: "custom", path: ["ie"], message: "Contribuinte do ICMS exige inscrição estadual." });
  if (party.ieIndicator !== "1" && party.ie)
    context.addIssue({ code: "custom", path: ["ie"], message: "Isento/não contribuinte não deve informar IE neste cadastro." });
  if (party.document.length === 11 && (party.ieIndicator !== "9" || !party.finalConsumer))
    context.addIssue({ code: "custom", message: "CPF contribuinte/produtor rural não suportado neste fluxo. Para CPF, use não contribuinte e consumidor final." });
});
export type Recipient = z.infer<typeof recipientSchema> & { updatedAt: string; updatedBy: string };
export class FiscalParties {
  constructor(private store: Store) {}
  list(context: Context) { return this.store.list<Recipient>(context.tenant, "fiscalRecipients"); }
  save(context: Context, company: CompanyData, input: unknown) {
    const party = recipientSchema.parse(input);
    const client = company.clients.find((item) => item.id === party.clientId);
    requireValue(client, "Cliente não encontrado na empresa. Aguarde Sincronizado.", 422);
    requireValue(/^[\d./\-\s]+$/.test(client.document) && client.document.replace(/\D/g, "") === party.document,
      "Documento fiscal diferente do cadastro do cliente na nuvem. Corrija o cliente e aguarde Sincronizado.", 422);
    const saved: Recipient = { ...party, updatedAt: new Date().toISOString(), updatedBy: context.actor };
    this.store.put(context.tenant, "fiscalRecipients", party.clientId, saved);
    this.store.audit(context.tenant, context.actor, "recipient.save", party.clientId);
    return saved;
  }
}
