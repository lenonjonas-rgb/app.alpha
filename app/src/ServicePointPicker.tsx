import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, CircleMarker } from "leaflet";
import { servicePointSchema } from "./domain";
import type { OrderDetails } from "./domain";
import { errorMessage } from "./useDatabase";
import { lookupServicePoint } from "./geocoding";
import "leaflet/dist/leaflet.css";

export function ServicePointPicker({ address, initialPoint, inputName = "servicePoint", assistance = false, ready = true }: {
  address: string;
  initialPoint?: OrderDetails["servicePoint"];
  inputName?: string;
  assistance?: boolean;
  ready?: boolean;
}) {
  const [point, setPoint] = useState(initialPoint);
  const [open, setOpen] = useState(false);
  const [coordinates, setCoordinates] = useState(() => ({
    address: initialPoint?.address ?? address,
    latitude: String(initialPoint?.latitude ?? ""),
    longitude: String(initialPoint?.longitude ?? ""),
  }));
  const latitude = coordinates.address === address ? coordinates.latitude : "";
  const longitude = coordinates.address === address ? coordinates.longitude : "";
  const [pausedAddress, setPausedAddress] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [lookup, setLookup] = useState({ address: "", status: "", message: "" });
  const requestVersion = useRef(0);
  const [error, setError] = useState("");
  const [mapVersion, setMapVersion] = useState(0);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const pointInput = useRef<HTMLInputElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<CircleMarker | null>(null);
  const validPoint = point?.address === address && address.trim() ? point : undefined;
  const googlePreview = validPoint?.source === "Google Maps";
  const autoLookup = ready && address.trim().length >= 8 && !validPoint && pausedAddress !== address;
  const lookupPending = autoLookup && (lookup.address !== address || lookup.status !== "error");
  const lookupMessage = lookup.address === address ? lookup.message : "";
  useEffect(() => {
    if (!autoLookup) return;
    const version = ++requestVersion.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLookup({ address, status: "loading", message: "Localizando coordenadas pelo endereço…" });
      void lookupServicePoint(address, controller.signal).then((located) => {
        if (controller.signal.aborted || requestVersion.current !== version) return;
        setCoordinates({ address, latitude: String(located.latitude), longitude: String(located.longitude) });
        setPoint(located);
        setLookup({ address, status: "success", message: "Coordenadas preenchidas automaticamente pelo Google Maps. Salve o formulário para registrar o ponto." });
        setError("");
      }).catch((cause: unknown) => {
        if (controller.signal.aborted || requestVersion.current !== version) return;
        setLookup({ address, status: "error", message: errorMessage(cause) });
      });
    }, 1200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [address, autoLookup, attempt]);

  const manualCoordinates = useCallback((nextLatitude: string, nextLongitude: string) => {
    requestVersion.current += 1;
    setPausedAddress(address);
    setCoordinates({ address, latitude: nextLatitude, longitude: nextLongitude });
    setLookup({ address, status: "", message: "" });
  }, [address]);
  useEffect(() => {
    pointInput.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [validPoint]);

  useEffect(() => {
    if (!open || googlePreview || !container.current) return;
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
        manualCoordinates(event.latlng.lat.toFixed(6), event.latlng.lng.toFixed(6));
        setError("");
      });
      instance.invalidateSize();
      setMapVersion((version) => version + 1);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(`Não foi possível abrir o mapa: ${errorMessage(cause)}. Informe as coordenadas.`);
    });
    return () => { cancelled = true; instance?.remove(); map.current = null; marker.current = null; };
  }, [open, googlePreview, address, manualCoordinates]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!latitude.trim() || !longitude.trim()) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
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
      ? `Ponto ${googlePreview ? "localizado automaticamente" : "confirmado"}: ${validPoint.latitude.toFixed(6)}, ${validPoint.longitude.toFixed(6)}.`
      : "As coordenadas serão preenchidas automaticamente pelo endereço completo. Você também pode marcar o ponto manualmente."}</p>
    <input ref={pointInput} type="hidden" name={inputName} value={validPoint ? JSON.stringify(validPoint) : ""} readOnly />
    <input type="hidden" name={`${inputName}Lookup`} value={lookupPending ? "pending" : ""} />
    {lookupPending && <p role="status">{lookupMessage || "Aguardando o endereço para localizar as coordenadas…"}</p>}
    {!lookupPending && lookupMessage && <p role={lookup.status === "error" ? "alert" : "status"}>{lookupMessage}</p>}
    <button type="button" className="text-button" disabled={!ready || address.trim().length < 8 || lookupPending} onClick={() => {
      requestVersion.current += 1;
      setPoint(undefined);
      setPausedAddress(null);
      setLookup({ address, status: "", message: "" });
      setAttempt((value) => value + 1);
    }}>Buscar coordenadas pelo endereço novamente</button>
    <button type="button" className="button secondary" onClick={() => setOpen(!open)} disabled={!address.trim()}>
      {open ? "Fechar mapa" : "Marcar / conferir ponto no mapa"}
    </button>
    {validPoint && <button type="button" className="text-button" onClick={() => {
      manualCoordinates("", "");
      setPoint(undefined);
      marker.current?.remove();
      marker.current = null;
      setError("");
    }}>Remover ponto confirmado</button>}
    {open && <>
      <p>Endereço: {address}. {googlePreview ? "Localização automática pelo Google Maps. Confira o ponto antes de salvar." : "Aproxime o mapa e clique no local exato, ou informe latitude e longitude. Confira o marcador e confirme."}</p>
      {googlePreview
        ? <iframe title="Ponto localizado no Google Maps" src={`https://maps.google.com/maps?q=${validPoint.latitude},${validPoint.longitude}&z=17&output=embed`} style={{ height: 320, width: "100%", border: 0 }} loading="lazy" referrerPolicy="no-referrer" />
        : <div ref={container} aria-label="Mapa para selecionar o ponto do atendimento" style={{ height: 320, width: "100%", position: "relative", zIndex: 0 }} />}
      <div className="form-grid">
        <label className="field">Latitude do atendimento
          <input type="number" step="any" value={latitude} onChange={(event) => manualCoordinates(event.target.value, longitude)} />
        </label>
        <label className="field">Longitude do atendimento
          <input type="number" step="any" value={longitude} onChange={(event) => manualCoordinates(latitude, event.target.value)} />
        </label>
      </div>
      {error && <p role="alert" className="error-message">{error}</p>}
      <button type="button" className="button secondary" onClick={() => {
        try {
          if (!latitude.trim() || !longitude.trim()) throw new Error("Selecione um ponto no mapa ou informe as duas coordenadas.");
          requestVersion.current += 1;
          setPausedAddress(address);
          setPoint(servicePointSchema.parse({ latitude: Number(latitude), longitude: Number(longitude), address,
            ...(googlePreview ? { source: "Google Maps" } : {}) }));
          setError("");
          setOpen(false);
        } catch (cause) { setError(errorMessage(cause)); }
      }}>Confirmar ponto deste endereço</button>
    </>}
  </section>;
}
