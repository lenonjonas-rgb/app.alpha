import { describe, expect, it } from "vitest";
import { demoDatabase, getOrderDetails, orderServiceAddress, replicateOrder, serviceLocationSchema, validateDatabase } from "./domain";
import { mobileSnapshotSchema, routeUrl } from "./mobile";

const location = {
  useClientAddress: false, postalCode: "01001000", street: "Praça da Sé", number: "10",
  complement: "Sala 2", neighborhood: "Sé", city: "São Paulo", state: "SP",
};

describe("local e responsável pelo atendimento", () => {
  it("preserva a compatibilidade de tarefas antigas e a opção de usar o cadastro", () => {
    const data = demoDatabase();
    const order = data.orders[0];
    const client = data.clients.find((item) => item.id === order.clientId)!;
    expect(orderServiceAddress(order, client)).toBe(client.address);
    order.details = { ...getOrderDetails(order), serviceLocation: { ...location, useClientAddress: true } };
    expect(orderServiceAddress(order, { address: "Cadastro atualizado" })).toBe("Cadastro atualizado");
  });
  it("persiste e projeta o local e responsável no mobile e nas rotas sem alterar o cliente", () => {
    const data = demoDatabase();
    const clientBefore = structuredClone(data.clients);
    const order = data.orders[0];
    order.details = { ...getOrderDetails(order), serviceLocation: location, responsibleName: "Maria", responsiblePhone: "11999998888" };
    const restored = validateDatabase(JSON.parse(JSON.stringify(data)));
    const mobile = mobileSnapshotSchema.parse({ payload: restored, revision: 1, role: "technician", name: "Técnico" });
    expect(getOrderDetails(mobile.payload.orders[0])).toMatchObject({
      serviceLocation: location, responsibleName: "Maria", responsiblePhone: "11999998888",
    });
    const address = orderServiceAddress(restored.orders[0], { address: "Outro endereço" });
    expect(address).toBe("Praça da Sé, 10 · Sala 2 · Sé · São Paulo - SP · CEP 01001000");
    expect(decodeURIComponent(routeUrl(address, "google"))).toContain(address);
    expect(decodeURIComponent(routeUrl(address, "waze"))).toContain(address);
    expect(restored.clients).toEqual(clientBefore);
    const replicated = replicateOrder(restored, order.id, "2026-10-20", "09:00");
    expect(getOrderDetails(replicated.orders.at(-1)!)).toMatchObject({ serviceLocation: location, responsibleName: "Maria", responsiblePhone: "11999998888" });
  });
  it("valida campos necessários somente para o endereço específico e permite complemento vazio", () => {
    expect(serviceLocationSchema.parse({ ...location, complement: "", number: "S/N" }).number).toBe("S/N");
    for (const key of ["postalCode", "street", "number", "city", "state"] as const)
      expect(serviceLocationSchema.safeParse({ ...location, [key]: "" }).success).toBe(false);
    expect(serviceLocationSchema.safeParse({ ...location, useClientAddress: true, postalCode: "", street: "", number: "", city: "", state: "" }).success).toBe(true);
  });
});
