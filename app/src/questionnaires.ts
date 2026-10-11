import { validateDatabase } from "./domain";
import type { Database, QuestionnaireTemplate } from "./domain";
import { questionnaireTemplateSchema } from "./questionnaireSchema";
export { instantiateQuestionnaire, defaultQuestionnaires } from "./domain";

export function saveQuestionnaire(data: Database, input: QuestionnaireTemplate): Database {
  const template = questionnaireTemplateSchema.parse(input);
  const previous = data.questionnaires.find((item) => item.id === template.id);
  if (previous && previous.revision !== template.revision) throw new Error("O modelo foi alterado em outra sessão. Reabra o questionário antes de salvar.");
  const saved = { ...template, revision: previous ? previous.revision + 1 : 1 };
  return validateDatabase({
    ...data,
    questionnaires: previous ? data.questionnaires.map((item) => item.id === saved.id ? saved : item) : [...data.questionnaires, saved],
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
