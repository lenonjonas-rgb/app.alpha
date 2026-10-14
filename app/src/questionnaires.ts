import { assertSingleEquipmentQuestionnaire, getOrderDetails, instantiateQuestionnaire, validateDatabase } from "./domain";
import type { Checklist, Database, QuestionnaireTemplate } from "./domain";
import { questionnaireTemplateSchema, requiresJustification } from "./questionnaireSchema";
export { assertSingleEquipmentQuestionnaire, instantiateQuestionnaire, defaultQuestionnaires } from "./domain";

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
  if (equipmentId && checklists.some((item) => item.equipmentId === equipmentId))
    throw new Error("Este equipamento já possui um questionário nesta tarefa. Substitua o atual em vez de adicionar outra manutenção.");
  if (checklists.some((item) => item.templateId === template.id && item.equipmentId === equipmentId))
    throw new Error("Este questionário já está vinculado a esta tarefa/equipamento e recebe as alterações automaticamente.");
  return [...checklists, instantiateQuestionnaire(template, equipmentId)];
}

export function replaceOrderQuestionnaire(
  checklists: Checklist[], template: QuestionnaireTemplate, equipmentId = "", checklistId = "",
): Checklist[] {
  const linked = checklists.filter((item) => item.equipmentId === equipmentId);
  if (equipmentId) {
    if (checklistId && !linked.some((item) => item.id === checklistId))
      throw new Error("O questionário a substituir não está mais disponível. Reabra a tarefa.");
    const matching = linked.filter((item) => item.templateId === template.id);
    const selected = matching.find((item) => item.id === checklistId);
    if (matching.length > 1 && !selected)
      throw new Error("Há respostas duplicadas para este modelo. Escolha qual questionário manter usando Manter somente este questionário.");
    const kept = selected ?? matching[0];
    if (linked.length === 1 && kept) return checklists;
    const replacement = kept ?? instantiateQuestionnaire(template, equipmentId);
    if (!linked.length) return [...checklists, replacement];
    const firstId = linked[0].id;
    return checklists.flatMap((item) => item.id === firstId ? [replacement] : item.equipmentId === equipmentId ? [] : [item]);
  }
  const previous = checklistId
    ? linked.find((item) => item.id === checklistId)
    : linked.length === 1 ? linked[0] : undefined;
  if (checklistId && !previous) throw new Error("O questionário a substituir não está mais disponível. Reabra a tarefa.");
  if (!previous && linked.length > 1) throw new Error("Selecione qual questionário deseja substituir.");
  if (previous?.templateId === template.id) return checklists;
  if (!previous) return addQuestionnaire(checklists, template, equipmentId);
  if (linked.some((item) => item.id !== previous.id && item.templateId === template.id))
    throw new Error("O modelo escolhido já está vinculado a este equipamento/tarefa. Selecione outro modelo.");
  const replacement = instantiateQuestionnaire(template, equipmentId);
  return checklists.map((item) => item.id === previous.id ? replacement : item);
}

export function keepEquipmentQuestionnaire(checklists: Checklist[], checklistId: string): Checklist[] {
  const selected = checklists.find((item) => item.id === checklistId);
  if (!selected?.equipmentId) throw new Error("Selecione um questionário vinculado ao equipamento.");
  return checklists.filter((item) => item.equipmentId !== selected.equipmentId || item.id === selected.id);
}

export function assignQuestionnaireEquipment(checklists: Checklist[], checklistId: string, equipmentId: string): Checklist[] {
  if (!checklists.some((item) => item.id === checklistId)) throw new Error("Questionário não encontrado.");
  if (equipmentId && checklists.some((item) => item.id !== checklistId && item.equipmentId === equipmentId))
    throw new Error("Este equipamento já possui um questionário nesta tarefa. Mantenha somente um questionário por equipamento.");
  return checklists.map((item) => item.id === checklistId ? { ...item, equipmentId } : item);
}

export type OrderEquipmentSelection = { equipmentId: string; questionnaireId: string; checklistId?: string };

export function equipmentDefaultQuestionnaire(data: Database, equipmentId: string, type: Database["orders"][number]["type"]): string {
  const unit = data.equipment.find((item) => item.id === equipmentId);
  const model = data.equipmentModels.find((item) => item.id === unit?.model?.modelId);
  const defaultId = model?.questionnaireId || data.orderTypeQuestionnaires.find((item) => item.type === type)?.questionnaireId;
  return data.questionnaires.find((item) => item.id === defaultId && !item.archived && item.display.equipment)?.id ?? "";
}

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
    result = replaceOrderQuestionnaire(result, template, selection.equipmentId, selection.checklistId);
  }
  assertSingleEquipmentQuestionnaire(result);
  return { equipmentId: ids[0] ?? "", equipmentIds: ids.slice(1), checklists: result };
}

export function saveQuestionnaire(data: Database, input: QuestionnaireTemplate): Database {
  const template = questionnaireTemplateSchema.parse(input);
  const previous = data.questionnaires.find((item) => item.id === template.id);
  if (!template.display.equipment && data.equipmentModels.some((item) => item.questionnaireId === template.id))
    throw new Error("Este questionário é padrão de um modelo de equipamento. Remova o vínculo no catálogo antes de desabilitar a resposta por equipamento.");
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
    equipmentModels: data.equipmentModels.map((item) => item.questionnaireId === id ? { ...item, questionnaireId: "" } : item),
    orderTypeQuestionnaires: data.orderTypeQuestionnaires.map((item) => item.questionnaireId === id ? { ...item, questionnaireId: "" } : item),
  });
}
