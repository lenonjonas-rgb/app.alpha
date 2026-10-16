import { validateDatabase } from "./domain";
import type { Database } from "./domain";
import { financeEntrySchema, installmentSchema, monthlyDueDate } from "./financeSchema";
import type { FinanceEntry } from "./financeSchema";

export function previewFinanceInstallments(total: number, count: number, firstDueOn: string) {
  installmentSchema.parse({ planId: "preview", number: 1, count, total });
  financeEntrySchema.shape.dueOn.parse(firstDueOn);
  if (total < count) throw new Error("O total deve permitir pelo menos um centavo por parcela.");
  return Array.from({ length: count }, (_, index) => {
    const dueOn = monthlyDueDate(firstDueOn, index);
    return { dueOn, amount: Math.floor(total / count) + (index < total % count ? 1 : 0) };
  });
}

export function saveFinanceInstallments(data: Database, input: FinanceEntry, dueDates: string[], confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme o total e os vencimentos das parcelas.");
  const base = financeEntrySchema.parse(input);
  if (base.invoiceId || base.retention || base.installment || base.recurrence || base.purchaseId || base.canceled || base.settlements.length)
    throw new Error("Parcelamento disponível somente no cadastro de novas contas manuais em aberto.");
  const rows = previewFinanceInstallments(base.amount, dueDates.length, base.dueOn);
  if (!data.finance.accounts.some((item) => item.id === base.accountId && item.active))
    throw new Error("Selecione uma conta bancária ativa.");
  if (data.finance.entries.some((item) => item.id === base.id || item.installment?.planId === base.id))
    throw new Error("Este parcelamento já foi cadastrado. Atualize antes de tentar novamente.");
  const entries = rows.map((row, index) => financeEntrySchema.parse({
    ...base, id: `${base.id}:${index + 1}`, amount: row.amount, dueOn: dueDates[index],
    installment: { planId: base.id, number: index + 1, count: rows.length, total: base.amount },
  }));
  return validateDatabase({ ...data, finance: { ...data.finance, entries: [...data.finance.entries, ...entries] } });
}
