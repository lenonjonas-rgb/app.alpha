import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { currency, demoDatabase, getOrderDetails, orderValues, replicateOrder, validateDatabase } from "./domain";
import { routeTolls, sameTravelEndpoint, servicePointSchema, travelEndpoint, travelSchema, travelValues } from "./travel";
import { filterOrders, defaultReportFilters, travelCostRows } from "./reporting";
import { OrderPrintable } from "./OrderWorkspace";
import { TravelPanel } from "./TravelPanel";

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
  it("oferece Sim/Não na criação antes de calcular e explica total de pedágios incompleto", () => {
    const data = demoDatabase();
    const props = { data, editing: true, busy: false, onBusy: () => {}, onChange: () => {}, onError: () => {} };
    const html = renderToStaticMarkup(<TravelPanel {...props} travel={undefined} initialCharge />);
    expect(html.match(/<select name="travelChargeTravel"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html).toContain('<option selected="">Sim</option>');
    const travel = { ...trip(), tollsConfirmed: false };
    travel.route.tollEstimate = { outbound: 1250, return: null };
    const pending = renderToStaticMarkup(<TravelPanel {...props} travel={travel} />);
    expect(pending).toContain("Pedágio — ida + volta");
    expect(pending).toContain("não pode ser salvo");
  });
  it.each([false, true])("mostra somente totais separados sem recados da rota (Sim=%s)", (chargeTravel) => {
    const travel = { ...trip(), chargeTravel };
    const html = renderToStaticMarkup(<TravelPanel data={demoDatabase()} travel={travel} editing busy={false}
      onBusy={() => {}} onChange={() => {}} onError={() => {}} />);
    expect(html).toContain('Total do deslocamento (R$)<input readOnly="" value="175.00"');
    expect(html).toContain('Pedágio — ida + volta (R$)<input');
    expect(html).toContain('value="20"');
    expect(html).toContain("70 km");
    for (const text of ["Origem registrada", "Preços registrados", "Consumo estimado", "Cobrança ao cliente", "Rota de carro", "Não é obrigatório", "Estimativa de combustível"])
      expect(html).not.toContain(text);
  });
  it.each([false, true])("preserva estimativas dos pedágios de ida e volta no backup e aplica o total uma única vez (Sim=%s)", (chargeTravel) => {
    const data = demoDatabase();
    const travel = trip();
    travel.route.tollEstimate = { outbound: 1250, return: 1875 };
    travel.tolls = routeTolls(travel.route)!;
    travel.tollsConfirmed = true;
    travel.chargeTravel = chargeTravel;
    const details = getOrderDetails(data.orders[0]);
    const baseline = orderValues(details).total;
    data.orders[0].details = { ...details, travel };
    const restored = validateDatabase(JSON.parse(JSON.stringify(data)));
    const saved = restored.orders[0].details!;
    expect(saved.travel?.route.tollEstimate).toEqual({ outbound: 1250, return: 1875 });
    expect(saved.travel?.tollsConfirmed).toBe(true);
    expect(travelValues(saved.travel!)).toMatchObject({ cost: 7325, charge: chargeTravel ? 20625 : 0 });
    expect(orderValues(saved).total).toBe(baseline + (chargeTravel ? 20625 : 0));
  });
  it("não aceita endereço em branco e não altera o endereço vinculado às coordenadas", () => {
    expect(servicePointSchema.safeParse({ ...trip().route.origin, address: "   " }).success).toBe(false);
    expect(servicePointSchema.parse({ ...trip().route.origin, address: " Rua da assistência, 10 " }).address).toBe(" Rua da assistência, 10 ");
  });
  it("preserva endereço e origem Google em backups e mantém compatibilidade com pontos manuais antigos", () => {
    const data = demoDatabase();
    data.settings.assistanceAddress = "Rua da assistência, 10";
    data.settings.assistancePoint = servicePointSchema.parse({ ...trip().route.origin, source: "Google Maps" });
    const travel = trip();
    travel.route.origin = servicePointSchema.parse({ ...travel.route.origin, source: "Google Maps" });
    data.orders[0].details = { ...getOrderDetails(data.orders[0]), travel, servicePoint: servicePointSchema.parse({ ...travel.route.destination, source: "Google Maps" }) };
    const restored = validateDatabase(JSON.parse(JSON.stringify(data)));
    expect(restored.settings.assistanceAddress).toBe(data.settings.assistanceAddress);
    expect(restored.settings.assistancePoint?.source).toBe("Google Maps");
    expect(restored.orders[0].details?.servicePoint?.source).toBe("Google Maps");
    expect(restored.orders[0].details?.travel?.route.origin).toMatchObject({ source: "Google Maps" });
    Reflect.deleteProperty(data.settings, "assistanceAddress");
    data.settings.assistancePoint = servicePointSchema.parse(trip().route.origin);
    const legacy = validateDatabase(data);
    expect(legacy.settings.assistanceAddress).toBe("");
    expect(legacy.settings.assistancePoint?.source).toBeUndefined();
  });
  it("usa endereço sem coordenadas, mantém histórico no backup e calcula cobrança/custos normalmente", () => {
    const data = demoDatabase();
    const travel = trip();
    travel.route.origin = { address: "Rua da assistência, 10 - Cidade - SC" };
    travel.route.destination = { address: "Rua do atendimento, 20 - Cidade - SC" };
    data.orders[0].details = { ...getOrderDetails(data.orders[0]), travel };
    const restored = validateDatabase(JSON.parse(JSON.stringify(data)));
    expect(restored.orders[0].details?.travel?.route).toEqual(travel.route);
    expect(restored.orders[0].details?.servicePoint).toBeUndefined();
    expect(travelValues(travel)).toMatchObject({ kilometers: 70, cost: 6200, charge: 0 });
    expect(travelValues({ ...travel, chargeTravel: true })).toMatchObject({ cost: 6200, charge: 19500 });
    expect(travelSchema.safeParse({ ...travel, route: { ...travel.route, origin: { address: "   " } } }).success).toBe(false);
  });
  it("detecta mudanças de endereço/coordenadas e ignora ponto vinculado a endereço antigo", () => {
    const point = servicePointSchema.parse(trip().route.origin);
    expect(travelEndpoint("Endereço novo", point)).toEqual({ address: "Endereço novo" });
    expect(travelEndpoint(point.address, point)).toEqual(point);
    expect(sameTravelEndpoint({ address: "A" }, { address: "A" })).toBe(true);
    expect(sameTravelEndpoint({ address: "A" }, { address: "B" })).toBe(false);
    expect(sameTravelEndpoint({ address: point.address }, point)).toBe(false);
    expect(sameTravelEndpoint(point, { ...point, latitude: point.latitude + 1 })).toBe(false);
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
