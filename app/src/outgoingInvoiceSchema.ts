import { z } from "zod";

const id = z.string().min(1);
const cents = z.number().int().nonnegative().max(100_000_000);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDay = z.union([z.literal(""), day]).default("");

export const nfeOutputTypes = ["Emissão própria", "NF-e com DANFE Simplificado Tipo 2", "Exportação", "Importação de XML de saída"] as const;
export const nfeTaxRegimes = [
  ["1", "Simples nacional"],
  ["2", "Simples nacional - excesso de sublimite de receita bruta"],
  ["3", "Regime normal"],
  ["4", "MEI"],
] as const;
export const nfePurposes = [
  ["1", "NF-e normal"],
  ["2", "NF-e complementar"],
  ["3", "NF-e de ajuste"],
  ["4", "Devolução de mercadoria"],
  ["5", "Nota de crédito"],
  ["6", "Nota de débito"],
] as const;
export const nfePresenceIndicators = [
  ["0", "0 - Não se aplica"],
  ["1", "1 - Operação presencial"],
  ["2", "2 - Operação não presencial, pela Internet"],
  ["3", "3 - Operação não presencial, Teleatendimento"],
  ["4", "4 - NFC-e em operação com entrega a domicílio"],
  ["5", "5 - Operação presencial, fora do estabelecimento"],
  ["9", "9 - Operação não presencial, outros"],
] as const;
export const nfeGovernmentPurchases = [
  ["", "Não"],
  ["1", "1 - União"],
  ["2", "2 - Estado"],
  ["3", "3 - Distrito Federal"],
  ["4", "4 - Município"],
  ["5", "5 - Consórcio Público"],
  ["6", "6 - Comitê Gestor do IBS"],
] as const;
export const nfeFreightModes = [
  ["0", "0 - Contratação do Frete por conta do Remetente (CIF)"],
  ["1", "1 - Contratação do Frete por conta do Destinatário (FOB)"],
  ["2", "2 - Contratação do Frete por conta de Terceiros"],
  ["3", "3 - Transporte Próprio por conta do Remetente"],
  ["4", "4 - Transporte Próprio por conta do Destinatário"],
  ["9", "9 - Sem Ocorrência de Transporte"],
] as const;
export const nfePaymentMethods = ["Boleto", "Pix"] as const;

const code = <T extends readonly (readonly [string, string])[]>(items: T) =>
  z.enum(items.map(([value]) => value) as [T[number][0], ...T[number][0][]]);

export const nfeItemSchema = z.object({
  id,
  kind: z.enum(["produto", "servico"]).default("produto"),
  referenceId: optionalText(200),
  salesOrderLineId: optionalText(200),
  name: z.string().trim().min(1, "Informe a descrição do item.").max(120),
  code: optionalText(60),
  unit: optionalText(6),
  quantity: z.number().positive().max(1_000_000),
  price: cents,
  freight: cents.default(0),
  discount: cents.default(0),
  // Campos fiscais das abas do item (ICMS, IPI, PIS, COFINS, IBS, CBS...) em texto, com decimais com ponto.
  fields: z.record(z.string().max(80), z.string().max(2000)).default({}),
});

export const installmentSchema = z.object({
  id,
  days: z.number().int().min(0).max(3650),
  dueOn: day,
  amount: cents,
  method: z.enum(nfePaymentMethods).default("Boleto"),
  accountId: optionalText(200),
  paymentType: optionalText(80),
  authorization: optionalText(80),
  notes: optionalText(500),
});

const addressFields = {
  postalCode: optionalText(9),
  state: optionalText(2),
  city: optionalText(80),
  district: optionalText(80),
  street: optionalText(160),
  number: optionalText(20),
  complement: optionalText(80),
};

export const outgoingInvoiceSchema = z.object({
  id,
  kind: z.literal("nfe").default("nfe"),
  status: z.enum(["Pendente", "Cancelada"]),
  number: z.number().int().positive().max(999_999_999),
  series: z.string().regex(/^\d{1,3}$/, "Série inválida."),
  outputType: z.enum(nfeOutputTypes).default("Emissão própria"),
  store: optionalText(120),
  businessUnit: optionalText(120),
  operationNature: z.string().trim().min(1, "Informe a natureza da operação.").max(160),
  issueDate: day,
  exitDate: optionalDay,
  exitTime: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]).default(""),
  taxRegime: code(nfeTaxRegimes).default("1"),
  purpose: code(nfePurposes).default("1"),
  presence: code(nfePresenceIndicators).default("9"),
  recipient: z.object({
    clientId: optionalText(200),
    name: z.string().trim().min(1, "Informe o destinatário.").max(160),
    personType: z.enum(["J", "F", "E"]).default("J"),
    document: optionalText(20),
    stateRegistration: optionalText(30),
    seller: optionalText(160),
    finalConsumer: z.boolean().default(false),
    phone: optionalText(40),
    email: optionalText(254),
    governmentPurchase: code(nfeGovernmentPurchases).default(""),
    ...addressFields,
  }),
  items: z.array(nfeItemSchema).min(1, "Inclua pelo menos um item.").max(990),
  autoCalculation: z.boolean().default(true),
  retentions: z.object({
    minimum: cents.default(0), base: cents.default(0), ir: cents.default(0), csll: cents.default(0),
    pis: cents.default(0), cofins: cents.default(0), iss: cents.default(0),
  }).prefault({}),
  transport: z.object({
    mode: z.enum(["none", "logistics", "manual"]).default("none"),
    freightBy: code(nfeFreightModes).default("9"),
    logistics: optionalText(120),
    carrier: z.object({
      name: optionalText(160), plate: optionalText(10), plateState: optionalText(2), rntc: optionalText(30),
      document: optionalText(20), stateRegistration: optionalText(30), state: optionalText(2), city: optionalText(80),
      address: optionalText(200),
    }).prefault({}),
    volumes: z.object({
      quantity: optionalText(20), grossWeight: optionalText(20), netWeight: optionalText(20),
      numbering: optionalText(60), species: optionalText(60), brand: optionalText(60),
    }).prefault({}),
    differentDelivery: z.boolean().default(false),
    delivery: z.object({ name: optionalText(160), document: optionalText(20), ...addressFields }).prefault({}),
  }).prefault({}),
  payment: z.object({
    terms: optionalText(120),
    category: optionalText(120),
    installments: z.array(installmentSchema).max(120).default([]),
  }).prefault({}),
  xmlAuthorized: z.array(z.object({ name: optionalText(160), document: optionalText(20) })).max(10).default([]),
  additional: z.object({
    storeOrderNumber: optionalText(60), storeOrigin: optionalText(120), channel: optionalText(120),
    complementary: optionalText(5000), natureComplementary: optionalText(5000), fiscoInfo: optionalText(2000),
  }).prefault({}),
  salesOrderId: optionalText(200),
  serviceOrderId: optionalText(200),
  invoiceId: optionalText(200),
  entryIds: z.array(id).max(120).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  events: z.array(z.object({ at: z.iso.datetime(), description: z.string().trim().min(1).max(500) })).min(1).max(500),
}).superRefine((invoice, context) => {
  if (new Set(invoice.items.map((item) => item.id)).size !== invoice.items.length)
    context.addIssue({ code: "custom", path: ["items"], message: "Itens da nota repetidos." });
  if (new Set(invoice.payment.installments.map((item) => item.id)).size !== invoice.payment.installments.length)
    context.addIssue({ code: "custom", path: ["payment"], message: "Parcelas da nota repetidas." });
  if (invoice.exitDate && invoice.exitDate < invoice.issueDate)
    context.addIssue({ code: "custom", path: ["exitDate"], message: "A saída não pode anteceder a emissão." });
  if (invoice.items.some((item) => item.discount > Math.round(item.quantity * item.price)))
    context.addIssue({ code: "custom", path: ["items"], message: "Desconto do item maior que o valor do item." });
});

export type OutgoingInvoice = z.infer<typeof outgoingInvoiceSchema>;
export type NfeItem = z.infer<typeof nfeItemSchema>;
export type NfeInstallment = OutgoingInvoice["payment"]["installments"][number];
