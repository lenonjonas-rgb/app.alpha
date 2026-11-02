import { z } from "zod";

const id = z.string().min(1);
const cents = z.number().int().nonnegative().max(100_000_000);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido.");

export const contractPeriodicities = [
  ["Mensal", 1], ["Bimestral", 2], ["Trimestral", 3], ["Semestral", 6], ["Anual", 12], ["Bianual", 24], ["Trianual", 36],
] as const;
export const contractDueRules = [
  ["0", "No mês corrente"],
  ["1", "No mês seguinte"],
  ["2", "Em dois meses"],
] as const;
export const contractPeriodPrints = [
  ["none", "Não imprime"],
  ["current", "Mês atual"],
  ["previous", "Mês anterior"],
] as const;
export const contractMaintenanceTypes = ["Valor", "Indexação"] as const;

const code = <T extends readonly (readonly [string, string])[]>(items: T) =>
  z.enum(items.map(([value]) => value) as [T[number][0], ...T[number][0][]]);

/** Dados de cobrança do contrato, no padrão de Contratos do Bling. */
export const contractBillingSchema = z.object({
  number: optionalText(40),
  billingClientId: optionalText(200),
  contractDate: z.union([z.literal(""), day]).default(""),
  baseDate: z.union([z.literal(""), day]).default(""),
  periodicity: z.enum(contractPeriodicities.map(([value]) => value) as [string, ...string[]]).default("Mensal"),
  dueRule: code(contractDueRules).default("0"),
  dueDay: z.number().int().min(1).max(31).default(10),
  periodPrint: code(contractPeriodPrints).default("none"),
  maintenanceType: z.enum(contractMaintenanceTypes).default("Valor"),
  category: optionalText(120),
  paymentMethod: z.enum(["Boleto", "Pix"]).default("Boleto"),
  accountId: optionalText(200),
  discountRate: z.number().min(0).max(100).default(0),
  discountAmount: cents.default(0),
  discountUntil: z.union([z.literal(""), month]).default(""),
  seller: optionalText(160),
  commissionInstallments: z.number().int().min(0).max(999).default(0),
  commissionRate: z.number().min(0).max(100).default(0),
  generateServiceOrder: z.boolean().default(false),
  generateNfse: z.boolean().default(false),
  issRate: z.number().min(0).max(100).default(0),
  discountIss: z.boolean().default(false),
  irMode: z.enum(["config", "yes", "no"]).default("config"),
  serviceCode: optionalText(20),
  nfseDescription: optionalText(2000),
  notes: optionalText(2000),
});

export const contractChargeSchema = z.object({
  id,
  contractId: id,
  clientId: id,
  period: month,
  dueOn: day,
  amount: cents.refine((value) => value > 0),
  discount: cents.default(0),
  entryId: id,
  serviceInvoiceId: optionalText(200),
  serviceOrderId: optionalText(200),
  createdAt: z.iso.datetime(),
});

export type ContractBilling = z.infer<typeof contractBillingSchema>;
export const contractBilling = (billing: Partial<ContractBilling> | undefined): ContractBilling => contractBillingSchema.parse(billing ?? {});
export type ContractCharge = z.infer<typeof contractChargeSchema>;
