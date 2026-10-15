import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, CircleMarker } from "leaflet";
import { servicePointSchema } from "./domain";
import type { OrderDetails } from "./domain";
import { errorMessage } from "./useDatabase";
import "leaflet/dist/leaflet.css";

export function ServicePointPicker({ address, initialPoint, inputName = "servicePoint", assistance = false }: {
  address: string;
  initialPoint?: OrderDetails["servicePoint"];
  inputName?: string;
  assistance?: boolean;
}) {
  const [point, setPoint] = useState(initialPoint);
  const [open, setOpen] = useState(false);
  const [latitude, setLatitude] = useState(() => String(initialPoint?.latitude ?? ""));
  const [longitude, setLongitude] = useState(() => String(initialPoint?.longitude ?? ""));
  const [error, setError] = useState("");
  const [mapVersion, setMapVersion] = useState(0);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const pointInput = useRef<HTMLInputElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<CircleMarker | null>(null);
  const validPoint = point?.address === address && address.trim() ? point : undefined;
  useEffect(() => {
    pointInput.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [validPoint]);

  useEffect(() => {
    if (!open || !container.current) return;
    let cancelled = false;
    let instance: LeafletMap | undefined;
    void import("leaflet").then((module) => {
      if (cancelled || !container.current) return;
      leaflet.current = module;
      instance = module.map(container.current).setView([-14.235, -51.925], 4);
      map.current = instance;
      const tiles = module.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
      }).addTo(instance);
      tiles.on("tileerror", () => setError("Não foi possível carregar parte do mapa. Verifique a conexão ou informe as coordenadas."));
      instance.on("click", (event) => {
        setLatitude(event.latlng.lat.toFixed(6));
        setLongitude(event.latlng.lng.toFixed(6));
        setError("");
      });
      instance.invalidateSize();
      setMapVersion((version) => version + 1);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(`Não foi possível abrir o mapa: ${errorMessage(cause)}. Informe as coordenadas.`);
    });
    return () => { cancelled = true; instance?.remove(); map.current = null; marker.current = null; };
  }, [open]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !latitude.trim() || !longitude.trim()) return;
    const parsed = servicePointSchema.safeParse({ latitude: Number(latitude), longitude: Number(longitude), address });
    if (!parsed.success) return;
    const latlng: [number, number] = [parsed.data.latitude, parsed.data.longitude];
    if (marker.current) marker.current.setLatLng(latlng);
    else if (leaflet.current) marker.current = leaflet.current.circleMarker(latlng, { radius: 9, color: "#0891b2", fillOpacity: 0.8 }).addTo(instance);
    if (!instance.getBounds().contains(latlng) || instance.getZoom() < 15) instance.setView(latlng, 17);
  }, [address, latitude, longitude, open, mapVersion]);

  return <section className="field full">
    <h3>{assistance ? "Ponto de saída da assistência" : "Ponto do atendimento para monitoramento"}</h3>
    <p>{validPoint
      ? `Ponto confirmado: ${validPoint.latitude.toFixed(6)}, ${validPoint.longitude.toFixed(6)}.`
      : assistance ? "Sem ponto confirmado para a assistência. Confirme o local de saída para calcular as rotas." : "Sem ponto confirmado para este endereço. A distância dos próximos check-ins e check-outs não poderá ser calculada."}</p>
    <input ref={pointInput} type="hidden" name={inputName} value={validPoint ? JSON.stringify(validPoint) : ""} readOnly />
    <button type="button" className="button secondary" onClick={() => setOpen(!open)} disabled={!address.trim()}>
      {open ? "Fechar mapa" : "Marcar / conferir ponto no mapa"}
    </button>
    {validPoint && <button type="button" className="text-button" onClick={() => {
      setPoint(undefined);
      setLatitude("");
      setLongitude("");
      marker.current?.remove();
      marker.current = null;
      setError("");
    }}>Remover ponto confirmado</button>}
    {open && <>
      <p>Endereço: {address}. Aproxime o mapa e clique no local exato, ou informe latitude e longitude. Confira o marcador e confirme. Não há conversão automática do endereço.</p>
      <div ref={container} aria-label="Mapa para selecionar o ponto do atendimento" style={{ height: 320, width: "100%", position: "relative", zIndex: 0 }} />
      <div className="form-grid">
        <label className="field">Latitude do atendimento
          <input type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} />
        </label>
        <label className="field">Longitude do atendimento
          <input type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} />
        </label>
      </div>
      {error && <p role="alert" className="error-message">{error}</p>}
      <button type="button" className="button secondary" onClick={() => {
        try {
          if (!latitude.trim() || !longitude.trim()) throw new Error("Selecione um ponto no mapa ou informe as duas coordenadas.");
          setPoint(servicePointSchema.parse({ latitude: Number(latitude), longitude: Number(longitude), address }));
          setError("");
          setOpen(false);
        } catch (cause) { setError(errorMessage(cause)); }
      }}>Confirmar ponto deste endereço</button>
    </>}
  </section>;
}
