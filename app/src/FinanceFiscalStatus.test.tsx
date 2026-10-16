import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinanceFiscalStatus } from "./FinanceFiscalStatus";
import { financeCancellationSchema, financeFiscalLinksSchema } from "./financeFiscalLinks";

describe("vínculos do financeiro com fiscal e banco", () => {
  it("não apresenta ausência de consulta como nota pendente ou autorização", () => {
    const html = renderToStaticMarkup(<FinanceFiscalStatus />);
    expect(html).toContain("não atualizado");
    expect(html).not.toContain("autorizado");
    expect(html).not.toContain("Pendente de emissão");
  });
  it("separa autorização de homologação, remessa e recebimento e explica bloqueio de cancelamento", () => {
    const parsed = financeFiscalLinksSchema.parse({ checkedAt: "2026-10-15T12:00:00Z", entries: [{
      entryId: "entry", invoiceId: "invoice", documents: [
        { id: "doc", kind: "nfse", environment: "homologacao", status: "autorizado", key: "DPS123", accessKey: "key" },
      ], remittances: [{ id: "remittance", createdAt: "2026-10-15T12:00:00Z", fileSequence: 12 }],
      cancellationPending: true, cancellationAllowed: false, reasons: ["Há documento fiscal ativo."],
    }] });
    const html = renderToStaticMarkup(<FinanceFiscalStatus link={parsed.entries[0]} />);
    expect(html).toContain("HOMOLOGAÇÃO (sem validade fiscal)");
    expect(html).toContain("Remessa 12");
    expect(html).toContain("Não comprova envio, registro ou pagamento");
    expect(html).toContain("Cancelamento reservado no backend");
    expect(html).toContain("Há documento fiscal ativo");
    expect(() => financeCancellationSchema.parse({ id: "invalid", entryId: "entry", confirmedAt: "now" })).toThrow();
    expect(() => financeFiscalLinksSchema.parse({ ...parsed, entries: [{ ...parsed.entries[0], documents: [
      { id: "doc", kind: "nfse", environment: "unknown", status: "paid", key: "key" },
    ] }] })).toThrow();
  });
});
