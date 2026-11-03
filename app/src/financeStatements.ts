import { z } from "zod";
import { bankDateSchema } from "./bankingSchema";
import { activeBankMatch, activeBankReconciliationGroup, activeTransferMatch, banking } from "./bankReconciliation";
import { encodeCsv } from "./csv";
import { localDay } from "./domain";
import type { Database } from "./domain";
import { entryBalance, entryStatus } from "./finance";
import { financeManagement, managementReport } from "./financeManagement";
import { settlementCashAmount } from "./financeSchema";
import type { FinanceEntry } from "./financeSchema";

export const statementPeriodSchema = z.object({
  start: bankDateSchema, end: bankDateSchema,
}).refine((value) => value.start <= value.end, "A data inicial deve ser anterior ou igual à final.");
export type StatementPeriod = z.infer<typeof statementPeriodSchema>;
export type CashStatementMovement = {
  id: string;
  date: string;
  accountId: string;
  description: string;
  party: string;
  categoryId: string;
  amount: number;
  source: "Baixa" | "Transferência";
  reconciled: boolean;
};

export function cashStatement(data: Database, input: StatementPeriod & { accountId: string }, today = localDay()) {
  const period = statementPeriodSchema.parse(input);
  const report = managementReport(data, { ...period, accountId: input.accountId, categoryId: "", costCenterId: "" }, today);
  const current = banking(data);
  const settlements = new Set(current.matches.filter((match) => activeBankMatch(data, match))
    .map((match) => JSON.stringify([match.entryId, match.settlementId])));
  for (const group of current.reconciliationGroups ?? []) if (activeBankReconciliationGroup(data, group)) {
    for (const item of group.settlements) settlements.add(JSON.stringify([item.entryId, item.settlementId]));
  }
  const legs = new Set((current.transferMatches ?? []).filter((match) => activeTransferMatch(data, match))
    .map((match) => JSON.stringify([match.transferId, match.leg])));
  const movements: CashStatementMovement[] = [
    ...report.movements.flatMap((item): CashStatementMovement[] => item.source === "realized" ? [{
      id: JSON.stringify(["settlement", item.entryId, item.settlementId]), date: item.date, accountId: item.accountId,
      description: item.description, party: item.party, categoryId: item.categoryId,
      amount: item.kind === "Receber" ? item.amount : -item.amount, source: "Baixa",
      reconciled: settlements.has(JSON.stringify([item.entryId, item.settlementId])),
    }] : []),
    ...report.transfers.map((item): CashStatementMovement => ({
      id: JSON.stringify(["transfer", item.transferId, item.accountId]), date: item.date, accountId: item.accountId,
      description: item.description, party: data.finance.accounts.find((account) => account.id === item.counterpartId)?.name ?? "",
      categoryId: "", amount: item.amount, source: "Transferência",
      reconciled: legs.has(JSON.stringify([item.transferId, item.amount > 0 ? "incoming" : "outgoing"])),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const incoming = movements.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
  const outgoing = movements.filter((item) => item.amount < 0).reduce((sum, item) => sum - item.amount, 0);
  const positions = report.positions;
  const finalBalance = positions.length && positions.every((item) => item.balance !== null)
    ? positions.reduce((sum, item) => sum + (item.balance ?? 0), 0) : null;
  const startsBeforeBase = positions.some((item) => item.opening && item.opening.date > period.start);
  const initialBalance = finalBalance === null || startsBeforeBase ? null : finalBalance - incoming + outgoing;
  return { movements, incoming, outgoing, initialBalance, finalBalance,
    missingOpening: positions.some((item) => !item.opening), startsBeforeBase };
}

export function cashStatementCsv(data: Database, movements: CashStatementMovement[]) {
  const management = financeManagement(data);
  return encodeCsv([
    ["Data", "Conta", "Origem", "Categoria", "Histórico", "Cliente/Favorecido", "Conciliação", "Valor (R$)"],
    ...movements.map((item) => [
      item.date, data.finance.accounts.find((account) => account.id === item.accountId)?.name ?? "",
      item.source, item.source === "Transferência" ? "Transferência interna" :
        management.categories.find((category) => category.id === item.categoryId)?.name ?? "Sem categoria",
      item.description, item.party, item.reconciled ? "Conciliado" : "Pendente", item.amount / 100,
    ]),
  ]);
}

export function customerStatement(data: Database, clientId: string, input: StatementPeriod, today = localDay()) {
  const period = statementPeriodSchema.parse(input);
  bankDateSchema.parse(today);
  if (!data.clients.some((client) => client.id === clientId)) throw new Error("Selecione um cliente cadastrado.");
  const invoiceClients = new Map(data.finance.invoices.map((invoice) => [invoice.id, invoice.clientId]));
  const entries = data.finance.entries.filter((entry) => entry.kind === "Receber" &&
    (entry.clientId === clientId || (!entry.clientId && entry.invoiceId && invoiceClients.get(entry.invoiceId) === clientId)) &&
    entry.dueOn >= period.start && entry.dueOn <= period.end)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));
  const active = entries.filter((entry) => !entry.canceled);
  const received = active.flatMap((entry) => entry.settlements)
    .filter((settlement) => !settlement.reversed)
    .reduce((sum, settlement) => sum + settlementCashAmount(settlement), 0);
  return {
    entries, received,
    outstanding: active.reduce((sum, entry) => sum + entryBalance(entry), 0),
    overdue: active.filter((entry) => entry.dueOn < today).reduce((sum, entry) => sum + entryBalance(entry), 0),
  };
}

export function customerStatementCsv(data: Database, clientId: string, period: StatementPeriod, today = localDay()) {
  const report = customerStatement(data, clientId, period, today);
  const money = (amount: number) => (amount / 100).toFixed(2).replace(".", ",");
  return encodeCsv([
    ["Cliente", "Emissão", "Vencimento", "Histórico", "Conta", "Pagamento", "Valor original (R$)", "Saldo (R$)", "Situação"],
    ...report.entries.map((entry) => [
      entry.party, entry.issuedOn, entry.dueOn, entry.description,
      data.finance.accounts.find((account) => account.id === entry.accountId)?.name ?? "",
      entry.paymentMethod, money(entry.amount), money(entry.canceled ? 0 : entryBalance(entry)), entryStatus(entry, today),
    ]),
  ]);
}

export const financeEntryFilterSchema = z.object({
  kind: z.enum(["Receber", "Pagar"]),
  query: z.string().max(1000),
  status: z.enum(["Todas", "Em aberto", "Atrasada", "Parcial", "Recebida", "Paga", "Compensada", "Cancelada"]),
  from: z.union([z.literal(""), bankDateSchema]),
  through: z.union([z.literal(""), bankDateSchema]),
  accountId: z.string(), categoryId: z.string(),
}).refine((value) => !value.from || !value.through || value.from <= value.through,
  "O primeiro vencimento deve ser anterior ou igual ao último.");
export type FinanceEntryFilter = z.infer<typeof financeEntryFilterSchema>;

export function filterFinanceEntries(data: Database, input: FinanceEntryFilter, today = localDay()) {
  const filter = financeEntryFilterSchema.parse(input);
  bankDateSchema.parse(today);
  const management = financeManagement(data);
  if ((filter.accountId && !data.finance.accounts.some((account) => account.id === filter.accountId)) ||
    (filter.categoryId && !management.categories.some((category) => category.id === filter.categoryId)))
    throw new Error("Selecione uma conta financeira e uma categoria existentes.");
  const query = filter.query.trim().toLocaleLowerCase("pt-BR");
  const classifications = new Map(management.classifications.map((item) => [item.entryId, item]));
  return data.finance.entries.filter((entry) => {
    const matchesStatus = filter.status === "Todas" ||
      (filter.status === "Em aberto" ? !entry.canceled && entryBalance(entry) > 0 :
        filter.status === "Parcial" ? !entry.canceled && entryBalance(entry) > 0 && entry.settlements.some((item) => !item.reversed) :
          entryStatus(entry, today) === filter.status);
    const classification = classifications.get(entry.id);
    return entry.kind === filter.kind && matchesStatus &&
      (!filter.from || entry.dueOn >= filter.from) && (!filter.through || entry.dueOn <= filter.through) &&
      (!filter.accountId || entry.accountId === filter.accountId) &&
      (!filter.categoryId || classification?.categoryId === filter.categoryId) &&
      `${entry.party} ${entry.description} ${entry.details?.documentNumber ?? ""} ${entry.details?.seller ?? ""} ${entry.purchaseId ?? ""} ${entry.installment?.planId ?? ""} ${entry.recurrence?.id ?? ""} ${entry.recurrence?.period ?? ""}`
        .toLocaleLowerCase("pt-BR").includes(query);
  }).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));
}

export function financeEntriesCsv(data: Database, entries: FinanceEntry[], today = localDay()) {
  bankDateSchema.parse(today);
  const management = financeManagement(data);
  const money = (amount: number) => (amount / 100).toFixed(2).replace(".", ",");
  return encodeCsv([
    ["Tipo", "Cliente/Favorecido", "Histórico", "Documento", "Emissão", "Competência", "Vencimento", "Conta", "Pagamento",
      "Categoria", "Centro de custo", "Vendedor", "Valor original (R$)", "Retido (R$)", "Saldo (R$)", "Situação"],
    ...entries.map((entry) => {
      const classification = management.classifications.find((item) => item.entryId === entry.id);
      return [
        entry.kind, entry.party, entry.description, entry.details?.documentNumber ?? "", entry.issuedOn,
        entry.details?.competenceOn ?? "", entry.dueOn, data.finance.accounts.find((account) => account.id === entry.accountId)?.name ?? "",
        entry.paymentMethod, management.categories.find((category) => category.id === classification?.categoryId)?.name ?? "Sem categoria",
        management.costCenters.find((center) => center.id === classification?.costCenterId)?.name ?? "Sem centro de custo",
        entry.details?.seller ?? "", money(entry.amount), money(entry.retention?.withheld ?? 0),
        money(entry.canceled ? 0 : entryBalance(entry)), entryStatus(entry, today),
      ];
    }),
  ]);
}
