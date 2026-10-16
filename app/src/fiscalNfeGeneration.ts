import { z } from "zod";

export const generatedNfeResponseSchema = z.object({ id: z.string(), key: z.string().regex(/^NFe\d{44}$/), status: z.literal("rascunho") });
export function nfeGenerationFromForm(form: FormData) {
  const integer = (name: string, min: number, max: number) =>
    z.number().int().min(min).max(max).parse(Number(z.string().regex(/^(?:0|[1-9]\d*)$/).parse(form.get(name))));
  const issuedAt = z.string().regex(/^2026-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/).parse(form.get("issuedAt"));
  const confirmed = (name: string) => z.literal("on").parse(form.get(name)) === "on";
  return { invoiceId: z.string().min(1).parse(form.get("invoiceId")), environment: "homologacao" as const,
    series: integer("series", 0, 889), expectedNumber: integer("expectedNumber", 1, 999999999),
    issuedAt: `${issuedAt.length === 16 ? `${issuedAt}:00` : issuedAt}-03:00`,
    nature: z.string().trim().min(1).max(60).parse(form.get("nature")),
    presence: z.enum(["0", "1"]).parse(form.get("presence")), paymentTiming: z.enum(["0", "1"]).parse(form.get("paymentTiming")),
    confirmNoGtin: confirmed("confirmNoGtin"), confirmNoFreight: confirmed("confirmNoFreight"), confirmScope: confirmed("confirmScope") };
}
