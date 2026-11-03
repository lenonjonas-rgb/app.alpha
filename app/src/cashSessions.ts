import { localDay, makeId, validateDatabase } from "./domain";
import type { Database } from "./domain";
import { bankDateSchema } from "./bankingSchema";
import { cashMovementKey, cashSessionSchema } from "./cashSessionSchema";
import type { CashSession, CashSessionMovement } from "./cashSessionSchema";
import { settlementCashAmount } from "./settlementMath";

type MovementChoice = { movement: CashSessionMovement; description: string; party: string; paymentMethod: string };

export function cashMovementDetails(data: Database, movement: CashSessionMovement) {
  if (movement.source === "settlement") {
    const entry = data.finance.entries.find((item) => item.id === movement.entryId);
    if (!entry) throw new Error("Conta vinculada ao fechamento não encontrada.");
    return { description: entry.description, party: entry.party, paymentMethod: entry.paymentMethod };
  }
  const transfer = data.finance.transfers?.find((item) => item.id === movement.transferId);
  if (!transfer) throw new Error("Transferência vinculada ao fechamento não encontrada.");
  const counterpartId = movement.leg === "incoming" ? transfer.fromAccountId : transfer.toAccountId;
  return { description: transfer.description, party: data.finance.accounts.find((account) => account.id === counterpartId)?.name ?? "",
    paymentMethod: "Transferência interna" };
}

export function openCashSession(data: Database, input: { accountId: string; store: string; openingAmount: number }, confirmed: boolean, id: string = makeId()) {
  if (!confirmed) throw new Error("Confirme a conta, a loja e o valor contado para abertura.");
  if (!data.finance.accounts.some((account) => account.id === input.accountId && account.active && account.kind === "Caixa"))
    throw new Error("Selecione uma conta financeira ativa do tipo Caixa.");
  if (data.finance.cashSessions?.some((item) => item.id === id || (item.accountId === input.accountId && !item.closure)))
    throw new Error("Já existe uma abertura com este identificador ou um caixa aberto nesta conta.");
  const session = cashSessionSchema.parse({ ...input, id, openedAt: new Date().toISOString(), openedOn: localDay() });
  return validateDatabase({ ...data, finance: { ...data.finance, cashSessions: [...(data.finance.cashSessions ?? []), session] } });
}

export function cashSessionCandidates(data: Database, session: CashSession, through = localDay()): MovementChoice[] {
  bankDateSchema.parse(through);
  if (session.closure || through < session.openedOn) throw new Error("Caixa fechado ou data de fechamento anterior à abertura.");
  const used = new Set((data.finance.cashSessions ?? []).flatMap((item) => item.closure?.movements.map(cashMovementKey) ?? []));
  const inPeriod = (date: string) => date >= session.openedOn && date <= through;
  const choices: MovementChoice[] = [];
  for (const entry of data.finance.entries) if (!entry.canceled) for (const settlement of entry.settlements) {
    if (settlement.reversed || settlement.accountId !== session.accountId || !inPeriod(settlement.date)) continue;
    const movement: CashSessionMovement = { source: "settlement", entryId: entry.id, settlementId: settlement.id,
      date: settlement.date, amount: (entry.kind === "Receber" ? 1 : -1) * settlementCashAmount(settlement) };
    if (!used.has(cashMovementKey(movement))) choices.push({ movement, ...cashMovementDetails(data, movement) });
  }
  for (const transfer of data.finance.transfers ?? []) {
    if (transfer.reversal || !inPeriod(transfer.date)) continue;
    const leg = transfer.toAccountId === session.accountId ? "incoming" : transfer.fromAccountId === session.accountId ? "outgoing" : "";
    if (!leg) continue;
    const movement: CashSessionMovement = { source: "transfer", transferId: transfer.id, leg,
      date: transfer.date, amount: leg === "incoming" ? transfer.amount : -transfer.amount };
    if (!used.has(cashMovementKey(movement))) choices.push({ movement, ...cashMovementDetails(data, movement) });
  }
  return choices.sort((a, b) => a.movement.date.localeCompare(b.movement.date) ||
    cashMovementKey(a.movement).localeCompare(cashMovementKey(b.movement)));
}

export function closeCashSession(data: Database, expected: CashSession, reviewedChoices: MovementChoice[], selectedKeys: string[],
  counted: number, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme a seleção de movimentos e o dinheiro contado antes de fechar.");
  const session = data.finance.cashSessions?.find((item) => item.id === expected.id);
  if (!session || session.closure || JSON.stringify(session) !== JSON.stringify(expected))
    throw new Error("Abertura alterada ou caixa já fechado. Atualize e revise.");
  const today = localDay();
  const choices = cashSessionCandidates(data, session, today);
  if (JSON.stringify(choices) !== JSON.stringify(reviewedChoices))
    throw new Error("Os movimentos mudaram. Atualize a seleção e revise o fechamento.");
  if (new Set(selectedKeys).size !== selectedKeys.length ||
    selectedKeys.some((key) => !choices.some((item) => cashMovementKey(item.movement) === key)))
    throw new Error("Seleção de movimentações indisponível ou duplicada.");
  const movements = choices.filter((item) => selectedKeys.includes(cashMovementKey(item.movement))).map((item) => item.movement);
  const expectedAmount = session.openingAmount + movements.reduce((sum, item) => sum + item.amount, 0);
  const updated = cashSessionSchema.parse({ ...session, closure: { at: new Date().toISOString(), date: today, counted,
    expected: expectedAmount, difference: counted - expectedAmount, movements } });
  return validateDatabase({ ...data, finance: { ...data.finance,
    cashSessions: data.finance.cashSessions!.map((item) => item.id === session.id ? updated : item) } });
}

export function cashMovementReversed(data: Database, movement: CashSessionMovement) {
  if (movement.source === "settlement") {
    const entry = data.finance.entries.find((item) => item.id === movement.entryId);
    const settlement = entry?.settlements.find((item) => item.id === movement.settlementId);
    if (!entry || !settlement) throw new Error("Baixa vinculada ao fechamento não encontrada.");
    return entry.canceled || settlement.reversed;
  }
  const transfer = data.finance.transfers?.find((item) => item.id === movement.transferId);
  if (!transfer) throw new Error("Transferência vinculada ao fechamento não encontrada.");
  return Boolean(transfer.reversal);
}
