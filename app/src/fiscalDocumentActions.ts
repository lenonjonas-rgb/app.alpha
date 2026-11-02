import { z } from "zod";
import type { FiscalDocumentRecord } from "./fiscalDocuments";

type Request = (path: string, method: "POST", body: { confirmation: string }) => Promise<Response>;

export async function transmitFiscalDocuments(documents: FiscalDocumentRecord[], request: Request) {
  if (!documents.length || documents.length > 50 || documents.some((item) => item.status !== "rascunho") ||
    new Set(documents.map((item) => item.id)).size !== documents.length)
    throw new Error("Selecione de 1 a 50 rascunhos nunca transmitidos. Consulte notas incertas antes de continuar.");
  for (const [index, document] of documents.entries()) {
    try {
      const result = z.object({ status: z.string(), message: z.string().optional() })
        .parse(await (await request(`/documents/${document.id}/transmit`, "POST", { confirmation: document.key })).json());
      if (result.status !== "autorizado")
        throw new Error(`Retorno ${result.status}: ${result.message ?? "consulte a situação no fisco"}.`);
    } catch (cause) {
      throw new Error(`Envio interrompido na nota ${document.number ?? document.key}. ${index} autorizada(s) nesta operação. ` +
        `As próximas não foram enviadas. ${cause instanceof Error ? cause.message : "Falha fiscal."} Atualize e confira a situação antes de tentar novamente.`);
    }
  }
}
