import { useState } from "react";
import { fiscalRequest } from "./fiscalApi";
import { fiscalTaxSimulationSchema, formatTaxMoney, taxSimulationFromForm, type FiscalTaxSimulation as Simulation } from "./fiscalTaxCalculation";
import type { FiscalMatrixRecord } from "./fiscalMatrixSchema";

export function FiscalTaxSimulationResult({ simulation }: { simulation: Simulation }) {
  const { totals, items } = simulation.result;
  return <section aria-label="Resultado da simulação tributária">
    <p role="status">{simulation.warning}</p>
    <div className="finance-table"><table><thead><tr><th>Tributo</th><th>Base</th><th>Alíquota</th><th>Valor</th><th>Tratamento</th></tr></thead><tbody>
      {items.flatMap((item) => item.taxes.map((tax) => <tr key={`${item.id}:${tax.code}`}>
        <td>{tax.label}</td><td>{formatTaxMoney(tax.base)}</td><td>{tax.rate}%</td><td>{formatTaxMoney(tax.amount)}</td>
        <td>{tax.retained ? "Retido do cliente" : "Tributo próprio (informativo)"}</td>
      </tr>))}
    </tbody></table></div>
    <p>Bruto: <strong>{formatTaxMoney(totals.gross)}</strong> · Desconto: <strong>{formatTaxMoney(totals.discount)}</strong> · Após desconto: <strong>{formatTaxMoney(totals.net)}</strong></p>
    <p>Tributos próprios simulados: <strong>{formatTaxMoney(totals.ownTaxes)}</strong> · Retenções simuladas: <strong>{formatTaxMoney(totals.withheld)}</strong></p>
    <p>Saldo após retenções simuladas: <strong>{formatTaxMoney(totals.afterWithholding)}</strong>. Não representa total autorizado da nota nem valor de cobrança gerada.</p>
    <p>Arredondamento por tributo/item ao centavo mais próximo; meio centavo arredonda para cima. Totais somam os itens já arredondados.</p>
  </section>;
}
export function FiscalTaxSimulation({ matrix, busy, act }: {
  matrix: FiscalMatrixRecord; busy: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  return <section>
    <h4>Simular parâmetros de {matrix.name}</h4>
    <p>Prévia de um item, sem alterar OS, financeiro ou documentos. Usa os parâmetros salvos nesta versão, mesmo pendentes de revisão. NF-e: revenda interna SC/5102, ICMS 00 e PIS/COFINS 01/02. IBS/CBS: 000/000001. Bases integrais; operações especiais são bloqueadas.</p>
    <form onChange={() => setSimulation(null)} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setSimulation(null);
      void act(async () => {
        const response = await fiscalRequest("/matrices/simulate", "POST", taxSimulationFromForm(form, matrix));
        const parsed = fiscalTaxSimulationSchema.parse(await response.json());
        if (parsed.matrixId !== matrix.id || parsed.updatedAt !== matrix.updatedAt || parsed.result.kind !== matrix.kind)
          throw new Error("A simulação retornou outra versão/modelo de matriz. Atualize a tela e tente novamente.");
        setSimulation(parsed);
      }, "Simulação calculada. Nenhum documento ou cobrança foi gerado.");
    }}>
      <fieldset disabled={busy}><legend>Valores para conferência</legend><div className="form-grid">
        <label className="field">Valor bruto (R$)<input name="gross" inputMode="decimal" required placeholder="Ex.: 1000,00" /></label>
        <label className="field">Desconto incondicional (R$)<input name="discount" inputMode="decimal" required placeholder="Informe 0 se não houver" /></label>
      </div><button className="button secondary">Calcular prévia tributária</button></fieldset>
    </form>
    {simulation && <FiscalTaxSimulationResult simulation={simulation} />}
  </section>;
}
