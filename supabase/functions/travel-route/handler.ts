import { geocodeAddress } from "./geocoding.ts";

type Environment = { url: string; publicKey: string; googleKey: string };
type Point = { latitude: number; longitude: number; address: string; source?: "Google Maps" };
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dados inválidos para calcular a rota.");
  return value as Record<string, unknown>;
}
function point(value: unknown): Point {
  const data = object(value);
  if (typeof data.latitude !== "number" || !Number.isFinite(data.latitude) || Math.abs(data.latitude) > 90 ||
    typeof data.longitude !== "number" || !Number.isFinite(data.longitude) || Math.abs(data.longitude) > 180 ||
    typeof data.address !== "string" || !data.address.trim() || data.address.length > 2000)
    throw new Error("Confirme os pontos da assistência e do atendimento antes de calcular.");
  const source = data.source === "Google Maps" ? "Google Maps" : undefined;
  return { latitude: data.latitude, longitude: data.longitude, address: data.address, ...(source ? { source } : {}) };
}
function records(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Base da empresa inválida.");
  return value.map(object);
}
function serviceAddress(details: Record<string, unknown>, client: Record<string, unknown>): string {
  if (!details.serviceLocation || object(details.serviceLocation).useClientAddress !== false)
    return typeof client.address === "string" ? client.address : "";
  const location = object(details.serviceLocation);
  const text = (key: string) => typeof location[key] === "string" ? location[key] : "";
  return [[text("street"), text("number")].filter(Boolean).join(", "), text("complement"),
    text("neighborhood"), [text("city"), text("state")].filter(Boolean).join(" - "),
    text("postalCode") ? `CEP ${text("postalCode")}` : ""].filter(Boolean).join(" · ");
}
export function travelRouteHandler(env: Environment, fetcher: typeof fetch = fetch) {
  const response = (status: number, body: object) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return response(405, { error: "Método não permitido." });
    if (!env.url || !env.publicKey || !env.googleKey)
      return response(503, { error: "Rotas não configuradas. Configure GOOGLE_MAPS_ROUTES_API_KEY no Supabase e habilite a Routes API no Google Cloud." });
    const authorization = request.headers.get("Authorization");
    if (!authorization?.match(/^Bearer \S+$/i)) return response(401, { error: "Entre na conta para calcular rotas." });
    const headers = { apikey: env.publicKey, Authorization: authorization, "Content-Type": "application/json" };
    async function api(path: string, body?: object) {
      const result = await fetcher(`${env.url}${path}`, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) throw new Error("Não foi possível consultar a empresa ou reservar o cálculo. Verifique o acesso, a migração de rotas e aguarde alguns segundos antes de repetir.");
      return await result.json() as unknown;
    }
    let userId: string;
    try {
      const user = object(await api("/auth/v1/user"));
      if (typeof user.id !== "string" || !/^[0-9a-f-]{36}$/i.test(user.id)) throw new Error("Sessão inválida.");
      userId = user.id;
    } catch { return response(401, { error: "Não foi possível validar a sessão. Entre novamente." }); }
    let companyId: string;
    try {
      const memberships = records(await api(`/rest/v1/company_memberships?user_id=eq.${userId}&select=company_id,role`));
      const member = memberships[0];
      if (memberships.length !== 1 || !member || !["owner", "admin"].includes(String(member.role)) ||
        typeof member.company_id !== "string" || !/^[0-9a-f-]{36}$/i.test(member.company_id))
        return response(403, { error: "Somente a administração pode calcular o deslocamento." });
      companyId = member.company_id;
    } catch { return response(403, { error: "Não foi possível confirmar o acesso administrativo à empresa." }); }
    let orderId: string;
    try {
      const raw = await request.text();
      if (raw.length > 12000) throw new Error("Solicitação excede o tamanho permitido.");
      const fields = object(JSON.parse(raw));
      if (fields.action === "geocode") {
        if (typeof fields.address !== "string" || fields.address.trim().length < 8 || fields.address.length > 2000 ||
          Object.keys(fields).some((key) => !["action", "address"].includes(key)))
          throw new Error("Informe um endereço completo de até 2000 caracteres.");
        try { await api("/rest/v1/rpc/reserve_address_lookup", {}); }
        catch { return response(429, { error: "Não foi possível autorizar a consulta de endereço. Aguarde um minuto se atingiu o limite e confira se a migração de geocodificação foi aplicada." }); }
        try { return response(200, await geocodeAddress(fields.address, env.googleKey, fetcher)); }
        catch (cause) { return response(502, { error: cause instanceof Error ? cause.message : "Não foi possível localizar o endereço." }); }
      }
      if (typeof fields.orderId !== "string" || !fields.orderId.trim() || fields.orderId.length > 200 ||
        Object.keys(fields).some((key) => key !== "orderId")) throw new Error("Informe somente a OS a calcular.");
      orderId = fields.orderId;
    } catch (cause) { return response(400, { error: cause instanceof Error ? cause.message : "Solicitação inválida." }); }
    let origin: Point;
    let destination: Point;
    try {
      const rows = records(await api(`/rest/v1/company_data?company_id=eq.${companyId}&select=payload`));
      const payload = object(rows[0]?.payload);
      const order = records(payload.orders).find((item) => item.id === orderId);
      if (!order) throw new Error("OS não encontrada na empresa.");
      const details = object(order.details);
      const client = records(payload.clients).find((item) => item.id === order.clientId);
      if (!client) throw new Error("Cliente não encontrado.");
      origin = point(object(payload.settings).assistancePoint);
      destination = point(details.servicePoint);
      if (destination.address !== serviceAddress(details, client))
        throw new Error("O endereço mudou. Confirme novamente o ponto do atendimento e salve a OS.");
    } catch (cause) { return response(400, { error: cause instanceof Error ? cause.message : "Confira os pontos cadastrados." }); }
    try { await api("/rest/v1/rpc/reserve_travel_route", {}); }
    catch { return response(429, { error: "Cálculo não autorizado ou muito frequente. Aguarde 10 segundos e verifique se a migração de rotas foi aplicada." }); }
    async function leg(from: Point, to: Point) {
      const location = (value: Point) => ({ location: { latLng: { latitude: value.latitude, longitude: value.longitude } } });
      const result = await fetcher("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.googleKey, "X-Goog-FieldMask": "routes.distanceMeters" },
        body: JSON.stringify({
          origin: location(from), destination: location(to), travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE", computeAlternativeRoutes: false,
          routeModifiers: { avoidTolls: false, avoidHighways: false, avoidFerries: false },
          languageCode: "pt-BR", units: "METRIC",
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!result.ok) throw new Error("O Google Maps recusou o cálculo. Confira chave, faturamento, cotas e habilitação da Routes API.");
      const body = object(await result.json());
      if (!Array.isArray(body.routes) || body.routes.length === 0)
        throw new Error("O Google Maps não encontrou uma rota de carro entre os pontos.");
      const routes = records(body.routes);
      const meters = routes[0]?.distanceMeters;
      if (typeof meters !== "number" || !Number.isSafeInteger(meters) || meters < 0 || meters > 50_000_000)
        throw new Error("O Google Maps não retornou uma distância válida para esta rota.");
      return meters;
    }
    try {
      const [outboundMeters, returnMeters] = await Promise.all([leg(origin, destination), leg(destination, origin)]);
      return response(200, { provider: "Google Maps", calculatedAt: new Date().toISOString(), origin, destination, outboundMeters, returnMeters });
    } catch (cause) {
      return response(502, { error: cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Tempo limite ao calcular a rota. Tente novamente." });
    }
  };
}
