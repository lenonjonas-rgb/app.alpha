import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoDatabase } from "./domain";
import { assistanceEndpoint, calculateTravelRoute } from "./travelClient";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { functions: { invoke } } }));
const destination = { address: "Rua do atendimento, 20 - Cidade - SC" };
function fixture() {
  const data = demoDatabase();
  Object.assign(data.settings, { assistanceAddress: "Rua da assistência, 10 - Cidade - SC", fuelPrice: 600, kilometersPerLiter: 10, kilometerRate: 250 });
  const route = { provider: "Google Maps", calculatedAt: "2026-10-15T12:00:00Z",
    origin: assistanceEndpoint(data), destination, outboundMeters: 30000, returnMeters: 40000,
    tollEstimate: { outbound: 1250, return: 1875 } };
  return { data, route };
}
describe("consulta compartilhada de rota e pedágios", () => {
  beforeEach(() => invoke.mockReset());
  it("permite prévia de nova OS sem enviar preços ou empresa do navegador", async () => {
    const { data, route } = fixture();
    invoke.mockResolvedValue({ data: route, error: null });
    expect(await calculateTravelRoute(data, destination)).toEqual(route);
    expect(invoke).toHaveBeenCalledWith("travel-route", { body: { action: "preview-route", destination } });
  });
  it("mantém envio somente do ID para OS já salva", async () => {
    const { data, route } = fixture();
    invoke.mockResolvedValue({ data: route, error: null });
    expect(await calculateTravelRoute(data, destination, "order")).toEqual(route);
    expect(invoke).toHaveBeenCalledWith("travel-route", { body: { orderId: "order" } });
  });
  it("não consulta se falta combustível, rendimento ou endereço", async () => {
    const { data } = fixture();
    data.settings.fuelPrice = 0;
    await expect(calculateTravelRoute(data, destination)).rejects.toThrow("combustível");
    data.settings.fuelPrice = 600;
    await expect(calculateTravelRoute(data, { address: "" })).rejects.toThrow("endereço");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("recusa resposta de outro endereço e propaga erro explícito do servidor", async () => {
    const { data, route } = fixture();
    invoke.mockResolvedValue({ data: { ...route, destination: { address: "Outra rua" } }, error: null });
    await expect(calculateTravelRoute(data, destination)).rejects.toThrow("endereços");
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "Limite atingido" })) } });
    await expect(calculateTravelRoute(data, destination)).rejects.toThrow("Limite atingido");
  });
});
