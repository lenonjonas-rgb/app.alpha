import { describe, expect, it } from "vitest";
import { tollPrice } from "../../supabase/functions/travel-route/tolls";
import { assertTravelReady, routeTolls, travelRouteSchema, travelSchema } from "./travel";

const priced = (prices: unknown) => ({ travelAdvisory: { tollInfo: { estimatedPrice: prices } } });
describe("estimativa de pedágios", () => {
  it("converte BRL em centavos sem tratar nanos como reais e soma praças da mesma perna", () => {
    expect(tollPrice(priced([{ currencyCode: "BRL", units: "12", nanos: 500000000 }, { currencyCode: "BRL", units: "7", nanos: 250000000 }]))).toBe(1975);
    expect(tollPrice(priced([{ currencyCode: "BRL", nanos: 150000000 }]))).toBe(15);
    expect(tollPrice(priced([{ currencyCode: "BRL", units: "0" }]))).toBe(0);
  });
  it("distingue rota sem pedágio de pedágio sem preço ou moeda não suportada", () => {
    expect(tollPrice({})).toBe(0);
    expect(tollPrice({ travelAdvisory: {} })).toBe(0);
    expect(tollPrice({ travelAdvisory: { tollInfo: {} } })).toBeNull();
    expect(tollPrice(priced([]))).toBeNull();
    expect(tollPrice(priced([{ currencyCode: "USD", units: "5" }]))).toBeNull();
  });
  it.each([
    [{ currencyCode: "BRL", units: "-1" }],
    [{ currencyCode: "BRL", units: "1.5" }],
    [{ currencyCode: "BRL", units: 1 }],
    [{ currencyCode: "BRL", units: "1", nanos: -1 }],
    [{ currencyCode: "BRL", units: "1", nanos: 1000000000 }],
    [{ currencyCode: "BRL", units: "999999999999999999999" }],
    "invalid",
  ].map((prices) => ({ prices })))("rejeita dados de preço inválidos: %j", ({ prices }) => {
    expect(() => tollPrice(priced(prices))).toThrow("pedágio");
  });
  const route = () => travelRouteSchema.parse({
    provider: "Google Maps", calculatedAt: "2026-10-15T12:00:00Z",
    origin: { address: "Origem" }, destination: { address: "Destino" },
    outboundMeters: 30000, returnMeters: 40000, tollEstimate: { outbound: 1250, return: 1875 },
  });
  it("soma ida e volta distintas sem duplicar nem ignorar uma perna", () => {
    expect(routeTolls(route())).toBe(3125);
    expect(routeTolls({ ...route(), tollEstimate: { outbound: 0, return: 0 } })).toBe(0);
    expect(routeTolls({ ...route(), tollEstimate: { outbound: 1250, return: null } })).toBeUndefined();
    expect(routeTolls({ ...route(), tollEstimate: undefined })).toBeUndefined();
  });
  it("exige confirmação manual se o total é desconhecido e mantém compatibilidade com cálculos antigos", () => {
    const travel = travelSchema.parse({ route: route(), chargeTravel: true, fuelPrice: 600, kilometersPerLiter: 10, kilometerRate: 250, tolls: 3125 });
    expect(() => assertTravelReady(travel, true)).not.toThrow();
    expect(() => assertTravelReady({ ...travel, tollsConfirmed: false }, true)).toThrow("confirme o total");
    expect(() => assertTravelReady({ ...travel, tollsConfirmed: true }, true)).not.toThrow();
    expect(() => assertTravelReady(travel, false)).toThrow("cobrança");
    expect(() => assertTravelReady(undefined, false)).toThrow("Calcule");
  });
});
