import { useState } from "react";
import type { z } from "zod";
import { currency } from "./domain";
import { fiscalRequest } from "./fiscalApi";
import { nfseCheckSchema } from "./fiscalNfseReconciliationSchema";
type Document = { id: string; kind: string; status: string; environment: string; key: string; accessKey?: string };
export function FiscalNfseReconciliation({ documents, busy, act }: {
  documents: Document[]; busy: boolean; act: (operation: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [check, setCheck] = useState<z.infer<typeof nfseCheckSchema> | null>(null);
  return <section>
    <h3>Conferir NFS-e autorizada e financeiro</h3>
    <p>Compara o XML retornado pela autoridade com a DPS enviada, memória e conta na nuvem. Não altera saldos, alíquotas ou baixas. Divergências exigem análise contábil; não são corrigidas automaticamente.</p>
    <form onChange={() => setCheck(null)} onSubmit={(event) => {
      event.preventDefault();
      const id = new FormData(event.currentTarget).get("documentId");
      setCheck(null);
      void act(async () => {
        const result = nfseCheckSchema.parse(await (await fiscalRequest(`/documents/${id}/reconciliation`)).json());
        if (result.documentId !== id) throw new Error("Conferência retornada para outro documento.");
        setCheck(result);
      }, "Conferência calculada. Revise valores e divergências antes de confirmar.");
    }}>
      <fieldset disabled={busy}><legend>NFS-e retornada pelo sistema nacional</legend>
        <label className="field">Documento<select name="documentId" required defaultValue=""><option value="">Selecione</option>
          {documents.filter((item) => item.kind === "nfse" && item.status === "autorizado").map((item) =>
            <option key={item.id} value={item.id}>{item.environment} · {item.accessKey ?? item.key}</option>)}
        </select></label>
        <button className="button secondary">Conferir valores oficiais</button>
      </fieldset>
    </form>
    {check && <section aria-label="Conferência oficial da NFS-e">
      <p>{check.environment === "homologacao" ? "HOMOLOGAÇÃO: conferência de teste. Nunca libera cobrança real ou remessa." : "Produção: confira antes de autorizar a cobrança."}</p>
      <p>Bruto após desconto: {currency(check.actual.invoiceAmount)} · Retenções: {currency(check.actual.withheld)} · Líquido: {currency(check.actual.net)}</p>
      <p>IRRF: {currency(check.actual.irrf)} · INSS: {currency(check.actual.inss)} · CSLL: {currency(check.actual.csll)} · ISS próprio: {currency(check.actual.iss)} · Base ISS: {currency(check.actual.issBase)}</p>
      <p>Base IBS/CBS: {check.actual.rtcBase === null ? "não retornada" : currency(check.actual.rtcBase)} · IBS: {check.actual.ibsTotal === null ? "não retornado" : currency(check.actual.ibsTotal)} · CBS: {check.actual.cbs === null ? "não retornada" : currency(check.actual.cbs)}</p>
      {check.differences.map((difference, index) => <p role="alert" key={index}>{difference}</p>)}
      {check.matches && <form key={check.id} onSubmit={(event) => {
        event.preventDefault();
        void act(async () => {
          const result = nfseCheckSchema.parse(await (await fiscalRequest(`/documents/${check.documentId}/reconciliation`, "POST",
            { checkId: check.id, confirmation: true })).json());
          if (result.id !== check.id || result.documentId !== check.documentId || !result.confirmedAt)
            throw new Error("Confirmação retornada diferente da conferência revisada.");
          setCheck(result);
        }, check.environment === "homologacao" ? "Conferência de homologação registrada; cobrança real permanece bloqueada." :
          "Conferência registrada; remessa revalidará nota e financeiro antes de gerar o arquivo.");
      }}>
        <label className="checkbox-field"><input type="checkbox" required disabled={busy} />Revisei a nota autorizada, o ambiente, as retenções e o líquido. Não estou registrando recebimento.</label>
        <button className="button secondary" disabled={busy}>Confirmar conferência {check.environment === "homologacao" ? "de teste" : "fiscal/financeira"}</button>
      </form>}
      {check.confirmedAt && <p role="status">Conferência registrada em {check.confirmedAt}. Alterações no XML, situação da nota ou dados financeiros exigem nova conferência.</p>}
    </section>}
  </section>;
}
