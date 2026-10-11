import type { Checklist, OrderDetails } from "./domain";

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
  return question.kind === "Check" && question.answer === "Nao" ? "Não" : question.answer;
}
