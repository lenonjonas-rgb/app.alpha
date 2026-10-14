import { getOrderDetails, instantiateQuestionnaire, validateDatabase } from "./domain";
import type { Checklist, Database, QuestionnaireTemplate } from "./domain";
import { questionnaireTemplateSchema, requiresJustification } from "./questionnaireSchema";
export { instantiateQuestionnaire, defaultQuestionnaires } from "./domain";

function updateChecklist(checklist: Checklist, template: QuestionnaireTemplate): Checklist {
  const updated = instantiateQuestionnaire(template);
  return {
    ...updated, id: checklist.id, equipmentId: checklist.equipmentId,
    questions: updated.questions.map((question) => {
      const previous = checklist.questions.find((item) => item.id === question.id && item.kind === question.kind);
      if (!previous) return question;
      let answer = previous.answer;
      if (question.kind === "Multipla escolha" && Array.isArray(answer))
        answer = answer.filter((option) => question.options.includes(option));
      if (question.kind === "Escolha" && typeof answer === "string" && !question.options.includes(answer))
        answer = "";
      const saved = { ...question, answer, ...(question.kind === "Assinatura" ? { signature: previous.signature ?? null } : {}) };
      return requiresJustification(saved)
        ? { ...saved, justification: previous.justification ?? "", justificationPhotoId: previous.justificationPhotoId ?? "" }
        : saved;
    }),
  };
}

export function addQuestionnaire(checklists: Checklist[], template: QuestionnaireTemplate, equipmentId = ""): Checklist[] {
  if (checklists.some((item) => item.templateId === template.id && item.equipmentId === equipmentId))
    throw new Error("Este questionário já está vinculado a esta tarefa/equipamento e recebe as alterações automaticamente.");
  return [...checklists, instantiateQuestionnaire(template, equipmentId)];
}

export type OrderEquipmentSelection = { equipmentId: string; questionnaireId: string };

export function orderEquipmentQuestionnaires(
  data: Database, clientId: string, selections: OrderEquipmentSelection[], checklists: Checklist[], previousEquipmentIds: string[] = [],
): { equipmentId: string; equipmentIds: string[]; checklists: Checklist[] } {
  const ids = selections.map((item) => item.equipmentId);
  if (new Set(ids).size !== ids.length) throw new Error("Selecione cada equipamento apenas uma vez.");
  if (ids.some((id) => !data.equipment.some((item) => item.id === id && item.clientId === clientId)))
    throw new Error("Um dos equipamentos selecionados não pertence ao cliente. Confira a seleção.");
  if (checklists.some((item) => item.equipmentId && !ids.includes(item.equipmentId)))
    throw new Error("Há questionários vinculados a um equipamento desmarcado. Ajuste esses vínculos em Mais informações antes de removê-lo.");
  let result = checklists;
  for (const selection of selections) {
    if (!selection.questionnaireId) {
      if (!previousEquipmentIds.includes(selection.equipmentId) && !checklists.some((item) => item.equipmentId === selection.equipmentId))
        throw new Error("Selecione um questionário para cada equipamento marcado.");
      continue;
    }
    const template = data.questionnaires.find((item) => item.id === selection.questionnaireId && !item.archived);
    if (!template) throw new Error("Questionário indisponível. Selecione um modelo ativo.");
    result = addQuestionnaire(result, template, selection.equipmentId);
  }
  return { equipmentId: ids[0] ?? "", equipmentIds: ids.slice(1), checklists: result };
}

export function saveQuestionnaire(data: Database, input: QuestionnaireTemplate): Database {
  const template = questionnaireTemplateSchema.parse(input);
  const previous = data.questionnaires.find((item) => item.id === template.id);
  if (previous && previous.revision !== template.revision) throw new Error("O modelo foi alterado em outra sessão. Reabra o questionário antes de salvar.");
  const saved = { ...template, revision: previous ? previous.revision + 1 : 1 };
  return validateDatabase({
    ...data,
    questionnaires: previous ? data.questionnaires.map((item) => item.id === saved.id ? saved : item) : [...data.questionnaires, saved],
    orders: !previous || saved.archived ? data.orders : data.orders.map((order) => {
      const details = getOrderDetails(order);
      if (order.status === "Finalizada" || details.archived || !details.checklists.some((item) => item.templateId === saved.id)) return order;
      return {
        ...order,
        details: { ...details, checklists: details.checklists.map((item) => item.templateId === saved.id ? updateChecklist(item, saved) : item) },
      };
    }),
  });
}

export function archiveQuestionnaire(data: Database, id: string): Database {
  if (!data.questionnaires.some((item) => item.id === id)) throw new Error("Questionário não encontrado.");
  return validateDatabase({
    ...data,
    questionnaires: data.questionnaires.map((item) => item.id === id ? { ...item, archived: true, revision: item.revision + 1 } : item),
    orderTypeQuestionnaires: data.orderTypeQuestionnaires.map((item) => item.questionnaireId === id ? { ...item, questionnaireId: "" } : item),
  });
}
