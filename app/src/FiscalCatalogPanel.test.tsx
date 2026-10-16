import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FiscalCatalogPanel } from "./FiscalCatalogPanel";
import { fiscalCatalogSchema } from "./fiscalCatalogSchema";
import { demoDatabase } from "./domain";

describe("cadastro fiscal básico", () => {
  it("exibe produtos/serviços, situação e revisão pendente sem prometer emissão", () => {
    const data = demoDatabase();
    const catalog = fiscalCatalogSchema.parse([
      { kind: "nfe", referenceId: data.products[0].id, ruleId: "product-rule", unit: "UN", ncm: "84821010", origin: "0",
        active: true, notes: "", updatedAt: "2026-10-15T20:00:00Z" },
      { kind: "nfse", referenceId: data.services[0].id, ruleId: "service-rule", nationalCode: "140101", municipalCode: "",
        nbs: "120029000", active: false, notes: "", updatedAt: "2026-10-15T20:00:00Z" },
    ]);
    const html = renderToStaticMarkup(<FiscalCatalogPanel data={data} catalog={catalog} rules={[
      { id: "product-rule", kind: "nfe", name: "Referência de venda", reviewed: false },
      { id: "service-rule", kind: "nfse", name: "Referência de serviço", reviewed: true },
    ]} busy={false} act={async () => {}} />);
    expect(html).toContain("NCM 84821010");
    expect(html).toContain("NBS 120029000");
    expect(html).toContain("Revisão pendente");
    expect(html).toContain("Inativo");
    expect(html).toContain("Não calcula impostos nem gera XML automaticamente");
    expect(html).toContain("Editar / inativar");
  });
  it("mostra referências ou itens ausentes sem esconder registros persistidos", () => {
    const html = renderToStaticMarkup(<FiscalCatalogPanel data={demoDatabase()} catalog={[{
      kind: "nfe", referenceId: "removed", ruleId: "removed-rule", unit: "UN", ncm: "84821010", origin: "0", active: true,
      notes: "", updatedAt: "2026-10-15T20:00:00Z",
    }]} rules={[]} busy={false} act={async () => {}} />);
    expect(html).toContain("Item ausente: removed");
    expect(html).toContain("Referência ausente");
    expect(html).toContain("disabled");
  });
});
