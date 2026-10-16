import { useState } from "react";
import { z } from "zod";
import { fiscalRequest } from "./fiscalApi";
import { errorMessage } from "./useDatabase";
import { fiscalEventSchema, nfseCancellationFromForm } from "./fiscalEventSchema";

export function FiscalNfseCancellationActions({ item, busy, act }: {
  item: { id: string; key: string; accessKey?: string; kind: string; status: string; environment: string }; busy: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<z.infer<typeof fiscalEventSchema>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const nfseKey = item.accessKey ?? "";
  async function history() {
    setLoading(true); setError("");
    try {
      setEvents(z.array(fiscalEventSchema).parse(await (await fiscalRequest(`/documents/${item.id}/events`)).json()));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  async function download(id: string) {
    setLoading(true); setError("");
    try {
      const response = await fiscalRequest(`/fiscal-events/${id}/xml`);
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement("a");
      anchor.href = url; anchor.download = `evento-101101-${id}.xml`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("XML baixado. Confirme o status do evento no histórico; um pedido incerto não comprova cancelamento registrado.");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  return <div>
    {item.status === "autorizado" && /^\d{50}$/.test(nfseKey) && <button className="text-button" disabled={busy || loading} onClick={() => {
      setOpen(!open); setMessage(""); setError("");
    }}>Solicitar cancelamento fiscal NFS-e</button>}
    <button className="text-button" disabled={busy || loading} onClick={() => void history()}>Histórico de eventos NFS-e</button>
    {item.status === "autorizado" && !/^\d{50}$/.test(nfseKey) && <p role="alert">NFS-e autorizada sem chave de acesso válida; cancelamento indisponível.</p>}
    {open && item.status === "autorizado" && <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setError(""); setMessage("");
      let input: ReturnType<typeof nfseCancellationFromForm>;
      try { input = nfseCancellationFromForm(form, nfseKey); }
      catch (cause) { setError(errorMessage(cause)); return; }
      void act(async () => {
        const result = z.object({ id: z.string(), status: z.enum(["registrado", "rejeitado", "incerto"]), message: z.string().optional() })
          .parse(await (await fiscalRequest(`/documents/${item.id}/cancel`, "POST", input)).json());
        setOpen(false); setEvents(null);
        setMessage(result.status === "registrado" ? "Cancelamento NFS-e registrado pela Sefin Nacional. A conta financeira não foi cancelada." :
          result.status === "rejeitado" ? `Pedido de cancelamento rejeitado: ${result.message ?? "consulte o histórico"}. A NFS-e não foi cancelada.` :
            `Resultado incerto: ${result.message ?? "consulte a situação"}. Não repita o pedido; consulte o evento.`);
      }, "Pedido de evento processado. Confira o resultado específico do cancelamento.");
    }}>
      <h4>Cancelamento fiscal NFS-e · {item.environment}</h4>
      <p>Escolha o motivo correspondente e informe a justificativa. Confirme a chave completa da NFS-e. A Sefin Nacional decide a aceitação; não use este fluxo para cancelar cobrança, conta ou boleto.</p>
      <p>Baixas ativas e remessas vinculadas bloqueiam o pedido. Em caso de falha ou resultado incerto, consulte o evento antes de qualquer outra ação; não envie novamente.</p>
      {item.environment === "homologacao" && <p>Homologação: evento de teste, sem efeito em nota de produção.</p>}
      <label className="field">Motivo do cancelamento
        <select name="reasonCode" required defaultValue="">
          <option value="" disabled>Selecione o motivo</option>
          <option value="1">Erro na emissão</option>
          <option value="2">Serviço não prestado</option>
          <option value="9">Outros</option>
        </select>
      </label>
      <label className="field">Justificativa (15 a 255 caracteres)
        <input name="justification" required minLength={15} maxLength={255} />
      </label>
      <label className="field">Digite a chave de acesso completa (50 dígitos)
        <input name="confirmation" required pattern="[0-9]{50}" maxLength={50} autoComplete="off" />
      </label>
      <button className="button danger" disabled={busy || loading}>Assinar e solicitar cancelamento na Sefin Nacional</button>
    </form>}
    {events && <div>
      {!events.length && <p>Nenhum evento local registrado. Isso não comprova ausência de eventos externos.</p>}
      {events.map((event) => {
        if (!("model" in event) || event.model !== "nfse") return null;
        return <p key={event.id}>Cancelamento NFS-e · motivo {event.reasonCode} · {event.environment} · {event.status}<br />
          {event.createdAt} · {event.justification}<br />{event.message}<br />
          <button className="text-button" disabled={busy || loading} onClick={() => void download(event.id)}>Baixar XML do pedido/evento</button>
        </p>;
      })}
    </div>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
