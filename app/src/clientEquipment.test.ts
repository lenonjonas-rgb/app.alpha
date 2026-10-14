import { afterEach, describe, expect, it, vi } from "vitest";
import { demoDatabase, getOrderDetails, validateDatabase } from "./domain";
import { clientEquipmentHistory, generateEquipmentCode, linkClientEquipment, saveEquipmentBrand, saveEquipmentModel, selectEquipmentModel } from "./equipmentCatalogData";

function fixture() {
  let data = saveEquipmentBrand(demoDatabase(), { id: "konnen", name: "Konnen", archived: false });
  data = saveEquipmentModel(data, { id: "e8", brandId: "konnen", line: "Cardio", name: "Esteira E8", category: "Esteiras", notes: "", archived: false });
  return data;
}

afterEach(() => vi.restoreAllMocks());

describe("linhas e equipamentos dos clientes", () => {
  it("persiste a linha separada da categoria e permite o mesmo nome em linhas diferentes", () => {
    const data = fixture();
    const second = saveEquipmentModel(data, { ...data.equipmentModels[0], id: "e8-other", line: "Profissional" });
    expect(selectEquipmentModel(second, "e8")).toMatchObject({ line: "Cardio", category: "Esteiras" });
    expect(() => saveEquipmentModel(second, { ...second.equipmentModels[0], id: "duplicate", line: " CARDIO " })).toThrow("marca e linha");
    expect(validateDatabase(JSON.parse(JSON.stringify(second))).equipmentModels[0].line).toBe("Cardio");
  });
  it("transforma quantidade 2 em duas unidades e reutiliza o catálogo em outro cliente", () => {
    const data = fixture();
    const clientA = data.clients[0].id;
    const clientB = data.clients[1].id;
    const linked = linkClientEquipment(data, clientA, [{ modelId: "e8", quantity: 2 }]);
    const both = linkClientEquipment(linked, clientB, [{ modelId: "e8", quantity: 2 }]);
    const units = both.equipment.filter((item) => item.model?.modelId === "e8");
    expect(units).toHaveLength(4);
    expect(units.filter((item) => item.clientId === clientA)).toHaveLength(2);
    expect(units.filter((item) => item.clientId === clientB)).toHaveLength(2);
    expect(new Set(units.map((item) => item.id)).size).toBe(4);
    expect(new Set(units.map((item) => item.assetCode)).size).toBe(4);
    expect(units.every((item) => item.assetCode?.startsWith("EQ-") && item.serial === item.assetCode)).toBe(true);
    expect(units.every((item) => item.model?.line === "Cardio")).toBe(true);
    expect(both.equipmentModels).toEqual(data.equipmentModels);
    expect(both.equipmentBrands).toEqual(data.equipmentBrands);
    expect(data.equipment).toHaveLength(3);
    expect(validateDatabase(JSON.parse(JSON.stringify(both))).equipment).toEqual(both.equipment);
  });
  it("permite vários modelos na mesma operação e novos vínculos posteriores do mesmo modelo", () => {
    let data = fixture();
    data = saveEquipmentModel(data, { ...data.equipmentModels[0], id: "bike", name: "Bicicleta" });
    const linked = linkClientEquipment(data, data.clients[0].id, [{ modelId: "e8", quantity: 2 }, { modelId: "bike", quantity: 3 }]);
    const more = linkClientEquipment(linked, data.clients[0].id, [{ modelId: "e8", quantity: 1 }]);
    expect(more.equipment.filter((item) => item.model?.modelId === "e8")).toHaveLength(3);
    expect(more.equipment.filter((item) => item.model?.modelId === "bike")).toHaveLength(3);
  });
  it("gera outro código em colisão e falha explicitamente se o gerador continuar repetindo", () => {
    const data = fixture();
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    data.equipment[0].assetCode = `EQ-${first.toUpperCase()}`;
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(first).mockReturnValue(second);
    expect(generateEquipmentCode(data.equipment)).toBe(`EQ-${second.toUpperCase()}`);
    uuid.mockReturnValue(first);
    expect(() => generateEquipmentCode(data.equipment)).toThrow("código único");
    expect(() => generateEquipmentCode([], new Set([`EQ-${first.toUpperCase()}`]))).toThrow("código único");
  });
  it("impede códigos repetidos entre clientes inclusive ao importar dados", () => {
    const data = fixture();
    data.equipment[0].assetCode = "EQ-UNICO";
    data.equipment[1].assetCode = "eq-unico";
    expect(() => validateDatabase(data)).toThrow("duplicado entre os clientes");
  });
  it.each([0, -1, 1.5, 10001, NaN])("rejeita quantidade inválida %s sem criar unidades", (quantity) => {
    const data = fixture();
    expect(() => linkClientEquipment(data, data.clients[0].id, [{ modelId: "e8", quantity }])).toThrow();
    expect(data.equipment).toHaveLength(3);
  });
  it("valida cliente, catálogo ativo e seleção antes de salvar o lote", () => {
    const data = fixture();
    expect(() => linkClientEquipment(data, "missing", [{ modelId: "e8", quantity: 1 }])).toThrow("cliente ativo");
    expect(() => linkClientEquipment(data, data.clients[0].id, [])).toThrow();
    expect(() => linkClientEquipment(data, data.clients[0].id, [{ modelId: "e8", quantity: 1 }, { modelId: "e8", quantity: 2 }])).toThrow("duplicado");
    expect(() => linkClientEquipment(data, data.clients[0].id, [{ modelId: "e8", quantity: 1 }, { modelId: "missing", quantity: 2 }])).toThrow("indisponível");
    data.equipmentModels[0].archived = true;
    expect(() => linkClientEquipment(data, data.clients[0].id, [{ modelId: "e8", quantity: 1 }])).toThrow("indisponível");
    data.equipmentModels[0].archived = false;
    data.equipmentBrands[0].archived = true;
    expect(() => linkClientEquipment(data, data.clients[0].id, [{ modelId: "e8", quantity: 1 }])).toThrow("indisponível");
    data.clients[0].active = false;
    expect(() => linkClientEquipment(data, data.clients[0].id, [{ modelId: "e8", quantity: 1 }])).toThrow("cliente ativo");
  });
  it("mantém modelos legados sem linha e unidades antigas sem código compatíveis", () => {
    const data = fixture();
    delete data.equipmentModels[0].line;
    const linked = linkClientEquipment(data, data.clients[0].id, [{ modelId: "e8", quantity: 1 }]);
    expect(linked.equipment.at(-1)!.model?.line).toBe("");
    expect(linked.equipment[0].assetCode).toBeUndefined();
  });
});

describe("histórico por unidade do cliente", () => {
  it("mostra tarefas principais e associadas, incluindo arquivadas, sem misturar unidades do mesmo modelo", () => {
    const base = fixture();
    const data = linkClientEquipment(base, base.clients[0].id, [{ modelId: "e8", quantity: 2 }]);
    const [first, second] = data.equipment.slice(-2);
    const order = data.orders[0];
    data.orders = [
      { ...order, id: "first", code: "OS-1001", equipmentId: first.id, date: "2026-10-01", status: "Finalizada", details: { ...getOrderDetails(order), report: "Troca da correia", archived: true } },
      { ...order, id: "associated", code: "OS-1002", equipmentId: second.id, date: "2026-10-05", details: { ...getOrderDetails(order), equipmentIds: [first.id], report: "Lubrificação" } },
      { ...order, id: "second-only", code: "OS-1003", equipmentId: second.id, date: "2026-10-06" },
      { ...order, id: "generic", code: "OS-1004", equipmentId: "", details: { ...getOrderDetails(order), equipmentModels: [selectEquipmentModel(data, "e8")] } },
    ];
    expect(clientEquipmentHistory(data, first.clientId, first.id).map((item) => item.id)).toEqual(["associated", "first"]);
    expect(getOrderDetails(clientEquipmentHistory(data, first.clientId, first.id)[1]).report).toBe("Troca da correia");
    expect(clientEquipmentHistory(data, second.clientId, second.id).map((item) => item.id)).toEqual(["second-only", "associated"]);
    expect(() => clientEquipmentHistory(data, data.clients[1].id, first.id)).toThrow("não vinculado");
  });
});
