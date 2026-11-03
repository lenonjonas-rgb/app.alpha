import { localDay } from "./domain";
import type { FinanceEntry } from "./financeSchema";

export function FinanceEntryDetailsFields({ kind, recurring = false }: { kind: FinanceEntry["kind"]; recurring?: boolean }) {
  return <>
    <label className="field">{recurring ? "Competência da primeira ocorrência" : "Competência"}
      <input type="date" name="competenceOn" required defaultValue={localDay()} /></label>
    <label className="field">Número do documento<input name="documentNumber" maxLength={200} /></label>
    {kind === "Receber" && <label className="field">Vendedor<input name="seller" maxLength={160} /></label>}
    <label className="field">Juros mensal informativo (%)<input type="number" name="monthlyInterestRate" min="0" max="100" step="0.01" required defaultValue="0" /></label>
    <label className="field">Multa informativa (%)<input type="number" name="lateFineRate" min="0" max="100" step="0.01" required defaultValue="0" /></label>
    <p className="full">Os percentuais são apenas informativos. Juros, multa e desconto devem ser conferidos e lançados manualmente na baixa quando disponíveis.
      {recurring && " A competência avança mensalmente a partir da primeira ocorrência."}</p>
  </>;
}
