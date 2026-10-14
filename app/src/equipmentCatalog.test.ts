import { describe, expect, it } from "vitest";
import { convertQuote, demoDatabase, getOrderDetails, replicateOrder, validateDatabase } from "./domain";
import { saveEquipmentBrand, saveEquipmentModel, selectEquipmentModel } from "./equipmentCatalogData";
import { mobileSnapshotSchema } from "./mobile";

function fixture() {
  let data = saveEquipmentBrand(demoDatabase(), { id: "brand", name: "Marca teste", archived: false });
  data = saveEquipmentModel(data, { id: "model", brandId: "brand", name: "Esteira X", category: "Cardio", notes: "Modelo de catálogo", archived: false });
  return data;
}

describe("catálogo de marcas e modelos", () => {
  it("abre bases antigas sem catálogo e mantém seleções opcionais", () => {
    const { equipmentBrands: _brands, equipmentModels: _models, ...legacy } = demoDatabase();
    const data = validateDatabase(legacy);
    expect(data.equipmentBrands).toEqual([]);
    expect(data.equipmentModels).toEqual([]);
    expect(data.equipment[0].model).toBeUndefined();
    expect(getOrderDetails(data.orders[0]).equipmentModels).toEqual([]);
    expect(data.quotes[0].equipmentModels).toEqual([]);
  });
  it("cadastra a marca antes dos modelos e mantém modelos dentro da marca", () => {
    const data = fixture();
    expect(data.equipmentBrands).toHaveLength(1);
    expect(data.equipmentModels[0]).toMatchObject({ brandId: "brand", name: "Esteira X" });
    expect(() => saveEquipmentModel(data, { ...data.equipmentModels[0], brandId: "missing" })).toThrow("marca ativa");
    expect(() => validateDatabase({ ...data, equipmentBrands: [] })).toThrow("marca válida");
  });
  it("impede nomes duplicados por marca sem impedir o mesmo modelo em outra marca", () => {
    const data = fixture();
    expect(() => saveEquipmentBrand(data, { id: "second", name: " MARCA TESTE ", archived: false })).toThrow("Já existe uma marca");
    expect(() => saveEquipmentModel(data, { ...data.equipmentModels[0], id: "second", name: " ESTEIRA X " })).toThrow("Já existe um modelo");
    const other = saveEquipmentBrand(data, { id: "other", name: "Outra marca", archived: false });
    expect(saveEquipmentModel(other, { ...data.equipmentModels[0], id: "other-model", brandId: "other" }).equipmentModels).toHaveLength(2);
  });
  it("edita e arquiva sem remover cadastros ou permitir novas seleções arquivadas", () => {
    const data = fixture();
    const selection = selectEquipmentModel(data, "model");
    data.equipment[0].model = selection;
    data.orders[0].details = { ...getOrderDetails(data.orders[0]), equipmentModels: [selection] };
    data.quotes[0].equipmentModels = [selection];
    const renamed = saveEquipmentModel(data, { ...data.equipmentModels[0], name: "Novo nome" });
    expect(renamed.equipment[0].model?.name).toBe("Esteira X");
    expect(renamed.quotes[0].equipmentModels[0].name).toBe("Esteira X");
    const archived = saveEquipmentModel(renamed, { ...renamed.equipmentModels[0], archived: true });
    expect(() => selectEquipmentModel(archived, "model")).toThrow("indisponível");
    expect(archived.orders).toEqual(renamed.orders);
    const restored = saveEquipmentModel(archived, { ...archived.equipmentModels[0], archived: false });
    expect(selectEquipmentModel(restored, "model").name).toBe("Novo nome");
    const brandArchived = saveEquipmentBrand(restored, { ...restored.equipmentBrands[0], archived: true });
    expect(() => selectEquipmentModel(brandArchived, "model")).toThrow("indisponível");
    expect(() => saveEquipmentModel(brandArchived, brandArchived.equipmentModels[0])).toThrow("marca ativa");
  });
  it("vincula modelos a clientes e permite tarefas e orçamentos sem unidade física cadastrada", () => {
    const data = fixture();
    const selection = selectEquipmentModel(data, "model");
    data.equipment[0].model = selection;
    data.orders[0].equipmentId = "";
    data.orders[0].details = { ...getOrderDetails(data.orders[0]), equipmentModels: [{ ...selection, quantity: 3, purpose: "Montagem" }] };
    data.quotes[0].equipmentModels = [{ ...selection, quantity: 2 }];
    const restored = validateDatabase(JSON.parse(JSON.stringify(data)));
    expect(restored.equipment[0].model).toMatchObject({ modelId: "model", brand: "Marca teste" });
    expect(getOrderDetails(restored.orders[0]).equipmentModels[0]).toMatchObject({ quantity: 3, purpose: "Montagem" });
    expect(restored.orders[0].equipmentId).toBe("");
    expect(restored.quotes[0].equipmentModels[0].quantity).toBe(2);
  });
  it("copia os equipamentos do orçamento aprovado para a OS e preserva seleções na réplica", () => {
    const data = fixture();
    data.quotes[0].status = "Aprovado";
    data.quotes[0].equipmentModels = [{ ...selectEquipmentModel(data, "model"), quantity: 4, purpose: "Montagem" }];
    const converted = convertQuote(data, data.quotes[0].id);
    const generated = converted.orders.at(-1)!;
    expect(getOrderDetails(generated).equipmentModels).toEqual(data.quotes[0].equipmentModels);
    expect(generated.equipmentId).toBe("");
    const replicated = replicateOrder(converted, generated.id, "2026-11-20", "09:00");
    expect(getOrderDetails(replicated.orders.at(-1)!).equipmentModels).toEqual(data.quotes[0].equipmentModels);
    getOrderDetails(generated).equipmentModels[0].quantity = 1;
    expect(data.quotes[0].equipmentModels[0].quantity).toBe(4);
  });
  it("valida quantidade e finalidade sem alterar regras de preço dos orçamentos", () => {
    const data = fixture();
    const selection = selectEquipmentModel(data, "model");
    for (const quantity of [0, -1, 0.5, 10001])
      expect(() => validateDatabase({ ...data, quotes: [{ ...data.quotes[0], equipmentModels: [{ ...selection, quantity }] }] })).toThrow();
    expect(() => validateDatabase({ ...data, quotes: [{ ...data.quotes[0], equipmentModels: [{ ...selection, purpose: "inválido" }] }] })).toThrow();
    expect(() => validateDatabase({ ...data, quotes: [{ ...data.quotes[0], equipmentModels: [selection], items: [] }] })).toThrow();
  });
  it("permite projetar o histórico de modelos no mobile sem expor o catálogo inteiro", () => {
    const data = fixture();
    const selection = selectEquipmentModel(data, "model");
    data.equipment[0].model = selection;
    data.orders[0].details = { ...getOrderDetails(data.orders[0]), equipmentModels: [selection] };
    const snapshot = mobileSnapshotSchema.parse({
      payload: { ...data, equipmentBrands: [], equipmentModels: [] },
      revision: 1, name: "Técnico", role: "technician",
    });
    expect(snapshot.payload.equipment[0].model?.brand).toBe("Marca teste");
    expect(getOrderDetails(snapshot.payload.orders[0]).equipmentModels[0]).toEqual(selection);
  });
});
