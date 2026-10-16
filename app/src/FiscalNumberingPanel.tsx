import { fiscalRequest } from "./fiscalApi";
import { numberingFromForm, type FiscalNumberingRecord, type FiscalNumberReservation } from "./fiscalNumberingSchema";

export function FiscalNumberingPanel({ records, reservations, busy, act, model = "nfe" }: {
  records: FiscalNumberingRecord[]; reservations: FiscalNumberReservation[]; busy: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
  model?: "nfe" | "nfse";
}) {
  const dps = model === "nfse";
  const maximum = dps ? 999999999999999 : 999999999;
  return <section>
    <h3>Séries e numeração {dps ? "da DPS" : "da NF-e"}</h3>
    <p>Somente Master configura. Confirme a série e o próximo número livre com a contabilidade e todos os emissores, inclusive Bling. O Alpha não consulta nem bloqueia outros sistemas. Esta configuração não é credenciamento ou liberação de produção.</p>
    <p>{dps ? "DPS própria via API: séries 1 a 49999, número até 15 dígitos. O número da DPS não é o número da NFS-e autorizada. O gerador automático aceita somente homologação; configurar produção não libera envio." : "NF-e normal: séries 0 a 889."} Cada CNPJ, série e ambiente tem seu contador independente por modelo. O número é consumido apenas ao salvar um rascunho validado, na mesma transação do documento. Descarte/rejeição não devolvem números. Avançar manualmente pode criar lacunas que precisam de avaliação fiscal fora deste fluxo.</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void act(async () => { await fiscalRequest(dps ? "/dps-numbering" : "/numbering", "PUT", numberingFromForm(form, records, model)); },
        "Numeração salva. Nenhuma nota emitida; coordene a série com todos os emissores.");
    }}><fieldset disabled={busy}><legend>Configurar / avançar contador</legend><div className="form-grid">
      <label className="field">Ambiente<select name="environment" required><option value="homologacao">Homologação</option><option value="producao">Produção</option></select></label>
      <label className="field">Série<input name="series" required type="number" min={dps ? 1 : 0} max={dps ? 49999 : 889} step={1} /></label>
      <label className="field">Próximo número livre<input name="nextNumber" required type="number" min={1} max={maximum} step={1} /></label>
    </div><label className="checkbox-field"><input type="checkbox" name="confirmation" required />Confirmei a numeração livre e a coordenação com outros emissores. Sei que não posso reduzir o contador.</label>
      <button className="button secondary">Salvar numeração (Master)</button>
    </fieldset></form>
    <div className="finance-table"><table><thead><tr><th>Ambiente</th><th>Série</th><th>Próximo número</th><th>Atualização</th></tr></thead><tbody>
      {records.map((record) => <tr key={`${record.environment}:${record.series}`}><td>{record.environment}</td><td>{record.series}</td>
        <td>{record.nextNumber > maximum ? "Esgotada" : record.nextNumber}</td><td>{record.updatedAt}</td></tr>)}
    </tbody></table></div>
    {!records.length && <p>Nenhuma série configurada. {dps ? "DPS" : "NF-e"} externa também exige configurar antes de salvar novo rascunho.</p>}
    <h4>Números consumidos no Alpha</h4>
    <p>Reservas locais não comprovam autorização. Documentos antigos anteriores ao controle permanecem no histórico de documentos e são considerados ao configurar o próximo número.</p>
    {reservations.map((record) => <p key={`${record.environment}:${record.series}:${record.number}`}>
      {record.environment} · série {record.series} · número {record.number} · faturamento {record.invoiceId} · {record.createdAt}
    </p>)}
  </section>;
}
