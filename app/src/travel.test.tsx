import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { currency, demoDatabase, getOrderDetails, orderValues, replicateOrder, validateDatabase } from "./domain";
import { servicePointSchema, travelSchema, travelValues } from "./travel";
import { filterOrders, defaultReportFilters, travelCostRows } from "./reporting";
import { OrderPrintable } from "./OrderWorkspace";

const trip = () => travelSchema.parse({
  route: {
    provider: "Google Maps", calculatedAt: "2026-10-15T12:00:00Z",
    origin: { latitude: -26.3, longitude: -48.85, address: "Assistência" },
    destination: { latitude: -26.4, longitude: -48.9, address: "Cliente" },
    outboundMeters: 30000, returnMeters: 40000,
  },
  chargeTravel: false, fuelPrice: 600, kilometersPerLiter: 10, kilometerRate: 250, tolls: 2000,
});

describe("custos e cobrança de deslocamento", () => {
  it("não aceita endereço em branco e não altera o endereço vinculado às coordenadas", () => {
    expect(servicePointSchema.safeParse({ ...trip().route.origin, address: "   " }).success).toBe(false);
    expect(servicePointSchema.parse({ ...trip().route.origin, address: " Rua da assistência, 10 " }).address).toBe(" Rua da assistência, 10 ");
  });
  it("preserva endereço e origem Google em backups e mantém compatibilidade com pontos manuais antigos", () => {
    const data = demoDatabase();
    data.settings.assistanceAddress = "Rua da assistência, 10";
    data.settings.assistancePoint = { ...trip().route.origin, source: "Google Maps" };
    const travel = trip();
    travel.route.origin.source = "Google Maps";
    data.orders[0].details = { ...getOrderDetails(data.orders[0]), travel, servicePoint: { ...travel.route.destination, source: "Google Maps" } };
    const restored = validateDatabase(JSON.parse(JSON.stringify(data)));
    expect(restored.settings.assistanceAddress).toBe(data.settings.assistanceAddress);
    expect(restored.settings.assistancePoint?.source).toBe("Google Maps");
    expect(restored.orders[0].details?.servicePoint?.source).toBe("Google Maps");
    expect(restored.orders[0].details?.travel?.route.origin.source).toBe("Google Maps");
    Reflect.deleteProperty(data.settings, "assistanceAddress");
    data.settings.assistancePoint = trip().route.origin;
    const legacy = validateDatabase(data);
    expect(legacy.settings.assistanceAddress).toBe("");
    expect(legacy.settings.assistancePoint?.source).toBeUndefined();
  });
  it("calcula exatamente o exemplo de 70 km sem cobrar quando Não", () => {
    expect(travelValues(trip())).toEqual({
      kilometers: 70, liters: 7, fuelCost: 4200, cost: 6200,
      mileageCharge: 0, charge: 0, balance: -6200,
    });
  });
  it("cobra km e pedágios quando Sim, sem deixar de registrar combustível e pedágios como custo", () => {
    expect(travelValues({ ...trip(), chargeTravel: true })).toMatchObject({
      fuelCost: 4200, cost: 6200, mileageCharge: 17500, charge: 19500, balance: 13300,
    });
  });
  it("soma ida e volta distintas, arredonda centavos somente ao final e aceita rota zero", () => {
    const travel = trip();
    travel.route.outboundMeters = 35251;
    travel.route.returnMeters = 35123;
    travel.kilometersPerLiter = 12.7;
    travel.fuelPrice = 619;
    expect(travelValues(travel).fuelCost).toBe(Math.round(70.374 / 12.7 * 619));
    travel.route.outboundMeters = 0; travel.route.returnMeters = 0; travel.tolls = 0;
    expect(travelValues(travel)).toMatchObject({ kilometers: 0, liters: 0, cost: 0, charge: 0 });
  });
  it.each([
    { kilometersPerLiter: 0 }, { kilometersPerLiter: -1 }, { kilometersPerLiter: 0.00001 },
    { fuelPrice: 0 }, { fuelPrice: -1 }, { fuelPrice: 6.5 }, { tolls: -1 }, { kilometerRate: -1 },
    { chargeTravel: "Sim" },
  ])("rejeita entradas inválidas %j", (change) => {
    expect(travelSchema.safeParse({ ...trip(), ...change }).success).toBe(false);
  });
  it("não adiciona custos internos ao total e integra cobrança uma única vez com o desconto geral", () => {
    const details = getOrderDetails(demoDatabase().orders[0]);
    const baseline = orderValues(details).total;
    details.travel = trip();
    expect(orderValues(details).total).toBe(baseline);
    details.travel.chargeTravel = true;
    expect(orderValues(details).total).toBe(baseline + 19500);
    details.discountMode = "%"; details.discount = 10;
    expect(orderValues(details).total).toBe(baseline + 19500 - Math.round((baseline + 19500) * 0.1));
    details.travel.chargeTravel = false;
    expect(travelValues(details.travel).cost).toBe(6200);
  });
  it("preserva preços históricos em backups e não replica cobrança/custos anteriores", () => {
    const data = demoDatabase();
    data.orders[0].details = { ...getOrderDetails(data.orders[0]), travel: trip() };
    const restored = validateDatabase(JSON.parse(JSON.stringify(data)));
    restored.settings.fuelPrice = 999;
    restored.settings.kilometerRate = 800;
    expect(travelValues(restored.orders[0].details!.travel!).cost).toBe(6200);
    const replicated = replicateOrder(restored, data.orders[0].id, "2026-10-20", "10:00");
    expect(replicated.orders.at(-1)?.details?.travel).toBeUndefined();
    const legacy = structuredClone(data);
    delete legacy.orders[0].details!.travel;
    expect(validateDatabase(legacy).orders[0].details?.travel).toBeUndefined();
  });
  it("relata custos com e sem cobrança e aplica os filtros sem inventar custos para OS antigas", () => {
    const data = demoDatabase();
    const order = data.orders[0];
    order.details = { ...getOrderDetails(order), travel: trip() };
    data.orders[1].details = { ...getOrderDetails(data.orders[1]), travel: { ...trip(), chargeTravel: true } };
    const rows = travelCostRows(data.orders);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.cost)).toEqual([6200, 6200]);
    expect(rows.map((row) => row.charge)).toEqual([0, 19500]);
    const filtered = travelCostRows(filterOrders(data, { ...defaultReportFilters(), query: order.code }));
    expect(filtered).toHaveLength(1);
    expect(filtered[0].order.id).toBe(order.id);
  });
  it.each([false, true])("não expõe combustível ou custo interno no relatório do cliente (cobrar=%s)", (chargeTravel) => {
    const data = demoDatabase(); const order = data.orders[0];
    const details = getOrderDetails(order);
    details.travel = { ...trip(), chargeTravel };
    const html = renderToStaticMarkup(<OrderPrintable data={data} order={order} details={details} />);
    expect(html).not.toContain("combustível");
    expect(html).not.toContain("km/litro");
    expect(html).not.toContain("custo interno");
    expect(html.includes("Total do deslocamento")).toBe(chargeTravel);
    if (chargeTravel) expect(html).toContain(currency(19500));
    else expect(html).not.toContain(currency(6200));
  });
});
