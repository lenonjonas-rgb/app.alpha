import { z } from "zod";

export const reportSections = {
  company: "Dados da empresa",
  client: "Dados do cliente e endereço",
  schedule: "Agendamento, técnico e tipo de atendimento",
  instructions: "Orientações",
  report: "Relato técnico",
  equipment: "Equipamentos",
  questionnaires: "Questionários",
  pending: "Pendências",
  hours: "Controle de horas e localização",
  values: "Valores",
  quotes: "Orçamentos vinculados",
  photos: "Fotos",
  attachments: "Outros anexos",
  signature: "Assinaturas",
} as const;

export const reportSettingsSchema = z.object({
  layout: z.enum(["classic", "clean", "watermark"]).default("clean"),
  title: z.string().trim().min(1).max(120).default("Relatório de atendimento"),
  fontSize: z.enum(["small", "medium", "large"]).default("medium"),
  questionnaireOrder: z.enum(["task", "name", "equipment"]).default("task"),
  sections: z.object({
    company: z.boolean().default(true),
    client: z.boolean().default(true),
    schedule: z.boolean().default(true),
    instructions: z.boolean().default(true),
    report: z.boolean().default(true),
    equipment: z.boolean().default(true),
    questionnaires: z.boolean().default(true),
    pending: z.boolean().default(true),
    hours: z.boolean().default(true),
    values: z.boolean().default(true),
    quotes: z.boolean().default(true),
    photos: z.boolean().default(true),
    attachments: z.boolean().default(true),
    signature: z.boolean().default(true),
  }).prefault({}),
});

export type ReportSettings = z.infer<typeof reportSettingsSchema>;
