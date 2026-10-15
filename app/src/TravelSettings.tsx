import { useState } from "react";
import type { Database } from "./domain";
import { servicePointSchema } from "./travel";
import { ServicePointPicker } from "./ServicePointPicker";
import { errorMessage } from "./useDatabase";

export function TravelSettings({ data, commit, onSuccess, onError }: {
  data: Database;
  commit: (update: (current: Database) => Database) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [address, setAddress] = useState(data.settings.assistanceAddress || data.settings.assistancePoint?.address || data.settings.address);
  return <section className="settings-section">
    <h2>Deslocamento, combustível e assistência</h2>
    <p>Valores padrão para novos cálculos. As OS já calculadas preservam seus preços. A chave Google Maps é configurada somente no servidor, nunca neste formulário.</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        const form = new FormData(event.currentTarget);
        if (form.get("assistancePointLookup") === "pending")
          throw new Error("Aguarde a localização automática da assistência ou marque o ponto manualmente antes de salvar.");
        const rawPoint = String(form.get("assistancePoint") ?? "");
        const point = rawPoint ? servicePointSchema.parse(JSON.parse(rawPoint)) : undefined;
        const fuelPrice = Math.round(Number(form.get("fuelPrice")) * 100);
        const kilometersPerLiter = Number(form.get("kilometersPerLiter"));
        const kilometerRate = Math.round(Number(form.get("kilometerRate")) * 100);
        if (fuelPrice <= 0 || kilometersPerLiter <= 0) throw new Error("Informe preço do combustível e rendimento maiores que zero.");
        commit((current) => ({ ...current, settings: { ...current.settings, fuelPrice, kilometersPerLiter, kilometerRate, assistancePoint: point, assistanceAddress: address } }));
        onSuccess("Configurações de deslocamento salvas."); onError("");
      } catch (cause) { onError(errorMessage(cause)); }
    }}>
      <div className="form-grid">
        <label className="field">Preço do combustível (R$/litro)<input name="fuelPrice" type="number" min="0.01" max="1000000" step="0.01" required defaultValue={(data.settings.fuelPrice / 100).toFixed(2)} /></label>
        <label className="field">Rendimento do veículo (km/litro)<input name="kilometersPerLiter" type="number" min="0.01" max="1000" step="0.01" required defaultValue={data.settings.kilometersPerLiter} /></label>
        <label className="field">Tarifa cobrada por km (R$)<input name="kilometerRate" type="number" min="0" max="1000000" step="0.01" required defaultValue={(data.settings.kilometerRate / 100).toFixed(2)} /></label>
        <label className="field full">Endereço de saída da assistência<input value={address} maxLength={2000} onChange={(event) => setAddress(event.target.value)} /></label>
        <div className="full"><ServicePointPicker address={address} initialPoint={data.settings.assistancePoint} inputName="assistancePoint" assistance /></div>
      </div>
      <p>As coordenadas são localizadas automaticamente pelo endereço. Confira e salve. Se necessário, corrija o ponto manualmente. As rotas serão calculadas nos dois sentidos.</p>
      <button className="button primary">Salvar deslocamento e combustível</button>
    </form>
  </section>;
}
