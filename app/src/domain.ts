import { z } from "zod";
import type { CompanyRegistration } from "./cnpj";
import { isValidCnpj, normalizeCnpj } from "./cnpj";
import { isValidCpf } from "./cpf";
import { orderTypeQuestionnaireSchema, questionnaireDisplaySchema, questionnaireTemplateSchema, questionDefinitionSchema, requiresJustification, signatureSchema } from "./questionnaireSchema";
import type { QuestionnaireTemplate } from "./questionnaireSchema";
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
const lineSchema = z.object({
  id,
  kind: z.enum(["produto", "servico"]),
  referenceId: id,
  name: text,
  quantity: z.number().positive().max(10000),
  price: money,
});
const eventSchema = z.object({ id, at: z.iso.datetime(), description: text });
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
const activitySchema = z.object({
  id,
  kind: z.enum(["Deslocamento", "Check-in", "Pausa", "Retorno", "Check-out"]),
  at: z.iso.datetime(),
  technician: text,
  reason: z.string().max(1000),
  justification: z.string().max(1000),
  origin: z.enum(["Web local", "Android"]),
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
  responsibleName: z.string().trim().max(160).optional(),
  responsiblePhone: z.string().trim().max(40).optional(),
  tags: z.array(text).default([]),
  checkInMode: z.enum(["Manual", "Automatico"]).default("Manual"),
  distanceKm: z.number().nonnegative().max(100000).default(0),
  equipmentIds: z.array(id).default([]),
  equipmentModels: z.array(equipmentSelectionSchema).default([]),
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
  at: z.iso.datetime(),
  delta: z
    .number()
    .int()
    .refine((value) => value !== 0),
  reason: text,
  balance: z.number().int().nonnegative(),
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
  clients: z.array(clientSchema),
  equipment: z.array(equipmentSchema),
  equipmentBrands: z.array(equipmentBrandSchema).default([]),
  equipmentModels: z.array(equipmentModelSchema).default([]),
  products: z.array(productSchema),
  services: z.array(serviceSchema),
  orders: z.array(orderSchema),
  quotes: z.array(quoteSchema),
  movements: z.array(movementSchema),
  expenses: z.array(expenseSchema).default([]),
  questionnaires: z.array(questionnaireTemplateSchema).default([]),
  orderTypeQuestionnaires: z.array(orderTypeQuestionnaireSchema).default([]),
  settings: z.object({
    company: text,
    technician: text,
    kilometerRate: money.default(0),
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
    phone: z.string().max(100).default(""),
    email: z.string().max(320).default(""),
    registrationData: z.record(z.string(), z.unknown()).default({}),
  }),
});
export type Database = z.infer<typeof databaseSchema>;
export type Client = z.infer<typeof clientSchema>;
export type Equipment = z.infer<typeof equipmentSchema>;
export type EquipmentBrand = z.infer<typeof equipmentBrandSchema>;
export type EquipmentModel = z.infer<typeof equipmentModelSchema>;
export type EquipmentSelection = z.infer<typeof equipmentSelectionSchema>;
export type Product = z.infer<typeof productSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type Order = z.infer<typeof orderSchema>;
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
  const location = order.details?.serviceLocation;
  if (!location || location.useClientAddress) return client.address;
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
  const discount =
    details.discountMode === "%"
      ? Math.round(((items + costs) * details.discount) / 100)
      : Math.round(details.discount);
  return { items, costs, discount, total: items + costs - discount };
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
  return validateDatabase({
    ...data,
    orders: data.orders.map((item) =>
      item.id === orderId
        ? {
            ...item,
            details: update(getOrderDetails(item)),
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
export function replicateOrder(
  data: Database,
  orderId: string,
  date: string,
  time: string,
): Database {
  const original = data.orders.find((item) => item.id === orderId);
  if (!original) throw new Error("OS nao encontrada.");
  const originalDetails = getOrderDetails(original);
  const details = {
    ...originalDetails,
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
      phone: registration?.phone ?? "",
      email: registration?.email ?? "",
      registrationData: registration?.raw ?? {},
    },
  });
}

export function validateDatabase(input: unknown): Database {
  const data = databaseSchema.parse(input);
  for (const collection of [
    data.clients,
    data.equipment,
    data.equipmentBrands,
    data.equipmentModels,
    data.products,
    data.services,
    data.orders,
    data.quotes,
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
  for (const collection of [data.orders, data.quotes]) {
    if (
      new Set(collection.map((record) => record.code)).size !==
      collection.length
    )
      throw new Error("Codigos de documentos duplicados.");
  }
  return data;
}

export function moveStock(
  data: Database,
  productId: string,
  delta: number,
  reason: string,
): Database {
  const product = data.products.find((record) => record.id === productId);
  if (!product) throw new Error("Produto nao encontrado.");
  if (!Number.isSafeInteger(delta) || delta === 0)
    throw new Error("Informe uma quantidade inteira maior que zero.");
  if (!reason.trim()) throw new Error("Informe o motivo da movimentacao.");
  const balance = product.stock + delta;
  if (balance < 0) throw new Error("Saldo insuficiente para esta saida.");
  return validateDatabase({
    ...data,
    products: data.products.map((record) =>
      record.id === productId ? { ...record, stock: balance } : record,
    ),
    movements: [
      {
        id: makeId(),
        productId,
        delta,
        balance,
        reason,
        at: new Date().toISOString(),
      },
      ...data.movements,
    ],
  });
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
  if (order.status === next) return data;
  return validateDatabase({
    ...data,
    orders: data.orders.map((record) =>
      record.id === orderId
        ? {
            ...record,
            status: next,
            history: [
              ...record.history,
              {
                id: makeId(),
                at: new Date().toISOString(),
                description: `Status: ${record.status} -> ${next}`,
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
    movements: [],
    expenses: [],
    settings: { company: "Alpha Tec", technician: "Tecnico Alpha", logo: "" },
  });
}
