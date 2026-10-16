import { z } from "zod";

export const fiscalAddressSchema = z.object({
  street: z.string(), number: z.string(), complement: z.string(), district: z.string(), postalCode: z.string(),
  municipality: z.string(), city: z.string(), state: z.string(),
});
export const fiscalIssuerSchema = z.object({
  cnpj: z.string(), name: z.string(), ie: z.string(), im: z.string(),
  address: fiscalAddressSchema.optional(), email: z.string().optional(), phone: z.string().optional(),
});
export const fiscalRecipientSchema = z.object({
  clientId: z.string(), document: z.string(), name: z.string(), address: fiscalAddressSchema,
  ieIndicator: z.enum(["1", "2", "9"]), ie: z.string(), im: z.string(), finalConsumer: z.boolean(),
  email: z.string(), phone: z.string(), updatedAt: z.string(),
});
export type FiscalAddress = z.infer<typeof fiscalAddressSchema>;
export type FiscalRecipient = z.infer<typeof fiscalRecipientSchema>;
export function addressFromForm(form: FormData): FiscalAddress {
  return fiscalAddressSchema.parse(Object.fromEntries(
    ["street", "number", "complement", "district", "postalCode", "municipality", "city", "state"].map((key) => [key, form.get(key)]),
  ));
}
