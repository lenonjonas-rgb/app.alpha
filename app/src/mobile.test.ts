import { describe, expect, it } from "vitest";
import { activityTotals, demoDatabase, getOrderDetails, validateDatabase } from "./domain";
import { durationText, mobileSnapshotSchema, nativeRouteUrl, routeUrl } from "./mobile";

describe("app técnico", () => {
  it("preserva backups sem conta vinculada e sem GPS", () => {
    const data = demoDatabase();
    const old = { ...data, orders: data.orders.map(({ technicianUserId: _user, ...order }) => order) };
    expect(validateDatabase(old).orders[0].technicianUserId).toBe("");
    expect(() => validateDatabase({
      ...data, orders: [{ ...data.orders[0], technicianUserId: "texto-livre" }],
    })).toThrow();
  });
  it("codifica o destino em ambos os provedores", () => {
    const address = "Rua São José, 10 & Centro";
    expect(new URL(routeUrl(address, "google")).searchParams.get("destination")).toBe(address);
    expect(new URL(routeUrl(address, "waze")).searchParams.get("q")).toBe(address);
    expect(() => routeUrl(" ", "waze")).toThrow();
    expect(nativeRouteUrl(address, "google")).toBe(`google.navigation:q=${encodeURIComponent(address)}&mode=d`);
    expect(new URL(nativeRouteUrl(address, "waze")).searchParams.get("q")).toBe(address);
    expect(() => nativeRouteUrl("", "google")).toThrow();
  });
  it("calcula atendimento descontando pausas, sem contabilizar após saída", () => {
    const kinds = ["Check-in", "Pausa", "Retorno", "Check-out"] as const;
    const activities = kinds.map((kind, index) => ({
      id: String(index), kind, at: new Date(Date.UTC(2026, 9, 9, 8, index * 10)).toISOString(),
      technician: "Técnico", reason: kind === "Pausa" ? "Intervalo" : "", justification: "",
      origin: "Android" as const,
      ...(kind === "Check-in" || kind === "Check-out" ? { location: { latitude: -23, longitude: -46, accuracy: 15, capturedAt: new Date(Date.UTC(2026, 9, 9, 8, index * 10)).toISOString() } } : {}),
    }));
    const base = demoDatabase().orders[0];
    const details = getOrderDetails({ ...base, details: { ...getOrderDetails(base), activities } });
    const totals = activityTotals(details.activities, Date.UTC(2026, 9, 9, 18));
    expect(durationText(totals.work)).toBe("00:20:00");
    expect(durationText(totals.pause)).toBe("00:10:00");
  });
  it("rejeita coordenadas fora dos limites", () => {
    const payload = demoDatabase();
    payload.orders[0].details = {
      ...getOrderDetails(payload.orders[0]),
      activities: [{ id: "gps", kind: "Check-in", at: "2026-10-09T08:00:00.000Z", technician: "Técnico", reason: "", justification: "", origin: "Android", location: { latitude: 91, longitude: 0, accuracy: 1, capturedAt: "2026-10-09T08:00:00.000Z" } }],
    };
    expect(() => mobileSnapshotSchema.parse({ payload, revision: 1, name: "Técnico", role: "technician" })).toThrow();
  });
});
