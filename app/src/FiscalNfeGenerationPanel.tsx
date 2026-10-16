import { useState } from "react";
import type { Database } from "./domain";
import { currency } from "./domain";
import { fiscalRequest } from "./fiscalApi";
import { generatedNfeResponseSchema, nfeGenerationFromForm } from "./fiscalNfeGeneration";
import type { FiscalNumberingRecord } from "./fiscalNumberingSchema";

export function FiscalNfeGenerationPanel({ data, numbering, busy, certificateReady, schemaReady, act }: {
  data: Database; numbering: FiscalNumberingRecord[]; busy: boolean; certificateReady: boolean; schemaReady: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [series, setSeries] = useState("");
  const counter = numbering.find((item) => item.environment === "homologacao" && String(item.series) === series);
  return <section>
    <h3>Gerar XML da NF-e de produtos · Homologação</h3>
    <p>Gera o XML automaticamente dos itens faturados e recalcula com cadastros/matrizes revisados. Apenas revenda interna SC/5102, ICMS00, PIS/COFINS01/02, IBS/CBS000/000001 e emissão em 2026. Não inclui ST/FCP/DIFAL/IPI, benefícios, devoluções ou exportações. Não use para operações fora desse escopo.</p>
    <p>O rascunho só é salvo após assinatura de teste e validação no XSD instalado. Nesse momento consome o número, mesmo sem transmitir. A transmissão é uma ação separada na lista de documentos. Produção ainda não está disponível neste gerador.</p>
    {(!certificateReady || !schemaReady) && <p role="alert">Cadastre o A1 e instale os schemas NF-e vigentes para validar e salvar o rascunho. Nenhum número é consumido se a validação falhar.</p>}
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void act(async () => {
        generatedNfeResponseSchema.parse(await (await fiscalRequest("/documents/generate-nfe", "POST", nfeGenerationFromForm(form))).json());
      }, "XML NF-e gerado e rascunho salvo em homologação. Número consumido; nenhuma transmissão ou cobrança realizada. Confira em Documentos fiscais.");
    }}><fieldset disabled={busy || !certificateReady || !schemaReady}><legend>Dados da emissão de teste</legend><div className="form-grid">
      <label className="field">Faturamento de produtos<select name="invoiceId" required defaultValue=""><option value="">Selecione</option>
        {data.finance.invoices.filter((invoice) => !invoice.canceled && invoice.kind === "Produtos").map((invoice) =>
          <option key={invoice.id} value={invoice.id}>{invoice.clientName} · {currency(invoice.amount)} · {invoice.orders.map((order) => order.code).join(", ")}</option>)}
      </select></label>
      <label className="field">Série de homologação<select name="series" value={series} required onChange={(event) => setSeries(event.target.value)}>
        <option value="">Selecione</option>{numbering.filter((item) => item.environment === "homologacao" && item.nextNumber <= 999999999).map((item) =>
          <option key={item.series} value={item.series}>{item.series} · próximo {item.nextNumber}</option>)}
      </select></label>
      <label className="field">Número a consumir<input name="expectedNumber" readOnly required value={counter?.nextNumber ?? ""} /></label>
      <label className="field">Emissão (horário de SC, -03:00)<input name="issuedAt" type="datetime-local" step={1} required min="2026-01-01T00:00:00" max="2026-12-31T23:59:59" /></label>
      <label className="field">Natureza da operação<input name="nature" required maxLength={60} /></label>
      <label className="field">Presença do comprador<select name="presence" required defaultValue=""><option value="">Selecione</option>
        <option value="0">0 · Não se aplica</option><option value="1">1 · Operação presencial</option></select></label>
      <label className="field">Condição de pagamento<select name="paymentTiming" required defaultValue=""><option value="">Selecione</option>
        <option value="0">À vista</option><option value="1">A prazo</option></select></label>
    </div>
      <label className="checkbox-field"><input name="confirmNoGtin" type="checkbox" required />Confirmei que todos os produtos não possuem GTIN e usam a mesma unidade comercial/tributável (SEM GTIN).</label>
      <label className="checkbox-field"><input name="confirmNoFreight" type="checkbox" required />Não há transporte/frete, seguro ou outras despesas de produtos a declarar nesta NF-e (modalidade 9).</label>
      <label className="checkbox-field"><input name="confirmScope" type="checkbox" required />Conferi o enquadramento limitado, os parâmetros e a numeração. É teste sem valor fiscal; o número local será consumido.</label>
      <button className="button primary" disabled={!counter}>Gerar e validar rascunho NF-e</button>
    </fieldset></form>
  </section>;
}
