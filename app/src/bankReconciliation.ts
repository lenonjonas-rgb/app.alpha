import { bankingSchema, statementLineSchema } from "./bankingSchema";
import type { Banking, BankMatch, BankReconciliationGroup, BankTransaction, BankTransferMatch } from "./bankingSchema";
import { localDay, makeId, validateDatabase } from "./domain";
import type { Database } from "./domain";
import { entryBalance, settleFinanceEntry } from "./finance";
import type { ParsedStatement } from "./bankStatement";
import { settlementCashAmount } from "./financeSchema";

export function banking(data: Database): Banking {
  return data.finance.banking ?? { transactions: [], matches: [] };
}

export function activeBankMatch(data: Database, match: BankMatch) {
  const entry = data.finance.entries.find((item) => item.id === match.entryId);
  return !match.reversed && !!entry && !entry.canceled &&
    entry.settlements.some((item) => item.id === match.settlementId && !item.reversed);
}

export function activeBankReconciliationGroup(data: Database, group: BankReconciliationGroup) {
  if (group.reversed) return false;
  const current = banking(data);
  return group.transactionIds.every((id) => current.transactions.some((transaction) => transaction.id === id)) &&
    group.settlements.every(({ entryId, settlementId }) => {
      const entry = data.finance.entries.find((item) => item.id === entryId);
      return !!entry && !entry.canceled && entry.settlements.some((settlement) => settlement.id === settlementId && !settlement.reversed);
    });
}

function activeSettlementKeys(data: Database) {
    const current = banking(data), keys = new Set<string>();
    for (const match of current.matches) if (activeBankMatch(data, match))
      keys.add(JSON.stringify([match.entryId, match.settlementId]));
    for (const group of current.reconciliationGroups ?? []) if (activeBankReconciliationGroup(data, group))
      for (const reference of group.settlements) keys.add(JSON.stringify([reference.entryId, reference.settlementId]));
    return keys;
}

export function activeTransferMatch(data: Database, match: BankTransferMatch) {
  const transfer = data.finance.transfers?.find((item) => item.id === match.transferId);
  return !match.reversed && !!transfer && !transfer.reversal;
}

export function transactionReconciled(data: Database, transactionId: string) {
  const current = banking(data);
  return current.matches.some((item) => item.transactionId === transactionId && activeBankMatch(data, item)) ||
    (current.reconciliationGroups ?? []).some((group) => group.transactionIds.includes(transactionId) &&
      activeBankReconciliationGroup(data, group)) ||
    (current.transferMatches ?? []).some((item) => item.transactionId === transactionId && activeTransferMatch(data, item));
}

const reconciliationWindowDays = 3;
function dayNumber(date: string) {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}
function withinReconciliationWindow(dates: string[]) {
  return Math.max(...dates.map(dayNumber)) - Math.min(...dates.map(dayNumber)) <= reconciliationWindowDays;
}

export function reconciliationTransactionCandidates(data: Database, transaction: BankTransaction, selectedIds = [transaction.id]) {
  const current = banking(data);
  const selected = selectedIds.map((id) => current.transactions.find((item) => item.id === id));
  if (!selected.length || selected.some((item) => !item) ||
    selected.some((item) => item!.accountId !== transaction.accountId ||
      Math.sign(item!.amount) !== Math.sign(transaction.amount)) ||
    !withinReconciliationWindow(selected.map((item) => item!.date))) return [];
  return banking(data).transactions.filter((candidate) => candidate.accountId === transaction.accountId &&
    Math.sign(candidate.amount) === Math.sign(transaction.amount) &&
    withinReconciliationWindow([...selected.map((item) => item!.date), candidate.date]) &&
    !transactionReconciled(data, candidate.id));
}

export type SettlementReference = { entryId: string; settlementId: string };
export function groupSettlementCandidates(data: Database, transactionIds: string[]) {
  const current = banking(data);
  const matchedSettlements = activeSettlementKeys(data);
  const transactions = transactionIds.map((id) => current.transactions.find((transaction) => transaction.id === id));
  if (!transactions.length || transactions.some((transaction) => !transaction) ||
    transactions.some((transaction) => transaction!.accountId !== transactions[0]!.accountId ||
      Math.sign(transaction!.amount) !== Math.sign(transactions[0]!.amount)) ||
    !withinReconciliationWindow(transactions.map((transaction) => transaction!.date))) return [];
  const transaction = transactions[0]!;
  return data.finance.entries.filter((entry) => !entry.canceled &&
    entry.kind === (transaction.amount > 0 ? "Receber" : "Pagar"))
    .flatMap((entry) => entry.settlements.filter((settlement) => !settlement.reversed &&
      settlement.accountId === transaction.accountId &&
      withinReconciliationWindow([...transactions.map((item) => item!.date), settlement.date]) &&
      !matchedSettlements.has(JSON.stringify([entry.id, settlement.id])))
      .map((settlement) => ({ entry, settlement })));
}

export function previewStatementImport(data: Database, accountId: string, statement: ParsedStatement) {
  if (!data.finance.accounts.some((item) => item.id === accountId && item.active)) throw new Error("Selecione um banco ativo.");
  if (!statement.lines.length || statement.lines.length > 2000) throw new Error("Importe entre 1 e 2.000 movimentos.");
  const lines = statement.lines.map((line) => statementLineSchema.parse(line));
  if (new Set(lines.map((item) => item.externalId)).size !== lines.length) throw new Error("IDs de movimentos repetidos no arquivo.");
  let duplicates = 0;
  const fresh = lines.filter((line) => {
    const previous = banking(data).transactions.find((item) => item.accountId === accountId && item.externalId === line.externalId);
    if (!previous) return true;
    if (previous.amount !== line.amount || previous.date !== line.date || previous.description !== line.description)
      throw new Error(`O ID ${line.externalId} já foi importado com dados diferentes. Nenhum movimento foi importado.`);
    duplicates++;
    return false;
  });
  return { fresh, duplicates };
}

export function importStatement(data: Database, accountId: string, statement: ParsedStatement, fileName: string, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme que o extrato pertence ao banco selecionado.");
  const { fresh } = previewStatementImport(data, accountId, statement), current = banking(data);
  if (!fresh.length) throw new Error("Todos os movimentos já foram importados. Nenhuma alteração realizada.");
  if (fresh.some((item) => item.date > localDay())) throw new Error("Extrato contém movimento futuro; revise o arquivo antes de importar.");
  const importedAt = new Date().toISOString();
  const updated = bankingSchema.parse({ ...current, transactions: [...current.transactions, ...fresh.map((line) => ({
    ...line, id: makeId(), accountId, importedAt, fileName,
  }))] });
  return validateDatabase({ ...data, finance: { ...data.finance, banking: updated } });
}

function availableTransaction(data: Database, transactionId: string) {
  const transaction = banking(data).transactions.find((item) => item.id === transactionId);
  if (!transaction) throw new Error("Movimento indisponível. Atualize o extrato.");
  if (transactionReconciled(data, transactionId))
    throw new Error("Movimento já conciliado. Atualize a seleção.");
  return transaction;
}

export function transferCandidates(data: Database, transaction: BankTransaction) {
  const leg = transaction.amount < 0 ? "outgoing" : "incoming";
  return (data.finance.transfers ?? []).filter((item) => !item.reversal &&
    item.date === transaction.date && item.amount === Math.abs(transaction.amount) &&
    (leg === "outgoing" ? item.fromAccountId : item.toAccountId) === transaction.accountId &&
    !(banking(data).transferMatches ?? []).some((match) => match.transferId === item.id && match.leg === leg && activeTransferMatch(data, match)));
}

export function matchBankTransfer(data: Database, transactionId: string, transferId: string, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme o vínculo com a transferência interna.");
  const transaction = availableTransaction(data, transactionId);
  if (!transferCandidates(data, transaction).some((item) => item.id === transferId))
    throw new Error("Transferência incompatível, estornada ou ponta já conciliada. Confira conta, data, sinal e valor exatos.");
  const current = banking(data);
  const match: BankTransferMatch = { id: makeId(), transactionId, transferId,
    leg: transaction.amount < 0 ? "outgoing" : "incoming", createdAt: new Date().toISOString(), reversed: false };
  return validateDatabase({ ...data, finance: { ...data.finance, banking: {
    ...current, transferMatches: [...(current.transferMatches ?? []), match],
  } } });
}

export function unmatchBankTransfer(data: Database, matchId: string) {
  const current = banking(data);
  if (!(current.transferMatches ?? []).some((item) => item.id === matchId && activeTransferMatch(data, item)))
    throw new Error("Vínculo já desfeito ou transferência estornada.");
  return validateDatabase({ ...data, finance: { ...data.finance, banking: {
    ...current, transferMatches: (current.transferMatches ?? []).map((item) => item.id === matchId ? { ...item, reversed: true } : item),
  } } });
}

export function settlementCandidates(data: Database, transaction: BankTransaction) {
  const matchedSettlements = activeSettlementKeys(data);
  return data.finance.entries.filter((entry) => !entry.canceled && entry.kind === (transaction.amount > 0 ? "Receber" : "Pagar"))
    .flatMap((entry) => entry.settlements.filter((settlement) => !settlement.reversed &&
      settlementCashAmount(settlement) === Math.abs(transaction.amount) && settlement.accountId === transaction.accountId && settlement.date === transaction.date &&
      !matchedSettlements.has(JSON.stringify([entry.id, settlement.id])))
      .map((settlement) => ({ entry, settlement })));
}

export function matchBankSettlement(data: Database, transactionId: string, entryId: string, settlementId: string) {
  const transaction = availableTransaction(data, transactionId);
  if (!settlementCandidates(data, transaction).some((item) => item.entry.id === entryId && item.settlement.id === settlementId))
    throw new Error("Baixa incompatível ou já conciliada. Confira banco, tipo, data e valor exatos.");
  const current = banking(data);
  const match: BankMatch = { id: makeId(), transactionId, entryId, settlementId, createdAt: new Date().toISOString(), reversed: false };
  return validateDatabase({ ...data, finance: { ...data.finance, banking: { ...current, matches: [...current.matches, match] } } });
}

export function matchBankSettlementGroup(data: Database, transactionIds: string[],
  settlementRefs: SettlementReference[], confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme a conciliacao agrupada.");
  if (new Set(transactionIds).size !== transactionIds.length || new Set(settlementRefs.map((item) =>
    JSON.stringify([item.entryId, item.settlementId]))).size !== settlementRefs.length ||
    transactionIds.length + settlementRefs.length < 3 || transactionIds.length > 200 || settlementRefs.length > 200)
    throw new Error("Selecione movimentos e baixas distintos para formar um grupo.");
  const transactions = transactionIds.map((id) => availableTransaction(data, id));
  const first = transactions[0];
  if (transactions.some((transaction) => transaction.accountId !== first.accountId ||
    Math.sign(transaction.amount) !== Math.sign(first.amount)))
    throw new Error("O grupo deve usar um banco e um sentido de movimento.");
  const candidates = groupSettlementCandidates(data, transactionIds);
  const selected = settlementRefs.map((reference) => candidates.find((candidate) =>
    candidate.entry.id === reference.entryId && candidate.settlement.id === reference.settlementId));
  if (selected.some((candidate) => !candidate) ||
    !withinReconciliationWindow([...transactions.map((item) => item.date), ...selected.map((item) => item!.settlement.date)]))
    throw new Error("Baixas selecionadas devem estar livres e dentro da janela de tres dias.");
  const transactionTotal = transactions.reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const settlementTotal = selected.reduce((sum, item) => sum + settlementCashAmount(item!.settlement), 0);
  if (transactionTotal !== settlementTotal || transactionTotal > 100_000_000)
    throw new Error("A soma dos movimentos e das baixas deve coincidir exatamente.");
  const current = banking(data);
  const group: BankReconciliationGroup = {
    id: makeId(), transactionIds: [...transactionIds],
    settlements: settlementRefs.map((item) => ({ ...item })),
    createdAt: new Date().toISOString(), reversed: false,
  };
  return validateDatabase({ ...data, finance: { ...data.finance, banking: {
    ...current, reconciliationGroups: [...(current.reconciliationGroups ?? []), group],
  } } });
}

export function settleAndMatch(data: Database, transactionId: string, entryId: string, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme a baixa e a conciliação.");
  const transaction = availableTransaction(data, transactionId);
  const entry = data.finance.entries.find((item) => item.id === entryId);
  if (!entry || entry.canceled || entry.kind !== (transaction.amount > 0 ? "Receber" : "Pagar") ||
    entryBalance(entry) < Math.abs(transaction.amount))
    throw new Error("Título incompatível ou saldo insuficiente para esta baixa.");
  const settlementId = makeId();
  const updated = settleFinanceEntry(data, entryId, {
    id: settlementId, date: transaction.date, amount: Math.abs(transaction.amount), accountId: transaction.accountId,
  });
  return matchBankSettlement(updated, transactionId, entryId, settlementId);
}

export function unmatchBankSettlement(data: Database, matchId: string) {
  const current = banking(data);
  const group = (current.reconciliationGroups ?? []).find((item) => item.id === matchId && activeBankReconciliationGroup(data, item));
  if (group) return validateDatabase({ ...data, finance: { ...data.finance, banking: {
    ...current, reconciliationGroups: current.reconciliationGroups!.map((item) =>
      item.id === matchId ? { ...item, reversed: true } : item),
  } } });
  if (!current.matches.some((item) => item.id === matchId && activeBankMatch(data, item))) throw new Error("Vínculo já desfeito ou baixa estornada.");
  return validateDatabase({ ...data, finance: { ...data.finance, banking: {
    ...current, matches: current.matches.map((item) => item.id === matchId ? { ...item, reversed: true } : item),
  } } });
}
