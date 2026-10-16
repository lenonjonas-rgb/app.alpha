import { useState } from "react";
import { z } from "zod";
import { fiscalRequest } from "./fiscalApi";
import { errorMessage } from "./useDatabase";
import { fiscalEventSchema, nfeCancellationFromForm } from "./fiscalEventSchema";
import { FiscalNfseCancellationActions } from "./FiscalNfseCancellationActions";

export function FiscalEventActions({ item, busy, act }: {
  item: { id: string; key: string; accessKey?: string; kind: string; status: string; environment: string }; busy: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<z.infer<typeof fiscalEventSchema>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  if (item.kind === "nfse") return <FiscalNfseCancellationActions item={item} busy={busy} act={act} />;
  if (item.kind !== "nfe") return null;
  async function history() {
    setLoading(true); setError("");
    try { setEvents(z.array(fiscalEventSchema).parse(await (await fiscalRequest(`/documents/${item.id}/events`)).json())); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  async function download(id: string) {
    setLoading(true); setError("");
    try {
      const response = await fiscalRequest(`/fiscal-events/${id}/xml`);
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement("a");
      anchor.href = url; anchor.download = `evento-110111-${id}.xml`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("XML baixado. Pedido enviado ou incerto não comprova cancelamento registrado.");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  return <div>
    {item.status === "autorizado" && <button className="text-button" disabled={busy || loading} onClick={() => {
      setOpen(!open); setMessage(""); setError("");
    }}>Solicitar cancelamento fiscal NF-e</button>}
    <button className="text-button" disabled={busy || loading} onClick={() => void history()}>Histórico de eventos NF-e</button>
    {open && item.status === "autorizado" && <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setError(""); setMessage("");
      let input: ReturnType<typeof nfeCancellationFromForm>;
      try { input = nfeCancellationFromForm(form, item.key); }
      catch (cause) { setError(errorMessage(cause)); return; }
      void act(async () => {
        const result = z.object({ id: z.string(), status: z.enum(["registrado", "rejeitado", "incerto"]),
          protocol: z.string().optional(), message: z.string().optional() })
          .parse(await (await fiscalRequest(`/documents/${item.id}/cancel`, "POST", input)).json());
        setOpen(false); setEvents(null);
        const message = result.status === "registrado" ? `Cancelamento registrado no fisco. Protocolo ${result.protocol}. A conta financeira não foi cancelada.` :
          result.status === "rejeitado" ? `Cancelamento rejeitado: ${result.message}. A NF-e não foi cancelada.` :
            `Cancelamento incerto: ${result.message}. Não reenviar; consulte a situação.`;
        setMessage(message);
      }, "Pedido de evento processado. Confira o resultado específico do cancelamento.");
    }}>
      <h4>Cancelamento fiscal · {item.environment}</h4>
      <p>Prazo normal SC: até 24 horas da autorização. A SEFAZ decide a aceitação. Justifique e confirme a chave. Não use para corrigir preço, tributo ou destinatário.</p>
      <p>Baixas ativas e qualquer remessa vinculada bloqueiam. Não cancela a conta nem resolve cobrança bancária. Em caso de falha ou situação incerta, consulte; não repita o evento.</p>
      {item.environment === "homologacao" && <p>Homologação: evento de teste, sem efeito em nota de produção.</p>}
      <label className="field">Justificativa (15 a 255 caracteres)<input name="justification" required minLength={15} maxLength={255} /></label>
      <label className="field">Digite a chave completa (44 dígitos)<input name="confirmation" required pattern="[0-9]{44}" maxLength={44} autoComplete="off" /></label>
      <label className="checkbox-field"><input name="noCirculation" type="checkbox" required />Confirmo que não houve circulação da mercadoria.</label>
      <label className="checkbox-field"><input name="noService" type="checkbox" required />Confirmo que não houve prestação de serviço vinculada.</label>
      <label className="checkbox-field"><input name="noBookEntry" type="checkbox" required />Confirmo que não há vínculo à duplicata escritural.</label>
      <button className="button danger" disabled={busy || loading}>Assinar e solicitar cancelamento na SEFAZ</button>
    </form>}
    {events && <div>
      {!events.length && <p>Nenhum evento local registrado. Isso não comprova ausência de eventos externos.</p>}
      {events.map((event) => "model" in event ? null : <p key={event.id}>Cancelamento 110111 · {event.environment} · {event.status}<br />
        {event.createdAt} · {event.protocol} · {event.justification}<br />{event.message}<br />
        <button className="text-button" disabled={busy || loading} onClick={() => void download(event.id)}>Baixar XML do evento / pedido</button>
      </p>)}
    </div>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
