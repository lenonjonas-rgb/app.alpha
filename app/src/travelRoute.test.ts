import { describe, expect, it, vi } from "vitest";
import { travelRouteHandler } from "../../supabase/functions/travel-route/handler";

const company = "10000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000001";
const origin = { latitude: -26.3, longitude: -48.85, address: "Assistência" };
const destination = { latitude: -26.4, longitude: -48.9, address: "Cliente" };
const env = { url: "https://example.test", publicKey: "test-public", googleKey: "test-google" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const request = (body: object = { orderId: "order-1" }) => new Request("https://example.test/travel-route", {
  method: "POST", headers: { Authorization: "Bearer test-user", "Content-Type": "application/json" }, body: JSON.stringify(body),
});
function setup({ role = "owner", stale = false, found = true, googleStatus = 200, reserveStatus = 200, noRoutes = false, geocoded = false, noPoints = false, assistanceAddress = "", clientAddress = destination.address, companyAddress = "", specificAddress = false, tolls = false, unknownTolls = false } = {}) {
  const legs: { body: Record<string, unknown>; headers: Headers }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return json({ id: user });
    if (url.includes("/company_memberships?")) return json([{ company_id: company, role }]);
    if (url.includes("/company_data?")) return json([{ payload: {
      settings: { address: companyAddress, assistanceAddress, assistancePoint: noPoints ? undefined : { ...origin, ...(geocoded ? { source: "Google Maps" } : {}) } },
      orders: found ? [{ id: "order-1", clientId: "client", details: {
        servicePoint: noPoints ? undefined : { ...destination, address: stale ? "Antigo" : destination.address, ...(geocoded ? { source: "Google Maps" } : {}) },
        ...(specificAddress ? { serviceLocation: { useClientAddress: false, street: "Rua Específica", number: "20", city: "Cidade", state: "SC", postalCode: "88330390" } } : {}),
      } }] : [],
      clients: [{ id: "client", address: clientAddress }],
    } }]);
    if (url.endsWith("/rpc/reserve_travel_route")) return new Response(null, { status: reserveStatus });
    if (url.startsWith("https://routes.googleapis.com/")) {
      legs.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      return json(noRoutes ? { routes: [] } : { routes: [{
        distanceMeters: legs.length === 1 ? 30000 : 40000,
        ...(tolls ? { travelAdvisory: { tollInfo: unknownTolls && legs.length === 2 ? {} : {
          estimatedPrice: [{ currencyCode: "BRL", units: legs.length === 1 ? "12" : "18", nanos: legs.length === 1 ? 500000000 : 750000000 }],
        } } } : {}),
      }] }, googleStatus);
    }
    throw new Error(`Unexpected request ${url}`);
  });
  return { handler: travelRouteHandler(env, fetcher), fetcher, legs };
}
describe("Google Maps Routes protegido no servidor", () => {
  it("busca preços distintos de ida e volta e não assume zero quando uma perna não tem preço", async () => {
    const { handler } = setup({ tolls: true });
    expect(await (await handler(request())).json()).toMatchObject({ tollEstimate: { outbound: 1250, return: 1875 } });
    const unknown = setup({ tolls: true, unknownTolls: true });
    expect(await (await unknown.handler(request())).json()).toMatchObject({ tollEstimate: { outbound: 1250, return: null } });
  });
  it("calcula prévia antes de criar a OS usando somente origem da própria empresa", async () => {
    const { handler, legs } = setup({ found: false, tolls: true });
    const response = await handler(request({ action: "preview-route", destination: { address: "Rua do novo atendimento, 10 - Cidade - SC" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ origin, tollEstimate: { outbound: 1250, return: 1875 } });
    expect(legs).toHaveLength(2);
  });
  it.each([
    { action: "preview-route", destination: { address: "" } },
    { action: "preview-route", destination: { address: "Destino", latitude: 99, longitude: 0 } },
    { action: "preview-route", destination: { address: "Destino", companyId: company } },
    { action: "preview-route", destination: { address: "Destino" }, origin },
    { action: "preview-route", destination: { address: "Destino" }, fuelPrice: 1 },
  ])("recusa destino inválido ou campos extras na prévia: %j", async (body) => {
    const { handler, legs } = setup();
    expect((await handler(request(body))).status).toBe(400);
    expect(legs).toHaveLength(0);
  });
  it.each([{ role: "technician", status: 403 }, { reserveStatus: 400, status: 429 }])("protege prévia por perfil e limite: %j", async ({ status, ...options }) => {
    const { handler, legs } = setup(options);
    expect((await handler(request({ action: "preview-route", destination: { address: "Destino" } }))).status).toBe(status);
    expect(legs).toHaveLength(0);
  });
  it("preserva a origem Google dos pontos no histórico da rota", async () => {
    const { handler } = setup({ geocoded: true });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      origin: { ...origin, source: "Google Maps" }, destination: { ...destination, source: "Google Maps" },
    });
  });
  it("solicita ida e volta separadamente e só envia coordenadas ao Google", async () => {
    const { handler, legs } = setup();
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provider: "Google Maps", origin, destination, outboundMeters: 30000, returnMeters: 40000 });
    expect(legs).toHaveLength(2);
    expect(legs[0].body.origin).toEqual(legs[1].body.destination);
    expect(legs[1].body.origin).toEqual(legs[0].body.destination);
    expect(legs[0].body).toMatchObject({ travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" });
    expect(legs[0].headers.get("X-Goog-FieldMask")).toBe("routes.distanceMeters,routes.travelAdvisory.tollInfo");
    expect(legs[0].body.extraComputations).toEqual(["TOLLS"]);
    expect(JSON.stringify(legs.map((leg) => leg.body))).not.toContain("Assistência");
    expect(JSON.stringify(legs.map((leg) => leg.body))).not.toContain("Cliente");
  });
  it("recusa técnico e não consulta Google", async () => {
    const { handler, legs } = setup({ role: "technician" });
    expect((await handler(request())).status).toBe(403);
    expect(legs).toHaveLength(0);
  });
  it("autoriza também o administrativo e não expõe a chave na resposta", async () => {
    const { handler } = setup({ role: "admin" });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(env.googleKey);
  });
  it.each([{ found: false }, { noPoints: true }, { clientAddress: "" }])("recusa endereço ausente ou OS fora da empresa: %j", async (options) => {
    const { handler, legs } = setup(options);
    expect((await handler(request())).status).toBe(400);
    expect(legs).toHaveLength(0);
  });
  it("calcula ida e volta diretamente pelos endereços salvos sem chamar Geocoding API", async () => {
    const assistanceAddress = "Rua da assistência, 10 - Cidade - SC";
    const clientAddress = "Rua do cliente, 20 - Cidade - SC";
    const { handler, legs, fetcher } = setup({ noPoints: true, assistanceAddress, clientAddress });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      origin: { address: assistanceAddress }, destination: { address: clientAddress }, outboundMeters: 30000, returnMeters: 40000,
    });
    expect(legs[0].body).toMatchObject({ origin: { address: assistanceAddress }, destination: { address: clientAddress }, regionCode: "BR" });
    expect(legs[1].body).toMatchObject({ origin: { address: clientAddress }, destination: { address: assistanceAddress } });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("geocode"))).toBe(false);
  });
  it("não reutiliza coordenadas antigas quando o endereço mudou e permite rota mista", async () => {
    const { handler, legs } = setup({ stale: true });
    expect((await handler(request())).status).toBe(200);
    expect(legs[0].body).toMatchObject({
      origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
      destination: { address: destination.address },
    });
  });
  it("usa endereço atual da assistência em vez do ponto antigo", async () => {
    const assistanceAddress = "Rua da nova assistência, 40 - Cidade - SC";
    const { handler, legs } = setup({ assistanceAddress });
    expect((await handler(request())).status).toBe(200);
    expect(legs[0].body.origin).toEqual({ address: assistanceAddress });
  });
  it("usa endereço cadastral da assistência e endereço específico da OS sem coordenadas", async () => {
    const companyAddress = "Rua da empresa, 10 - Cidade - SC";
    const { handler, legs } = setup({ noPoints: true, companyAddress, specificAddress: true });
    expect((await handler(request())).status).toBe(200);
    expect(legs[0].body).toMatchObject({
      origin: { address: companyAddress },
      destination: { address: "Rua Específica, 20 · Cidade - SC · CEP 88330390" },
    });
  });
  it("não permite coordenadas arbitrárias ou tarifas enviadas pelo navegador", async () => {
    const { handler, legs } = setup();
    expect((await handler(request({ orderId: "order-1", origin }))).status).toBe(400);
    expect(legs).toHaveLength(0);
  });
  it.each([{ googleStatus: 403 }, { noRoutes: true }])("falha explicitamente, sem usar linha reta ou zero como fallback: %j", async (options) => {
    const { handler } = setup(options);
    const response = await handler(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });
  it("respeita o limite persistente antes de consumir a API paga", async () => {
    const { handler, legs } = setup({ reserveStatus: 400 });
    expect((await handler(request())).status).toBe(429);
    expect(legs).toHaveLength(0);
  });
  it("aceita a reserva SQL sem corpo com status 204 antes de calcular as duas pernas", async () => {
    const { handler, legs } = setup({ reserveStatus: 204 });
    expect((await handler(request())).status).toBe(200);
    expect(legs).toHaveLength(2);
  });
  it("sem chave configurada e sem sessão não faz chamadas externas", async () => {
    const fetcher = vi.fn();
    const handler = travelRouteHandler({ ...env, googleKey: "" }, fetcher);
    expect((await handler(request())).status).toBe(503);
    const noAuth = travelRouteHandler(env, fetcher);
    expect((await noAuth(new Request("https://example.test", { method: "POST" }))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
