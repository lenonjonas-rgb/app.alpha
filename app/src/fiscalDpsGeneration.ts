import { z } from "zod";

export const generatedDpsResponseSchema = z.object({ id: z.string(), key: z.string().regex(/^DPS\d{42}$/), status: z.literal("rascunho") });
export function dpsGenerationFromForm(form: FormData) {
  const integer = (name: string, min: number, max: number) =>
    z.number().int().min(min).max(max).parse(Number(z.string().regex(/^(?:0|[1-9]\d*)$/).parse(form.get(name))));
  const local = z.string().regex(/^2026-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/).parse(form.get("issuedAt"));
  const issuedAt = z.iso.datetime({ offset: true }).parse(`${local.length === 16 ? `${local}:00` : local}-03:00`);
  const competence = z.iso.date().refine((value) => value.startsWith("2026-") && value <= issuedAt.slice(0, 10)).parse(form.get("competence"));
  const percent = (name: string) => z.string().regex(/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/).refine((value) => Number(value) <= 100)
    .parse(z.string().parse(form.get(name)).trim().replace(",", "."));
  const additionalServiceId = z.string().parse(form.get("additionalServiceId"));
  return {
    invoiceId: z.string().min(1).parse(form.get("invoiceId")), environment: "homologacao" as const,
    ...(additionalServiceId ? { additionalServiceId } : {}),
    series: integer("series", 1, 49999), expectedNumber: integer("expectedNumber", 1, 999999999999999),
    issuedAt, competence, operationIndicator: z.string().regex(/^\d{6}$/).parse(form.get("operationIndicator")),
    personalUse: z.enum(["0", "1"]).parse(form.get("personalUse")),
    totalTaxPercent: { federal: percent("totalFederal"), state: percent("totalState"), municipal: percent("totalMunicipal") },
    confirmScope: z.literal("on").parse(form.get("confirmScope")) === "on",
    confirmUnconditionalDiscount: z.literal("on").parse(form.get("confirmUnconditionalDiscount")) === "on",
    ...(form.get("confirmRetentions") === "on" ? { confirmRetentions: true as const } : {}),
  };
}
