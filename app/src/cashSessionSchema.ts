import { z } from "zod";
import { bankDateSchema } from "./bankingSchema";
import { settlementCashAmount } from "./settlementMath";
import type { Finance } from "./financeSchema";

const id = z.string().min(1).max(200);
const amount = z.number().int().min(-100_000_000).max(100_000_000).refine((value) => value !== 0);
const total = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const cashSessionMovementSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("settlement"), entryId: id, settlementId: id, date: bankDateSchema, amount }),
  z.object({ source: z.literal("transfer"), transferId: id, leg: z.enum(["incoming", "outgoing"]), date: bankDateSchema, amount }),
]);
export const cashSessionSchema = z.object({
  id, accountId: id, store: z.string().trim().min(1).max(160), openedAt: z.iso.datetime(), openedOn: bankDateSchema,
  openingAmount: z.number().int().nonnegative().max(100_000_000),
  closure: z.object({
    at: z.iso.datetime(), date: bankDateSchema, counted: z.number().int().nonnegative().max(100_000_000),
    expected: total, difference: total, movements: z.array(cashSessionMovementSchema).max(10000),
  }).optional(),
}).superRefine((session, context) => {
  const closure = session.closure;
  if (closure && (closure.at < session.openedAt || closure.date < session.openedOn ||
    closure.expected !== session.openingAmount + closure.movements.reduce((sum, item) => sum + item.amount, 0) ||
    closure.difference !== closure.counted - closure.expected ||
    closure.movements.some((item) => item.date < session.openedOn || item.date > closure.date)))
    context.addIssue({ code: "custom", message: "Datas ou valores do fechamento de caixa inconsistentes." });
});
export type CashSession = z.infer<typeof cashSessionSchema>;
export type CashSessionMovement = z.infer<typeof cashSessionMovementSchema>;

export function cashMovementKey(movement: CashSessionMovement) {
  return movement.source === "settlement" ? JSON.stringify(["settlement", movement.entryId, movement.settlementId]) :
    JSON.stringify(["transfer", movement.transferId, movement.leg]);
}

export function validateCashSessions(finance: Finance) {
  const sessions = finance.cashSessions ?? [];
  const ids = new Set<string>(), openAccounts = new Set<string>(), movements = new Set<string>();
  for (const session of sessions) {
    if (ids.has(session.id) || !finance.accounts.some((account) => account.id === session.accountId && account.kind === "Caixa"))
      throw new Error("Caixas com identificadores duplicados ou conta financeira incompatível.");
    ids.add(session.id);
    if (!session.closure) {
      if (openAccounts.has(session.accountId)) throw new Error("Já existe um caixa aberto nesta conta.");
      openAccounts.add(session.accountId);
      continue;
    }
    for (const movement of session.closure.movements) {
      const key = cashMovementKey(movement);
      if (movements.has(key)) throw new Error("Movimentação vinculada a mais de um fechamento de caixa.");
      movements.add(key);
      if (movement.source === "settlement") {
        const entry = finance.entries.find((item) => item.id === movement.entryId);
        const settlement = entry?.settlements.find((item) => item.id === movement.settlementId);
        if (!entry || !settlement || settlement.accountId !== session.accountId || settlement.date !== movement.date ||
          (entry.kind === "Receber" ? settlementCashAmount(settlement) : -settlementCashAmount(settlement)) !== movement.amount)
          throw new Error("Movimentação do fechamento diverge da baixa original.");
      } else {
        const transfer = finance.transfers?.find((item) => item.id === movement.transferId);
        if (!transfer || transfer.date !== movement.date ||
          (movement.leg === "incoming" ? transfer.toAccountId : transfer.fromAccountId) !== session.accountId ||
          (movement.leg === "incoming" ? transfer.amount : -transfer.amount) !== movement.amount)
          throw new Error("Movimentação do fechamento diverge da transferência original.");
      }
    }
  }
}
