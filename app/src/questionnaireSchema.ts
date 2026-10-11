import { z } from "zod";

const text = z.string().trim().min(1).max(1000);
export const orderTypes = ["Corretiva", "Preventiva", "Instalacao", "Visita tecnica"] as const;
export const questionKinds = ["Texto", "Area de texto", "Numero", "Escolha", "Multipla escolha", "Check", "Data", "Hora", "Monetaria", "CPF/CNPJ", "Foto", "Assinatura"] as const;
export const signatureSchema = z.object({
  signer: text,
  image: z.string().max(800000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
  at: z.iso.datetime(),
});
export const questionDefinitionSchema = z.object({
  id: z.string().min(1),
  label: text,
  kind: z.enum(questionKinds),
  required: z.boolean(),
  options: z.array(text).default([]),
  description: z.string().max(3000).optional(),
  photoMetadata: z.boolean().optional(),
});
export const questionnaireDisplaySchema = z.object({
  showOnOrder: z.boolean().default(true),
  columns: z.number().int().min(1).max(4).default(1),
  inlineAnswers: z.boolean().default(false),
  showUnanswered: z.boolean().default(true),
  equipment: z.boolean().default(false),
});
export const questionnaireTemplateSchema = z.object({
  id: z.string().min(1),
  title: text,
  revision: z.number().int().positive(),
  archived: z.boolean().default(false),
  header: z.string().max(10000).default(""),
  footer: z.string().max(10000).default(""),
  display: questionnaireDisplaySchema,
  questions: z.array(questionDefinitionSchema).min(1).max(200),
});
export const orderTypeQuestionnaireSchema = z.object({
  type: z.enum(orderTypes),
  questionnaireId: z.string().default(""),
  required: z.boolean().default(false),
});
export type QuestionnaireTemplate = z.infer<typeof questionnaireTemplateSchema>;
export type QuestionDefinition = z.infer<typeof questionDefinitionSchema>;
