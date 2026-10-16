import type { z } from "zod";
import type { financeFiscalLinkSchema } from "./financeFiscalLinks";

export function FinanceFiscalStatus({ link }: { link?: z.infer<typeof financeFiscalLinkSchema> }) {
  if (!link) return <span>Vínculo fiscal/bancário não atualizado. Consulte o backend.</span>;
  return <div>
    {!link.documents.length && <span>Sem documento fiscal no backend consultado.</span>}
    {link.documents.map((document) => <div key={document.id}>
      <strong>{document.kind.toUpperCase()} · {document.environment === "homologacao" ? "HOMOLOGAÇÃO (sem validade fiscal)" : "Produção"} · {document.status}</strong>
      <br /><small>{document.accessKey ?? document.key}{document.protocol ? ` · protocolo ${document.protocol}` : ""}</small>
      {document.message && <p>{document.message}</p>}
    </div>)}
    {link.remittances.map((remittance) => <div key={remittance.id}>Remessa {remittance.fileSequence} gerada em {remittance.createdAt}. Não comprova envio, registro ou pagamento no banco.</div>)}
    {link.cancellationPending && <p role="alert">Cancelamento reservado no backend. Conclua/retente o cancelamento local e aguarde Sincronizado. Nova emissão e remessa bloqueadas para este faturamento.</p>}
    {link.reasons.map((reason) => <small key={reason}>{reason}<br /></small>)}
  </div>;
}
