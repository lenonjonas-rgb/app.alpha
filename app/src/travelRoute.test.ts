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
function setup({ role = "owner", stale = false, found = true, googleStatus = 200, reserveStatus = 200, noRoutes = false } = {}) {
  const legs: { body: Record<string, unknown>; headers: Headers }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return json({ id: user });
    if (url.includes("/company_memberships?")) return json([{ company_id: company, role }]);
    if (url.includes("/company_data?")) return json([{ payload: {
      settings: { assistancePoint: origin },
      orders: found ? [{ id: "order-1", clientId: "client", details: { servicePoint: { ...destination, address: stale ? "Antigo" : destination.address } } }] : [],
      clients: [{ id: "client", address: destination.address }],
    } }]);
    if (url.endsWith("/rpc/reserve_travel_route")) return json(null, reserveStatus);
    if (url.startsWith("https://routes.googleapis.com/")) {
      legs.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      return json(noRoutes ? { routes: [] } : { routes: [{ distanceMeters: legs.length === 1 ? 30000 : 40000 }] }, googleStatus);
    }
    throw new Error(`Unexpected request ${url}`);
  });
  return { handler: travelRouteHandler(env, fetcher), fetcher, legs };
}
describe("Google Maps Routes protegido no servidor", () => {
  it("solicita ida e volta separadamente e só envia coordenadas ao Google", async () => {
    const { handler, legs } = setup();
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provider: "Google Maps", origin, destination, outboundMeters: 30000, returnMeters: 40000 });
    expect(legs).toHaveLength(2);
    expect(legs[0].body.origin).toEqual(legs[1].body.destination);
    expect(legs[1].body.origin).toEqual(legs[0].body.destination);
    expect(legs[0].body).toMatchObject({ travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" });
    expect(legs[0].headers.get("X-Goog-FieldMask")).toBe("routes.distanceMeters");
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
  it.each([{ stale: true }, { found: false }])("recusa referência antiga ou OS fora da empresa: %j", async (options) => {
    const { handler, legs } = setup(options);
    expect((await handler(request())).status).toBe(400);
    expect(legs).toHaveLength(0);
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
  it("sem chave configurada e sem sessão não faz chamadas externas", async () => {
    const fetcher = vi.fn();
    const handler = travelRouteHandler({ ...env, googleKey: "" }, fetcher);
    expect((await handler(request())).status).toBe(503);
    const noAuth = travelRouteHandler(env, fetcher);
    expect((await noAuth(new Request("https://example.test", { method: "POST" }))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
