import type { Database, Order } from "./domain";
import { currency, orderServiceAddress } from "./domain";
import { samePoint, travelRouteSchema, travelValues } from "./travel";
import type { Travel } from "./travel";
import { supabase } from "./supabase";
import { errorMessage } from "./useDatabase";

export function TravelPanel({ data, order, travel, editing, busy, onBusy, onChange, onError }: {
  data: Database;
  order: Order;
  travel: Travel | undefined;
  editing: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onChange: (travel: Travel | undefined) => void;
  onError: (message: string) => void;
}) {
  const values = travel ? travelValues(travel) : undefined;
  const client = data.clients.find((item) => item.id === order.clientId)!;
  const point = order.details?.servicePoint;
  const stale = travel && (!samePoint(travel.route.origin, data.settings.assistancePoint) ||
    !samePoint(travel.route.destination, point) || travel.route.destination.address !== orderServiceAddress(order, client));
  async function calculate() {
    onBusy(true); onError("");
    try {
      if (!supabase) throw new Error("O cálculo Google Maps exige login no banco seguro e a função travel-route publicada.");
      if (!data.settings.assistancePoint || !point || point.address !== orderServiceAddress(order, client))
        throw new Error("Confirme e salve o ponto da assistência nas Configurações e o ponto do atendimento nos dados básicos da OS.");
      if (data.settings.fuelPrice <= 0 || data.settings.kilometersPerLiter <= 0)
        throw new Error("Cadastre preço do combustível e rendimento do veículo maiores que zero nas Configurações.");
      const result = await supabase.functions.invoke("travel-route", { body: { orderId: order.id } });
      if (result.error) {
        if (result.error.context instanceof Response) {
          const body: unknown = await result.error.context.json();
          if (body && typeof body === "object" && "error" in body && typeof body.error === "string") throw new Error(body.error);
        }
        throw result.error;
      }
      const route = travelRouteSchema.parse(result.data);
      if (!samePoint(route.origin, data.settings.assistancePoint) || !samePoint(route.destination, point))
        throw new Error("Os pontos mudaram durante o cálculo. Atualize a OS e calcule novamente.");
      onChange({ route, chargeTravel: travel?.chargeTravel ?? false, tolls: travel?.tolls ?? 0,
        fuelPrice: data.settings.fuelPrice, kilometersPerLiter: data.settings.kilometersPerLiter, kilometerRate: data.settings.kilometerRate });
    } catch (cause) {
      onError(`${errorMessage(cause)}${travel ? " O cálculo anterior foi mantido; nenhum valor novo foi aplicado." : ""}`);
    } finally { onBusy(false); }
  }
  return <section className="order-section">
    <h2>Deslocamento e custo de combustível</h2>
    <p>Rota de carro da assistência ao atendimento e retorno. O combustível e os pedágios são custos internos nos dois casos. Só “Sim” adiciona a cobrança por km e pedágios ao total da OS.</p>
    <div className="form-grid">
      <label className="field">Cobrança de deslocamento
        <select disabled={!editing || busy || !travel} value={travel?.chargeTravel ? "Sim" : "Não"} onChange={(event) => {
          const chargeTravel = event.target.value === "Sim";
          if (travel) onChange({ ...travel, chargeTravel });
        }}><option>Não</option><option>Sim</option></select>
      </label>
      <label className="field">Pedágios totais ida e volta (R$)
        <input type="number" min="0" max="1000000" step="0.01" disabled={!editing || busy || !travel} value={(travel?.tolls ?? 0) / 100} onChange={(event) => {
          const amount = Math.round(Number(event.target.value) * 100);
          if (travel) onChange({ ...travel, tolls: amount });
        }} />
      </label>
    </div>
    {editing && <button type="button" className="button secondary" disabled={busy} onClick={() => void calculate()}>
      {busy ? "Calculando ida e volta…" : travel ? "Recalcular rota e aplicar preços atuais" : "Calcular rota e custos"}
    </button>}
    {!travel && <p>Sem cálculo de deslocamento salvo. Calcule a rota para habilitar a cobrança Sim/Não e os pedágios. Depois salve as alterações da OS.</p>}
    {stale && <p role="alert">O cálculo salvo usa um ponto/endereço anterior. Os valores históricos foram preservados. Recalcule para usar os pontos atuais.</p>}
    {travel && values && <>
      <p>Origem registrada: {travel.route.origin.address}<br />Destino registrado: {travel.route.destination.address}</p>
      <p>Google Maps · calculado em {new Date(travel.route.calculatedAt).toLocaleString("pt-BR")} · ida {(travel.route.outboundMeters / 1000).toLocaleString("pt-BR")} km + volta {(travel.route.returnMeters / 1000).toLocaleString("pt-BR")} km = <strong>{values.kilometers.toLocaleString("pt-BR")} km</strong></p>
      <p>Preços registrados: {currency(travel.fuelPrice)}/litro · {travel.kilometersPerLiter.toLocaleString("pt-BR")} km/litro · tarifa {currency(travel.kilometerRate)}/km.</p>
      <p>Consumo estimado: {values.liters.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} litros · combustível {currency(values.fuelCost)} + pedágios {currency(travel.tolls)} = <strong>custo interno {currency(values.cost)}</strong>.</p>
      <p><strong>Cobrança ao cliente: {currency(values.charge)}</strong>{travel.chargeTravel ? ` (${currency(values.mileageCharge)} por km + ${currency(travel.tolls)} de pedágios), antes do desconto geral.` : " — deslocamento não cobrado."}</p>
      <small>Estimativa de combustível, não despesa comprovada. Não inclui manutenção, estacionamento ou outros custos. Não altera os quilômetros informados pelo técnico.</small>
      {editing && <button type="button" className="text-button" disabled={busy} onClick={() => {
        if (window.confirm("Remover o cálculo de deslocamento deste rascunho, incluindo cobrança e custos internos?")) {
          onChange(undefined);
        }
      }}>Remover cálculo de deslocamento</button>}
    </>}
  </section>;
}
