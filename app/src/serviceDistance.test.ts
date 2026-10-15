import { describe, expect, it } from "vitest";
import { demoDatabase, getOrderDetails, orderServiceAddress, validateDatabase } from "./domain";
import type { Activity } from "./domain";
import { distanceMeters, serviceDistanceForActivity, serviceDistanceText } from "./serviceDistance";

describe("distância em linha reta do atendimento", () => {
  it("calcula metros inclusive zero, cruzamento do meridiano e antípodas", () => {
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 })).toBe(0);
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBe(111195);
    expect(distanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 })).toBe(222);
    expect(distanceMeters({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 0 })).toBe(20015087);
  });

  it("vincula o ponto ao endereço e preserva a referência histórica", () => {
    const data = demoDatabase();
    const order = data.orders[0];
    const client = data.clients.find((item) => item.id === order.clientId)!;
    order.details = { ...getOrderDetails(order), servicePoint: {
      latitude: -27.58, longitude: -48.58, address: orderServiceAddress(order, client),
    } };
    const gps = { latitude: -27.58017, longitude: -48.5875, accuracy: 16, capturedAt: new Date().toISOString() };
    const measured = serviceDistanceForActivity(order, client, gps)!;
    expect(measured.meters).toBeGreaterThan(700);
    expect(measured.meters).toBeLessThan(750);
    const activity: Activity = {
      id: "test", at: gps.capturedAt, kind: "Check-in", technician: "Técnico",
      origin: "Android", reason: "", justification: "", location: gps, serviceDistance: measured,
    };
    order.details.activities = [activity];
    client.address = "Endereço alterado";
    expect(serviceDistanceForActivity(order, client, gps)).toBeUndefined();
    expect(validateDatabase(JSON.parse(JSON.stringify(data))).orders[0].details?.activities[0].serviceDistance).toEqual(measured);
    expect(serviceDistanceText(activity)).toContain(`${measured.meters} m`);
    expect(serviceDistanceText({ ...activity, serviceDistance: { ...measured, meters: 0 } })).toContain("0 m");
  });

  it("não inventa distância para registros antigos ou sem GPS", () => {
    const activity: Activity = {
      id: "old", at: new Date().toISOString(), kind: "Check-out", technician: "Técnico",
      origin: "Web local", reason: "", justification: "",
    };
    expect(serviceDistanceText(activity)).toBe("GPS não registrado");
    expect(serviceDistanceText({ ...activity, location: {
      latitude: 0, longitude: 0, accuracy: 12, capturedAt: activity.at,
    } })).toBe("Sem ponto confirmado na data do registro");
    expect(serviceDistanceText({ ...activity, kind: "Pausa" })).toBe("Não se aplica");
  });
});
