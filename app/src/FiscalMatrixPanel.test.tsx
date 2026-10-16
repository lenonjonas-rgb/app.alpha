import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FiscalMatrixPanel } from "./FiscalMatrixPanel";
import { fiscalMatrixSchema } from "./fiscalMatrixSchema";

describe("matriz tributária", () => {
  it("mostra pendência, vigência e referência alterada sem aprovar automaticamente", () => {
    const matrix = fiscalMatrixSchema.parse({ id: "test", name: "Operação SC", kind: "nfe", operation: "Revenda teste",
      ruleId: "rule", validFrom: "2026-01-01", validUntil: "2026-12-31", destinationState: "SC", ieIndicator: "9",
      finalConsumer: true, active: true, reviewed: false, approval: "", updatedAt: "2026-10-15T20:00:00Z",
      ruleSnapshot: { reviewed: false, scope: "Referência SC", fields: { ICMS_percent: "17" } } });
    const html = renderToStaticMarkup(<FiscalMatrixPanel matrices={[matrix]} rules={[{
      id: "rule", name: "Regra alterada", kind: "nfe", reviewed: false, scope: "Referência SC", fields: { ICMS_percent: "18" },
    }]} busy={false} act={async () => {}} />);
    expect(html).toContain("Pendente");
    expect(html).toContain("2026-01-01");
    expect(html).toContain("referência alterada/ausente: reconferir");
    expect(html).toContain("a prévia não aplica tributos na OS nem gera XML");
    expect(html).toContain("Simular tributos");
  });
});
