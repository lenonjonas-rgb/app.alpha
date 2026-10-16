import { z } from "zod";
const nfeFiscalEventSchema = z.object({
  id: z.string(), documentId: z.string(), type: z.literal("110111"), environment: z.string(),
  justification: z.string(), createdAt: z.string(), status: z.enum(["enviando", "incerto", "registrado", "rejeitado", "cancelamento_confirmado"]),
  protocol: z.string().optional(), message: z.string().optional(),
});
const nfseFiscalEventSchema = z.object({
  id: z.string(), model: z.literal("nfse"), documentId: z.string(), type: z.literal("101101"), environment: z.string(),
  reasonCode: z.enum(["1", "2", "9"]), justification: z.string(), createdAt: z.string(),
  status: z.enum(["enviando", "incerto", "registrado", "rejeitado", "cancelamento_confirmado"]),
  message: z.string().optional(),
});
export const fiscalEventSchema = z.union([nfeFiscalEventSchema, nfseFiscalEventSchema]);
export function nfeCancellationFromForm(form: FormData, key: string) {
  const confirmation = String(form.get("confirmation") ?? "").trim();
  const justification = String(form.get("justification") ?? "").trim();
  if (!/^\d{44}$/.test(confirmation) || confirmation !== key.replace(/^NFe/, "")) throw new Error("Confirme a chave completa da NF-e.");
  if (justification.length < 15 || justification.length > 255 ||
    Array.from(justification).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new Error("Informe uma justificativa de 15 a 255 caracteres, sem quebras de linha.");
  if (["noCirculation", "noService", "noBookEntry"].some((name) => form.get(name) !== "on"))
    throw new Error("Confirme todas as condições legais antes de solicitar cancelamento.");
  return { confirmation, justification, noCirculation: true, noService: true, noBookEntry: true };
}

export function nfseCancellationFromForm(form: FormData, key: string) {
  const confirmation = String(form.get("confirmation") ?? "").trim();
  const reasonCode = String(form.get("reasonCode") ?? "").trim();
  const justification = String(form.get("justification") ?? "").trim();
  if (!/^\d{50}$/.test(key) || confirmation !== key)
    throw new Error("Confirme a chave de acesso completa da NFS-e.");
  if (!["1", "2", "9"].includes(reasonCode))
    throw new Error("Selecione um motivo de cancelamento válido.");
  if (justification.length < 15 || justification.length > 255 ||
    Array.from(justification).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new Error("Informe uma justificativa de 15 a 255 caracteres, sem quebras de linha.");
  return { confirmation, reasonCode, justification };
}
