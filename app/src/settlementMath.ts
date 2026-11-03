export function settlementCashAmount(settlement: { amount: number; adjustment?: { interest: number; fine: number; discount: number } }) {
  return settlement.amount + (settlement.adjustment?.interest ?? 0) + (settlement.adjustment?.fine ?? 0) - (settlement.adjustment?.discount ?? 0);
}
