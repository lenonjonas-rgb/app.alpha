import { describe, expect, it, vi } from "vitest";
import { transmitFiscalDocuments } from "./fiscalDocumentActions";
import type { FiscalDocumentRecord } from "./fiscalDocuments";

const draft: FiscalDocumentRecord = { id: "one", invoiceId: "invoice", kind: "nfe", environment: "homologacao",
  key: "NFe-key", status: "rascunho", createdAt: "2026-10-19T12:00:00Z" };

describe("envio fiscal selecionado", () => {
  it("envia sequencialmente com a chave esperada pelo backend, sem misturar consulta ou e-mail", async () => {
    const request = vi.fn().mockImplementation(async () => Response.json({ status: "autorizado" }));
    await transmitFiscalDocuments([draft, { ...draft, id: "two", key: "other" }], request);
    expect(request.mock.calls).toEqual([
      ["/documents/one/transmit", "POST", { confirmation: "NFe-key" }],
      ["/documents/two/transmit", "POST", { confirmation: "other" }],
    ]);
  });
  it.each(["incerto", "processando", "rejeitado", "enviando", "autorizado", "cancelado"] as const)(
    "recusa a seleção inteira antes de enviar se uma nota não é rascunho: %s", async (status) => {
      const request = vi.fn();
      await expect(transmitFiscalDocuments([draft, { ...draft, id: "two", status }], request)).rejects.toThrow("rascunhos");
      expect(request).not.toHaveBeenCalled();
    },
  );
  it.each(["incerto", "processando", "rejeitado"])("interrompe após retorno %s sem enviar as próximas", async (status) => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ status: "autorizado" }))
      .mockResolvedValueOnce(Response.json({ status, message: "Conferir no fisco" }));
    await expect(transmitFiscalDocuments([draft, { ...draft, id: "two" }, { ...draft, id: "three" }], request))
      .rejects.toThrow("1 autorizada(s)");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("não retenta falha de rede e rejeita lotes vazios, duplicados ou acima de 50", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Rede indisponível"));
    await expect(transmitFiscalDocuments([draft], request)).rejects.toThrow("Rede indisponível");
    expect(request).toHaveBeenCalledTimes(1);
    for (const batch of [[], [draft, draft], Array.from({ length: 51 }, (_, i) => ({ ...draft, id: String(i) }))])
      await expect(transmitFiscalDocuments(batch, request)).rejects.toThrow("1 a 50");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("aceita exatamente 50 rascunhos, sem pular nenhum", async () => {
    const request = vi.fn().mockImplementation(async () => Response.json({ status: "autorizado" }));
    await transmitFiscalDocuments(Array.from({ length: 50 }, (_, index) => ({ ...draft, id: String(index) })), request);
    expect(request).toHaveBeenCalledTimes(50);
  });
});
