import { equipmentBrandSchema, equipmentModelSchema, getOrderDetails, makeId, validateDatabase } from "./domain";
import type { Database, EquipmentBrand, EquipmentModel, EquipmentSelection } from "./domain";
import { z } from "zod";

export function saveEquipmentBrand(data: Database, input: EquipmentBrand): Database {
  const brand = equipmentBrandSchema.parse(input);
  return validateDatabase({
    ...data,
    equipmentBrands: data.equipmentBrands.some((item) => item.id === brand.id)
      ? data.equipmentBrands.map((item) => item.id === brand.id ? brand : item)
      : [...data.equipmentBrands, brand],
  });
}

export function saveEquipmentModel(data: Database, input: EquipmentModel): Database {
  const model = equipmentModelSchema.parse(input);
  if (!data.equipmentBrands.some((item) => item.id === model.brandId && !item.archived))
    throw new Error("Selecione uma marca ativa.");
  return validateDatabase({
    ...data,
    equipmentModels: data.equipmentModels.some((item) => item.id === model.id)
      ? data.equipmentModels.map((item) => item.id === model.id ? model : item)
      : [...data.equipmentModels, model],
  });
}

export function selectEquipmentModel(data: Database, modelId: string): EquipmentSelection {
  const model = data.equipmentModels.find((item) => item.id === modelId && !item.archived);
  const brand = data.equipmentBrands.find((item) => item.id === model?.brandId && !item.archived);
  if (!model || !brand) throw new Error("Modelo de equipamento indisponível. Selecione um modelo ativo.");
  return {
    modelId: model.id, brandId: brand.id, brand: brand.name, name: model.name, category: model.category,
    line: model.line ?? "",
    quantity: 1, purpose: "Manutenção",
  };
}

export function generateEquipmentCode(equipment: Database["equipment"], reserved: Set<string> = new Set()) {
  const existing = new Set(equipment.flatMap((item) => [item.serial.toUpperCase(), item.assetCode?.toUpperCase() ?? ""]));
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = `EQ-${makeId().toUpperCase()}`;
    if (!existing.has(code) && !reserved.has(code)) return code;
  }
  throw new Error("Não foi possível gerar um código único para o equipamento. Tente novamente.");
}

const linksSchema = z.array(z.object({
  modelId: z.string().min(1),
  quantity: z.number().int().min(1).max(10000),
})).min(1);

export function linkClientEquipment(data: Database, clientId: string, input: { modelId: string; quantity: number }[]): Database {
  const client = data.clients.find((item) => item.id === clientId);
  if (!client?.active) throw new Error("Selecione um cliente ativo para vincular equipamentos.");
  const links = linksSchema.parse(input);
  if (new Set(links.map((item) => item.modelId)).size !== links.length)
    throw new Error("Modelo duplicado na seleção. Ajuste a quantidade.");
  const codes = new Set<string>();
  const equipment = links.flatMap((link) => {
    const { quantity: _quantity, purpose: _purpose, ...model } = selectEquipmentModel(data, link.modelId);
    return Array.from({ length: link.quantity }, () => {
      const assetCode = generateEquipmentCode(data.equipment, codes);
      codes.add(assetCode);
      return {
        id: makeId(), assetCode, serial: assetCode, clientId,
        name: model.name, category: model.category, warranty: "", notes: "", model: { ...model },
      };
    });
  });
  return validateDatabase({ ...data, equipment: [...data.equipment, ...equipment] });
}

export function clientEquipmentHistory(data: Database, clientId: string, equipmentId: string) {
  if (!data.equipment.some((item) => item.id === equipmentId && item.clientId === clientId))
    throw new Error("Equipamento não vinculado a este cliente.");
  return data.orders.filter((order) => order.clientId === clientId &&
    (order.equipmentId === equipmentId || getOrderDetails(order).equipmentIds.includes(equipmentId)))
    .toSorted((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
}
