import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase } from "./domain";
import { FiscalNfeGenerationPanel } from "./FiscalNfeGenerationPanel";
import { nfeGenerationFromForm, generatedNfeResponseSchema } from "./fiscalNfeGeneration";

function form() {
  const form = new FormData();
  for (const [name, value] of Object.entries({ invoiceId: "invoice", series: "1", expectedNumber: "10",
    issuedAt: "2026-10-15T14:00", nature: "VENDA DE MERCADORIA", presence: "1", paymentTiming: "0",
    confirmNoGtin: "on", confirmNoFreight: "on", confirmScope: "on" })) form.set(name, value);
  return form;
}
describe("geração automática NF-e", () => {
  it("envia data/hora explícita SC, número esperado e confirmações, sem aceitar XML ou taxas do navegador", () => {
    expect(nfeGenerationFromForm(form())).toEqual({
      invoiceId: "invoice", environment: "homologacao", series: 1, expectedNumber: 10,
      issuedAt: "2026-10-15T14:00:00-03:00", nature: "VENDA DE MERCADORIA", presence: "1", paymentTiming: "0",
      confirmNoGtin: true, confirmNoFreight: true, confirmScope: true,
    });
    const value = form(); value.set("issuedAt", "2026-10-15T14:00:35");
    expect(nfeGenerationFromForm(value).issuedAt).toBe("2026-10-15T14:00:35-03:00");
  });
  it("exige confirmações, série, número e escolhas explícitas", () => {
    for (const field of ["confirmNoGtin", "confirmNoFreight", "confirmScope", "issuedAt", "expectedNumber", "presence", "paymentTiming"]) {
      const input = form(); input.delete(field); expect(() => nfeGenerationFromForm(input)).toThrow();
    }
    const input = form(); input.set("issuedAt", "2027-01-01T14:00"); expect(() => nfeGenerationFromForm(input)).toThrow();
    expect(() => generatedNfeResponseSchema.parse({ id: "id", key: "bad", status: "autorizado" })).toThrow();
  });
  it("sinaliza homologação limitada, consumo e dependências sem oferecer produção ou transmitir", () => {
    const html = renderToStaticMarkup(<FiscalNfeGenerationPanel data={demoDatabase()} numbering={[]} busy={false}
      certificateReady={false} schemaReady={false} act={async () => {}} />);
    for (const text of ["Homologação", "SEM GTIN", "2026", "consome o número", "transmissão é uma ação separada", "Cadastre o A1"])
      expect(html).toContain(text);
    expect(html).toContain("disabled");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('value="producao"');
  });
});
