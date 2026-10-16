import { useState } from "react";
import type { z } from "zod";
import type { Database } from "./domain";
import { currency } from "./domain";
import { fiscalRequest } from "./fiscalApi";
import { invoiceCalculationSchema, invoiceCalculationMetadataSchema, formatTaxMoney } from "./fiscalTaxCalculation";
import type { FiscalCatalogItem } from "./fiscalCatalogSchema";
import { retentionClearSchema, retentionConfirmationSchema } from "./fiscalRetentions";
import { applyFinanceRetention, clearFinanceRetention } from "./finance";

type Calculation = z.infer<typeof invoiceCalculationSchema>;
export function FiscalInvoiceCalculation({ data, catalog, calculations, busy, act, commit }: {
  data: Database; catalog: FiscalCatalogItem[]; calculations: z.infer<typeof invoiceCalculationMetadataSchema>[]; busy: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
  commit?: (update: (current: Database) => Database) => void;
}) {
  const [result, setResult] = useState<Calculation | null>(null);
  return <section>
    <h3>Calcular itens do faturamento</h3>
    <p>Usa os itens congelados ao faturar, não a OS atual. Exige emitente, destinatário e cadastros fiscais completos, além de matrizes revisadas e vigentes na data informada. Faturamentos anteriores sem itens não são reconstruídos automaticamente.</p>
    <form onChange={() => setResult(null)} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setResult(null);
      void act(async () => {
        const response = await fiscalRequest("/invoices/calculate", "POST", {
          invoiceId: form.get("invoiceId"), date: form.get("date"),
          ...(form.get("additionalServiceId") ? { additionalServiceId: form.get("additionalServiceId") } : {}),
        });
        const parsed = invoiceCalculationSchema.parse(await response.json());
        if (parsed.invoiceId !== form.get("invoiceId")) throw new Error("Memória retornada para outro faturamento.");
        setResult(parsed);
      }, "Memória de cálculo salva no backend. Nenhum XML, nota ou cobrança gerado.");
    }}>
      <fieldset disabled={busy}><legend>Preparação fiscal por itens</legend><div className="form-grid">
        <label className="field">Faturamento<select name="invoiceId" required defaultValue=""><option value="">Selecione</option>
          {data.finance.invoices.filter((invoice) => !invoice.canceled && invoice.kind !== "Legado").map((invoice) => <option key={invoice.id} value={invoice.id}>
            {invoice.kind} · {invoice.clientName} · {currency(invoice.amount)}{invoice.orders.some((order) => !order.items) ? " · sem snapshot dos itens" : ""}
          </option>)}</select></label>
        <label className="field">Data fiscal para selecionar vigência<input name="date" type="date" required /></label>
        <label className="field">Classificação dos adicionais (se houver)<select name="additionalServiceId" defaultValue="">
          <option value="">Selecione se houver adicionais</option>{catalog.filter((item) => item.kind === "nfse" && item.active).map((item) =>
            <option key={item.referenceId} value={item.referenceId}>{data.services.find((service) => service.id === item.referenceId)?.name ?? item.referenceId}</option>)}
        </select></label>
      </div><p>A classificação selecionada será usada para todos os acréscimos, deslocamento e pedágio deste cálculo. Se exigirem códigos diferentes, este agrupamento ainda não é suportado: não prossiga com uma classificação genérica.</p>
        <button className="button secondary">Calcular e salvar memória fiscal</button>
      </fieldset>
    </form>
    {data.finance.entries.some((entry) => entry.retention && !entry.canceled) && <form onSubmit={(event) => {
      event.preventDefault();
      const entryId = new FormData(event.currentTarget).get("entryId");
      const expected = data.finance.entries.find((entry) => entry.id === entryId);
      void act(async () => {
        if (!expected?.retention || !commit) throw new Error("Conciliação indisponível.");
        const calculationId = expected.retention.calculationId;
        const response = retentionClearSchema.parse(await (await fiscalRequest("/invoices/retentions/clear", "POST",
          { entryId: expected.id, calculationId, confirmation: true })).json());
        if (response.entryId !== expected.id || response.calculationId !== calculationId)
          throw new Error("Remoção retornada para outra conta/memória.");
        commit((current) => clearFinanceRetention(current, expected.id, calculationId, expected));
        setResult(null);
      }, "Conciliação removida; saldo bruto restaurado sem baixa ou estorno. Aguarde Sincronizado, revise os parâmetros e recalcule antes de emitir ou cobrar.");
    }}>
      <fieldset disabled={busy || !commit}><legend>Remover conciliação para corrigir parâmetros</legend>
        <p>Restaura o saldo bruto, sem apagar a memória fiscal. Bloqueado se houver baixas ativas, remessa anterior ou documento fiscal ativo. Corrija os parâmetros e recalcule antes de emitir ou cobrar.</p>
        <label className="field">Conta conciliada<select name="entryId" required defaultValue=""><option value="">Selecione</option>
          {data.finance.entries.filter((entry) => entry.retention && !entry.canceled).map((entry) =>
            <option key={entry.id} value={entry.id}>{entry.party} · bruto {currency(entry.amount)} · líquido {currency(entry.retention!.net)}</option>)}
        </select></label>
        <label className="checkbox-field"><input type="checkbox" required />Confirmo a remoção da conciliação e a restauração do saldo bruto para corrigir os parâmetros.</label>
        <button className="button secondary">Remover conciliação de retenções</button>
      </fieldset>
    </form>}
    <h4>Memórias salvas</h4>
    <p>Histórico para conferência, inclusive de faturamentos posteriormente alterados ou cancelados. Não indica autorização nem substitui um novo cálculo com os dados vigentes.</p>
    {calculations.map((record) => <p key={record.id}>{record.kind.toUpperCase()} · {record.date} · {record.createdAt} · {record.id.slice(0, 12)}{" "}
      <button className="text-button" disabled={busy} onClick={() => {
        setResult(null);
        void act(async () => {
          const parsed = invoiceCalculationSchema.parse(await (await fiscalRequest(`/invoice-calculations/${record.id}`)).json());
          if (parsed.id !== record.id) throw new Error("Memória retornada com identificador diferente do solicitado.");
          setResult(parsed);
        }, "Memória histórica recuperada; não representa validação dos dados atuais.");
      }}>Conferir memória salva</button>
    </p>)}
    {!calculations.length && <p>Nenhuma memória de cálculo salva.</p>}
    {result && <section aria-label="Memória de cálculo do faturamento">
      <p role="status">{result.warning}</p><p>Identificador: {result.id} · {result.createdAt}</p>
      <button className="button secondary" disabled={busy} onClick={() => void act(async () => {
        const response = await fiscalRequest(`/invoice-calculations/${result.id}`);
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `memoria-fiscal-${result.id}.json`; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "Memória fiscal baixada para conferência; não é documento fiscal autorizado.")}>Baixar memória completa (JSON)</button>
      <div className="finance-table"><table><thead><tr><th>OS / item</th><th>Matriz</th><th>Base após desconto</th><th>Tributos próprios</th><th>Retenções</th></tr></thead><tbody>
        {result.lines.map((line, index) => <tr key={index}><td>{line.orderCode} · {line.item.name} · qtd. {line.item.quantity}</td>
          <td>{line.matrix.name}</td><td>{formatTaxMoney(line.calculation.totals.net)}</td>
          <td>{formatTaxMoney(line.calculation.totals.ownTaxes)}</td><td>{formatTaxMoney(line.calculation.totals.withheld)}</td></tr>)}
      </tbody></table></div>
      <p>Total faturado: {formatTaxMoney(result.totals.net)} · Tributos próprios: {formatTaxMoney(result.totals.ownTaxes)} · Retenções: {formatTaxMoney(result.totals.withheld)} · Saldo simulado: {formatTaxMoney(result.totals.afterWithholding)}</p>
      {result.kind === "nfse" && result.totals.withheld !== "0.00" && <form onSubmit={(event) => {
        event.preventDefault();
        const expected = data.finance.entries.find((entry) => entry.invoiceId === result.invoiceId);
        void act(async () => {
          if (!expected || !commit) throw new Error("Conta indisponível para conciliação.");
          const response = retentionConfirmationSchema.parse(await (await fiscalRequest("/invoices/retentions/confirm", "POST",
            { calculationId: result.id, confirmation: true })).json());
          if (response.invoiceId !== result.invoiceId || response.entryId !== expected.id || response.retention.calculationId !== result.id)
            throw new Error("Conciliação retornada para outra conta/memória.");
          commit((current) => applyFinanceRetention(current, expected.id, response.retention, expected));
        }, "Retenções conciliadas no financeiro. Aguarde Sincronizado antes de gerar DPS. Não é recebimento, autorização fiscal ou cobrança bancária.");
      }}>
        <h4>Conciliar retenções e líquido a receber</h4>
        <p>IRRF, INSS e CSLL no escopo suportado. Preserva o bruto da OS/faturamento e deduz somente as retenções do saldo a receber, sem registrar baixa. ISS e PIS/COFINS retidos ainda bloqueados. Exige conta sem baixas ativas, sem documento ativo e sem remessa anterior; a conferência oficial da NFS-e ainda é necessária.</p>
        <label className="checkbox-field"><input type="checkbox" required disabled={busy} />Revisei com a contabilidade a incidência, dispensas, mínimos e limites por tributo. Confirmo o líquido acima; a prévia não comprova autorização nem recolhimento.</label>
        <button className="button secondary" disabled={busy || !commit}>Confirmar retenções e aplicar líquido</button>
      </form>}
    </section>}
  </section>;
}
