import { describe, expect, it } from "vitest";
import {
  appendActivity, changeOrderStatus, convertQuote, defaultQuestionnaires, demoDatabase, getOrderDetails, instantiateQuestionnaire,
  orderPending, replicateOrder, validateDatabase, validateOrderDetails,
} from "./domain";
import type { Database, Order, QuestionnaireTemplate } from "./domain";
import { addQuestionnaire, archiveQuestionnaire, orderEquipmentQuestionnaires, saveQuestionnaire } from "./questionnaires";
import { questionnaireDisplaySchema } from "./questionnaireSchema";
import { questionnaireRows } from "./reporting";
import { questionAnswerText, withQuestionAnswer } from "./questionnaireAnswers";

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

describe("equipamentos e questionários na criação da OS", () => {
  function setup() {
    const data = saveQuestionnaire(saveQuestionnaire(demoDatabase(), template()), { ...template(), id: "second", title: "Outro questionário" });
    const first = data.equipment[0];
    const second = { ...first, id: "second-unit", serial: "SECOND-UNIT" };
    data.equipment.push(second);
    return { data, first, second, picks: [
      { equipmentId: first.id, questionnaireId: "template" },
      { equipmentId: second.id, questionnaireId: "second" },
    ] };
  }
  it("associa todas as unidades e cria questionários diferentes por equipamento", () => {
    const { data, first, second, picks } = setup();
    const result = orderEquipmentQuestionnaires(data, first.clientId, picks, []);
    expect(result.equipmentId).toBe(first.id);
    expect(result.equipmentIds).toEqual([second.id]);
    expect(result.checklists.map((item) => [item.equipmentId, item.templateId])).toEqual([[first.id, "template"], [second.id, "second"]]);
    const order = { ...data.orders[0], clientId: first.clientId, equipmentId: result.equipmentId,
      details: { ...getOrderDetails(data.orders[0]), equipmentIds: result.equipmentIds, checklists: result.checklists } };
    expect(() => validateOrderDetails(order, data)).not.toThrow();
  });
  it("permite o mesmo modelo com respostas e instâncias independentes", () => {
    const { data, first, picks } = setup();
    const result = orderEquipmentQuestionnaires(data, first.clientId, picks.map((item) => ({ ...item, questionnaireId: "template" })), []);
    expect(result.checklists[0].id).not.toBe(result.checklists[1].id);
    result.checklists[0].questions[0].answer = "Revisado";
    expect(result.checklists[1].questions[0].answer).toBe("");
    expect(data.questionnaires[0].questions[0]).not.toHaveProperty("answer");
  });
  it("mantém seleção de equipamentos opcional", () => {
    const { data, first } = setup();
    const general = instantiateQuestionnaire(data.questionnaires[0]);
    expect(orderEquipmentQuestionnaires(data, first.clientId, [], [general])).toEqual({ equipmentId: "", equipmentIds: [], checklists: [general] });
  });
  it("não obriga adicionar questionário ao editar um vínculo legado", () => {
    const { data, first, picks } = setup();
    const result = orderEquipmentQuestionnaires(data, first.clientId, [{ ...picks[0], questionnaireId: "" }], [], [first.id]);
    expect(result).toEqual({ equipmentId: first.id, equipmentIds: [], checklists: [] });
  });
  it("impede equipamento de outro cliente e IDs duplicados", () => {
    const { data, first, picks } = setup();
    expect(() => orderEquipmentQuestionnaires(data, "other-client", picks, [])).toThrow("não pertence");
    expect(() => orderEquipmentQuestionnaires(data, first.clientId, [picks[0], picks[0]], [])).toThrow("apenas uma vez");
  });
  it("exige questionário ativo e compatível para cada unidade nova", () => {
    const { data, first, picks } = setup();
    expect(() => orderEquipmentQuestionnaires(data, first.clientId, [{ ...picks[0], questionnaireId: "" }], [])).toThrow("cada equipamento");
    data.questionnaires[0].archived = true;
    expect(() => orderEquipmentQuestionnaires(data, first.clientId, picks, [])).toThrow("indisponível");
    data.questionnaires[0].archived = false;
    data.questionnaires[0].display.equipment = false;
    expect(() => orderEquipmentQuestionnaires(data, first.clientId, picks, [])).toThrow("não permite");
  });
  it("preserva respostas existentes e não duplica o questionário da unidade", () => {
    const { data, first, picks } = setup();
    const existing = instantiateQuestionnaire(data.questionnaires[0], first.id);
    existing.questions[0].answer = "Manutenção anterior";
    const result = orderEquipmentQuestionnaires(data, first.clientId, [{ ...picks[0], questionnaireId: "" }, picks[1]], [existing]);
    expect(result.checklists[0]).toEqual(existing);
    expect(result.checklists).toHaveLength(2);
    expect(() => orderEquipmentQuestionnaires(data, first.clientId, picks, [existing])).toThrow("já está vinculado");
    expect(() => orderEquipmentQuestionnaires(data, first.clientId, [picks[1]], [existing])).toThrow("desmarcado");
  });
});

describe("catálogo e atualização de questionários vinculados", () => {
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
  it("atualiza tarefas abertas sem criar instâncias e preserva vínculos ao arquivar", () => {
    const { data, order } = fixture();
    const oldOrder = structuredClone(order);
    const edited = saveQuestionnaire(data, { ...template(), title: "Nova inspeção" });
    expect(edited.questionnaires[0].revision).toBe(2);
    expect(edited.questionnaires).toHaveLength(1);
    expect(getOrderDetails(edited.orders[0]).checklists).toHaveLength(1);
    expect(getOrderDetails(edited.orders[0]).checklists[0]).toMatchObject({ id: oldOrder.details.checklists[0].id, title: "Nova inspeção", templateRevision: 2 });
    const configured = { ...edited, orderTypeQuestionnaires: [{ type: "Preventiva" as const, questionnaireId: "template", required: true }] };
    const archived = archiveQuestionnaire(configured, "template");
    expect(archived.orderTypeQuestionnaires[0]).toMatchObject({ questionnaireId: "", required: true });
    expect(archived.orders[0]).toEqual(edited.orders[0]);
    expect(() => instantiateQuestionnaire(archived.questionnaires[0])).toThrow("arquivado");
    const restored = saveQuestionnaire(archived, { ...archived.questionnaires[0], archived: false });
    expect(restored.questionnaires[0]).toMatchObject({ archived: false, revision: 4 });
    expect(() => saveQuestionnaire(restored, template())).toThrow("outra sessão");
  });
  it.each(["Aberta", "Em atendimento", "Pausada"] as const)("sincroniza estrutura, apresentação e respostas compatíveis em tarefa %s", (status) => {
    const { data, order } = fixture();
    order.status = status;
    const checklist = order.details.checklists[0];
    checklist.questions[0].answer = "Motor revisado";
    checklist.questions[1].answer = ["Motor", "Freio"];
    checklist.questions[2].signature = signature;
    const edited = saveQuestionnaire(data, {
      ...template(), header: "Novo cabeçalho", footer: "Novo rodapé", requiredForCheckout: false,
      display: { ...template().display, columns: 3 },
      questions: [
        { ...template().questions[1], options: ["Freio", "Correia"] },
        { ...template().questions[0], label: "Novo relato" },
        template().questions[2],
        { id: "new", label: "Verificação", kind: "Texto", required: true, options: [] },
      ],
    });
    const saved = getOrderDetails(edited.orders[0]).checklists[0];
    expect(saved).toMatchObject({ id: checklist.id, header: "Novo cabeçalho", footer: "Novo rodapé", requiredForCheckout: false, display: { columns: 3 } });
    expect(saved.questions.map((q) => q.id)).toEqual(["choices", "text", "tech-sign", "new"]);
    expect(saved.questions[0].answer).toEqual(["Freio"]);
    expect(saved.questions[1]).toMatchObject({ label: "Novo relato", answer: "Motor revisado" });
    expect(saved.questions[2].signature).toEqual(signature);
    expect(saved.questions[3].answer).toBe("");
    expect(order.details.checklists[0].questions[1].answer).toEqual(["Motor", "Freio"]);
  });
  it("preserva tarefas finalizadas e arquivadas e não associa modelos a outras tarefas", () => {
    const { data, order } = fixture();
    data.orders = [
      { ...order, id: "closed", code: "OS-901", status: "Finalizada" },
      { ...order, id: "archived", code: "OS-902", details: { ...order.details, archived: true } },
      { ...order, id: "unlinked", code: "OS-903", details: { ...order.details, checklists: [] } },
    ];
    const before = structuredClone(data.orders);
    expect(saveQuestionnaire(data, { ...template(), title: "Alterado" }).orders).toEqual(before);
  });
  it("usa o cadastro atual ao replicar uma tarefa finalizada, sem modificar seu histórico", () => {
    const { data, order } = fixture();
    order.status = "Finalizada";
    const edited = saveQuestionnaire(data, { ...template(), title: "Modelo atual", questions: [{ ...template().questions[0], label: "Pergunta atual" }] });
    const replicated = replicateOrder(edited, order.id, "2026-10-20", "09:00");
    expect(getOrderDetails(replicated.orders[0]).checklists[0].title).toBe("Inspeção");
    expect(getOrderDetails(replicated.orders.at(-1)!).checklists[0]).toMatchObject({ title: "Modelo atual", questions: [{ id: "text", label: "Pergunta atual", answer: "" }] });
  });
  it("limpa respostas quando o tipo muda e limpa escolhas removidas", () => {
    const { data, order } = fixture();
    order.details.checklists[0].questions[0].answer = "Texto antigo";
    order.details.checklists[0].questions[1] = { ...order.details.checklists[0].questions[1], kind: "Escolha", answer: "Motor" };
    const saved = saveQuestionnaire(data, { ...template(), questions: [
      { ...template().questions[0], kind: "Numero" },
      { ...template().questions[1], kind: "Escolha", options: ["Freio", "Correia"] },
    ] });
    expect(getOrderDetails(saved.orders[0]).checklists[0].questions.map((q) => q.answer)).toEqual(["", ""]);
  });
  it("preserva fotos e justificativas compatíveis e remove vínculos de justificativa que deixaram de se aplicar", () => {
    const { data, order } = fixture();
    const model = { ...template(), questions: [{ id: "yes-no", label: "Funcionou?", kind: "Sim ou Não" as const, options: [], required: true, justificationOn: "Nao" as const }, template().questions[4]] };
    data.questionnaires = [model];
    order.details.checklists = [instantiateQuestionnaire(model)];
    order.details.attachments = [{ id: "file", name: "foto.jpg", mime: "image/jpeg", size: 3, data: "data:image/jpeg;base64,AAAA", at: signature.at }];
    Object.assign(order.details.checklists[0].questions[0], { answer: "Nao", justification: "Falhou", justificationPhotoId: "file" });
    order.details.checklists[0].questions[1].answer = "file";
    const saved = saveQuestionnaire(data, model);
    expect(getOrderDetails(saved.orders[0]).checklists[0].questions[0]).toMatchObject({ answer: "Nao", justification: "Falhou", justificationPhotoId: "file" });
    const changed = saveQuestionnaire(saved, { ...saved.questionnaires[0], questions: [{ ...model.questions[0], justificationOn: "Sim" }, model.questions[1]] });
    const details = getOrderDetails(changed.orders[0]);
    expect(details.checklists[0].questions[0]).toMatchObject({ answer: "Nao", justification: "", justificationPhotoId: "" });
    expect(details.checklists[0].questions[1].answer).toBe("file");
    expect(details.attachments).toEqual(order.details.attachments);
  });
  it("atualiza instâncias por equipamento sem misturar respostas e bloqueia novas duplicações", () => {
    const { data, order } = fixture();
    order.details.checklists = addQuestionnaire(order.details.checklists, template(), order.equipmentId);
    order.details.checklists[0].questions[0].answer = "Geral";
    order.details.checklists[1].questions[0].answer = "Equipamento";
    const saved = saveQuestionnaire(data, { ...template(), title: "Atualizado" });
    expect(getOrderDetails(saved.orders[0]).checklists.map((list) => list.questions[0].answer)).toEqual(["Geral", "Equipamento"]);
    expect(() => addQuestionnaire(order.details.checklists, template())).toThrow("já está vinculado");
    expect(() => addQuestionnaire(order.details.checklists, template(), order.equipmentId)).toThrow("já está vinculado");
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
    expect(() => saveQuestionnaire(data, { ...template(), questions: [{ ...template().questions[0], kind: "Sim ou Não" }] })).toThrow("justificativa");
    expect(() => saveQuestionnaire(data, { ...template(), questions: [{ ...template().questions[0], justificationOn: "Sim" }] })).toThrow("tipo");
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
  it("preserva o bloqueio legado e sincroniza a opção de check-out nas tarefas abertas", () => {
    const { requiredForCheckout: _requirement, ...legacy } = template();
    const data = validateDatabase({ ...demoDatabase(), questionnaires: [legacy] });
    expect(data.questionnaires[0].requiredForCheckout).toBe(true);
    const { data: configured, order } = fixture();
    const edited = saveQuestionnaire(configured, { ...template(), requiredForCheckout: false });
    expect(getOrderDetails(edited.orders[0]).checklists[0].requiredForCheckout).toBe(false);
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
    expect(getOrderDetails(replicated.orders.at(-1)!).checklists[0].requiredForCheckout).toBe(true);
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
    expect(details.checklists[0].questions[0].id).toBe("text");
    expect(details.checklists[0].questions[2].signature).toBeNull();
    expect(details.attachments).toEqual([]);
    const updated = saveQuestionnaire(replicated, { ...template(), title: "Atualizada após réplica" });
    expect(getOrderDetails(updated.orders.at(-1)!).checklists[0].title).toBe("Atualizada após réplica");
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
  it.each(["Sim", "Nao"] as const)("exige texto somente na resposta %s e permite rascunho sem foto", (justificationOn) => {
    const data = demoDatabase();
    const model = { ...template(), questions: [{ ...template().questions[0], kind: "Sim ou Não" as const, required: false, justificationOn }] };
    const checklist = instantiateQuestionnaire(model);
    const order = { ...data.orders[0], details: { ...getOrderDetails(data.orders[0]), checklists: [checklist] } };
    const q = checklist.questions[0];
    expect(orderPending(order)).toEqual([]);
    q.answer = justificationOn;
    expect(orderPending(order)[0].title).toContain("Justificativa");
    q.justification = "   ";
    expect(orderPending(order)).toHaveLength(1);
    expect(() => validateOrderDetails(order, data)).not.toThrow();
    q.justification = "Ajuste necessário";
    expect(orderPending(order)).toEqual([]);
    expect(() => validateOrderDetails(order, data)).not.toThrow();
    q.answer = justificationOn === "Sim" ? "Nao" : "Sim";
    expect(() => validateOrderDetails(order, data)).toThrow("sem resposta");
    checklist.questions[0] = withQuestionAnswer(q, q.answer);
    expect(checklist.questions[0]).toMatchObject({ justification: "", justificationPhotoId: "" });
    expect(orderPending(order)).toEqual([]);
  });
  it("valida foto opcional, reporta justificativa e limpa execução ao replicar", () => {
    const { data, order } = fixture();
    const model = { ...template(), questions: [{
      ...template().questions[0], kind: "Sim ou Não", justificationOn: "Nao",
    }] } satisfies QuestionnaireTemplate;
    data.questionnaires = [model];
    order.details.checklists = [instantiateQuestionnaire(model)];
    const q = order.details.checklists[0].questions[0];
    q.answer = "Nao"; q.justification = "Motor parado."; q.justificationPhotoId = "photo";
    expect(() => validateOrderDetails(order, data)).toThrow("Foto de justificativa");
    order.details.attachments = [{ id: "photo", name: "motor.png", mime: "image/png", size: 3, data: "data:image/png;base64,YWJj", at: signature.at }];
    expect(() => validateOrderDetails(order, data)).not.toThrow();
    expect(questionAnswerText(q, order.details)).toBe("Não · Justificativa: Motor parado. · Foto: motor.png");
    expect(questionnaireRows(data, [order])[0].answer).toContain("Motor parado.");
    const replicated = getOrderDetails(replicateOrder(data, order.id, "2026-10-20", "09:00").orders.at(-1)!);
    expect(replicated.checklists[0].questions[0]).toMatchObject({ answer: "", justification: "", justificationPhotoId: "", justificationOn: "Nao" });
    order.details.attachments[0].mime = "text/plain";
    order.details.attachments[0].data = "data:text/plain;base64,YWJj";
    expect(() => validateOrderDetails(order, data)).toThrow("Foto de justificativa");
  });
  it("questionário opcional não exige justificativa no checkout, mas mantém validação das respostas", () => {
    const { data, order } = fixture();
    order.details.checklists = [instantiateQuestionnaire({ ...template(), requiredForCheckout: false, questions: [{
      ...template().questions[0], kind: "Sim ou Não", justificationOn: "Sim",
    }] })];
    const q = order.details.checklists[0].questions[0];
    q.answer = "Sim";
    expect(orderPending(order)).toEqual([]);
    expect(changeOrderStatus(data, order.id, "Finalizada").orders[0].status).toBe("Finalizada");
    q.answer = "Talvez";
    expect(() => validateOrderDetails(order, data)).toThrow("sim ou nao");
  });
  it.each([
    ["Numero", "abc"], ["Numero", "0x10"], ["Monetaria", "Infinity"], ["Data", "2026-02-31"], ["Hora", "25:00"], ["Check", "talvez"], ["CPF/CNPJ", "123"], ["Foto", "missing"],
  ] as const)("rejeita resposta inválida do tipo %s", (kind, answer) => {
    const data: Database = demoDatabase();
    const order: Order = { ...data.orders[0], details: { ...getOrderDetails(data.orders[0]), checklists: [{ id: "check", title: "Validação", equipmentId: "", questions: [{ id: "q", label: "Valor", kind, required: false, options: [], answer }] }] } };
    expect(() => validateOrderDetails(order, data)).toThrow();
  });
});
