import { describe, expect, it } from "vitest";
import {
  appendActivity, changeOrderStatus, convertQuote, defaultQuestionnaires, demoDatabase, getOrderDetails, instantiateQuestionnaire,
  orderPending, replicateOrder, validateDatabase, validateOrderDetails,
} from "./domain";
import type { Database, Order, QuestionnaireTemplate } from "./domain";
import { archiveQuestionnaire, saveQuestionnaire } from "./questionnaires";
import { questionnaireDisplaySchema } from "./questionnaireSchema";
import { questionnaireRows } from "./reporting";

function template(): QuestionnaireTemplate {
  return {
    id: "template", title: "Inspeção", revision: 1, archived: false, requiredForCheckout: true,
    header: "Verifique o equipamento", footer: "Fim da inspeção",
    display: questionnaireDisplaySchema.parse({ equipment: true, columns: 2 }),
    questions: [
      { id: "text", label: "Relato", kind: "Area de texto", required: true, options: [], description: "Descreva o teste" },
      { id: "choices", label: "Testes", kind: "Multipla escolha", required: true, options: ["Motor", "Freio"] },
      { id: "tech-sign", label: "Assinatura do técnico", kind: "Assinatura", required: true, options: [] },
      { id: "client-sign", label: "Assinatura do cliente", kind: "Assinatura", required: true, options: [] },
      { id: "photo", label: "Foto", kind: "Foto", required: true, options: [], photoMetadata: true },
    ],
  };
}
function fixture() {
  const data = saveQuestionnaire(demoDatabase(), template());
  const order = {
    ...data.orders[0],
    details: { ...getOrderDetails(data.orders[0]), questionnaireRequired: true, checklists: [instantiateQuestionnaire(data.questionnaires[0])] },
  };
  data.orders[0] = order;
  return { data, order };
}
const signature = { signer: "Técnico", image: "data:image/png;base64,AAAA", at: "2026-10-10T12:00:00.000Z" };

describe("catálogo e snapshots de questionários", () => {
  it("abre backups antigos sem catálogo, apresentação ou assinaturas por pergunta", () => {
    const { questionnaires: _templates, orderTypeQuestionnaires: _types, ...old } = demoDatabase();
    expect(validateDatabase(old).questionnaires).toEqual([]);
    expect(validateDatabase(old).orderTypeQuestionnaires).toEqual([]);
    const order = { ...old.orders[0], details: { ...getOrderDetails(old.orders[0]), signature, checklists: [{
      id: "old", title: "Antigo", equipmentId: "", questions: [{ id: "signature", label: "Assinatura", kind: "Assinatura" as const, required: true, options: [], answer: "" }],
    }] } };
    expect(orderPending(order)).toEqual([]);
    expect(() => validateOrderDetails({ ...old.orders[0], details: { ...getOrderDetails(old.orders[0]), checklists: [{
      id: "old-choice", title: "Legado", equipmentId: "", questions: [{ id: "q", label: "Escolha antiga", kind: "Escolha", required: false, options: [], answer: "" }],
    }] } }, validateDatabase(old))).not.toThrow();
  });
  it("copia modelos e opções, com IDs de instâncias e respostas independentes", () => {
    const model = template();
    const first = instantiateQuestionnaire(model);
    const second = instantiateQuestionnaire(model);
    expect(first.id).not.toBe(second.id);
    expect(first.templateId).toBe(model.id);
    expect(first.templateRevision).toBe(1);
    expect(first.requiredForCheckout).toBe(true);
    expect(first.questions[1].answer).toEqual([]);
    expect(first.questions[2].signature).toBeNull();
    first.questions[1].options.push("Extra");
    first.display!.columns = 4;
    expect(second.questions[1].options).toEqual(["Motor", "Freio"]);
    expect(model.questions[1].options).toEqual(["Motor", "Freio"]);
    expect(model.display.columns).toBe(2);
  });
  it("edita, arquiva e restaura modelos sem alterar tarefas existentes", () => {
    const { data, order } = fixture();
    const oldOrder = structuredClone(order);
    const edited = saveQuestionnaire(data, { ...template(), title: "Nova inspeção" });
    expect(edited.questionnaires[0].revision).toBe(2);
    expect(edited.orders[0]).toEqual(oldOrder);
    const configured = { ...edited, orderTypeQuestionnaires: [{ type: "Preventiva" as const, questionnaireId: "template", required: true }] };
    const archived = archiveQuestionnaire(configured, "template");
    expect(archived.orderTypeQuestionnaires[0]).toMatchObject({ questionnaireId: "", required: true });
    expect(archived.orders[0]).toEqual(oldOrder);
    expect(() => instantiateQuestionnaire(archived.questionnaires[0])).toThrow("arquivado");
    const restored = saveQuestionnaire(archived, { ...archived.questionnaires[0], archived: false });
    expect(restored.questionnaires[0]).toMatchObject({ archived: false, revision: 4 });
    expect(() => saveQuestionnaire(restored, template())).toThrow("outra sessão");
  });
  it("aplica padrão e obrigatoriedade às novas tarefas, incluindo conversão de orçamento", () => {
    const { data } = fixture();
    data.orderTypeQuestionnaires = [{ type: "Corretiva", questionnaireId: "template", required: true }];
    expect(defaultQuestionnaires(data, "Corretiva")).toMatchObject({ questionnaireRequired: true, checklists: [{ templateId: "template", templateRevision: 1 }] });
    expect(defaultQuestionnaires(data, "Instalacao")).toEqual({ questionnaireRequired: false, checklists: [] });
    const quote = data.quotes[0];
    quote.status = "Aprovado"; quote.orderId = "";
    const converted = convertQuote(data, quote.id);
    expect(getOrderDetails(converted.orders.at(-1)!).checklists[0].templateId).toBe("template");
  });
  it("valida padrões, IDs, opções e limites do editor", () => {
    const data = demoDatabase();
    expect(() => saveQuestionnaire(data, { ...template(), questions: [] })).toThrow();
    expect(() => saveQuestionnaire(data, { ...template(), questions: Array.from({ length: 201 }, (_, index) => ({ ...template().questions[0], id: String(index) })) })).toThrow();
    expect(() => saveQuestionnaire(data, { ...template(), questions: [template().questions[0], template().questions[0]] })).toThrow("duplicados");
    expect(() => saveQuestionnaire(data, { ...template(), questions: [{ ...template().questions[1], options: ["Motor", "Motor"] }] })).toThrow("distintas");
    expect(() => validateDatabase({ ...data, orderTypeQuestionnaires: [{ type: "Corretiva", questionnaireId: "missing", required: false }] })).toThrow("indisponivel");
  });
  it("respeita habilitação e associação de equipamento", () => {
    const model = template();
    expect(() => instantiateQuestionnaire({ ...model, display: { ...model.display, equipment: false } }, "eq")).toThrow("equipamento");
    const { data, order } = fixture();
    order.details.checklists[0].equipmentId = "missing";
    expect(() => validateOrderDetails(order, data)).toThrow("nao associado");
    order.details.checklists[0].equipmentId = order.equipmentId;
    expect(() => validateOrderDetails(order, data)).not.toThrow();
  });
  it("mantém cada assinatura obrigatória independente da assinatura geral", () => {
    const { order } = fixture();
    order.details.signature = signature;
    expect(orderPending(order)).toHaveLength(5);
    order.details.checklists[0].questions[2].signature = signature;
    expect(orderPending(order)).toHaveLength(4);
    expect(orderPending(order).map((item) => item.title)).toContain("Assinatura do cliente");
    order.details.checklists[0].questions[3].signature = { ...signature, signer: "Cliente" };
    expect(orderPending(order)).toHaveLength(3);
    order.details.checklists[0].questions[2].signature = null;
    expect(orderPending(order)).toHaveLength(4);
  });
  it("gera pendências exclusivas por instância e exige questionário se solicitado", () => {
    const { order } = fixture();
    order.details.checklists.push(instantiateQuestionnaire(template()));
    const pending = orderPending(order);
    expect(pending).toHaveLength(10);
    expect(new Set(pending.map((item) => item.id)).size).toBe(10);
    order.details.checklists = [];
    expect(orderPending(order)[0].title).toBe("Adicionar questionário obrigatório");
  });
  it("bloqueia check-out e finalização de novas tarefas com respostas obrigatórias pendentes", () => {
    const { data, order } = fixture();
    expect(() => changeOrderStatus(data, order.id, "Finalizada")).toThrow("pendencias");
    expect(() => appendActivity(data, order.id, { id: "out", kind: "Check-out", at: signature.at, technician: order.technician, reason: "", justification: "", origin: "Web local" })).toThrow("pendencias");
  });
  it("preserva o bloqueio dos modelos antigos e copia a opção sem alterar tarefas existentes", () => {
    const { requiredForCheckout: _requirement, ...legacy } = template();
    const data = validateDatabase({ ...demoDatabase(), questionnaires: [legacy] });
    expect(data.questionnaires[0].requiredForCheckout).toBe(true);
    const { data: configured, order } = fixture();
    const edited = saveQuestionnaire(configured, { ...template(), requiredForCheckout: false });
    expect(getOrderDetails(edited.orders[0]).checklists[0].requiredForCheckout).toBe(true);
    expect(instantiateQuestionnaire(edited.questionnaires[0]).requiredForCheckout).toBe(false);
    delete order.details.checklists[0].requiredForCheckout;
    expect(orderPending(order)).toHaveLength(5);
  });
  it("questionário opcional não bloqueia finalização, mas pendências manuais e outros modelos continuam obrigatórios", () => {
    const { data, order } = fixture();
    order.details.checklists[0].requiredForCheckout = false;
    expect(orderPending(order)).toEqual([]);
    expect(changeOrderStatus(data, order.id, "Finalizada").orders[0].status).toBe("Finalizada");
    const started = appendActivity(data, order.id, { id: "in", kind: "Check-in", at: "2026-10-10T11:00:00.000Z", technician: order.technician, reason: "", justification: "", origin: "Web local" });
    expect(appendActivity(started, order.id, { id: "out", kind: "Check-out", at: signature.at, technician: order.technician, reason: "", justification: "", origin: "Web local" }).orders[0].status).toBe("Finalizada");
    order.details.pending.push({ id: "manual", title: "Conferir", resolved: false });
    expect(orderPending(order)).toHaveLength(1);
    expect(() => changeOrderStatus(data, order.id, "Finalizada")).toThrow("pendencias");
    order.details.checklists.push(instantiateQuestionnaire(template()));
    expect(orderPending(order)).toHaveLength(6);
    expect(() => appendActivity(data, order.id, { id: "out", kind: "Check-out", at: signature.at, technician: order.technician, reason: "", justification: "", origin: "Web local" })).toThrow("pendencias");
    const replicated = replicateOrder(data, order.id, "2026-10-20", "09:00");
    expect(getOrderDetails(replicated.orders.at(-1)!).checklists[0].requiredForCheckout).toBe(false);
  });
  it("replica estrutura sem copiar respostas, fotos ou assinaturas", () => {
    const { data, order } = fixture();
    order.details.checklists[0].questions[0].answer = "Respondido";
    order.details.checklists[0].questions[2].signature = signature;
    const replicated = replicateOrder(data, order.id, "2026-10-20", "09:00");
    const details = getOrderDetails(replicated.orders.at(-1)!);
    expect(details.questionnaireRequired).toBe(true);
    expect(details.checklists[0].templateRevision).toBe(1);
    expect(details.checklists[0].questions[0].answer).toBe("");
    expect(details.checklists[0].questions[2].signature).toBeNull();
    expect(details.attachments).toEqual([]);
  });
  it("relatórios usam assinante e nome de foto, não IDs, e respeitam perguntas não respondidas", () => {
    const { data, order } = fixture();
    order.details.checklists[0].questions[2].signature = signature;
    order.details.attachments = [{ id: "attachment", name: "foto.jpg", mime: "image/jpeg", size: 3, data: "data:image/jpeg;base64,AAAA", at: signature.at }];
    order.details.checklists[0].questions[4].answer = "attachment";
    const rows = questionnaireRows(data, [order]);
    expect(rows.find((row) => row.question === "Foto")?.answer).toBe("foto.jpg");
    expect(rows.find((row) => row.question === "Assinatura do técnico")?.answer).toContain("Técnico");
    order.details.checklists[0].display!.showUnanswered = false;
    expect(questionnaireRows(data, [order])).toHaveLength(2);
  });
  it.each([
    ["Numero", "abc"], ["Numero", "0x10"], ["Monetaria", "Infinity"], ["Data", "2026-02-31"], ["Hora", "25:00"], ["Check", "talvez"], ["CPF/CNPJ", "123"], ["Foto", "missing"],
  ] as const)("rejeita resposta inválida do tipo %s", (kind, answer) => {
    const data: Database = demoDatabase();
    const order: Order = { ...data.orders[0], details: { ...getOrderDetails(data.orders[0]), checklists: [{ id: "check", title: "Validação", equipmentId: "", questions: [{ id: "q", label: "Valor", kind, required: false, options: [], answer }] }] } };
    expect(() => validateOrderDetails(order, data)).toThrow();
  });
});
