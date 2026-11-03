import { financeEntryDetailsSchema } from "./financeSchema";
import { percentToBasisPoints } from "./financePercent";

export function readFinanceEntryDetails(form: FormData) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  return financeEntryDetailsSchema.parse({
    competenceOn: text("competenceOn"), documentNumber: text("documentNumber"), seller: text("seller"),
    monthlyInterestBasisPoints: percentToBasisPoints(text("monthlyInterestRate")),
    lateFineBasisPoints: percentToBasisPoints(text("lateFineRate")),
  });
}
