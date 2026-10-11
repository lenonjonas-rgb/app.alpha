import type { Checklist, OrderDetails } from "./domain";
import { requiresJustification } from "./questionnaireSchema";

export function withQuestionAnswer(question: Checklist["questions"][number], answer: string | string[]) {
  const updated = { ...question, answer };
  return question.kind === "Sim ou Não" && !requiresJustification(updated)
    ? { ...updated, justification: "", justificationPhotoId: "" }
    : updated;
}

export function questionSignature(question: Checklist["questions"][number], details: OrderDetails) {
  return question.signature === undefined ? details.signature : question.signature;
}

export function questionAnswerText(question: Checklist["questions"][number], details: OrderDetails): string {
  if (question.kind === "Assinatura") {
    const signature = questionSignature(question, details);
    return signature ? `${signature.signer} · ${new Date(signature.at).toLocaleString("pt-BR")}` : "";
  }
  if (question.kind === "Foto") return details.attachments.find((item) => item.id === question.answer)?.name ?? "";
  if (Array.isArray(question.answer)) return question.answer.join("; ");
  const answer = ["Check", "Sim ou Não"].includes(question.kind) && question.answer === "Nao" ? "Não" : question.answer;
  if (!requiresJustification(question)) return answer;
  const photo = details.attachments.find((item) => item.id === question.justificationPhotoId);
  return [answer, question.justification?.trim() ? `Justificativa: ${question.justification.trim()}` : "", photo ? `Foto: ${photo.name}` : ""].filter(Boolean).join(" · ");
}
