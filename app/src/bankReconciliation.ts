import { bankingSchema, statementLineSchema } from "./bankingSchema";
import type { Banking, BankMatch, BankTransaction, BankTransferMatch } from "./bankingSchema";
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

export function activeTransferMatch(data: Database, match: BankTransferMatch) {
  const transfer = data.finance.transfers?.find((item) => item.id === match.transferId);
  return !match.reversed && !!transfer && !transfer.reversal;
}

export function transactionReconciled(data: Database, transactionId: string) {
  const current = banking(data);
  return current.matches.some((item) => item.transactionId === transactionId && activeBankMatch(data, item)) ||
    (current.transferMatches ?? []).some((item) => item.transactionId === transactionId && activeTransferMatch(data, item));
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
  return data.finance.entries.filter((entry) => !entry.canceled && entry.kind === (transaction.amount > 0 ? "Receber" : "Pagar"))
    .flatMap((entry) => entry.settlements.filter((settlement) => !settlement.reversed &&
      settlementCashAmount(settlement) === Math.abs(transaction.amount) && settlement.accountId === transaction.accountId && settlement.date === transaction.date &&
      !banking(data).matches.some((match) => match.entryId === entry.id && match.settlementId === settlement.id && activeBankMatch(data, match)))
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
  if (!current.matches.some((item) => item.id === matchId && activeBankMatch(data, item))) throw new Error("Vínculo já desfeito ou baixa estornada.");
  return validateDatabase({ ...data, finance: { ...data.finance, banking: {
    ...current, matches: current.matches.map((item) => item.id === matchId ? { ...item, reversed: true } : item),
  } } });
}
