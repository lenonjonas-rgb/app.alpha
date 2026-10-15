import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupServicePoint } from "./geocoding";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { functions: { invoke } } }));

describe("consulta de coordenadas no formulário", () => {
  beforeEach(() => invoke.mockReset());
  const address = "Rua Teste, 10 - Cidade - SC";
  const point = { address, latitude: -26.3, longitude: -48.85, source: "Google Maps" };
  it("usa o servidor e propaga sinal de cancelamento para endereço alterado", async () => {
    invoke.mockResolvedValue({ data: point, error: null });
    const controller = new AbortController();
    expect(await lookupServicePoint(address, controller.signal)).toEqual(point);
    expect(invoke).toHaveBeenCalledWith("travel-route", { body: { action: "geocode", address }, signal: controller.signal });
  });
  it("preserva o vínculo exato mesmo quando o endereço possui espaços nas extremidades", async () => {
    const spacedAddress = ` ${address} `;
    invoke.mockResolvedValue({ data: { ...point, address: spacedAddress }, error: null });
    expect((await lookupServicePoint(spacedAddress, new AbortController().signal)).address).toBe(spacedAddress);
  });
  it.each([
    { ...point, address: "Outro endereço" },
    { ...point, source: undefined },
    { ...point, latitude: 100 },
  ])("recusa resposta incompatível com o endereço atual: %j", async (data) => {
    invoke.mockResolvedValue({ data, error: null });
    await expect(lookupServicePoint(address, new AbortController().signal)).rejects.toThrow();
  });
  it("mostra erro explícito do servidor e não esconde ausência de configuração", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "Habilite Geocoding API" })) } });
    await expect(lookupServicePoint(address, new AbortController().signal)).rejects.toThrow("Habilite Geocoding API");
    invoke.mockResolvedValue({ data: null, error: new Error("Fetch failed") });
    await expect(lookupServicePoint(address, new AbortController().signal)).rejects.toThrow("publicação da função");
  });
});
