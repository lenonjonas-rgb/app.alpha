import { afterEach, describe, expect, it, vi } from "vitest";
import { activityTotals, demoDatabase, getOrderDetails, shiftDay, validateDatabase } from "./domain";
import type { Order } from "./domain";
import { durationText, mobileSnapshotSchema, nativeRouteUrl, routeUrl, technicianAgendaOrders } from "./mobile";
import * as mobile from "./mobile";
import { prepareQuestionnairePhoto } from "./questionnairePhoto";

const today = "2026-10-10";
const baseOrder = demoDatabase().orders[0];
const agendaOrders: Order[] = (["2026-10-09", today, "2026-10-11"] as const).flatMap((date) =>
  (["Aberta", "Em atendimento", "Pausada", "Finalizada"] as const).map((status, index) => ({
    ...baseOrder, id: `${date}-${status}`, date, status, time: `${String(index + 8).padStart(2, "0")}:00`,
    details: { ...getOrderDetails(baseOrder), archived: false },
  })),
);
const archivedOrder: Order = {
  ...agendaOrders[0], id: "archived",
  details: { ...getOrderDetails(agendaOrders[0]), archived: true },
};

describe("app técnico", () => {
  it("aceita o snapshot de cobrança da OS sem receber o cadastro privado dos contratos", () => {
    const payload = demoDatabase();
    const details = getOrderDetails(payload.orders[0]);
    payload.orders[0].details = {
      ...details,
      maintenanceContract: { id: "private-contract", monthlyAmount: 25000 },
      costs: [...details.costs, { id: "maintenance-contract:private-contract", name: "Contrato", value: 25000 }],
    };
    const snapshot = { revision: 1, name: "Tecnico", role: "technician", payload };
    const parsed = mobileSnapshotSchema.parse(snapshot);
    expect(parsed.payload.maintenanceContracts).toEqual([]);
    expect(getOrderDetails(parsed.payload.orders[0]).maintenanceContract?.monthlyAmount).toBe(25000);
    expect(() => validateDatabase(payload)).toThrow("OS com cobrança de contrato inválida");
    const missing = structuredClone(snapshot);
    missing.payload.orders[0].details!.costs = [];
    expect(() => mobileSnapshotSchema.parse(missing)).toThrow("OS com cobrança de contrato inválida");
    const mismatched = structuredClone(snapshot);
    mismatched.payload.orders[0].details!.costs.at(-1)!.value = 1;
    expect(() => mobileSnapshotSchema.parse(mismatched)).toThrow("OS com cobrança de contrato inválida");
    const duplicate = structuredClone(snapshot);
    duplicate.payload.orders[0].details!.costs.push({ id: "maintenance-contract:private-contract", name: "Duplicado", value: 25000 });
    expect(() => mobileSnapshotSchema.parse(duplicate)).toThrow();
  });

  it("oculta finalizadas no início sem remover o histórico da agenda", () => {
    const orders = [...agendaOrders, { ...archivedOrder, date: today }];
    expect(technicianAgendaOrders(orders, "home", today, today).map((order) => order.id)).toEqual([
      `${today}-Aberta`, `${today}-Em atendimento`, `${today}-Pausada`,
    ]);
    const completed = agendaOrders.find((order) => order.date === today && order.status === "Finalizada")!;
    expect(technicianAgendaOrders(orders, "day", today, today)).toContain(completed);
    const finished = orders.map((order) => ({ ...order, status: "Finalizada" as const }));
    expect(technicianAgendaOrders(finished, "home", today, today)).toEqual([]);
  });
  it("mostra somente tarefas da data selecionada, inclusive finalizadas, sem arquivadas", () => {
    const orders = [...agendaOrders, archivedOrder];
    expect(technicianAgendaOrders(orders, "day", today, today).map((order) => order.id)).toEqual(
      agendaOrders.filter((order) => order.date === today).map((order) => order.id),
    );
    const previous = shiftDay(today, -1);
    expect(technicianAgendaOrders(orders, "day", previous, today).map((order) => order.id)).toEqual(
      agendaOrders.filter((order) => order.date === previous).map((order) => order.id),
    );
    expect(technicianAgendaOrders(orders, "day", shiftDay(previous, 1), today)).toEqual(
      technicianAgendaOrders(orders, "day", today, today),
    );
    expect(technicianAgendaOrders(orders, "day", "2026-10-08", today)).toEqual([]);
  });

  describe("captura de foto de questionário com carimbo obrigatório", () => {
    const attachment = { id: "photo", name: "foto.jpg", mime: "image/jpeg" as const, size: 3, data: "data:image/jpeg;base64,YWJj", at: "2026-10-10T12:30:00.000Z" };
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    it("sem metadados usa diretamente prepareAttachment, sem solicitar GPS", async () => {
      const prepare = vi.spyOn(mobile, "prepareAttachment").mockResolvedValue(attachment);
      const gps = vi.spyOn(mobile, "captureLocation");
      const file = new File(["foto"], "foto.jpg", { type: "image/jpeg" });
      expect(await prepareQuestionnairePhoto(file, false)).toEqual(attachment);
      expect(prepare).toHaveBeenCalledWith(file);
      expect(gps).not.toHaveBeenCalled();
    });

    it("desenha coordenadas e data/hora na imagem antes de preparar o anexo, mesmo em fotos pequenas", async () => {
      vi.spyOn(mobile, "captureLocation").mockResolvedValue({
        latitude: -23.5, longitude: -46.6, accuracy: 12, capturedAt: attachment.at,
      });
      const prepare = vi.spyOn(mobile, "prepareAttachment").mockResolvedValue(attachment);
      const bitmap = { width: 100, height: 50, close: vi.fn() };
      vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
      const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), fillStyle: "", font: "" };
      const canvas = {
        width: 0, height: 0, getContext: vi.fn().mockReturnValue(context),
        toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(["jpg"], { type: "image/jpeg" }))),
      };
      vi.stubGlobal("document", { createElement: vi.fn().mockReturnValue(canvas) });
      expect(await prepareQuestionnairePhoto(new File(["foto"], "foto.png", { type: "image/png" }), true)).toEqual(attachment);
      expect(context.drawImage).toHaveBeenCalled();
      expect(context.fillText.mock.calls[0][0]).toContain("-23.500000, -46.600000");
      expect(context.fillText.mock.calls[0][0]).toContain("12 m");
      expect(context.fillText.mock.calls[1][0]).toContain(attachment.at);
      expect(canvas.width).toBeGreaterThanOrEqual(640);
      expect(canvas.height).toBeGreaterThan(bitmap.height);
      expect(prepare.mock.calls[0][0].type).toBe("image/jpeg");
      expect(prepare.mock.calls[0][0].name).toBe("foto.jpg");
      expect(bitmap.close).toHaveBeenCalledOnce();
    });

    it("bloqueia explicitamente sem GPS e nunca envia foto sem o carimbo solicitado", async () => {
      vi.spyOn(mobile, "captureLocation").mockRejectedValue(new Error("GPS negado"));
      const prepare = vi.spyOn(mobile, "prepareAttachment");
      await expect(prepareQuestionnairePhoto(new File(["foto"], "foto.jpg", { type: "image/jpeg" }), true)).rejects.toThrow("carimbo");
      expect(prepare).not.toHaveBeenCalled();
    });

    it("bloqueia canvas indisponível e libera a imagem carregada", async () => {
      vi.spyOn(mobile, "captureLocation").mockResolvedValue({ latitude: 0, longitude: 0, accuracy: 1, capturedAt: attachment.at });
      const prepare = vi.spyOn(mobile, "prepareAttachment");
      const bitmap = { width: 100, height: 50, close: vi.fn() };
      vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
      vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
      await expect(prepareQuestionnairePhoto(new File(["foto"], "foto.jpg", { type: "image/jpeg" }), true)).rejects.toThrow("Canvas indisponível");
      expect(prepare).not.toHaveBeenCalled();
      expect(bitmap.close).toHaveBeenCalledOnce();
    });

    it("rejeita documentos e arquivos vazios antes da captura", async () => {
      const gps = vi.spyOn(mobile, "captureLocation");
      await expect(prepareQuestionnairePhoto(new File(["pdf"], "nota.pdf", { type: "application/pdf" }), true)).rejects.toThrow("exige uma foto");
      await expect(prepareQuestionnairePhoto(new File([], "foto.jpg", { type: "image/jpeg" }), true)).rejects.toThrow("Foto vazia");
      expect(gps).not.toHaveBeenCalled();
    });
  });
  it("atrasadas inclui abertas, iniciadas e pausadas de dias passados, mas nao finalizadas", () => {
    expect(technicianAgendaOrders([...agendaOrders, archivedOrder], "overdue", today, today).map((order) => order.id)).toEqual([
      "2026-10-09-Aberta", "2026-10-09-Em atendimento", "2026-10-09-Pausada",
    ]);
  });
  it("em execucao inclui somente atendimentos iniciados e pausados, independentemente da data", () => {
    expect(technicianAgendaOrders([...agendaOrders, archivedOrder], "running", today, today).map((order) => order.id)).toEqual([
      "2026-10-09-Em atendimento", "2026-10-09-Pausada",
      "2026-10-10-Em atendimento", "2026-10-10-Pausada",
      "2026-10-11-Em atendimento", "2026-10-11-Pausada",
    ]);
  });
  it("ordena por data e hora sem modificar a lista original", () => {
    const orders = [...agendaOrders].reverse();
    const original = [...orders];
    expect(technicianAgendaOrders(orders, "day", today, today).map((order) => order.time)).toEqual([
      "08:00", "09:00", "10:00", "11:00",
    ]);
    expect(orders).toEqual(original);
  });
  it("recalcula atrasadas e tarefas de hoje quando muda o dia", () => {
    const nextDay = shiftDay(today, 1);
    expect(technicianAgendaOrders(agendaOrders, "overdue", nextDay, nextDay)).toHaveLength(6);
    expect(technicianAgendaOrders(agendaOrders, "day", nextDay, nextDay).every((order) => order.date === nextDay)).toBe(true);
  });
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
