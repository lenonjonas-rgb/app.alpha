import { z } from "zod";

export const fiscalNumberingSchema = z.object({
  cnpj: z.string(), environment: z.enum(["homologacao", "producao"]), series: z.number().int(),
  nextNumber: z.number().int(), updatedAt: z.string(), updatedBy: z.string(),
});
export const fiscalNumberReservationSchema = z.object({
  cnpj: z.string(), environment: z.enum(["homologacao", "producao"]), series: z.number().int(),
  number: z.number().int(), invoiceId: z.string(), documentId: z.string(), createdAt: z.string(),
});
export type FiscalNumberingRecord = z.infer<typeof fiscalNumberingSchema>;
export type FiscalNumberReservation = z.infer<typeof fiscalNumberReservationSchema>;
export function numberingFromForm(form: FormData, records: FiscalNumberingRecord[], model: "nfe" | "nfse" = "nfe") {
  const environment = z.enum(["homologacao", "producao"]).parse(form.get("environment"));
  const integer = (name: string, min: number, max: number) => {
    const text = z.string().regex(/^(?:0|[1-9]\d*)$/, "Informe número inteiro sem zeros à esquerda.").parse(form.get(name));
    return z.number().int().min(min).max(max).parse(Number(text));
  };
  const series = integer("series", model === "nfe" ? 0 : 1, model === "nfe" ? 889 : 49999);
  const nextNumber = integer("nextNumber", 1, model === "nfe" ? 999999999 : 999999999999999);
  const confirmation = z.literal("on").parse(form.get("confirmation"));
  return { environment, series, nextNumber, expectedNextNumber: records.find((record) => record.environment === environment && record.series === series)?.nextNumber ?? null,
    confirmation: confirmation === "on" };
}
