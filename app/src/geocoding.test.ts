import { describe, expect, it, vi } from "vitest";
import { geocodeAddress } from "../../supabase/functions/travel-route/geocoding";
import { travelRouteHandler } from "../../supabase/functions/travel-route/handler";

const address = "Rua 2550, 579 · Centro · Balneário Camboriú - SC · CEP 88330390";
const env = { url: "https://example.test", publicKey: "public-test", googleKey: "private-google-test" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const found = (changes: object = {}) => ({
  geometry: { location_type: "ROOFTOP", location: { lat: -26.99, lng: -48.63 } }, ...changes,
});
const request = (body: object = { action: "geocode", address }) => new Request("https://example.test", {
  method: "POST", headers: { Authorization: "Bearer test-user" }, body: JSON.stringify(body),
});

describe("geocodificação Google protegida", () => {
  it.each(["ROOFTOP", "RANGE_INTERPOLATED"])("preenche coordenadas para um endereço completo: %s", async (location_type) => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => json({ status: "OK", results: [found({ geometry: { location_type, location: { lat: -26.99, lng: -48.63 } } })] }));
    const point = await geocodeAddress(address, env.googleKey, fetcher);
    expect(point).toEqual({ address, latitude: -26.99, longitude: -48.63, source: "Google Maps" });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.origin).toBe("https://maps.googleapis.com");
    expect(url.searchParams.get("address")).toBe(address);
    expect(url.searchParams.get("language")).toBe("pt-BR");
    expect(JSON.stringify(point)).not.toContain(env.googleKey);
  });
  it.each([
    { status: "ZERO_RESULTS", results: [] },
    { status: "REQUEST_DENIED", error_message: "provider details" },
    { status: "OVER_QUERY_LIMIT" },
    { status: "OK", results: [] },
    { status: "OK", results: [found(), found()] },
    { status: "OK", results: [found({ partial_match: true })] },
    { status: "OK", results: [found({ geometry: { location_type: "APPROXIMATE", location: { lat: 1, lng: 2 } } })] },
    { status: "OK", results: [found({ geometry: { location_type: "GEOMETRIC_CENTER", location: { lat: 1, lng: 2 } } })] },
    { status: "OK", results: [found({ geometry: { location_type: "ROOFTOP", location: { lat: 91, lng: 2 } } })] },
    { status: "OK", results: [found({ geometry: { location_type: "ROOFTOP", location: { lat: "1", lng: 2 } } })] },
  ])("recusa resultados imprecisos ou inválidos sem coordenadas fictícias: %j", async (body) => {
    await expect(geocodeAddress(address, env.googleKey, async () => json(body))).rejects.toThrow();
  });
  it("não divulga chave ou URL de erro de rede", async () => {
    await expect(geocodeAddress(address, env.googleKey, async (url) => {
      throw new Error(`Network error ${url}`);
    })).rejects.toThrow("Não foi possível consultar o endereço");
  });
  it("reporta recusa HTTP do provedor", async () => {
    await expect(geocodeAddress(address, env.googleKey, async () => json({}, 403))).rejects.toThrow("Geocoding API");
  });

  function setup(role = "owner", limited = false) {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) return json({ id: "00000000-0000-4000-8000-000000000001" });
      if (url.includes("/company_memberships?"))
        return json([{ company_id: "10000000-0000-4000-8000-000000000001", role }]);
      if (url.endsWith("/rpc/reserve_address_lookup")) return json(null, limited ? 400 : 200);
      if (url.startsWith("https://maps.googleapis.com/"))
        return json({ status: "OK", results: [found()] });
      throw new Error("Unexpected request");
    });
    return { handler: travelRouteHandler(env, fetcher), fetcher };
  }
  it.each(["owner", "admin"])("permite endereço de formulário ainda não salvo, para %s", async (role) => {
    const { handler, fetcher } = setup(role);
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ address, source: "Google Maps" });
    expect(fetcher.mock.calls.map((call) => String(call[0])).some((url) => url.endsWith("/rpc/reserve_address_lookup"))).toBe(true);
    expect(fetcher.mock.calls.map((call) => String(call[0])).some((url) => url.includes("/company_data"))).toBe(false);
  });
  it("não permite que técnico consuma a API paga", async () => {
    const { handler, fetcher } = setup("technician");
    expect((await handler(request())).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("limita geocodificação independentemente das rotas", async () => {
    const { handler, fetcher } = setup("owner", true);
    expect((await handler(request())).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([
    { action: "geocode", address: "" },
    { action: "geocode", address: "123" },
    { action: "geocode", address: "A".repeat(2001) },
    { action: "geocode", address, key: "browser-key" },
    { action: "geocode", address: { street: "Rua" } },
  ])("valida o pedido antes de reservar ou consultar Google: %j", async (body) => {
    const { handler, fetcher } = setup();
    expect((await handler(request(body))).status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
