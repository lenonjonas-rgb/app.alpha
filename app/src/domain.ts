import { z } from "zod";
import type { CompanyRegistration } from "./cnpj";
import { isValidCnpj, normalizeCnpj } from "./cnpj";
import { isValidCpf } from "./cpf";
import { orderTypeQuestionnaireSchema, questionnaireDisplaySchema, questionnaireTemplateSchema, questionDefinitionSchema, requiresJustification, signatureSchema } from "./questionnaireSchema";
import type { QuestionnaireTemplate } from "./questionnaireSchema";
import { reportSettingsSchema } from "./reportSettings";
import { servicePointSchema, travelSchema, travelValues } from "./travel";
import { financeSchema, validateFinance } from "./financeSchema";
import type { FinanceEntry } from "./financeSchema";
export type { QuestionnaireTemplate, QuestionDefinition } from "./questionnaireSchema";

const id = z.string().min(1);
const text = z.string().trim().min(1, "Preencha este campo.").max(1000);
const money = z.number().int().nonnegative().max(100_000_000);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value + "T12:00:00");
    return !Number.isNaN(parsed.getTime()) && localDay(parsed) === value;
  }, "Data invalida.");
const status = z.enum(["Aberta", "Em atendimento", "Pausada", "Finalizada"]);
const clientSchema = z.object({
  id,
  name: text,
  document: z.string(),
  phone: z.string(),
  email: z.union([z.literal(""), z.email()]),
  address: z.string(),
  group: z.string(),
  active: z.boolean(),
});
export const equipmentBrandSchema = z.object({
  id, name: text, archived: z.boolean().default(false),
});
export const equipmentModelSchema = z.object({
  id, brandId: id, name: text, category: z.string().max(200),
  line: z.string().trim().max(200).optional(),
  notes: z.string().max(3000), archived: z.boolean().default(false),
  questionnaireId: z.string().optional(),
});
const equipmentModelSnapshotSchema = z.object({
  modelId: id, brandId: id, brand: text, name: text, category: z.string().max(200),
  line: z.string().trim().max(200).optional(),
});
export const equipmentSelectionSchema = equipmentModelSnapshotSchema.extend({
  quantity: z.number().int().min(1).max(10000),
  purpose: z.enum(["Montagem", "Manutenção", "Outro"]),
});
const equipmentSchema = z.object({
  id,
  name: text,
  serial: text,
  clientId: id,
  category: z.string(),
  warranty: z.union([z.literal(""), day]),
  notes: z.string(),
  model: equipmentModelSnapshotSchema.optional(),
  assetCode: z.string().trim().min(1).max(100).optional(),
});
export const attachmentSchema = z
  .object({
    id,
    name: text,
    mime: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "text/plain",
    ]),
    size: z.number().int().positive().max(500_000),
    data: z.string().max(800_000),
    at: z.iso.datetime(),
  })
  .refine(
    (value) =>
      value.data.startsWith(`data:${value.mime};base64,`) &&
      /^[A-Za-z0-9+/=]+$/.test(value.data.split(",")[1] ?? ""),
    "Arquivo invalido.",
  );
const maintenanceContractEventSchema = z.object({
  status: z.enum(["Ativo", "Suspenso", "Cancelado"]),
  at: z.iso.datetime(),
  reason: z.string().trim().min(5).max(1000),
});
export const maintenanceContractSchema = z.object({
  id,
  name: z.string().trim().min(1).max(160),
  clientId: id,
  equipmentTypeIds: z.array(id).max(100),
  equipmentIds: z.array(id).min(1).max(200),
  coverage: z.string().trim().min(1).max(5000),
  startsOn: day,
  endsOn: day,
  monthlyAmount: money.refine((value) => value > 0, "Informe o valor mensal do contrato."),
  signedAttachment: attachmentSchema.optional(),
  visitInterval: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("Quinzenal") }),
    z.object({ kind: z.literal("Mensal") }),
    z.object({ kind: z.literal("Semestral") }),
    z.object({ kind: z.literal("Dias"), days: z.number().int().min(1).max(3650) }),
  ]),
  createdAt: z.iso.datetime(),
  events: z.array(maintenanceContractEventSchema).max(1000),
}).superRefine((contract, context) => {
  if (contract.endsOn < contract.startsOn)
    context.addIssue({ code: "custom", path: ["endsOn"], message: "O fim da vigência não pode anteceder o início." });
  let previousStatus = "Ativo", previousAt = contract.createdAt;
  for (const [index, event] of contract.events.entries()) {
    if (event.at < previousAt || event.status === previousStatus || previousStatus === "Cancelado")
      context.addIssue({ code: "custom", path: ["events", index], message: "Histórico de situação do contrato inválido." });
    previousStatus = event.status;
    previousAt = event.at;
  }
  if (new Set(contract.equipmentTypeIds).size !== contract.equipmentTypeIds.length ||
    new Set(contract.equipmentIds).size !== contract.equipmentIds.length)
    context.addIssue({ code: "custom", message: "Tipos e unidades de equipamento não podem se repetir." });
});
export const maintenanceEquipmentTypeSchema = z.object({
  id,
  name: z.string().trim().min(1).max(160),
  active: z.boolean(),
});
const productSchema = z.object({
  id,
  name: text,
  code: text,
  price: money,
  cost: money,
  stock: z.number().int().nonnegative(),
  minimum: z.number().int().nonnegative(),
});
const serviceSchema = z.object({ id, name: text, price: money });
export const lineSchema = z.object({
  id,
  kind: z.enum(["produto", "servico"]),
  referenceId: id,
  name: text,
  quantity: z.number().positive().max(10000),
  price: money,
});
const eventSchema = z.object({ id, at: z.iso.datetime(), description: text });
const questionSchema = questionDefinitionSchema.extend({
  justification: z.string().max(10000).optional(),
  justificationPhotoId: z.string().optional(),
  signature: signatureSchema.nullable().optional(),
  answer: z
    .union([z.string().max(10000), z.array(z.string().max(1000))])
    .default(""),
});
const checklistSchema = z.object({
  id,
  title: text,
  equipmentId: z.string().default(""),
  questions: z.array(questionSchema).min(1),
  templateId: z.string().optional(),
  templateRevision: z.number().int().positive().optional(),
  requiredForCheckout: z.boolean().optional(),
  header: z.string().max(10000).optional(),
  footer: z.string().max(10000).optional(),
  display: questionnaireDisplaySchema.optional(),
});
export { servicePointSchema } from "./travel";
const activitySchema = z.object({
  id,
  kind: z.enum(["Deslocamento", "Check-in", "Pausa", "Retorno", "Check-out"]),
  at: z.iso.datetime(),
  technician: text,
  reason: z.string().max(1000),
  justification: z.string().max(1000),
  origin: z.enum(["Web local", "Android"]),
  serviceDistance: servicePointSchema.extend({
    meters: z.number().int().nonnegative().max(20015115),
  }).optional(),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().nonnegative(),
      capturedAt: z.iso.datetime(),
    })
    .optional(),
});
export const serviceLocationSchema = z.object({
  useClientAddress: z.boolean(),
  postalCode: z.string().max(8),
  street: z.string().max(300),
  number: z.string().max(40),
  complement: z.string().max(200),
  neighborhood: z.string().max(200),
  city: z.string().max(200),
  state: z.string().max(2),
}).superRefine((location, context) => {
  if (location.useClientAddress) return;
  for (const field of ["street", "number", "city", "state"] as const) {
    if (!location[field].trim())
      context.addIssue({ code: "custom", path: [field], message: "Preencha o endereço de atendimento." });
  }
  if (!/^\d{8}$/.test(location.postalCode))
    context.addIssue({ code: "custom", path: ["postalCode"], message: "Informe um CEP com 8 dígitos." });
  if (!/^[A-Z]{2}$/.test(location.state))
    context.addIssue({ code: "custom", path: ["state"], message: "Informe a UF com 2 letras." });
});
export const orderDetailsSchema = z.object({
  archived: z.boolean().default(false),
  createdAt: z.iso.datetime().nullable().default(null),
  report: z.string().max(10000).default(""),
  externalCode: z.string().max(100).default(""),
  serviceLocation: serviceLocationSchema.optional(),
  servicePoint: servicePointSchema.optional(),
  travel: travelSchema.optional(),
  responsibleName: z.string().trim().max(160).optional(),
  responsiblePhone: z.string().trim().max(40).optional(),
  tags: z.array(text).default([]),
  checkInMode: z.enum(["Manual", "Automatico"]).default("Manual"),
  distanceKm: z.number().nonnegative().max(100000).default(0),
  equipmentIds: z.array(id).default([]),
  maintenanceContract: z.object({ id, monthlyAmount: money }).optional(),
  equipmentModels: z.array(equipmentSelectionSchema).default([]),
  stockLocationId: id.optional(),
  attachments: z.array(attachmentSchema).default([]),
  checklists: z.array(checklistSchema).default([]),
  questionnaireRequired: z.boolean().optional(),
  pending: z
    .array(z.object({ id, title: text, resolved: z.boolean() }))
    .default([]),
  activities: z.array(activitySchema).default([]),
  signature: signatureSchema.nullable().default(null),
  items: z.array(lineSchema.extend({ discount: money.default(0) })).default([]),
  costs: z.array(z.object({ id, name: text, value: money })).default([]),
  discount: z.number().nonnegative().default(0),
  discountMode: z.enum(["R$", "%"]).default("R$"),
});
const orderSchema = z.object({
  id,
  code: text,
  clientId: id,
  equipmentId: z.string(),
  title: text,
  technician: text,
  technicianUserId: z.union([z.literal(""), z.uuid()]).default(""),
  date: day,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  duration: z.number().int().min(15).max(1440),
  type: z.enum(["Corretiva", "Preventiva", "Instalacao", "Visita tecnica"]),
  priority: z.enum(["Alta", "Media", "Baixa"]),
  status,
  notes: z.string(),
  history: z.array(eventSchema),
  details: orderDetailsSchema.optional(),
});
const quoteSchema = z
  .object({
    id,
    code: text,
    clientId: id,
    date: day,
    expires: day,
    status: z.enum(["Rascunho", "Enviado", "Aprovado", "Recusado"]),
    items: z.array(lineSchema).min(1),
    discount: money,
    notes: z.string(),
    orderId: z.string(),
    equipmentModels: z.array(equipmentSelectionSchema).default([]),
  })
  .refine(
    (value) => value.expires >= value.date,
    "Validade anterior a emissao.",
  )
  .refine(
    (value) => value.discount <= subtotal(value.items),
    "Desconto maior que o subtotal.",
  );
const movementSchema = z.object({
  id,
  productId: id,
  locationId: id.optional(),
  at: z.iso.datetime(),
  delta: z
    .number()
    .int(),
  reason: text,
  balance: z.number().int().nonnegative(),
  unitCost: money.optional(),
  averageCostBefore: money.optional(),
  averageCostAfter: money.optional(),
  source: z.object({
    type: z.enum(["legacy", "opening", "manual", "purchase", "purchaseReturn", "consumption", "consumptionReversal", "transfer", "migration", "inventory"]),
    referenceId: id.optional(), lineId: id.optional(),
  }).optional(),
}).superRefine((movement, context) => {
  if (movement.delta === 0 && movement.source?.type !== "inventory")
    context.addIssue({ code: "custom", path: ["delta"], message: "Movimentação sem diferença só é válida para inventário físico." });
});
const stockLocationSchema = z.object({ id, name: text, active: z.boolean() });
const purchaseStockReceiptSchema = z.object({
  id, orderId: id, at: z.iso.datetime(), date: day, locationId: id,
  reference: z.string().trim().max(200), notes: z.string().trim().min(5).max(1000),
  items: z.array(z.object({ lineId: id, productId: id, quantity: z.number().int().positive().max(10000) })).min(1).max(100),
});
const purchaseStockReturnSchema = z.object({
  id, orderId: id, at: z.iso.datetime(), date: day, reference: z.string().trim().max(200),
  reason: z.string().trim().min(5).max(1000),
  items: z.array(z.object({
    lineId: id, productId: id, locationId: id,
    quantity: z.number().int().positive().max(10000),
  })).min(1).max(100),
  financial: z.object({
    amount: money,
    payableOffsets: z.array(z.object({ entryId: id, amount: money.refine((value) => value > 0) })).max(120),
    creditEntryId: id.optional(),
  }).optional(),
});
const consumptionReversalSchema = z.object({
  id, reservationId: id, at: z.iso.datetime(), reason: z.string().trim().min(5).max(1000),
  items: z.array(z.object({ lineId: id, productId: id, quantity: z.number().int().positive() })).min(1).max(200),
});
const inventoryCountSchema = z.object({
  id, productId: id, locationId: id, at: z.iso.datetime(),
  systemQuantity: z.number().int().nonnegative(),
  countedQuantity: z.number().int().nonnegative(),
  reason: text,
});
const stockReservationSchema = z.object({
  id, orderId: id, locationId: id, createdAt: z.iso.datetime(),
  items: z.array(z.object({ lineId: id, productId: id, productName: text, quantity: z.number().int().positive() })).min(1).max(200),
  events: z.array(z.object({ status: z.enum(["Reservada", "Consumida", "Liberada"]), at: z.iso.datetime(), reason: text })).min(1).max(1000),
});
const inventorySchema = z.object({
  locations: z.array(stockLocationSchema).min(1).max(100),
  defaultLocationId: id,
  reservations: z.array(stockReservationSchema).max(5000),
  counts: z.array(inventoryCountSchema).max(100000).default([]),
  purchaseReceipts: z.array(purchaseStockReceiptSchema).max(100000).default([]),
  purchaseReturns: z.array(purchaseStockReturnSchema).max(100000).default([]),
  consumptionReversals: z.array(consumptionReversalSchema).max(100000).default([]),
});
const expenseSchema = z.object({
  id,
  date: day,
  technician: text,
  type: text,
  value: money,
  description: text,
  attachment: attachmentSchema.nullable().default(null),
});
export const databaseSchema = z.object({
  version: z.literal(1),
  finance: financeSchema.prefault({}),
  clients: z.array(clientSchema),
  equipment: z.array(equipmentSchema),
  equipmentBrands: z.array(equipmentBrandSchema).default([]),
  equipmentModels: z.array(equipmentModelSchema).default([]),
  products: z.array(productSchema),
  services: z.array(serviceSchema),
  orders: z.array(orderSchema),
  quotes: z.array(quoteSchema),
  maintenanceContracts: z.array(maintenanceContractSchema).max(10000).default([]),
  maintenanceEquipmentTypes: z.array(maintenanceEquipmentTypeSchema).max(1000).default([]),
  movements: z.array(movementSchema),
  inventory: inventorySchema.optional(),
  expenses: z.array(expenseSchema).default([]),
  questionnaires: z.array(questionnaireTemplateSchema).default([]),
  orderTypeQuestionnaires: z.array(orderTypeQuestionnaireSchema).default([]),
  settings: z.object({
    reportSettings: reportSettingsSchema.prefault({}),
    company: text,
    technician: text,
    kilometerRate: money.default(0),
    fuelPrice: money.default(0),
    kilometersPerLiter: z.number().nonnegative().max(1000).default(0),
    assistancePoint: servicePointSchema.optional(),
    assistanceAddress: z.string().max(2000).default(""),
    logo: z
      .string()
      .max(1_500_000)
      .refine(
        (value) =>
          value === "" ||
          /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value),
        "Logo invalida.",
      ),
    cnpj: z.string().max(14).default(""),
    legalName: z.string().max(1000).default(""),
    tradeName: z.string().max(1000).default(""),
    registrationStatus: z.string().max(200).default(""),
    openingDate: z.string().max(30).default(""),
    address: z.string().max(1000).default(""),
    addressDetails: z.object({
      street: z.string().max(60),
      number: z.string().max(20),
      complement: z.string().max(60),
      district: z.string().max(60),
      postalCode: z.string().max(8),
      municipality: z.string().max(7),
      city: z.string().max(60),
      state: z.string().max(2),
    }).default({ street: "", number: "", complement: "", district: "", postalCode: "", municipality: "", city: "", state: "" }),
    phone: z.string().max(100).default(""),
    email: z.string().max(320).default(""),
    stateRegistrations: z.array(z.object({
      state: z.string().max(2),
      number: z.string().max(30),
      active: z.boolean().nullable(),
    })).default([]),
    mainCnae: z.string().max(30).default(""),
    mainCnaeDescription: z.string().max(500).default(""),
    secondaryCnaes: z.array(z.string().max(500)).max(1000).default([]),
    legalNature: z.string().max(200).default(""),
    companySize: z.string().max(100).default(""),
    simpleNationalOptIn: z.boolean().nullable().default(null),
    meiOptIn: z.boolean().nullable().default(null),
    registrationData: z.record(z.string(), z.unknown()).default({}),
  }),
});
export type Database = z.infer<typeof databaseSchema>;
export type Client = z.infer<typeof clientSchema>;
export type Equipment = z.infer<typeof equipmentSchema>;
export type EquipmentBrand = z.infer<typeof equipmentBrandSchema>;
export type EquipmentModel = z.infer<typeof equipmentModelSchema>;
export type EquipmentSelection = z.infer<typeof equipmentSelectionSchema>;
export type MaintenanceContract = z.infer<typeof maintenanceContractSchema>;
export type MaintenanceEquipmentType = z.infer<typeof maintenanceEquipmentTypeSchema>;
export type Product = z.infer<typeof productSchema>;
export type StockMovement = z.infer<typeof movementSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type Order = z.infer<typeof orderSchema>;
export type StockLocation = z.infer<typeof stockLocationSchema>;
export type PurchaseStockReceipt = z.infer<typeof purchaseStockReceiptSchema>;
export type PurchaseStockReturn = z.infer<typeof purchaseStockReturnSchema>;
export type ConsumptionReversal = z.infer<typeof consumptionReversalSchema>;
export type InventoryCount = z.infer<typeof inventoryCountSchema>;
export type StockReservation = z.infer<typeof stockReservationSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type Line = z.infer<typeof lineSchema>;
export type OrderStatus = Order["status"];
export type OrderDetails = z.infer<typeof orderDetailsSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Checklist = z.infer<typeof checklistSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type ServiceLocation = z.infer<typeof serviceLocationSchema>;
export function orderServiceAddress(order: Order, client: Pick<Client, "address">): string {
  return serviceLocationAddress(order.details?.serviceLocation, client.address);
}
export function serviceLocationAddress(location: ServiceLocation | undefined, clientAddress: string): string {
  if (!location || location.useClientAddress) return clientAddress;
  return [
    [location.street, location.number].filter(Boolean).join(", "),
    location.complement, location.neighborhood,
    [location.city, location.state].filter(Boolean).join(" - "),
    `CEP ${location.postalCode}`,
  ].filter(Boolean).join(" · ");
}
export function instantiateQuestionnaire(template: QuestionnaireTemplate, equipmentId = ""): Checklist {
  const parsed = questionnaireTemplateSchema.parse(template);
  if (parsed.archived) throw new Error("Questionário arquivado não pode ser adicionado.");
  validateQuestionDefinitions(parsed.questions);
  if (equipmentId && !parsed.display.equipment) throw new Error("Este questionário não permite resposta por equipamento.");
  return {
    id: makeId(), title: parsed.title, equipmentId,
    templateId: parsed.id, templateRevision: parsed.revision,
    requiredForCheckout: parsed.requiredForCheckout,
    header: parsed.header, footer: parsed.footer, display: { ...parsed.display },
    questions: parsed.questions.map((question) => ({
      ...question, options: [...question.options],
      answer: question.kind === "Multipla escolha" ? [] : "",
      ...(question.kind === "Assinatura" ? { signature: null } : {}),
      ...(question.kind === "Sim ou Não" ? { justification: "", justificationPhotoId: "" } : {}),
    })),
  };
}
export function defaultQuestionnaires(data: Database, type: Order["type"]) {
  const setting = data.orderTypeQuestionnaires.find((item) => item.type === type);
  const template = data.questionnaires.find((item) => item.id === setting?.questionnaireId && !item.archived);
  return {
    questionnaireRequired: setting?.required ?? false,
    checklists: template ? [instantiateQuestionnaire(template)] : [],
  };
}
export function validateQuestionDefinitions(questions: z.infer<typeof questionDefinitionSchema>[], requireOptions = true) {
  if (new Set(questions.map((question) => question.id)).size !== questions.length)
    throw new Error("Identificadores duplicados nas perguntas.");
  for (const question of questions) {
    if (question.kind === "Sim ou Não" && !question.justificationOn)
      throw new Error("Selecione a resposta que exige justificativa.");
    if (question.kind !== "Sim ou Não" && question.justificationOn)
      throw new Error("Justificativa condicional em tipo de pergunta invalido.");
    if (requireOptions && ["Escolha", "Multipla escolha"].includes(question.kind) &&
      (question.options.length < 2 || new Set(question.options).size !== question.options.length))
      throw new Error("Cadastre opcoes distintas para a pergunta de escolha.");
  }
}
export const getOrderDetails = (order: Order): OrderDetails =>
  orderDetailsSchema.parse(order.details ?? {});
export const orderPending = (order: Order) => {
  const details = getOrderDetails(order);
  return [
    ...(details.questionnaireRequired && details.checklists.length === 0
      ? [{ id: "questionnaire-required", title: "Adicionar questionário obrigatório", source: "Tipo de tarefa" }]
      : []),
    ...details.pending
      .filter((item) => !item.resolved)
      .map((item) => ({
        id: item.id,
        title: item.title,
        source: "Registro manual",
      })),
    ...details.checklists.filter((checklist) => checklist.requiredForCheckout !== false).flatMap((checklist) =>
      checklist.questions
        .filter(
          (question) =>
            (question.required &&
            (question.kind === "Assinatura"
              ? !(question.signature === undefined ? details.signature : question.signature)
              : Array.isArray(question.answer)
                ? !question.answer.length
                : !question.answer.trim())) ||
            (requiresJustification(question) && !question.justification?.trim()),
        )
        .map((question) => ({
          id: `${checklist.id}:${question.id}`,
          title: requiresJustification(question) && !question.justification?.trim() ? `${question.label} · Justificativa` : question.label,
          source: checklist.title,
        })),
    ),
  ];
};
export function orderValues(details: OrderDetails) {
  const items = details.items.reduce(
    (sum, item) => sum + Math.round(item.quantity * item.price) - item.discount,
    0,
  );
  const costs = details.costs.reduce((sum, item) => sum + item.value, 0);
  const travel = details.travel ? travelValues(details.travel).charge : 0;
  const discount =
    details.discountMode === "%"
      ? Math.round(((items + costs + travel) * details.discount) / 100)
      : Math.round(details.discount);
  return { items, costs, travel, discount, total: items + costs + travel - discount };
}
export function orderMargin(data: Database, order: Order) {
  const details = getOrderDetails(order);
  const productLines = details.items.filter((item) => item.kind === "produto");
  const reservations = data.inventory!.reservations.filter((item) =>
    item.orderId === order.id && item.events.at(-1)?.status === "Consumida");
  const movements = data.movements.filter((movement) =>
    movement.source?.type === "consumption" &&
    reservations.some((reservation) => reservation.id === movement.source?.referenceId));
  if (!productLines.length) return { cost: 0, margin: orderValues(details).total, percentage: 100 };
  if (movements.length !== productLines.length || movements.some((item) => item.unitCost === undefined))
    return null;
  const reversedCost = data.inventory!.consumptionReversals
    .filter((reversal) => reservations.some((reservation) => reservation.id === reversal.reservationId))
    .flatMap((reversal) => reversal.items.map((item) => {
      const original = movements.find((movement) =>
        movement.source?.referenceId === reversal.reservationId && movement.source.lineId === item.lineId);
      return original ? item.quantity * original.unitCost! : 0;
    })).reduce((sum, item) => sum + item, 0);
  const cost = movements.reduce((sum, item) => sum + Math.abs(item.delta) * item.unitCost!, 0) - reversedCost;
  const revenue = orderValues(details).total;
  return { cost, margin: revenue - cost, percentage: revenue > 0 ? (revenue - cost) / revenue * 100 : 0 };
}
export function reversibleConsumptionItems(data: Database, orderId: string) {
  const reservations = data.inventory!.reservations.filter((item) =>
    item.orderId === orderId && item.events.at(-1)?.status === "Consumida");
  return reservations.flatMap((reservation) => reservation.items.flatMap((item) => {
    const consumption = data.movements.find((movement) => movement.source?.type === "consumption" &&
      movement.source.referenceId === reservation.id && movement.source.lineId === item.lineId);
    if (!consumption) return [];
    const reversedQuantity = data.inventory!.consumptionReversals
      .filter((reversal) => reversal.reservationId === reservation.id)
      .flatMap((reversal) => reversal.items)
      .filter((reversalItem) => reversalItem.lineId === item.lineId)
      .reduce((sum, reversalItem) => sum + reversalItem.quantity, 0);
    return [{
      id: `${reservation.id}|${item.lineId}`, reservationId: reservation.id, lineId: item.lineId,
      productId: item.productId, productName: item.productName, consumedQuantity: -consumption.delta,
      reversedQuantity, remainingQuantity: -consumption.delta - reversedQuantity,
    }];
  })).filter((item) => item.remainingQuantity > 0);
}
export function availablePurchaseReturnItems(data: Database, orderId: string, locationId: string) {
  const order = data.finance.purchasing?.orders.find((item) => item.id === orderId);
  if (!order) return [];
  const returns = data.inventory!.purchaseReturns.filter((item) => item.orderId === orderId);
  const locationAvailable = new Map<string, number>();
  return order.items.flatMap((line) => {
    const receipts = data.inventory!.purchaseReceipts.flatMap((receipt) =>
      receipt.orderId === orderId ? receipt.items.filter((item) => item.lineId === line.id)
        .map((item) => ({ ...item, locationId: receipt.locationId })) : []);
    const legacyReceipt = order.receipt?.stockItems?.find((item) => item.lineId === line.id);
    const receivedAtLocation = receipts.length ? receipts.filter((item) => item.locationId === locationId)
      .reduce((sum, item) => sum + item.quantity, 0) :
      legacyReceipt && order.receipt?.locationId === locationId ? line.quantity : 0;
    const returned = returns.flatMap((item) => item.items)
      .filter((item) => item.lineId === line.id).reduce((sum, item) => sum + item.quantity, 0);
    const productId = receipts[0]?.productId ?? legacyReceipt?.productId ?? line.productId;
    if (!productId) return [];
    if (!locationAvailable.has(productId)) locationAvailable.set(productId, stockAvailable(data, productId, locationId));
    const quantity = Math.min(receivedAtLocation, Math.max(0, line.quantity - returned),
      locationAvailable.get(productId)!);
    locationAvailable.set(productId, locationAvailable.get(productId)! - quantity);
    return quantity > 0 ? [{
      lineId: line.id!, productId, description: line.description,
      receivedQuantity: receipts.reduce((sum, item) => sum + item.quantity, 0) || (legacyReceipt ? line.quantity : 0),
      returnedQuantity: returned, returnableQuantity: quantity,
    }] : [];
  });
}
export function returnPurchaseStock(data: Database, orderId: string, locationId: string,
  quantities: Record<string, number>, input: { date: string; reference: string; reason: string }, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme a devolução física dos itens ao fornecedor.");
  const reason = z.string().trim().min(5).max(1000).parse(input.reason);
  const reference = z.string().trim().max(200).parse(input.reference);
  if (input.date < "1900-01-01" || input.date > localDay())
    throw new Error("Informe uma data de devolução válida, não futura.");
  if (!data.inventory!.locations.some((item) => item.id === locationId && item.active))
    throw new Error("Selecione um depósito ativo para a devolução.");
  const order = data.finance.purchasing?.orders.find((item) => item.id === orderId);
  if (!order)
    throw new Error("Pedido inexistente não aceita devolução.");
  const available = availablePurchaseReturnItems(data, orderId, locationId);
  const selected = Object.entries(quantities);
  if (!selected.length || selected.some(([lineId, quantity]) => !Number.isSafeInteger(quantity) ||
    quantity <= 0 || !available.some((item) => item.lineId === lineId && quantity <= item.returnableQuantity)))
    throw new Error("Quantidade excede o recebido e ainda disponível no depósito, ou está vinculada a uma linha inválida.");
  const items = selected.map(([lineId, quantity]) => ({
    ...available.find((item) => item.lineId === lineId)!, quantity, locationId,
  }));
  const id = makeId(), at = new Date().toISOString();
  const returnAmount = items.reduce((sum, item) => {
    const line = order.items.find((entry) => entry.id === item.lineId)!;
    return sum + item.quantity * line.unitCost;
  }, 0);
  let remainingCredit = returnAmount;
  const payableOffsets: { entryId: string; amount: number }[] = [];
  for (const entryId of order.receipt?.entryIds ?? order.cancellation?.payableEntryIds ?? []) {
    const entry = data.finance.entries.find((item) => item.id === entryId);
    if (!entry || entry.canceled || entry.kind !== "Pagar") continue;
    const amount = Math.min(remainingCredit, stockFinanceBalance(entry));
    if (amount > 0) {
      payableOffsets.push({ entryId, amount });
      remainingCredit -= amount;
    }
    if (!remainingCredit) break;
  }
  const creditEntryId = remainingCredit > 0 ? makeId() : undefined;
  const financial = { amount: returnAmount, payableOffsets, ...(creditEntryId ? { creditEntryId } : {}) };
  let result: Database = { ...data, inventory: { ...data.inventory!, purchaseReturns: [
    ...data.inventory!.purchaseReturns,
    { id, orderId, at, date: input.date, reference, reason, financial,
      items: items.map(({ lineId, productId, quantity, locationId: itemLocationId }) =>
        ({ lineId, productId, locationId: itemLocationId, quantity })) },
  ] } };
  result = { ...result, finance: { ...result.finance, entries: [
    ...result.finance.entries.map((entry) => {
      const offset = payableOffsets.find((item) => item.entryId === entry.id);
      return offset ? { ...entry, purchaseReturnOffsets: [...(entry.purchaseReturnOffsets ?? []), { returnId: id, amount: offset.amount }] } : entry;
    }),
    ...(creditEntryId ? [{
      id: creditEntryId, kind: "Receber" as const, party: order.supplierName,
      description: `Crédito de devolução da compra ${order.id}`,
      amount: remainingCredit, issuedOn: input.date, dueOn: input.date,
      accountId: order.accountId, paymentMethod: order.paymentMethod,
      purchaseReturnCreditId: id, purchaseReturnOffsets: [],
      canceled: false, settlements: [],
    }] : []),
  ] } };
  for (const item of items) result = appendStockMovement(result, item.productId, locationId, -item.quantity,
    `Devolução ao fornecedor do pedido ${order.id}: ${reason}`,
    { type: "purchaseReturn", referenceId: id, lineId: item.lineId }, at);
  return validateDatabase(result);
}
function stockFinanceBalance(entry: FinanceEntry) {
  return entry.amount - (entry.retention?.withheld ?? 0) -
    entry.settlements.filter((item) => !item.reversed).reduce((sum, item) => sum + item.amount, 0) -
    (entry.purchaseReturnOffsets ?? []).reduce((sum, item) => sum + item.amount, 0);
}
export function reverseOrderConsumption(data: Database, orderId: string, quantities: Record<string, number>,
  reason: string, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme a devolução das peças ainda não utilizadas.");
  const parsedReason = z.string().trim().min(5).max(1000).parse(reason);
  const order = data.orders.find((item) => item.id === orderId);
  if (!order || order.status !== "Finalizada")
    throw new Error("Somente peças consumidas de uma OS finalizada podem ser estornadas.");
  const available = reversibleConsumptionItems(data, orderId);
  const selected = Object.entries(quantities);
  if (!selected.length || selected.some(([key, quantity]) =>
    !Number.isSafeInteger(quantity) || quantity <= 0 ||
    !available.some((item) => item.id === key && quantity <= item.remainingQuantity)))
    throw new Error("Quantidade de estorno inválida ou superior ao saldo consumido ainda não devolvido.");
  const at = new Date().toISOString();
  const items = selected.map(([key, quantity]) => {
    const availableItem = available.find((item) => item.id === key)!;
    return { reservationId: availableItem.reservationId, lineId: availableItem.lineId,
      productId: availableItem.productId, quantity };
  });
  let result: Database = data;
  for (const reservationId of new Set(items.map((item) => item.reservationId))) {
    const id = makeId();
    const reservationItems = items.filter((item) => item.reservationId === reservationId);
    result = { ...result, inventory: { ...result.inventory!, consumptionReversals: [
      ...result.inventory!.consumptionReversals,
      { id, reservationId, at, reason: parsedReason,
        items: reservationItems.map(({ lineId, productId, quantity }) => ({ lineId, productId, quantity })) },
    ] } };
    const locationId = result.inventory!.reservations.find((reservation) => reservation.id === reservationId)!.locationId;
    for (const item of reservationItems) {
      result = appendStockMovement(result, item.productId, locationId, item.quantity,
        `Estorno de consumo da OS ${order.code}: ${parsedReason}`,
        { type: "consumptionReversal", referenceId: id, lineId: item.lineId }, at);
    }
  }
  return validateDatabase(result);
}
export function activityTotals(activities: Activity[], now = Date.now()) {
  const totals = { travel: 0, pause: 0, work: 0 };
  activities.forEach((activity, index) => {
    const end = activities[index + 1]
      ? Date.parse(activities[index + 1].at)
      : now;
    const elapsed = Math.max(0, end - Date.parse(activity.at));
    if (activity.kind === "Deslocamento") totals.travel += elapsed;
    if (activity.kind === "Pausa") totals.pause += elapsed;
    if (activity.kind === "Check-in" || activity.kind === "Retorno")
      totals.work += elapsed;
  });
  return totals;
}
export const allowedActivities = (
  activities: Activity[],
): Activity["kind"][] => {
  const last = activities.at(-1)?.kind;
  if (!last || last === "Check-out") return ["Deslocamento", "Check-in"];
  if (last === "Deslocamento") return ["Check-in"];
  if (last === "Pausa") return ["Retorno"];
  return ["Pausa", "Check-out"];
};
export function validateOrderDetails(order: Order, data: Database) {
  const details = getOrderDetails(order);
  if (
    details.equipmentIds.some(
      (equipmentId) =>
        !data.equipment.some(
          (item) => item.id === equipmentId && item.clientId === order.clientId,
        ),
    )
  )
    throw new Error("Equipamento associado pertence a outro cliente.");
  if (
    details.checklists.some(
      (checklist) =>
        checklist.equipmentId &&
        ![order.equipmentId, ...details.equipmentIds].includes(
          checklist.equipmentId,
        ),
    )
  )
    throw new Error("Questionario com equipamento nao associado.");
  if (
    details.items.some(
      (item) =>
        !(item.kind === "produto" ? data.products : data.services).some(
          (record) => record.id === item.referenceId,
        ) || item.discount > Math.round(item.quantity * item.price),
    )
  )
    throw new Error("Item ou desconto invalido na OS.");
  if (
    orderValues(details).total < 0 ||
    (details.discountMode === "%" && details.discount > 100)
  )
    throw new Error("Desconto superior ao valor da OS.");
  for (const collection of [
    details.attachments,
    details.checklists,
    details.activities,
    details.pending,
    details.items,
    details.costs,
  ]) {
    if (new Set(collection.map((item) => item.id)).size !== collection.length)
      throw new Error("Identificadores duplicados nos detalhes da OS.");
  }
  details.checklists.forEach((checklist) => {
    validateQuestionDefinitions(checklist.questions, Boolean(checklist.templateId));
    checklist.questions.forEach((question) => {
      const answers = Array.isArray(question.answer)
        ? question.answer
        : question.answer
          ? [question.answer]
          : [];
      if (
        ["Escolha", "Multipla escolha"].includes(question.kind) &&
        answers.some((answer) => !question.options.includes(answer))
      )
        throw new Error("Opcao invalida no questionario.");
      if (
        question.kind === "Foto" &&
        answers.some(
          (answer) =>
            !details.attachments.some(
              (file) => file.id === answer && file.mime.startsWith("image/"),
            ),
        )
      )
        throw new Error("Foto de questionario nao encontrada.");
      if (question.kind !== "Multipla escolha" && Array.isArray(question.answer))
        throw new Error("Resposta deve conter um unico valor.");
      if (question.kind === "Multipla escolha" && question.answer !== "" && !Array.isArray(question.answer))
        throw new Error("Resposta de multipla escolha deve ser uma lista.");
      if (question.kind !== "Assinatura" && question.signature)
        throw new Error("Assinatura em pergunta de outro tipo.");
      if (!requiresJustification(question) && (question.justification?.trim() || question.justificationPhotoId))
        throw new Error("Justificativa sem resposta correspondente.");
      if (question.justificationPhotoId && !details.attachments.some((file) => file.id === question.justificationPhotoId && file.mime.startsWith("image/")))
        throw new Error("Foto de justificativa nao encontrada.");
      const answer = typeof question.answer === "string" ? question.answer.trim() : "";
      if (answer && ["Numero", "Monetaria"].includes(question.kind) &&
        (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(answer) || !Number.isFinite(Number(answer))))
        throw new Error("Resposta numerica invalida.");
      if (answer && question.kind === "Check" && !["Sim", "Nao", "Não"].includes(answer))
        throw new Error("Resposta de check invalida.");
      if (answer && question.kind === "Sim ou Não" && !["Sim", "Nao"].includes(answer))
        throw new Error("Resposta de sim ou nao invalida.");
      if (answer && question.kind === "Data" && !day.safeParse(answer).success)
        throw new Error("Data de resposta invalida.");
      if (answer && question.kind === "Hora" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(answer))
        throw new Error("Hora de resposta invalida.");
      if (answer && question.kind === "CPF/CNPJ" && !isValidCpf(answer) && !isValidCnpj(normalizeCnpj(answer)))
        throw new Error("CPF/CNPJ de resposta invalido.");
    });
  });
  details.activities.forEach((activity, index) => {
    const previous = details.activities.slice(0, index);
    if (!allowedActivities(previous).includes(activity.kind))
      throw new Error("Sequencia de atividades invalida.");
    if (index > 0 && Date.parse(activity.at) <= Date.parse(previous.at(-1)!.at))
      throw new Error("Os horarios devem seguir a ordem das atividades.");
    if (activity.kind === "Pausa" && !activity.reason.trim())
      throw new Error("Informe o motivo da pausa.");
  });
}
export function updateOrderDetails(
  data: Database,
  orderId: string,
  update: (details: OrderDetails) => OrderDetails,
  description: string,
): Database {
  const order = data.orders.find((item) => item.id === orderId);
  if (!order) throw new Error("OS nao encontrada.");
  const before = getOrderDetails(order), next = update(before);
  const inventoryHistory = data.inventory!.reservations.filter((item) => item.orderId === orderId)
    .some((item) => item.events.at(-1)?.status !== "Liberada");
  if (inventoryHistory && JSON.stringify(before.items.filter((item) => item.kind === "produto")) !==
    JSON.stringify(next.items.filter((item) => item.kind === "produto")))
    throw new Error("Peças de OS reservadas/consumidas não podem ser alteradas. Faça devolução/ajuste de estoque antes.");
  return validateDatabase({
    ...data,
    orders: data.orders.map((item) =>
      item.id === orderId
        ? {
            ...item,
            details: next,
            history: [
              ...item.history,
              { id: makeId(), at: new Date().toISOString(), description },
            ],
          }
        : item,
    ),
  });
}
export function appendActivity(
  data: Database,
  orderId: string,
  activity: Activity,
): Database {
  const order = data.orders.find((item) => item.id === orderId);
  if (activity.kind === "Check-out" && order && orderPending(order).length)
    throw new Error("Resolva as pendencias antes do check-out.");
  const updated = updateOrderDetails(
    data,
    orderId,
    (details) => ({
      ...details,
      activities: [...details.activities, activity],
    }),
    `${activity.kind} registrado por ${activity.technician}`,
  );
  const status: OrderStatus =
    activity.kind === "Check-out"
      ? "Finalizada"
      : activity.kind === "Pausa"
        ? "Pausada"
        : activity.kind === "Deslocamento"
          ? "Aberta"
          : "Em atendimento";
  return changeOrderStatus(updated, orderId, status);
}
export function associateQuote(
  data: Database,
  orderId: string,
  quoteId: string,
): Database {
  const order = data.orders.find((item) => item.id === orderId);
  const quote = data.quotes.find((item) => item.id === quoteId);
  if (!order || !quote || order.clientId !== quote.clientId)
    throw new Error("Selecione um orcamento do mesmo cliente.");
  if (quote.orderId && quote.orderId !== orderId)
    throw new Error("Este orcamento ja esta associado a outra OS.");
  return validateDatabase({
    ...data,
    quotes: data.quotes.map((item) =>
      item.id === quoteId ? { ...item, orderId } : item,
    ),
    orders: data.orders.map((item) =>
      item.id === orderId
        ? {
            ...item,
            history: [
              ...item.history,
              {
                id: makeId(),
                at: new Date().toISOString(),
                description: `${quote.code} associado`,
              },
            ],
          }
        : item,
    ),
  });
}
export function assertSingleEquipmentQuestionnaire(checklists: Checklist[]): void {
  const equipmentIds = checklists.map((item) => item.equipmentId).filter(Boolean);
  if (new Set(equipmentIds).size !== equipmentIds.length)
    throw new Error("Há equipamentos com mais de um questionário nesta tarefa. Escolha o modelo correto ou use Manter somente este questionário antes de salvar ou replicar.");
}

export function replicateOrder(
  data: Database,
  orderId: string,
  date: string,
  time: string,
): Database {
  const original = data.orders.find((item) => item.id === orderId);
  if (!original) throw new Error("OS nao encontrada.");
  const originalDetails = getOrderDetails(original);
  assertSingleEquipmentQuestionnaire(originalDetails.checklists);
  const details = {
    ...originalDetails,
    travel: undefined,
    archived: false,
    createdAt: new Date().toISOString(),
    report: "",
    attachments: [],
    activities: [],
    signature: null,
    pending: [],
    checklists: originalDetails.checklists.map((checklist) => {
      const template = data.questionnaires.find((item) => item.id === checklist.templateId && !item.archived);
      if (template) return instantiateQuestionnaire(template, template.display.equipment ? checklist.equipmentId : "");
      return {
        ...checklist,
        id: makeId(),
        questions: checklist.questions.map((question) => ({
          ...question,
          ...(question.signature !== undefined ? { signature: null } : {}),
          ...(question.kind === "Sim ou Não" ? { justification: "", justificationPhotoId: "" } : {}),
          id: checklist.templateId ? question.id : makeId(),
          answer: question.kind === "Multipla escolha" ? [] : "",
        })),
      };
    }),
  };
  const record: Order = {
    ...original,
    id: makeId(),
    code: nextCode(data.orders, "OS"),
    date,
    time,
    status: "Aberta",
    details,
    history: [
      {
        id: makeId(),
        at: new Date().toISOString(),
        description: `Replicada de ${original.code}; execução anterior não copiada`,
      },
    ],
  };
  return validateDatabase({ ...data, orders: [...data.orders, record] });
}
export const STORAGE_KEY = "alpha-tec.database.v1";
export const makeId = () => crypto.randomUUID();
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function shiftDay(value: string, offset: number): string {
  const date = new Date(value + "T12:00:00");
  date.setDate(date.getDate() + offset);
  return localDay(date);
}
export const currency = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export const displayDate = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("pt-BR");
export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
export const subtotal = (items: Line[]) =>
  items.reduce((sum, item) => sum + Math.round(item.quantity * item.price), 0);
export const total = (quote: Pick<Quote, "items" | "discount">) =>
  subtotal(quote.items) - quote.discount;

export function emptyDatabase(
  company: string,
  technician: string,
  registration?: CompanyRegistration,
): Database {
  return validateDatabase({
    version: 1,
    clients: [],
    equipment: [],
    products: [],
    services: [],
    orders: [],
    quotes: [],
    maintenanceContracts: [],
    maintenanceEquipmentTypes: [],
    movements: [],
    expenses: [],
    settings: {
      company,
      technician,
      kilometerRate: 0,
      logo: "",
      cnpj: registration?.cnpj ?? "",
      legalName: registration?.legalName ?? "",
      tradeName: registration?.tradeName ?? "",
      registrationStatus: registration?.registrationStatus ?? "",
      openingDate: registration?.openingDate ?? "",
      address: registration?.address ?? "",
      addressDetails: registration?.addressDetails ?? { street: "", number: "", complement: "", district: "", postalCode: "", municipality: "", city: "", state: "" },
      phone: registration?.phone ?? "",
      email: registration?.email ?? "",
      stateRegistrations: registration?.stateRegistrations ?? [],
      mainCnae: registration?.mainCnae ?? "",
      mainCnaeDescription: registration?.mainCnaeDescription ?? "",
      secondaryCnaes: registration?.secondaryCnaes ?? [],
      legalNature: registration?.legalNature ?? "",
      companySize: registration?.companySize ?? "",
      simpleNationalOptIn: registration?.simpleNationalOptIn ?? null,
      meiOptIn: registration?.meiOptIn ?? null,
      registrationData: registration?.raw ?? {},
    },
  });
}

export function validateDatabase(input: unknown): Database {
  return validateDatabaseDocument(input, "company");
}

export function validateMobileDatabase(input: unknown): Database {
  return validateDatabaseDocument(input, "mobile");
}

function validateDatabaseDocument(input: unknown, scope: "company" | "mobile"): Database {
  let data = databaseSchema.parse(input);
  if (!data.inventory) data = migrateInventory(data);
  validateFinance(data.finance, new Set(data.clients.map((item) => item.id)), new Map(data.orders.map((item) => [item.id, item.clientId])));
  for (const collection of [
    data.clients,
    data.equipment,
    data.equipmentBrands,
    data.equipmentModels,
    data.products,
    data.services,
    data.orders,
    data.quotes,
    data.maintenanceContracts,
    data.maintenanceEquipmentTypes,
    data.movements,
    data.expenses,
    data.questionnaires,
  ]) {
    if (
      new Set(collection.map((record) => record.id)).size !== collection.length
    )
      throw new Error("Identificadores duplicados no arquivo.");
  }
  if (data.equipmentModels.some((model) => !data.equipmentBrands.some((brand) => brand.id === model.brandId)))
    throw new Error("Modelo de equipamento sem marca válida.");
  const normalizeName = (value: string) => value.trim().toLocaleLowerCase("pt-BR");
  if (new Set(data.equipmentBrands.map((brand) => normalizeName(brand.name))).size !== data.equipmentBrands.length)
    throw new Error("Já existe uma marca com este nome.");
  if (new Set(data.maintenanceEquipmentTypes.map((item) => normalizeName(item.name))).size !== data.maintenanceEquipmentTypes.length)
    throw new Error("Já existe um tipo de equipamento com este nome.");
  if (new Set(data.equipmentModels.map((model) => JSON.stringify([model.brandId, normalizeName(model.line ?? ""), normalizeName(model.name)]))).size !== data.equipmentModels.length)
    throw new Error("Já existe um modelo com este nome nesta marca e linha.");
  const assetCodes = data.equipment.flatMap((item) => item.assetCode ? [item.assetCode.toUpperCase()] : []);
  if (new Set(assetCodes).size !== assetCodes.length)
    throw new Error("Código de equipamento duplicado entre os clientes.");
  data.questionnaires.forEach((template) => validateQuestionDefinitions(template.questions));
  if (new Set(data.orderTypeQuestionnaires.map((item) => item.type)).size !== data.orderTypeQuestionnaires.length)
    throw new Error("Tipo de tarefa com configuracao duplicada.");
  if (data.orderTypeQuestionnaires.some((item) => item.questionnaireId && !data.questionnaires.some((template) => template.id === item.questionnaireId && !template.archived)))
    throw new Error("Questionario padrao indisponivel.");
  const hasClient = (clientId: string) =>
    data.clients.some((client) => client.id === clientId);
  data.orders.forEach((order) => validateOrderDetails(order, data));
  if (data.equipment.some((record) => !hasClient(record.clientId)))
    throw new Error("Equipamento sem cliente valido.");
  if (data.maintenanceContracts.some((contract) =>
    !hasClient(contract.clientId) ||
    contract.equipmentTypeIds.some((typeId) => !data.maintenanceEquipmentTypes.some((type) => type.id === typeId)) ||
    new Set(contract.equipmentIds).size !== contract.equipmentIds.length ||
    contract.equipmentIds.some((equipmentId) =>
      !data.equipment.some((equipment) => equipment.id === equipmentId && equipment.clientId === contract.clientId))))
    throw new Error("Contrato com cliente ou equipamento invalido.");
  data.orders.forEach((order) => {
    const linked = getOrderDetails(order).maintenanceContract;
    if (!linked) return;
    const contract = data.maintenanceContracts.find((item) => item.id === linked.id);
    const details = getOrderDetails(order);
    const charges = details.costs.filter((item) => item.id === `maintenance-contract:${linked.id}`);
    // Mobile projections omit the contract registry; the OS retains its billing snapshot.
    if (charges.length !== 1 || charges[0].value !== linked.monthlyAmount ||
      (scope === "company" && (!contract || contract.clientId !== order.clientId ||
        order.date < contract.startsOn || order.date > contract.endsOn ||
        ![order.equipmentId, ...details.equipmentIds].some((equipmentId) => contract.equipmentIds.includes(equipmentId)) ||
        linked.monthlyAmount !== contract.monthlyAmount)))
      throw new Error("OS com cobrança de contrato inválida.");
  });
  if (
    data.orders.some(
      (record) =>
        !hasClient(record.clientId) ||
        (record.equipmentId &&
          !data.equipment.some(
            (equipment) =>
              equipment.id === record.equipmentId &&
              equipment.clientId === record.clientId,
          )),
    )
  )
    throw new Error("OS com cliente ou equipamento invalido.");
  if (
    data.quotes.some(
      (quote) =>
        !hasClient(quote.clientId) ||
        (quote.orderId &&
          !data.orders.some(
            (order) =>
              order.id === quote.orderId && order.clientId === quote.clientId,
          )) ||
        quote.items.some(
          (item) =>
            !(item.kind === "produto" ? data.products : data.services).some(
              (record) => record.id === item.referenceId,
            ),
        ),
    )
  )
    throw new Error("Orcamento com referencias invalidas.");
  if (
    data.movements.some(
      (record) =>
        !data.products.some((product) => product.id === record.productId),
    )
  )
    throw new Error("Movimentacao sem produto valido.");
  validateInventory(data);
  for (const collection of [data.orders, data.quotes]) {
    if (
      new Set(collection.map((record) => record.code)).size !==
      collection.length
    )
      throw new Error("Codigos de documentos duplicados.");
  }
  return data;
}

const defaultStockLocationId = "stock-location:principal";
function migrateInventory(data: Database): Database {
  const location = { id: defaultStockLocationId, name: "Principal", active: true };
  const movements = data.movements.map((movement) => ({
    ...movement,
    locationId: movement.locationId ?? location.id,
    source: movement.source ?? { type: "legacy" as const },
  }));
  for (const product of data.products) {
    const ledgerBalance = movements.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.delta, 0);
    const difference = product.stock - ledgerBalance;
    if (difference) movements.push({
      id: makeId(), productId: product.id, locationId: location.id, delta: difference,
      reason: movements.some((item) => item.productId === product.id)
        ? "Migração: conciliação do histórico com o saldo existente"
        : "Saldo inicial migrado do cadastro do produto",
      balance: product.stock, at: new Date().toISOString(),
      source: { type: movements.some((item) => item.productId === product.id) ? "migration" as const : "opening" as const },
    });
  }
  return { ...data, movements, inventory: {
    locations: [location], defaultLocationId: location.id, reservations: [], counts: [], purchaseReceipts: [], purchaseReturns: [],
    consumptionReversals: [],
  } };
}

export function stockLocationBalance(data: Database, productId: string, locationId: string) {
  return data.movements.filter((item) => item.productId === productId && item.locationId === locationId)
    .reduce((sum, item) => sum + item.delta, 0);
}
export function stockReserved(data: Database, productId: string, locationId: string) {
  return (data.inventory?.reservations ?? []).filter((reservation) => reservation.locationId === locationId &&
    reservation.events.at(-1)?.status === "Reservada")
    .flatMap((reservation) => reservation.items).filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + item.quantity, 0);
}
export function stockAvailable(data: Database, productId: string, locationId: string) {
  return stockLocationBalance(data, productId, locationId) - stockReserved(data, productId, locationId);
}
function activeReservation(data: Database, orderId: string) {
  return data.inventory!.reservations.find((item) => item.orderId === orderId && item.events.at(-1)?.status === "Reservada");
}
function inventoryLines(data: Database, order: Order) {
  const lines = getOrderDetails(order).items.filter((item) => item.kind === "produto");
  if (lines.some((line) => !Number.isSafeInteger(line.quantity) || line.quantity <= 0))
    throw new Error("Peças controladas pelo estoque devem ter quantidades inteiras positivas.");
  if (lines.some((line) => !data.products.some((product) => product.id === line.referenceId)))
    throw new Error("A OS contém produto inexistente no catálogo.");
  return lines.map((line) => ({
    lineId: line.id, productId: line.referenceId,
    productName: data.products.find((product) => product.id === line.referenceId)!.name, quantity: line.quantity,
  }));
}
function reserveOrder(data: Database, order: Order) {
  const items = inventoryLines(data, order);
  if (!items.length) return data;
  const locationId = getOrderDetails(order).stockLocationId ?? data.inventory!.defaultLocationId;
  const location = data.inventory!.locations.find((item) => item.id === locationId && item.active);
  if (!location) throw new Error("Depósito padrão inativo ou inexistente; ajuste a localização antes de iniciar a OS.");
  for (const line of items) {
    const total = items.filter((item) => item.productId === line.productId).reduce((sum, item) => sum + item.quantity, 0);
    if (stockAvailable(data, line.productId, locationId) < total)
      throw new Error(`Estoque disponível insuficiente para reservar ${line.productName} (${total}) em ${location.name}.`);
  }
  const reservation: StockReservation = { id: makeId(), orderId: order.id, locationId, createdAt: new Date().toISOString(), items,
    events: [{ status: "Reservada", at: new Date().toISOString(), reason: `Reserva automática ao iniciar ${order.code}` }] };
  return {
    ...data,
    orders: data.orders.map((item) => item.id === order.id ? {
      ...item, details: { ...getOrderDetails(item), stockLocationId: locationId },
    } : item),
    inventory: { ...data.inventory!, reservations: [...data.inventory!.reservations, reservation] },
  };
}
function updateReservation(data: Database, reservation: StockReservation, status: "Consumida" | "Liberada", reason: string) {
  const updated = { ...reservation, events: [...reservation.events, { status, at: new Date().toISOString(), reason }] };
  return { ...data, inventory: { ...data.inventory!,
    reservations: data.inventory!.reservations.map((item) => item.id === reservation.id ? updated : item) } };
}
function validateInventory(data: Database) {
  const inventory = data.inventory!;
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(inventory.locations.map((item) => item.id)) ||
    new Set(inventory.locations.map((item) => item.name.trim().toLocaleLowerCase("pt-BR"))).size !== inventory.locations.length ||
    !inventory.locations.some((item) => item.id === inventory.defaultLocationId && item.active))
    throw new Error("Localizações de estoque inválidas ou sem depósito padrão ativo.");
  if (!unique(inventory.reservations.map((item) => item.id)) ||
    inventory.reservations.some((item) => !data.orders.some((order) => order.id === item.orderId) ||
      !inventory.locations.some((location) => location.id === item.locationId) ||
      !unique(item.items.map((line) => line.lineId)) ||
      item.events.some((event, index) => event.at < (index ? item.events[index - 1].at : item.createdAt) ||
        (index > 0 && item.events[index - 1].status !== "Reservada") ||
        (index === 0 && event.status !== "Reservada") ||
        (index > 0 && event.status === "Reservada"))))
    throw new Error("Reservas de estoque inválidas ou histórico de transição inconsistente.");
  const productBalances = new Map(data.products.map((product) => [product.id, 0]));
  const locationBalances = new Map<string, number>();
  const purchaseMovements = new Set<string>(), purchaseReturnMovements = new Set<string>();
  const consumptionMovements = new Set<string>();
  const reversalMovements = new Set<string>();
  const inventoryMovements = new Map<string, StockMovement>();
  const costMovements = new Map<string, StockMovement>();
  for (const movement of data.movements) {
    if (!movement.locationId || !inventory.locations.some((location) => location.id === movement.locationId))
      throw new Error("Movimentação sem localização válida.");
    const key = JSON.stringify([movement.productId, movement.locationId]);
    locationBalances.set(key, (locationBalances.get(key) ?? 0) + movement.delta);
    productBalances.set(movement.productId, (productBalances.get(movement.productId) ?? 0) + movement.delta);
    if (movement.source?.type === "purchase") {
      const [receiptId, ...lineParts] = (movement.source.lineId ?? "").split("|");
      const lineId = lineParts.join("|");
      const order = data.finance.purchasing?.orders.find((item) => item.id === movement.source!.referenceId);
      const batch = data.inventory!.purchaseReceipts.find((item) => item.id === receiptId && item.orderId === order?.id);
      if (batch && lineId) {
        const receiptLine = batch.items.find((item) => item.lineId === lineId);
        const reference = `${batch.id}:${lineId}`;
        const line = order?.items.find((item) => item.id === lineId);
        if (!line || !receiptLine || receiptLine.productId !== movement.productId ||
          movement.locationId !== batch.locationId || movement.delta !== receiptLine.quantity ||
          movement.unitCost !== line.unitCost || purchaseMovements.has(reference))
          throw new Error("Entrada de estoque sem vínculo único com o item recebido.");
        purchaseMovements.add(reference);
      } else {
        const line = order?.items.find((item) => item.id === movement.source!.lineId);
        const stockItem = order?.receipt?.stockItems?.find((item) => item.lineId === movement.source!.lineId);
        const reference = `${order?.id}:${movement.source.lineId}`;
        if (!order?.receipt || !line || !stockItem || stockItem.productId !== movement.productId ||
          movement.locationId !== order.receipt.locationId || movement.delta !== line.quantity ||
          movement.unitCost !== line.unitCost || purchaseMovements.has(reference))
          throw new Error("Entrada de estoque sem vínculo único com recebimento integral da compra.");
        purchaseMovements.add(reference);
      }
    } else if (movement.source?.type === "purchaseReturn") {
      const purchaseReturn = inventory.purchaseReturns.find((item) => item.id === movement.source!.referenceId);
      const item = purchaseReturn?.items.find((entry) => entry.lineId === movement.source!.lineId);
      const order = data.finance.purchasing?.orders.find((entry) => entry.id === purchaseReturn?.orderId);
      const reference = `${purchaseReturn?.id}:${movement.source.lineId}`;
      if (!purchaseReturn || !item || !order ||
        item.productId !== movement.productId || item.locationId !== movement.locationId ||
        movement.delta !== -item.quantity || movement.reason !== `Devolução ao fornecedor do pedido ${order.id}: ${purchaseReturn.reason}` ||
        movement.unitCost === undefined || movement.unitCost !== movement.averageCostBefore ||
        movement.averageCostAfter !== movement.averageCostBefore || purchaseReturnMovements.has(reference))
        throw new Error("Saída de estoque sem vínculo único com devolução da compra.");
      purchaseReturnMovements.add(reference);
    } else if (movement.source?.type === "consumption") {
      const reference = `${movement.source.referenceId}:${movement.source.lineId}`;
      const reservation = inventory.reservations.find((item) => item.id === movement.source!.referenceId);
      const line = reservation?.items.find((item) => item.lineId === movement.source!.lineId);
      if (!reservation || reservation.events.at(-1)?.status !== "Consumida" || !line ||
        line.productId !== movement.productId || movement.delta !== -line.quantity ||
        movement.unitCost === undefined || movement.averageCostAfter === undefined || consumptionMovements.has(reference))
        throw new Error("Baixa de estoque sem vínculo único com peças consumidas na OS.");
      consumptionMovements.add(reference);
    } else if (movement.source?.type === "consumptionReversal") {
      const reversal = inventory.consumptionReversals.find((item) => item.id === movement.source!.referenceId);
      const item = reversal?.items.find((entry) => entry.lineId === movement.source!.lineId);
      const reservation = inventory.reservations.find((entry) => entry.id === reversal?.reservationId);
      const original = data.movements.find((entry) => entry.source?.type === "consumption" &&
        entry.source.referenceId === reversal?.reservationId && entry.source.lineId === item?.lineId);
      const reference = `${reversal?.id}:${movement.source.lineId}`;
      if (!reversal || !item || !reservation || !original ||
        reservation.events.at(-1)?.status !== "Consumida" || item.productId !== movement.productId ||
        reservation.locationId !== movement.locationId || movement.delta !== item.quantity ||
        movement.unitCost === undefined || movement.unitCost !== movement.averageCostBefore ||
        movement.averageCostAfter !== movement.averageCostBefore || reversalMovements.has(reference))
        throw new Error("Reposição de peça sem vínculo único com estorno de consumo da OS.");
      reversalMovements.add(reference);
    } else if (movement.source?.type === "inventory") {
      const reference = movement.source.referenceId;
      if (!reference || inventoryMovements.has(reference))
        throw new Error("Contagem de inventário exige um vínculo único com seu movimento.");
      inventoryMovements.set(reference, movement);
    }
    if ((movement.unitCost === undefined) !== (movement.averageCostBefore === undefined) ||
      (movement.unitCost === undefined) !== (movement.averageCostAfter === undefined))
      throw new Error("Snapshot de custo incompleto na movimentação.");
    if (movement.averageCostAfter !== undefined && !costMovements.has(movement.productId))
      costMovements.set(movement.productId, movement);
  }
  for (const product of data.products) {
    const latestCost = costMovements.get(product.id);
    if (latestCost && product.cost !== latestCost.averageCostAfter)
      throw new Error("Custo médio atual diverge do último movimento de estoque.");
  }
  const previousAverageCosts = new Map<string, number>();
  for (const movement of [...data.movements].reverse()) {
    if (movement.averageCostBefore === undefined) continue;
    const stockBefore = movement.balance - movement.delta;
    const previousAverage = previousAverageCosts.get(movement.productId);
    if (previousAverage !== undefined && movement.averageCostBefore !== previousAverage)
      throw new Error("Histórico de custo médio não é contínuo.");
    if (movement.source?.type === "purchase") {
      const expected = stockBefore === 0 ? movement.unitCost! :
        Math.round((stockBefore * movement.averageCostBefore + movement.delta * movement.unitCost!) / movement.balance);
      if (movement.delta <= 0 || movement.averageCostAfter !== expected)
        throw new Error("Custo médio após compra diverge do cálculo ponderado.");
    } else if (movement.averageCostAfter !== movement.averageCostBefore) {
      throw new Error("Movimento que não é compra não pode recalcular o custo médio.");
    }
    previousAverageCosts.set(movement.productId, movement.averageCostAfter!);
  }
  if (new Set(inventory.counts.map((count) => count.id)).size !== inventory.counts.length ||
    inventory.counts.some((count) => {
      const movement = inventoryMovements.get(count.id);
      if (!movement || movement.productId !== count.productId || movement.locationId !== count.locationId ||
        movement.delta !== count.countedQuantity - count.systemQuantity ||
        movement.at !== count.at ||
        movement.reason !== `Inventário físico: sistema ${count.systemQuantity}, contado ${count.countedQuantity}. Justificativa: ${count.reason}`)
        return true;
      const movementIndex = data.movements.indexOf(movement);
      const systemQuantity = data.movements.slice(movementIndex + 1)
        .filter((item) => item.productId === count.productId && item.locationId === count.locationId)
        .reduce((sum, item) => sum + item.delta, 0);
      return systemQuantity !== count.systemQuantity;
    }) || inventoryMovements.size !== inventory.counts.length)
    throw new Error("Inventário físico divergente do livro de movimentações.");
  const chronologicalBalances = new Map<string, number>();
  for (const movement of [...data.movements].reverse()) {
    const balance = (chronologicalBalances.get(movement.productId) ?? 0) + movement.delta;
    if (movement.balance !== balance)
      throw new Error("Saldo histórico da movimentação diverge da sequência do livro de estoque.");
    chronologicalBalances.set(movement.productId, balance);
  }
  for (const product of data.products) {
    if (productBalances.get(product.id) !== product.stock)
      throw new Error("Saldo do produto diverge do livro de movimentações de estoque.");
  }
  for (const [key, balance] of locationBalances) {
    const [productId, locationId] = JSON.parse(key) as [string, string];
    if (balance < 0 || stockAvailable(data, productId, locationId) < 0)
      throw new Error("Estoque físico/reservado não pode ficar negativo.");
  }
  const activeOrders = new Set<string>();
  for (const reservation of inventory.reservations) {
    const status = reservation.events.at(-1)!.status;
    const order = data.orders.find((item) => item.id === reservation.orderId)!;
    const details = getOrderDetails(order);
    const productLines = details.items.filter((line) => line.kind === "produto");
    if (status === "Reservada") {
      if (activeOrders.has(reservation.orderId) || !["Em atendimento", "Pausada"].includes(order.status) ||
        details.stockLocationId !== reservation.locationId ||
        productLines.length !== reservation.items.length ||
        productLines.some((line) => !Number.isSafeInteger(line.quantity) ||
          !reservation.items.some((reserved) => reserved.lineId === line.id && reserved.productId === line.referenceId && reserved.quantity === line.quantity)))
        throw new Error("Reserva de estoque não corresponde às peças/status/localização atuais da OS.");
      if (reservation.items.some((item) => stockAvailable(data, item.productId, reservation.locationId) < 0))
        throw new Error("Reserva excede o saldo disponível no depósito.");
      for (const productId of new Set(reservation.items.map((item) => item.productId))) {
        const reserved = inventory.reservations.filter((item) => item.locationId === reservation.locationId &&
          item.events.at(-1)?.status === "Reservada").flatMap((item) => item.items)
          .filter((item) => item.productId === productId).reduce((sum, item) => sum + item.quantity, 0);
        if (stockLocationBalance(data, productId, reservation.locationId) < reserved)
          throw new Error("Reserva excede o saldo físico do depósito.");
      }
      activeOrders.add(reservation.orderId);
    }
    if (status === "Consumida" && (order.status !== "Finalizada" ||
      productLines.length !== reservation.items.length ||
      productLines.some((line) => !reservation.items.some((reserved) => reserved.lineId === line.id &&
        reserved.productId === line.referenceId && reserved.quantity === line.quantity))))
      throw new Error("Peças consumidas exigem OS finalizada e correspondência com as linhas de produto.");
    if (status === "Consumida" && reservation.items.some((item) =>
      !consumptionMovements.has(`${reservation.id}:${item.lineId}`)))
      throw new Error("Consumo de OS incompleto no livro de estoque.");
    if (status !== "Consumida" && consumptionMovements.size &&
      [...consumptionMovements].some((key) => key.startsWith(`${reservation.id}:`)))
      throw new Error("Movimentação consumida exige reserva finalizada.");
  }
  const purchaseReceiptIds = new Set<string>(), purchaseLineProducts = new Map<string, string>();
  const previousReceiptsAt = new Map<string, string>();
  const previousReceiptDates = new Map<string, string>();
  for (const receipt of inventory.purchaseReceipts) {
    const order = data.finance.purchasing?.orders.find((item) => item.id === receipt.orderId);
    if (!order || (order.cancellation && receipt.at > order.cancellation.at) || purchaseReceiptIds.has(receipt.id) ||
      !inventory.locations.some((location) => location.id === receipt.locationId) ||
      receipt.date < order.orderedOn || receipt.at < order.createdAt ||
      (previousReceiptsAt.get(receipt.orderId) ?? order.createdAt) > receipt.at ||
      (previousReceiptDates.get(receipt.orderId) ?? order.orderedOn) > receipt.date ||
      new Set(receipt.items.map((item) => item.lineId)).size !== receipt.items.length ||
      receipt.items.some((item) => !order.items.some((line) => line.id === item.lineId) ||
        !data.products.some((product) => product.id === item.productId) ||
        !purchaseMovements.has(`${receipt.id}:${item.lineId}`) ||
        (purchaseLineProducts.has(`${receipt.orderId}:${item.lineId}`) &&
          purchaseLineProducts.get(`${receipt.orderId}:${item.lineId}`) !== item.productId)))
      throw new Error("Recebimento parcial inválido ou sem movimento de estoque correspondente.");
    purchaseReceiptIds.add(receipt.id);
    previousReceiptsAt.set(receipt.orderId, receipt.at);
    previousReceiptDates.set(receipt.orderId, receipt.date);
    for (const item of receipt.items) purchaseLineProducts.set(`${receipt.orderId}:${item.lineId}`, item.productId);
  }
  for (const order of data.finance.purchasing?.orders ?? []) {
    const receipts = inventory.purchaseReceipts.filter((item) => item.orderId === order.id);
    let receivedAmount = 0;
    for (const line of order.items) {
      const receivedQuantity = receipts.flatMap((item) => item.items)
        .filter((item) => item.lineId === line.id)
        .reduce((sum, item) => sum + item.quantity, 0);
      receivedAmount += receivedQuantity * line.unitCost;
      if (receivedQuantity > line.quantity)
        throw new Error("Quantidade recebida excede a quantidade do pedido.");
      if (order.receipt && receivedQuantity !== line.quantity)
        throw new Error("Contas da compra só podem ser geradas quando todos os itens estiverem recebidos.");
    }
    if (order.cancellation && (receivedAmount !== (order.cancellation.receivedAmount ?? 0) ||
      (receivedAmount > 0) !== Boolean(order.cancellation.payableEntryIds?.length)))
      throw new Error("Cancelamento da compra diverge das quantidades e contas geradas pelo recebido.");
    const finalBatch = order.receipt?.batchId ? receipts.find((receipt) => receipt.id === order.receipt!.batchId) : undefined;
    if (order.receipt?.batchId && (!finalBatch || finalBatch.date !== order.receipt.date ||
      finalBatch.at !== order.receipt.at || finalBatch.locationId !== order.receipt.locationId ||
      finalBatch.reference !== order.receipt.reference || finalBatch.notes !== order.receipt.notes))
      throw new Error("Resumo final diverge da última entrega registrada.");
    if (order.receipt?.stockItems && (order.receipt.stockItems.length !== order.items.length ||
      new Set(order.receipt.stockItems.map((item) => item.lineId)).size !== order.items.length ||
      order.items.some((line) => {
        const stockItem = order.receipt!.stockItems!.find((item) => item.lineId === line.id);
        return !stockItem || stockItem.productId !== purchaseLineProducts.get(`${order.id}:${line.id}`);
      }) || (order.receipt.batchId && !finalBatch)))
      throw new Error("Resumo do recebimento final sem correspondência com os itens do pedido.");
  }
  const purchaseReturnIds = new Set<string>(), returnedPurchaseQuantities = new Map<string, number>();
  const returnedPurchaseLocationQuantities = new Map<string, number>();
  const returnedPurchaseOffsetTotals = new Map<string, number>();
  const purchaseReturnCreditEntries = new Set<string>();
  for (const purchaseReturn of inventory.purchaseReturns) {
    const order = data.finance.purchasing?.orders.find((item) => item.id === purchaseReturn.orderId);
    if (!order || purchaseReturnIds.has(purchaseReturn.id) ||
      purchaseReturn.date < order.orderedOn || purchaseReturn.at < order.createdAt ||
      !inventory.locations.some((location) => location.id === purchaseReturn.items[0]?.locationId) ||
      !unique(purchaseReturn.items.map((item) => item.lineId)) ||
      purchaseReturn.items.some((item) => {
        const key = `${purchaseReturn.orderId}:${item.lineId}`;
        const locationKey = `${key}:${item.locationId}`;
        const line = order.items.find((entry) => entry.id === item.lineId);
        const receiptRecords = inventory.purchaseReceipts.filter((receipt) => receipt.orderId === order.id &&
          receipt.items.some((receiptItem) => receiptItem.lineId === item.lineId && receiptItem.productId === item.productId));
        const receivedQuantity = receiptRecords.flatMap((receipt) => receipt.items.filter((receiptItem) =>
          receiptItem.lineId === item.lineId && receiptItem.productId === item.productId))
          .reduce((sum, receiptItem) => sum + receiptItem.quantity, 0) ||
          (order.receipt?.stockItems?.some((stockItem) => stockItem.lineId === item.lineId) ? line?.quantity ?? 0 : 0);
        const returnedQuantity = (returnedPurchaseQuantities.get(key) ?? 0) + item.quantity;
        const receivedAtLocation = receiptRecords.length
          ? receiptRecords.filter((receipt) => receipt.locationId === item.locationId)
            .flatMap((receipt) => receipt.items.filter((receiptItem) =>
              receiptItem.lineId === item.lineId && receiptItem.productId === item.productId))
            .reduce((sum, receiptItem) => sum + receiptItem.quantity, 0)
          : order.receipt?.locationId === item.locationId &&
            order.receipt.stockItems?.some((stockItem) =>
              stockItem.lineId === item.lineId && stockItem.productId === item.productId) ? line?.quantity ?? 0 : 0;
        const returnedAtLocation = (returnedPurchaseLocationQuantities.get(locationKey) ?? 0) + item.quantity;
        const receivedForProduct = inventory.purchaseReceipts.some((receipt) => receipt.orderId === order.id &&
          receipt.items.some((receiptItem) => receiptItem.lineId === item.lineId && receiptItem.productId === item.productId)) ||
          order.receipt?.stockItems?.some((stockItem) => stockItem.lineId === item.lineId && stockItem.productId === item.productId);
        const legacyReceipt = order.receipt?.stockItems?.some((stockItem) =>
          stockItem.lineId === item.lineId && stockItem.productId === item.productId) ? order.receipt : undefined;
        const earliestReceipt = receiptRecords.length
          ? receiptRecords.reduce((earliest, receipt) => receipt.at < earliest.at ? receipt : earliest)
          : legacyReceipt;
        if (!line || !receivedForProduct || returnedQuantity > receivedQuantity ||
            returnedAtLocation > receivedAtLocation ||
            !inventory.locations.some((location) => location.id === item.locationId) ||
            !earliestReceipt || purchaseReturn.date < earliestReceipt.date || purchaseReturn.at < earliestReceipt.at ||
            !purchaseReturnMovements.has(`${purchaseReturn.id}:${item.lineId}`)) return true;
        returnedPurchaseQuantities.set(key, returnedQuantity);
        returnedPurchaseLocationQuantities.set(locationKey, returnedAtLocation);
        return false;
      }))
      throw new Error("Devolução de compra inválida ou superior às quantidades recebidas.");
    if (purchaseReturn.financial) {
      const expectedAmount = purchaseReturn.items.reduce((sum, item) =>
        sum + item.quantity * (order.items.find((line) => line.id === item.lineId)?.unitCost ?? 0), 0);
      const offsetTotal = purchaseReturn.financial.payableOffsets.reduce((sum, offset) => sum + offset.amount, 0);
      const creditAmount = expectedAmount - offsetTotal;
      const creditEntry = purchaseReturn.financial.creditEntryId
        ? data.finance.entries.find((entry) => entry.id === purchaseReturn.financial!.creditEntryId) : undefined;
      if (purchaseReturn.financial.amount !== expectedAmount || offsetTotal > expectedAmount ||
        (creditAmount > 0 && (!creditEntry || creditEntry.purchaseReturnCreditId !== purchaseReturn.id ||
          creditEntry.kind !== "Receber" || creditEntry.party !== order.supplierName ||
          creditEntry.description !== `Crédito de devolução da compra ${order.id}` ||
          creditEntry.amount !== creditAmount || creditEntry.issuedOn !== purchaseReturn.date ||
          creditEntry.dueOn !== purchaseReturn.date || creditEntry.accountId !== order.accountId ||
          creditEntry.paymentMethod !== order.paymentMethod)) ||
        (creditAmount === 0 && (creditEntry || purchaseReturn.financial.creditEntryId)) ||
        purchaseReturn.financial.payableOffsets.some((offset) => {
          const entry = data.finance.entries.find((candidate) => candidate.id === offset.entryId);
          if (!entry || !(order.receipt?.entryIds ?? order.cancellation?.payableEntryIds ?? []).includes(entry.id) || entry.kind !== "Pagar" ||
            entry.purchaseId !== order.id || entry.purchaseReturnCreditId ||
            !(entry.purchaseReturnOffsets ?? []).some((item) => item.returnId === purchaseReturn.id && item.amount === offset.amount))
            return true;
          returnedPurchaseOffsetTotals.set(entry.id, (returnedPurchaseOffsetTotals.get(entry.id) ?? 0) + offset.amount);
          return false;
        }))
        throw new Error("Crédito ou abatimento financeiro da devolução de compra inválido.");
      if (creditEntry) purchaseReturnCreditEntries.add(creditEntry.id);
    }
    purchaseReturnIds.add(purchaseReturn.id);
  }
  for (const entry of data.finance.entries) {
    if ((entry.purchaseReturnOffsets ?? []).reduce((sum, offset) => sum + offset.amount, 0) !==
      (returnedPurchaseOffsetTotals.get(entry.id) ?? 0) ||
      (entry.purchaseReturnOffsets ?? []).some((offset) => !inventory.purchaseReturns.some((purchaseReturn) =>
        purchaseReturn.id === offset.returnId && purchaseReturn.financial?.payableOffsets.some((item) =>
          item.entryId === entry.id && item.amount === offset.amount))))
      throw new Error("Abatimentos financeiros não correspondem ao histórico das devoluções de compra.");
  }
  for (const entry of data.finance.entries.filter((item) => item.purchaseReturnCreditId)) {
    if (!purchaseReturnCreditEntries.has(entry.id))
      throw new Error("Crédito a receber sem devolução de compra correspondente.");
  }
  const reversalIds = new Set<string>(), reversedQuantities = new Map<string, number>();
  for (const reversal of inventory.consumptionReversals) {
    const reservation = inventory.reservations.find((item) => item.id === reversal.reservationId);
    const order = data.orders.find((item) => item.id === reservation?.orderId);
    if (!reservation || !order || order.status !== "Finalizada" ||
      reservation.events.at(-1)?.status !== "Consumida" ||
      reversalIds.has(reversal.id) || reversal.at < reservation.events.at(-1)!.at ||
      !unique(reversal.items.map((item) => item.lineId)) ||
      reversal.items.some((item) => {
        const reserved = reservation.items.find((line) => line.lineId === item.lineId);
        const original = data.movements.find((movement) => movement.source?.type === "consumption" &&
          movement.source.referenceId === reservation.id && movement.source.lineId === item.lineId);
        const key = `${reservation.id}:${item.lineId}`;
        const quantity = (reversedQuantities.get(key) ?? 0) + item.quantity;
        if (!reserved || !original || item.productId !== reserved.productId ||
          original.productId !== item.productId || quantity > -original.delta ||
          !reversalMovements.has(`${reversal.id}:${item.lineId}`)) return true;
        reversedQuantities.set(key, quantity);
        return false;
      }))
      throw new Error("Estorno de consumo inválido, excedente ou sem movimento correspondente.");
    reversalIds.add(reversal.id);
  }
  const transfers = new Map<string, StockMovement[]>();
  for (const movement of data.movements) if (movement.source?.type === "transfer") {
    const group = transfers.get(movement.source.referenceId!) ?? [];
    group.push(movement); transfers.set(movement.source.referenceId!, group);
  }
  for (const group of transfers.values()) if (group.length !== 2 || group[0].productId !== group[1].productId ||
    group[0].locationId === group[1].locationId || group[0].delta + group[1].delta !== 0)
    throw new Error("Transferência de estoque exige duas pontas correspondentes e atômicas.");
}

function appendStockMovement(data: Database, productId: string, locationId: string, delta: number,
  reason: string, source: StockMovement["source"] = { type: "manual" }, at = new Date().toISOString(),
  unitCost?: number, averageCostBefore?: number, averageCostAfter?: number): Database {
  const product = data.products.find((item) => item.id === productId);
  const location = data.inventory!.locations.find((item) => item.id === locationId && item.active);
  if (!product || !location) throw new Error("Produto ou localização de estoque indisponível.");
  if (!Number.isSafeInteger(delta) || (delta === 0 && source?.type !== "inventory"))
    throw new Error("Informe uma quantidade inteira diferente de zero.");
  if (delta < 0 && stockAvailable(data, productId, locationId) < -delta)
    throw new Error(`Saldo disponível insuficiente de ${product.name} em ${location.name}.`);
  const balance = product.stock + delta;
  if (balance < 0) throw new Error("Saldo físico insuficiente para esta saída.");
  const movement: StockMovement = {
    id: makeId(), productId, locationId, delta, reason: reason.trim(), balance, at, source,
    unitCost: unitCost ?? product.cost,
    averageCostBefore: averageCostBefore ?? product.cost,
    averageCostAfter: averageCostAfter ?? product.cost,
  };
  return {
    ...data,
    products: data.products.map((item) => item.id === productId ? { ...item, stock: balance } : item),
    movements: [movement, ...data.movements],
  };
}

export function receivePurchaseStock(data: Database, productId: string, locationId: string,
  quantity: number, unitCost: number, reason: string, source: StockMovement["source"]): Database {
  const product = data.products.find((item) => item.id === productId);
  if (!product) throw new Error("Produto nao encontrado.");
  if (!Number.isSafeInteger(quantity) || quantity <= 0 ||
    !Number.isSafeInteger(product.stock) || !Number.isSafeInteger(unitCost) || unitCost <= 0 || unitCost > 100_000_000)
    throw new Error("Quantidade ou custo unitário de compra inválido.");
  const totalQuantity = BigInt(product.stock) + BigInt(quantity);
  const averageCost = Number(
    (BigInt(product.stock) * BigInt(product.cost) + BigInt(quantity) * BigInt(unitCost) + totalQuantity / 2n) /
      totalQuantity,
  );
  const priced = {
    ...data,
    products: data.products.map((item) => item.id === productId ? { ...item, cost: averageCost } : item),
  };
  return appendStockMovement(priced, productId, locationId, quantity, reason, source,
    new Date().toISOString(), unitCost, product.cost, averageCost);
}

export function createStockLocation(data: Database, name: string) {
  const location = stockLocationSchema.parse({ id: makeId(), name, active: true });
  if (data.inventory!.locations.some((item) => item.name.toLocaleLowerCase("pt-BR") === location.name.toLocaleLowerCase("pt-BR")))
    throw new Error("Já existe uma localização com esse nome.");
  return validateDatabase({ ...data, inventory: { ...data.inventory!, locations: [...data.inventory!.locations, location] } });
}
export function setDefaultStockLocation(data: Database, locationId: string) {
  if (!data.inventory!.locations.some((item) => item.id === locationId && item.active))
    throw new Error("O depósito padrão deve estar ativo.");
  return validateDatabase({ ...data, inventory: { ...data.inventory!, defaultLocationId: locationId } });
}
export function transferStock(data: Database, productId: string, fromLocationId: string, toLocationId: string, quantity: number, reason: string) {
  if (fromLocationId === toLocationId || !reason.trim()) throw new Error("Selecione depósitos distintos e informe o motivo.");
  const referenceId = makeId();
  let result = appendStockMovement(data, productId, fromLocationId, -quantity, `Transferência para ${toLocationId}: ${reason}`,
    { type: "transfer", referenceId });
  result = appendStockMovement(result, productId, toLocationId, quantity, `Transferência de ${fromLocationId}: ${reason}`,
    { type: "transfer", referenceId });
  return validateDatabase(result);
}

export function moveStock(
  data: Database,
  productId: string,
  delta: number,
  reason: string,
  source: StockMovement["source"] = { type: "manual" },
  locationId = data.inventory!.defaultLocationId,
): Database {
  const product = data.products.find((record) => record.id === productId);
  if (!product) throw new Error("Produto nao encontrado.");
  if (!Number.isSafeInteger(delta) || delta === 0)
    throw new Error("Informe uma quantidade inteira maior que zero.");
  if (!reason.trim()) throw new Error("Informe o motivo da movimentacao.");
  if (delta < 0 && stockAvailable(data, productId, locationId) < -delta)
    throw new Error("Saldo insuficiente para esta saida.");
  return validateDatabase(recordStockMovement(data, productId, locationId, delta, reason, source));
}

export function countStock(data: Database, productId: string, locationId: string, countedQuantity: number, reason: string) {
  const product = data.products.find((record) => record.id === productId);
  const location = data.inventory!.locations.find((record) => record.id === locationId && record.active);
  if (!product || !location) throw new Error("Produto ou depósito ativo não encontrado.");
  if (!Number.isSafeInteger(countedQuantity) || countedQuantity < 0)
    throw new Error("A quantidade contada deve ser um número inteiro igual ou maior que zero.");
  const justification = reason.trim();
  if (!justification || justification.length > 700)
    throw new Error("Informe uma justificativa de até 700 caracteres.");
  const systemQuantity = stockLocationBalance(data, productId, locationId);
  const delta = countedQuantity - systemQuantity;
  if (delta < 0 && stockAvailable(data, productId, locationId) < -delta)
    throw new Error("A contagem não pode reduzir o saldo abaixo das peças reservadas.");
  const count: InventoryCount = {
    id: makeId(), productId, locationId, at: new Date().toISOString(),
    systemQuantity, countedQuantity, reason: justification,
  };
  const movement = appendStockMovement(data, productId, locationId, delta,
    `Inventário físico: sistema ${systemQuantity}, contado ${countedQuantity}. Justificativa: ${justification}`,
    { type: "inventory", referenceId: count.id }, count.at);
  return validateDatabase({
    ...movement,
    inventory: { ...movement.inventory!, counts: [count, ...movement.inventory!.counts] },
  });
}

export function recordStockMovement(data: Database, productId: string, locationId: string, delta: number,
  reason: string, source: StockMovement["source"] = { type: "manual" }) {
  return appendStockMovement(data, productId, locationId, delta, reason, source);
}

export function changeOrderStatus(
  data: Database,
  orderId: string,
  next: OrderStatus,
): Database {
  const order = data.orders.find((record) => record.id === orderId);
  if (!order) throw new Error("OS nao encontrada.");
  const details = getOrderDetails(order);
  if (next === "Finalizada" && (details.questionnaireRequired !== undefined || details.checklists.some((item) => item.templateId)) && orderPending(order).length)
    throw new Error("Resolva as pendencias antes de finalizar a tarefa.");
  const lastActivity = details.activities.at(-1);
  if (
    next === "Finalizada" &&
    lastActivity &&
    lastActivity.kind !== "Check-out"
  )
    throw new Error(
      "Registre o check-out antes de finalizar uma OS com atividade aberta.",
    );
  const hasProductLines = getOrderDetails(order).items.some((item) => item.kind === "produto");
  let result = data;
  let reservation = activeReservation(result, orderId);
  if (next === "Em atendimento" || next === "Pausada") {
    if (hasProductLines && !reservation) result = reserveOrder(result, order);
  }
  if (order.status === "Em atendimento" || order.status === "Pausada") {
    if (next === "Aberta" && reservation) {
      result = updateReservation(result, reservation, "Liberada", `Reserva liberada ao retornar ${order.code} para Aberta`);
      reservation = undefined;
    }
  }
  if (next === "Finalizada" && hasProductLines) {
    if (!reservation) {
      result = reserveOrder(result, order);
      reservation = activeReservation(result, orderId);
    }
    if (reservation) {
      result = updateReservation(result, reservation, "Consumida", `Peças consumidas ao finalizar ${order.code}`);
      for (const line of reservation.items)
        result = appendStockMovement(result, line.productId, reservation.locationId, -line.quantity,
          `Consumo automático na OS ${order.code}`, { type: "consumption", referenceId: reservation.id, lineId: line.lineId });
    }
  }
  if (order.status === next) return validateDatabase(result);
  return validateDatabase({
    ...result,
    orders: result.orders.map((record) =>
      record.id === orderId
        ? {
            ...record,
            status: next,
            history: [
              ...record.history,
              {
                id: makeId(),
                at: new Date().toISOString(),
                description: `Status: ${order.status} -> ${next}`,
              },
            ],
          }
        : record,
    ),
  });
}

export function nextCode(
  collection: { code: string }[],
  prefix: string,
): string {
  const next =
    Math.max(
      0,
      ...collection.map(
        (record) => Number(record.code.replace(prefix + "-", "")) || 0,
      ),
    ) + 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

export function convertQuote(data: Database, quoteId: string): Database {
  const quote = data.quotes.find((record) => record.id === quoteId);
  if (!quote) throw new Error("Orcamento nao encontrado.");
  if (quote.status !== "Aprovado")
    throw new Error("Aprove o orcamento antes de gerar a OS.");
  if (quote.orderId) throw new Error("Este orcamento ja possui uma OS.");
  const orderId = makeId();
  const order: Order = {
    id: orderId,
    code: nextCode(data.orders, "OS"),
    clientId: quote.clientId,
    equipmentId: "",
    title: `Atendimento do ${quote.code}`,
    technician: data.settings.technician,
    technicianUserId: "",
    date: localDay(),
    time: "09:00",
    duration: 60,
    type: "Corretiva",
    priority: "Media",
    status: "Aberta",
    details: orderDetailsSchema.parse({
      createdAt: new Date().toISOString(), ...defaultQuestionnaires(data, "Corretiva"),
      equipmentModels: structuredClone(quote.equipmentModels),
    }),
    notes: `${quote.notes}\n\n${quote.items.map((item) => `${item.quantity} x ${item.name}: ${currency(item.price)}`).join("\n")}\nTotal: ${currency(total(quote))}`,
    history: [
      {
        id: makeId(),
        at: new Date().toISOString(),
        description: `Criada a partir do ${quote.code}`,
      },
    ],
  };
  return validateDatabase({
    ...data,
    orders: [...data.orders, order],
    quotes: data.quotes.map((record) =>
      record.id === quoteId ? { ...record, orderId } : record,
    ),
  });
}

export function demoDatabase(): Database {
  const today = localDay();
  const clients: Client[] = [
    {
      id: "demo-client-1",
      name: "Academia Horizonte (demo)",
      document: "",
      phone: "(47) 0000-0000",
      email: "",
      address: "Rua das Palmeiras, 120 - Centro",
      group: "Academias",
      active: true,
    },
    {
      id: "demo-client-2",
      name: "Condominio Jardim (demo)",
      document: "",
      phone: "(47) 0000-0001",
      email: "",
      address: "Avenida Central, 480",
      group: "Condominios",
      active: true,
    },
    {
      id: "demo-client-3",
      name: "Studio Movimento (demo)",
      document: "",
      phone: "",
      email: "",
      address: "Rua do Sol, 55",
      group: "Academias",
      active: true,
    },
  ];
  const products: Product[] = [
    {
      id: "demo-product-1",
      name: "Correia de transmissao",
      code: "PC-001",
      price: 18500,
      cost: 9500,
      stock: 8,
      minimum: 3,
    },
    {
      id: "demo-product-2",
      name: "Rolamento 6203",
      code: "PC-002",
      price: 4200,
      cost: 1800,
      stock: 2,
      minimum: 4,
    },
    {
      id: "demo-product-3",
      name: "Lubrificante para esteira 500ml",
      code: "PC-003",
      price: 6500,
      cost: 3200,
      stock: 12,
      minimum: 5,
    },
    {
      id: "demo-product-4",
      name: "Cabo de aco revestido",
      code: "PC-004",
      price: 12000,
      cost: 6800,
      stock: 0,
      minimum: 2,
    },
  ];
  const services: Service[] = [
    { id: "demo-service-1", name: "Manutencao preventiva", price: 25000 },
    { id: "demo-service-2", name: "Visita tecnica", price: 15000 },
    { id: "demo-service-3", name: "Instalacao de equipamento", price: 35000 },
  ];
  const equipment: Equipment[] = [
    {
      id: "demo-equipment-1",
      name: "Esteira profissional",
      serial: "DEMO-EST-001",
      clientId: clients[0].id,
      category: "Cardio",
      warranty: shiftDay(today, 180),
      notes: "Revisar transmissao e alinhamento da lona.",
    },
    {
      id: "demo-equipment-2",
      name: "Estacao de musculacao",
      serial: "DEMO-MUS-002",
      clientId: clients[1].id,
      category: "Musculacao",
      warranty: "",
      notes: "Inspecao de cabos e roldanas.",
    },
    {
      id: "demo-equipment-3",
      name: "Bicicleta de spinning",
      serial: "DEMO-BIK-003",
      clientId: clients[2].id,
      category: "Cardio",
      warranty: shiftDay(today, -30),
      notes: "",
    },
  ];
  const orders: Order[] = [
    {
      id: "demo-order-1",
      code: "OS-0001",
      clientId: clients[0].id,
      equipmentId: equipment[0].id,
      title: "Revisao preventiva da esteira",
      technician: "Tecnico Alpha",
      technicianUserId: "",
      date: today,
      time: "09:00",
      duration: 90,
      type: "Preventiva",
      priority: "Media",
      status: "Aberta",
      notes: "Verificar lona, correia e lubrificacao.",
      history: [],
    },
    {
      id: "demo-order-2",
      code: "OS-0002",
      clientId: clients[1].id,
      equipmentId: equipment[1].id,
      title: "Troca do cabo de aco",
      technician: "Tecnico Alpha",
      technicianUserId: "",
      date: today,
      time: "14:00",
      duration: 60,
      type: "Corretiva",
      priority: "Alta",
      status: "Em atendimento",
      notes: "Equipamento com cabo danificado.",
      history: [],
    },
    {
      id: "demo-order-3",
      code: "OS-0003",
      clientId: clients[2].id,
      equipmentId: equipment[2].id,
      title: "Diagnostico de ruido no pedal",
      technician: "Tecnico Alpha",
      technicianUserId: "",
      date: shiftDay(today, 1),
      time: "10:30",
      duration: 60,
      type: "Visita tecnica",
      priority: "Baixa",
      status: "Aberta",
      notes: "",
      history: [],
    },
    {
      id: "demo-order-4",
      code: "OS-0004",
      clientId: clients[0].id,
      equipmentId: equipment[0].id,
      title: "Inspecao de seguranca",
      technician: "Tecnico Alpha",
      technicianUserId: "",
      date: shiftDay(today, -1),
      time: "11:00",
      duration: 60,
      type: "Preventiva",
      priority: "Media",
      status: "Finalizada",
      notes: "Inspecao concluida.",
      history: [],
    },
  ];
  const quotes: Quote[] = [
    {
      id: "demo-quote-1",
      code: "ORC-0001",
      clientId: clients[0].id,
      date: today,
      expires: shiftDay(today, 15),
      status: "Rascunho",
      items: [
        {
          id: "demo-line-1",
          kind: "produto",
          referenceId: products[0].id,
          name: products[0].name,
          quantity: 1,
          price: products[0].price,
        },
        {
          id: "demo-line-2",
          kind: "servico",
          referenceId: services[0].id,
          name: services[0].name,
          quantity: 1,
          price: services[0].price,
        },
      ],
      discount: 0,
      notes: "Pagamento a combinar. Pecas e mao de obra inclusas.",
      orderId: "",
      equipmentModels: [],
    },
  ];
  return validateDatabase({
    version: 1,
    clients,
    equipment,
    products,
    services,
    orders,
    quotes,
    maintenanceContracts: [],
    maintenanceEquipmentTypes: [],
    movements: [],
    expenses: [],
    settings: { company: "Alpha Tec", technician: "Tecnico Alpha", logo: "" },
  });
}
