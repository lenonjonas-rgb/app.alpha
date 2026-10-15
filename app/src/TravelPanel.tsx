import { useState } from "react";
import type { Database, Order } from "./domain";
import { orderServiceAddress } from "./domain";
import { routeTolls, sameTravelEndpoint, travelEndpoint, travelValues } from "./travel";
import type { Travel, TravelRoute } from "./travel";
import { assistanceEndpoint, calculateTravelRoute } from "./travelClient";
import { errorMessage } from "./useDatabase";

export function TravelPanel({ data, order, previewDestination, travel, editing, busy, onBusy, onChange, onError, initialCharge = false }: {
  data: Database;
  order?: Order;
  previewDestination?: () => TravelRoute["destination"];
  initialCharge?: boolean;
  travel: Travel | undefined;
  editing: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onChange: (travel: Travel | undefined) => void;
  onError: (message: string) => void;
}) {
  const values = travel ? travelValues(travel) : undefined;
  const [chargeRequested, setChargeRequested] = useState(initialCharge);
  const chargeTravel = travel?.chargeTravel ?? chargeRequested;
  const client = order ? data.clients.find((item) => item.id === order.clientId) : undefined;
  const origin = assistanceEndpoint(data);
  const destination = order && client ? travelEndpoint(orderServiceAddress(order, client), order.details?.servicePoint) : undefined;
  const stale = travel && (!sameTravelEndpoint(travel.route.origin, origin) ||
    (destination && !sameTravelEndpoint(travel.route.destination, destination)));
  async function calculate() {
    onBusy(true); onError("");
    try {
      const target = previewDestination ? previewDestination() : destination;
      if (!target) throw new Error("Informe o endereço do atendimento.");
      const route = await calculateTravelRoute(data, target, previewDestination ? undefined : order?.id);
      if (previewDestination && !sameTravelEndpoint(target, previewDestination()))
        throw new Error("O endereço mudou durante o cálculo. Calcule novamente.");
      const tolls = routeTolls(route);
      onChange({ route, chargeTravel, tolls: tolls ?? 0, tollsConfirmed: tolls !== undefined,
        fuelPrice: data.settings.fuelPrice, kilometersPerLiter: data.settings.kilometersPerLiter, kilometerRate: data.settings.kilometerRate });
    } catch (cause) {
      onError(`${errorMessage(cause)}${travel ? " O cálculo anterior foi mantido; nenhum valor novo foi aplicado." : ""}`);
    } finally { onBusy(false); }
  }
  return <section className="order-section">
    <h2>Deslocamento e pedágio</h2>
    <div className="form-grid">
      <label className="field">Cobrança de deslocamento
        <select name="travelChargeTravel" disabled={!editing || busy} value={chargeTravel ? "Sim" : "Não"} onChange={(event) => {
          const chargeTravel = event.target.value === "Sim";
          setChargeRequested(chargeTravel);
          if (travel) onChange({ ...travel, chargeTravel });
        }}><option>Não</option><option>Sim</option></select>
      </label>
      <label className="field">Total do deslocamento (R$)
        <input readOnly value={values && travel ? (Math.round(values.kilometers * travel.kilometerRate) / 100).toFixed(2) : ""} />
      </label>
      <label className="field">Pedágio — ida + volta (R$)
        <input type="number" min="0" max="1000000" step="0.01" disabled={!editing || busy || !travel} value={(travel?.tolls ?? 0) / 100} onChange={(event) => {
          const amount = Math.round(Number(event.target.value) * 100);
          if (travel) onChange({ ...travel, tolls: amount, tollsConfirmed: true });
        }} />
      </label>
    </div>
    {editing && <button type="button" className="button secondary" disabled={busy} onClick={() => void calculate()}>
      {busy ? "Calculando ida e volta…" : travel ? "Recalcular rota e aplicar preços atuais" : "Calcular rota e custos"}
    </button>}
    {stale && <p role="alert">O cálculo salvo usa um ponto/endereço anterior. Os valores históricos foram preservados. Recalcule para usar os pontos atuais.</p>}
    {travel && values && <>
      {travel.tollsConfirmed === false && <p role="alert">O Google não informou o preço completo dos pedágios de ida e volta. Informe o total manualmente ou confirme zero se não houver cobrança. O cálculo está pendente e não pode ser salvo ainda.</p>}
      {travel.tollsConfirmed === false && editing && <button type="button" className="text-button" disabled={busy} onClick={() => onChange({ ...travel, tollsConfirmed: true })}>Confirmar total de pedágios informado</button>}
      <p>Total percorrido (ida e volta): <strong>{values.kilometers.toLocaleString("pt-BR")} km</strong></p>
      {editing && <button type="button" className="text-button" disabled={busy} onClick={() => {
        if (window.confirm("Remover o cálculo de deslocamento deste rascunho, incluindo cobrança e custos internos?")) {
          setChargeRequested(false);
          onChange(undefined);
        }
      }}>Remover cálculo de deslocamento</button>}
    </>}
  </section>;
}
