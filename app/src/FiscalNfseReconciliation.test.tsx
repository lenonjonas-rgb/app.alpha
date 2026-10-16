import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FiscalNfseReconciliation } from "./FiscalNfseReconciliation";
import { nfseCheckSchema } from "./fiscalNfseReconciliationSchema";

const check = {
  id: "a".repeat(64), documentId: "document", invoiceId: "invoice", entryId: "entry",
  environment: "homologacao", accessKey: "2".repeat(50), calculationId: "b".repeat(64),
  actual: { invoiceAmount: 105000, withheld: 14175, net: 90825, iss: 5250, issBase: 105000,
    irrf: 1575, inss: 11550, csll: 1050, rtcBase: 99750, ibsState: 101, ibsMunicipal: 0, ibsTotal: 101, cbs: 899, total: 90825 },
  differences: [], matches: true,
};
describe("conferência da NFS-e autorizada", () => {
  it("oferece apenas notas de serviço autorizadas sem prometer alterar saldos ou tributos", () => {
    const html = renderToStaticMarkup(<FiscalNfseReconciliation busy={false} act={async () => {}} documents={[
      { id: "authorized", status: "autorizado", kind: "nfse", environment: "homologacao", key: "chave-visivel" },
      { id: "draft", status: "rascunho", kind: "nfse", environment: "homologacao", key: "nao-mostrar-rascunho" },
      { id: "nfe", status: "autorizado", kind: "nfe", environment: "homologacao", key: "nao-mostrar-produtos" },
    ]} />);
    expect(html).toContain("chave-visivel");
    expect(html).not.toContain("nao-mostrar");
    expect(html).toContain("Não altera saldos");
    expect(html).toContain("não são corrigidas automaticamente");
    expect(html).toContain('name="documentId" required=""');
    expect(html).toContain("Conferir valores oficiais");
  });
  it("valida valores monetários oficiais e coerência do resultado de divergências", () => {
    expect(nfseCheckSchema.parse(check).actual.net).toBe(90825);
    expect(() => nfseCheckSchema.parse({ ...check, differences: ["ISS divergente"] })).toThrow();
    expect(() => nfseCheckSchema.parse({ ...check, actual: { ...check.actual, net: "908.25" } })).toThrow();
    expect(() => nfseCheckSchema.parse({ ...check, accessKey: "other" })).toThrow();
    expect(() => nfseCheckSchema.parse({ ...check, actual: { ...check.actual, withheld: -1 } })).toThrow();
    const missing = { ...check, matches: false, differences: ["IBS/CBS oficial ausente"],
      actual: { ...check.actual, ibsTotal: null, cbs: null, total: null, rtcBase: null, ibsState: null, ibsMunicipal: null } };
    expect(nfseCheckSchema.parse(missing).actual.ibsTotal).toBeNull();
  });
});
