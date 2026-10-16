import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase } from "./domain";
import { RemittancePanel } from "./RemittancePanel";
import { remittanceHistorySchema } from "./remittanceSchema";

describe("remessa com nota autorizada obrigatória", () => {
  it("avisa os dois modelos, produção, bloqueio atômico e necessidade de conferência", () => {
    const html = renderToStaticMarkup(<RemittancePanel data={demoDatabase()} />);
    expect(html).toContain("NF-e para produtos e NFS-e para serviços");
    expect(html).toContain("inclusive sem retenções");
    expect(html).toContain("sem consumir numeração");
    expect(html).toContain("assinatura, protocolo");
    expect(html).toContain("não têm liberação automática");
    expect(html).toContain("Não gera Pix");
  });
  it("preserva vínculo novo e lê histórico antigo sem inventar chave/valor fiscal", () => {
    const base = { id: "remittance", accountId: "bank", fileSequence: 1, entryIds: ["entry"],
      createdAt: "2026-10-15T12:00:00Z", notice: "Sem envio" };
    const legacy = remittanceHistorySchema.parse([base])[0];
    expect(legacy.entries).toBeUndefined();
    const linked = { entryId: "entry", fiscalKind: "nfe", fiscalDocumentId: "document",
      fiscalAccessKey: "1".repeat(44), fiscalProtocol: "142260000000001", fiscalCheckId: "a".repeat(64), amount: 12345 };
    expect(remittanceHistorySchema.parse([{ ...base, entries: [linked] }])[0].entries?.[0]).toEqual(linked);
    expect(() => remittanceHistorySchema.parse([{ ...base, entries: [{ ...linked, amount: -1 }] }])).toThrow();
    expect(() => remittanceHistorySchema.parse([{ ...base, entries: [{ ...linked, fiscalAccessKey: undefined }] }])).toThrow();
  });
});
