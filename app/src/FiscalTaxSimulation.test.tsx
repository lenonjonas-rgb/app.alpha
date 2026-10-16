import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FiscalTaxSimulation, FiscalTaxSimulationResult } from "./FiscalTaxSimulation";
import { fiscalTaxSimulationSchema, formatTaxMoney, taxSimulationFromForm } from "./fiscalTaxCalculation";
import { fiscalMatrixSchema } from "./fiscalMatrixSchema";

const matrix = fiscalMatrixSchema.parse({ id: "matrix", name: "Teste SC", kind: "nfe", operation: "Revenda teste",
  ruleId: "rule", validFrom: "2026-01-01", validUntil: "2026-12-31", destinationState: "SC", ieIndicator: "9",
  finalConsumer: true, active: true, reviewed: false, approval: "", updatedAt: "2026-10-15T20:00:00Z",
  ruleSnapshot: { reviewed: false, scope: "Referência SC", fields: {} } });
describe("prévia tributária", () => {
  it("envia valores monetários decimais e a revisão da matriz, sem parâmetros sobrescritos no navegador", () => {
    const form = new FormData();
    form.set("gross", "1000,25"); form.set("discount", " 10,20 ");
    expect(taxSimulationFromForm(form, matrix)).toEqual({
      matrixId: "matrix", updatedAt: matrix.updatedAt, items: [{ id: "preview", gross: "1000.25", discount: "10.20" }],
    });
  });
  it("não converte vazio em zero nem arredonda entrada inválida", () => {
    for (const value of ["", "-1", "1,001", "1.000,00", "1e3", "NaN"]) {
      const form = new FormData(); form.set("gross", value); form.set("discount", "0");
      expect(() => taxSimulationFromForm(form, matrix)).toThrow();
    }
    const form = new FormData(); form.set("gross", "1");
    expect(() => taxSimulationFromForm(form, matrix)).toThrow();
  });
  it("formata centavos e totais grandes sem conversão para ponto flutuante", () => {
    expect(formatTaxMoney("0.01")).toBe("R$ 0,01");
    expect(formatTaxMoney("199999999999998.00")).toBe("R$ 199.999.999.999.998,00");
  });
  it("apresenta os limites e exige desconto explícito, sem gerar nota ou cobrança", () => {
    const html = renderToStaticMarkup(<FiscalTaxSimulation matrix={matrix} busy={false} act={async () => {}} />);
    expect(html).toContain("mesmo pendentes de revisão");
    expect(html).toContain("operações especiais são bloqueadas");
    expect(html).toContain('name="gross"');
    expect(html).toContain('name="discount"');
    expect(html).toContain("Calcular prévia tributária");
    expect(html).not.toContain("Resultado da simulação");
  });
  it("valida resposta e separa tributos próprios de retenções sem apresentar saldo como nota autorizada", () => {
    const totals = { gross: "100.00", discount: "0.00", net: "100.00", ownTaxes: "1.00", withheld: "5.00", afterWithholding: "95.00" };
    const response = { simulation: true, matrixId: matrix.id, updatedAt: matrix.updatedAt, warning: "Prévia, sem autorização fiscal.",
      result: { kind: "nfse", rounding: "half-up-per-item", totals, items: [{ id: "preview", ...totals, taxes: [
        { code: "iss", label: "ISS", base: "100.00", rate: "5", amount: "5.00", retained: true },
        { code: "cbs", label: "CBS", base: "100.00", rate: "1", amount: "1.00", retained: false },
      ] }] } };
    const parsed = fiscalTaxSimulationSchema.parse(response);
    const html = renderToStaticMarkup(<FiscalTaxSimulationResult simulation={parsed} />);
    expect(html).toContain("R$ 95,00");
    expect(html).toContain("Retido do cliente");
    expect(html).toContain("Tributo próprio (informativo)");
    expect(html).toContain("Não representa total autorizado");
    expect(html).toContain("meio centavo arredonda para cima");
    expect(() => fiscalTaxSimulationSchema.parse({ ...response, simulation: false })).toThrow();
    expect(() => fiscalTaxSimulationSchema.parse({ ...response, result: { ...response.result, totals: { ...totals, net: 100 } } })).toThrow();
  });
});
