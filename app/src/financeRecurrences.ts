import { localDay, makeId, validateDatabase } from "./domain";
import type { Database } from "./domain";
import { financeRecurrenceSchema, monthlyDueDate, recurrencePeriodSchema } from "./financeSchema";
import type { FinanceRecurrence } from "./financeSchema";
import { classifyFinanceEntry } from "./financeManagement";

export const recurrenceStatus = (item: FinanceRecurrence) => item.events.at(-1)?.status ?? "Ativa";
function activeReferences(data: Database, item: FinanceRecurrence) {
  if (!data.finance.accounts.some((account) => account.id === item.accountId && account.active) ||
    (item.categoryId && !data.finance.management?.categories.some((category) => category.id === item.categoryId && category.kind === item.kind && category.active)) ||
    (item.costCenterId && !data.finance.management?.costCenters.some((center) => center.id === item.costCenterId && center.active)))
    throw new Error("A recorrência exige banco, categoria e centro de custo ativos para cadastrar ou gerar contas.");
}
export function saveFinanceRecurrence(data: Database, input: FinanceRecurrence, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme a vigência e os dados da recorrência.");
  const item = financeRecurrenceSchema.parse(input);
  if (item.events.length || data.finance.recurrences?.some((previous) => previous.id === item.id))
    throw new Error("Recorrência já cadastrada ou com histórico inicial inválido.");
  activeReferences(data, item);
  return validateDatabase({ ...data, finance: { ...data.finance, recurrences: [...(data.finance.recurrences ?? []), item] } });
}
export function changeRecurrenceStatus(data: Database, expected: FinanceRecurrence, status: "Ativa" | "Suspensa" | "Cancelada", reason: string, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme a alteração de situação da recorrência.");
  const item = data.finance.recurrences?.find((item) => item.id === expected.id);
  if (!item || JSON.stringify(item) !== JSON.stringify(expected))
    throw new Error("Recorrência alterada. Atualize e revise novamente.");
  if (recurrenceStatus(item) === "Cancelada" || recurrenceStatus(item) === status)
    throw new Error("Transição indisponível; cancelamento é definitivo.");
  const updated = financeRecurrenceSchema.parse({ ...item, events: [...item.events, { status, reason, at: new Date().toISOString() }] });
  return validateDatabase({ ...data, finance: { ...data.finance,
    recurrences: data.finance.recurrences!.map((item) => item.id === updated.id ? updated : item) } });
}
export function previewRecurringEntries(data: Database, id: string, from: string, through: string) {
  recurrencePeriodSchema.parse(from); recurrencePeriodSchema.parse(through);
  const offset = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  const size = offset(through) - offset(from) + 1;
  if (size < 1 || size > 24) throw new Error("Selecione de 1 a 24 meses por geração.");
  const item = data.finance.recurrences?.find((item) => item.id === id);
  if (!item || recurrenceStatus(item) !== "Ativa") throw new Error("Selecione uma recorrência ativa.");
  activeReferences(data, item);
  const rows: { period: string; dueOn: string; amount: number; existingId?: string; canceled?: boolean }[] = [];
  for (let index = 0; index < size; index++) {
    const month = offset(from) + index - offset(item.firstDueOn);
    if (month < 0) continue;
    const dueOn = monthlyDueDate(item.firstDueOn, month);
    if (dueOn > item.endsOn) continue;
    const period = dueOn.slice(0, 7);
    const existing = data.finance.entries.find((entry) => entry.recurrence?.id === id && entry.recurrence.period === period);
    rows.push({ period, dueOn, amount: item.amount, ...(existing ? { existingId: existing.id, canceled: existing.canceled } : {}) });
  }
  return rows;
}
export function generateRecurringEntries(data: Database, expected: FinanceRecurrence, from: string, through: string,
  preview: ReturnType<typeof previewRecurringEntries>, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme os meses, vencimentos e o total da geração.");
  const item = data.finance.recurrences?.find((item) => item.id === expected.id);
  if (!item || JSON.stringify(item) !== JSON.stringify(expected)) throw new Error("Recorrência alterada. Gere outra prévia.");
  const rows = previewRecurringEntries(data, item.id, from, through);
  if (JSON.stringify(rows) !== JSON.stringify(preview)) throw new Error("Contas ou período alterados. Gere outra prévia antes de confirmar.");
  const fresh = rows.filter((row) => !row.existingId);
  if (!fresh.length) throw new Error("Nenhum mês novo na vigência; contas canceladas também não são geradas novamente.");
  const entries = fresh.map((row) => ({
    id: makeId(), kind: item.kind, party: item.party, ...(item.clientId ? { clientId: item.clientId } : {}),
    description: item.description, amount: item.amount, accountId: item.accountId, paymentMethod: item.paymentMethod,
    issuedOn: localDay(), dueOn: row.dueOn, recurrence: { id: item.id, period: row.period }, canceled: false, settlements: [],
  }));
  let updated = validateDatabase({ ...data, finance: { ...data.finance, entries: [...data.finance.entries, ...entries] } });
  for (const entry of entries) updated = classifyFinanceEntry(updated, { entryId: entry.id,
    ...(item.categoryId ? { categoryId: item.categoryId } : {}), ...(item.costCenterId ? { costCenterId: item.costCenterId } : {}) });
  return updated;
}
