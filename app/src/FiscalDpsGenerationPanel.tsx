import { useState } from "react";
import type { Database } from "./domain";
import { currency } from "./domain";
import { fiscalRequest } from "./fiscalApi";
import { generatedDpsResponseSchema, dpsGenerationFromForm } from "./fiscalDpsGeneration";
import type { FiscalNumberingRecord } from "./fiscalNumberingSchema";
import type { FiscalCatalogItem } from "./fiscalCatalogSchema";

export function FiscalDpsGenerationPanel({ data, catalog, numbering, busy, certificateReady, schemaReady, act }: {
  data: Database; catalog: FiscalCatalogItem[]; numbering: FiscalNumberingRecord[]; busy: boolean; certificateReady: boolean; schemaReady: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [series, setSeries] = useState("");
  const counter = numbering.find((item) => item.environment === "homologacao" && String(item.series) === series);
  return <section>
    <h3>Gerar DPS dos serviços · Homologação</h3>
    <p>Usa os itens faturados, descontos e adicionais cobrados, sem reconstruir a OS atual. Apenas manutenção cTribNac140101 prestada e sujeita ao ISS em Florianópolis, emissão/competência em 2026, ISS próprio, sem deduções ou regime especial, IBS/CBS000/000001. IRRF, INSS e CSLL exigem conciliação explícita do líquido na memória fiscal e financeiro Sincronizado. ISS e PIS/COFINS retidos ainda bloqueados. Todos os itens precisam da mesma classificação e parâmetros. Serviços com códigos distintos ainda exigem outro fluxo.</p>
    <p>A DPS não é NFS-e autorizada. O número local só é consumido após assinatura/XSD; gerar não transmite. A transmissão é separada. Alíquotas/valores oficiais de ISS e IBS/CBS dependem da apuração nacional/municipal; a memória é prévia e não substitui a nota retornada. Boleto/Pix permanecem na cobrança financeira separada, sem registro bancário.</p>
    {(!certificateReady || !schemaReady) && <p role="alert">Cadastre o A1 e instale os schemas DPS vigentes antes de gerar.</p>}
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void act(async () => {
        generatedDpsResponseSchema.parse(await (await fiscalRequest("/documents/generate-dps", "POST", dpsGenerationFromForm(form))).json());
      }, "DPS gerada em homologação, número local consumido. Nenhuma transmissão, NFS-e autorizada ou cobrança bancária realizada.");
    }}><fieldset disabled={busy || !certificateReady || !schemaReady}><legend>Dados da DPS de teste</legend><div className="form-grid">
      <label className="field">Faturamento de serviços<select name="invoiceId" required defaultValue=""><option value="">Selecione</option>
        {data.finance.invoices.filter((invoice) => !invoice.canceled && invoice.kind === "Serviços").map((invoice) =>
          <option key={invoice.id} value={invoice.id}>{invoice.clientName} · {currency(invoice.amount)} · {invoice.orders.map((order) => order.code).join(", ")}</option>)}
      </select></label>
      <label className="field">Classificação dos adicionais (se houver)<select name="additionalServiceId" defaultValue=""><option value="">Sem adicionais</option>
        {catalog.filter((item) => item.kind === "nfse" && item.active).map((item) =>
          <option key={item.referenceId} value={item.referenceId}>{data.services.find((service) => service.id === item.referenceId)?.name ?? item.referenceId}</option>)}
      </select></label>
      <label className="field">Série DPS de homologação<select name="series" value={series} required onChange={(event) => setSeries(event.target.value)}>
        <option value="">Selecione</option>{numbering.filter((item) => item.environment === "homologacao" && item.nextNumber <= 999999999999999).map((item) =>
          <option key={item.series} value={item.series}>{item.series} · próximo {item.nextNumber}</option>)}
      </select></label>
      <label className="field">Número DPS a consumir<input name="expectedNumber" readOnly required value={counter?.nextNumber ?? ""} /></label>
      <label className="field">Emissão (SC, -03:00)<input name="issuedAt" type="datetime-local" step={1} required min="2026-01-01T00:00:00" max="2026-12-31T23:59:59" /></label>
      <label className="field">Competência (início do serviço)<input name="competence" type="date" required min="2026-01-01" max="2026-12-31" /></label>
      <label className="field">Indicador da operação (cIndOp, tabela oficial)<input name="operationIndicator" pattern="[0-9]{6}" maxLength={6} required /></label>
      <label className="field">Uso ou consumo pessoal (art. 57)<select name="personalUse" required defaultValue=""><option value="">Selecione</option><option value="0">Não</option><option value="1">Sim</option></select></label>
      <label className="field">Carga tributária estimada federal (%)<input name="totalFederal" inputMode="decimal" required /></label>
      <label className="field">Carga tributária estimada estadual (%)<input name="totalState" inputMode="decimal" required /></label>
      <label className="field">Carga tributária estimada municipal (%)<input name="totalMunicipal" inputMode="decimal" required /></label>
    </div>
      <p>Informe cIndOp e percentuais estimados conforme fonte/revisão contábil. Não são as alíquotas de retenção nem substituem os parâmetros da matriz. Zero precisa ser informado explicitamente; não há valores presumidos.</p>
      <label className="checkbox-field"><input name="confirmUnconditionalDiscount" type="checkbox" required />Os descontos faturados são incondicionais; não há deduções especiais.</label>
      <label className="checkbox-field"><input name="confirmScope" type="checkbox" required />Conferi serviço/local em Florianópolis, incidência, ausência de ISS/PIS/COFINS retidos e regimes especiais, tomador como próprio destinatário (não ente governamental) e numeração. É teste sem valor fiscal.</label>
      <label className="checkbox-field"><input name="confirmRetentions" type="checkbox" />Se há retenções de IRRF/INSS/CSLL, revisei incidência, dispensas e limites e confirmei o líquido na memória fiscal. Aguardei Sincronizado; retenção não é recebimento.</label>
      <button className="button primary" disabled={!counter}>Gerar e validar rascunho DPS</button>
    </fieldset></form>
  </section>;
}
