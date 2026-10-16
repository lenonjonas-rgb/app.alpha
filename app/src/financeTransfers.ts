import { localDay, validateDatabase } from "./domain";
import type { Database } from "./domain";
import { financeTransferSchema } from "./financeSchema";
import type { FinanceTransfer } from "./financeSchema";

export function recordFinanceTransfer(data: Database, input: FinanceTransfer, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme o registro interno da transferência.");
  const transfer = financeTransferSchema.parse(input);
  if (transfer.reversal) throw new Error("Uma nova transferência não pode iniciar estornada.");
  if (transfer.date > localDay()) throw new Error("Registre somente transferências já realizadas, sem data futura.");
  const current = data.finance.transfers ?? [];
  if (current.some((item) => item.id === transfer.id)) throw new Error("Transferência já registrada. Atualize a lista.");
  if (![transfer.fromAccountId, transfer.toAccountId].every((id) => data.finance.accounts.some((item) => item.id === id && item.active)))
    throw new Error("Selecione duas contas bancárias ativas.");
  return validateDatabase({ ...data, finance: { ...data.finance, transfers: [...current, transfer] } });
}

export function reverseFinanceTransfer(data: Database, expected: FinanceTransfer, reason: string, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme o estorno interno das duas pontas.");
  const current = data.finance.transfers ?? [];
  const transfer = current.find((item) => item.id === expected.id);
  if (!transfer || JSON.stringify(transfer) !== JSON.stringify(expected)) throw new Error("Transferência alterada ou indisponível. Atualize a lista.");
  if (transfer.reversal) throw new Error("Transferência já estornada.");
  const reversed = financeTransferSchema.parse({ ...transfer, reversal: { at: new Date().toISOString(), reason } });
  return validateDatabase({ ...data, finance: { ...data.finance, transfers: current.map((item) => item.id === transfer.id ? reversed : item) } });
}
