import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FiscalEventActions } from "./FiscalEventActions";
import { fiscalEventSchema, nfeCancellationFromForm, nfseCancellationFromForm } from "./fiscalEventSchema";

const key = "4".repeat(44);
function form() {
  const input = new FormData();
  input.set("confirmation", key); input.set("justification", "Operação não realizada e mercadoria não entregue");
  for (const name of ["noCirculation", "noService", "noBookEntry"]) input.set(name, "on");
  return input;
}
describe("cancelamento e histórico fiscal NF-e", () => {
  it("somente nota NF-e autorizada oferece solicitação; histórico permanece em notas incertas/canceladas", () => {
    const item = { id: "id", key: `NFe${key}`, kind: "nfe", status: "autorizado", environment: "homologacao" };
    expect(renderToStaticMarkup(<FiscalEventActions item={item} busy={false} act={async () => {}} />))
      .toContain("Solicitar cancelamento fiscal NF-e");
    for (const status of ["cancelado", "incerto", "processando", "enviando", "rascunho", "rejeitado"]) {
      const html = renderToStaticMarkup(<FiscalEventActions item={{ ...item, status }} busy={false} act={async () => {}} />);
      expect(html).not.toContain("Solicitar cancelamento");
      expect(html).toContain("Histórico de eventos");
    }
    const nfse = { ...item, kind: "nfse", key: "DPS", accessKey: "3".repeat(50) };
    const nfseHtml = renderToStaticMarkup(<FiscalEventActions item={nfse} busy={false} act={async () => {}} />);
    expect(nfseHtml).toContain("Solicitar cancelamento fiscal NFS-e");
    expect(renderToStaticMarkup(<FiscalEventActions item={{ ...nfse, status: "cancelado" }} busy={false} act={async () => {}} />))
      .not.toContain("Solicitar cancelamento fiscal NFS-e");
  });
  it("exige chave exata, justificativa e cada uma das confirmações legais", () => {
    expect(nfeCancellationFromForm(form(), `NFe${key}`)).toEqual({
      confirmation: key, justification: "Operação não realizada e mercadoria não entregue",
      noCirculation: true, noService: true, noBookEntry: true,
    });
    for (const name of ["noCirculation", "noService", "noBookEntry"]) {
      const input = form(); input.delete(name);
      expect(() => nfeCancellationFromForm(input, key)).toThrow("condições legais");
    }
    for (const value of ["", "curta", "x".repeat(256), "Texto com\nquebra de linha"]) {
      const input = form(); input.set("justification", value);
      expect(() => nfeCancellationFromForm(input, key)).toThrow("justificativa");
    }
    const input = form(); input.set("confirmation", "3".repeat(44));
    expect(() => nfeCancellationFromForm(input, key)).toThrow("chave completa");
  });
  it("não converte resultado desconhecido/duplicidade em cancelamento registrado", () => {
    const event = { id: "event", documentId: "document", type: "110111", environment: "homologacao",
      justification: "Justificativa de teste", createdAt: "2026-10-15", status: "incerto", message: "573 · Duplicidade" };
    expect(fiscalEventSchema.parse(event).status).toBe("incerto");
    expect(fiscalEventSchema.parse({ ...event, status: "rejeitado" }).status).toBe("rejeitado");
    expect(() => fiscalEventSchema.parse({ ...event, status: "sucesso" })).toThrow();
  });
  it("NFS-e exige chave nacional, motivo oficial e justificativa de 15 a 255 caracteres", () => {
    const input = new FormData();
    input.set("confirmation", "3".repeat(50)); input.set("reasonCode", "2");
    input.set("justification", "Serviço não prestado conforme informado pelo cliente");
    expect(nfseCancellationFromForm(input, "3".repeat(50))).toEqual({
      confirmation: "3".repeat(50), reasonCode: "2", justification: "Serviço não prestado conforme informado pelo cliente",
    });
    for (const reason of ["", "3"]) {
      input.set("reasonCode", reason);
      expect(() => nfseCancellationFromForm(input, "3".repeat(50))).toThrow("motivo");
    }
    input.set("reasonCode", "1");
    expect(() => nfseCancellationFromForm(input, "2".repeat(50))).toThrow("chave de acesso");
    input.set("justification", "curta");
    expect(() => nfseCancellationFromForm(input, "3".repeat(50))).toThrow("15 a 255");
  });
});
