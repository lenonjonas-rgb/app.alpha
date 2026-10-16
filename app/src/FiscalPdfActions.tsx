import { useState } from "react";
import { fiscalRequest } from "./fiscalApi";
import { downloadFiscalPdf, fiscalPdfFile, shareFiscalPdf } from "./fiscalPdf";
import { errorMessage } from "./useDatabase";

export function FiscalPdfActions({ item, busy }: { item: { id: string; kind: string; environment: string; status: string }; busy: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (item.status !== "autorizado" || !["nfe", "nfse"].includes(item.kind) || !["homologacao", "producao"].includes(item.environment)) return null;
  const label = item.kind === "nfe" ? "DANFE" : "DANFSe";
  async function prepare(download: boolean) {
    setLoading(true); setError(""); setMessage(""); setFile(null);
    try {
      const pdf = await fiscalPdfFile(await fiscalRequest(`/documents/${item.id}/pdf`),
        `${label}-${item.environment}-${item.id.replace(/[^a-z0-9-]/gi, "")}.pdf`);
      if (download) { downloadFiscalPdf(pdf); setMessage("PDF baixado. O XML autorizado continua sendo o documento fiscal original."); }
      else { setFile(pdf); setMessage("PDF preparado. Clique em Compartilhar arquivo para escolher o aplicativo e o destinatário."); }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  async function share() {
    if (!file) return;
    setLoading(true); setError(""); setMessage("");
    try { setMessage(await shareFiscalPdf(file, navigator)); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  return <div>
    {item.environment === "homologacao" && <p>Homologação: PDF sem validade fiscal/jurídica. Não enviar como nota de produção.</p>}
    <button className="text-button" disabled={busy || loading} onClick={() => void prepare(true)}>Baixar {label} (PDF)</button>
    <button className="text-button" disabled={busy || loading} onClick={() => void prepare(false)}>Preparar compartilhamento do PDF</button>
    {file && <button className="button secondary" disabled={busy || loading} onClick={() => void share()}>Compartilhar arquivo</button>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
