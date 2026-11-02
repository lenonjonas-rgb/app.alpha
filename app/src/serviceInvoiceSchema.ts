import { z } from "zod";
import { installmentSchema, nfeGovernmentPurchases } from "./outgoingInvoiceSchema";

const id = z.string().min(1);
const cents = z.number().int().nonnegative().max(100_000_000);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rate = z.number().min(0).max(100).default(0);

export const nfseStatuses = ["Pendente", "Emitida", "Cancelada"] as const;
export const nfseOperationNatures = [
  ["1", "1 - Tributação no município"],
  ["2", "2 - Tributação fora do município"],
  ["3", "3 - Isenção"],
  ["4", "4 - Imune"],
  ["5", "5 - Exigibilidade suspensa por decisão judicial"],
  ["6", "6 - Exigibilidade suspensa por procedimento administrativo"],
] as const;
export const nfseOperationTypes = [
  ["", "Não informar"],
  ["1", "Fornecimento com pagamento posterior"],
  ["2", "Recebimento do pagamento com fornecimento já realizado"],
  ["3", "Fornecimento e recebimento do pagamento concomitantes"],
] as const;
export const nfseConsumptionIndicators = [
  ["", "Não informar"],
  ["0", "Não (B2B)"],
  ["1", "Sim (consumidor final)"],
] as const;
export const nfseIrModes = [
  ["config", "Padrão da configuração da NFS-e"],
  ["yes", "Sim"],
  ["no", "Não"],
] as const;
export { nfeGovernmentPurchases as nfseGovernmentPurchases };

// Alíquotas fixas de retenção aplicadas pelo Bling na NFS-e.
export const NFSE_INSS_RATE = 11;
export const NFSE_PIS_RATE = 0.65;
export const NFSE_COFINS_RATE = 3;
export const NFSE_CSLL_RATE = 1;

const code = <T extends readonly (readonly [string, string])[]>(items: T) =>
  z.enum(items.map(([value]) => value) as [T[number][0], ...T[number][0][]]);

export const serviceInvoiceSchema = z.object({
  id,
  status: z.enum(nfseStatuses),
  rpsNumber: z.number().int().positive().max(999_999_999),
  rpsSeries: z.string().trim().min(1, "Informe a série do RPS.").max(5),
  nfseNumber: optionalText(30),
  issueDate: day,
  operationNature: code(nfseOperationNatures).default("1"),
  recipient: z.object({
    clientId: optionalText(200),
    name: z.string().trim().min(1, "Informe o cliente.").max(160),
    document: optionalText(20),
    stateRegistration: optionalText(30),
    municipalRegistration: optionalText(30),
    governmentPurchase: code(nfeGovernmentPurchases).default(""),
    operationType: code(nfseOperationTypes).default(""),
    consumptionIndicator: code(nfseConsumptionIndicators).default(""),
    postalCode: optionalText(9),
    state: optionalText(2),
    city: optionalText(80),
    district: optionalText(80),
    street: optionalText(160),
    number: optionalText(20),
    complement: optionalText(80),
    phone: optionalText(40),
    email: optionalText(254),
    serviceState: optionalText(2),
    serviceCity: optionalText(80),
  }),
  service: z.object({
    description: z.string().trim().min(1, "Informe a descrição do serviço.").max(2000),
    amount: cents.refine((value) => value > 0, "Informe o valor do serviço."),
    taxSet: optionalText(160),
    nationalCode: optionalText(20),
    municipalCode: optionalText(20),
    nbs: optionalText(20),
    operationIndicator: optionalText(20),
    cst: optionalText(80),
    classification: optionalText(120),
  }),
  taxes: z.object({
    irRate: rate,
    issRate: rate,
    retainIss: z.boolean().default(false),
    discountIss: z.boolean().default(false),
    retainInss: z.boolean().default(false),
    retainFederal: z.boolean().default(false),
    ibptRate: rate,
  }).prefault({}),
  discount: cents.default(0),
  seller: optionalText(160),
  commissionRate: rate,
  payment: z.object({
    terms: optionalText(120),
    category: optionalText(120),
    installments: z.array(installmentSchema).max(120).default([]),
  }).prefault({}),
  complementary: optionalText(5000),
  salesOrderId: optionalText(200),
  serviceOrderId: optionalText(200),
  contractChargeId: optionalText(200),
  invoiceId: optionalText(200),
  entryIds: z.array(id).max(120).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  events: z.array(z.object({ at: z.iso.datetime(), description: z.string().trim().min(1).max(500) })).min(1).max(500),
}).superRefine((invoice, context) => {
  if (invoice.discount > invoice.service.amount)
    context.addIssue({ code: "custom", path: ["discount"], message: "O desconto não pode ser maior que o valor do serviço." });
  if (new Set(invoice.payment.installments.map((item) => item.id)).size !== invoice.payment.installments.length)
    context.addIssue({ code: "custom", path: ["payment"], message: "Parcelas da nota repetidas." });
  if (invoice.status === "Emitida" && !invoice.nfseNumber)
    context.addIssue({ code: "custom", path: ["nfseNumber"], message: "Informe o número da NFS-e emitida." });
});

export type ServiceInvoice = z.infer<typeof serviceInvoiceSchema>;
