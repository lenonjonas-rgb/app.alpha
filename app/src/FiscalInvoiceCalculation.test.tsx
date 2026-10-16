import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase } from "./domain";
import { FiscalInvoiceCalculation } from "./FiscalInvoiceCalculation";
import { invoiceCalculationSchema } from "./fiscalTaxCalculation";

describe("cálculo fiscal do faturamento", () => {
  it("explica uso dos snapshots e classificação explícita dos adicionais sem oferecer emissão automática", () => {
    const html = renderToStaticMarkup(<FiscalInvoiceCalculation data={demoDatabase()} catalog={[]} calculations={[]} busy={false} act={async () => {}} />);
    expect(html).toContain("não a OS atual");
    expect(html).toContain("matrizes revisadas");
    expect(html).toContain('name="date"');
    expect(html).toContain('name="additionalServiceId"');
    expect(html).toContain("códigos diferentes");
    expect(html).toContain("Calcular e salvar memória fiscal");
    expect(html).not.toContain("Assinar");
  });
  it("permite recuperar memórias históricas sem confundir com aprovação vigente", () => {
    const html = renderToStaticMarkup(<FiscalInvoiceCalculation data={demoDatabase()} catalog={[]} busy={false} act={async () => {}}
      calculations={[{ id: "historical-id", invoiceId: "old", kind: "nfe", date: "2026-10-15", createdAt: "2026-10-15T20:00:00Z" }]} />);
    expect(html).toContain("Conferir memória salva");
    expect(html).toContain("posteriormente alterados ou cancelados");
    expect(html).toContain("historical-i");
  });
  it("valida shape monetário e exige histórico e linhas retornados pelo backend", () => {
    const totals = { gross: "100.00", discount: "10.00", net: "90.00", ownTaxes: "1.00", withheld: "0.00", afterWithholding: "90.00" };
    const record = { id: "hash", invoiceId: "invoice", kind: "nfe", date: "2026-10-15", createdAt: "now", warning: "Não é nota",
      totals, lines: [{ orderCode: "OS-1", item: { name: "Peça", quantity: 2 }, matrix: { name: "Revenda" },
        calculation: { kind: "nfe", rounding: "half-up-per-item", totals, items: [{ id: "item", ...totals, taxes: [] }] } }] };
    expect(invoiceCalculationSchema.parse(record).lines[0].calculation.totals.net).toBe("90.00");
    expect(() => invoiceCalculationSchema.parse({ ...record, totals: { ...totals, net: 9000 } })).toThrow();
    expect(() => invoiceCalculationSchema.parse({ ...record, lines: undefined })).toThrow();
  });
});
