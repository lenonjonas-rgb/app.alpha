import { localDay, shiftDay, validateDatabase } from "./domain";
import type { Database, MaintenanceContract, MaintenanceEquipmentType, OrderDetails } from "./domain";
import { maintenanceContractSchema, maintenanceEquipmentTypeSchema } from "./domain";
import { monthlyDueDate } from "./financeSchema";

export function maintenanceContractLifecycle(contract: MaintenanceContract) {
  return contract.events.at(-1)?.status ?? "Ativo";
}

export function maintenanceContractStatus(contract: MaintenanceContract, today = localDay()) {
  const lifecycle = maintenanceContractLifecycle(contract);
  if (lifecycle !== "Ativo") return lifecycle;
  if (contract.startsOn > today) return "Vigência futura";
  if (contract.endsOn < today) return "Vencido";
  return "Ativo";
}

export function saveMaintenanceEquipmentType(data: Database, input: MaintenanceEquipmentType) {
  const item = maintenanceEquipmentTypeSchema.parse(input);
  if (data.maintenanceEquipmentTypes.some((previous) => previous.id !== item.id &&
    previous.name.toLocaleLowerCase("pt-BR") === item.name.toLocaleLowerCase("pt-BR")))
    throw new Error("Já existe um tipo de equipamento com este nome.");
  return validateDatabase({
    ...data,
    maintenanceEquipmentTypes: [...data.maintenanceEquipmentTypes.filter((previous) => previous.id !== item.id), item],
  });
}

export function clientMaintenanceEquipment(data: Database, clientId: string) {
  return data.equipment.filter((equipment) => equipment.clientId === clientId);
}

function intervalMonths(contract: MaintenanceContract) {
  return contract.visitInterval.kind === "Mensal" ? 1 : contract.visitInterval.kind === "Semestral" ? 6 : 0;
}

function visitDateAt(contract: MaintenanceContract, index: number) {
  if (contract.visitInterval.kind === "Mensal")
    return monthlyDueDate(contract.startsOn, index);
  if (contract.visitInterval.kind === "Semestral")
    return monthlyDueDate(contract.startsOn, index * 6);
  const days = contract.visitInterval.kind === "Quinzenal" ? 15 : contract.visitInterval.days;
  return shiftDay(contract.startsOn, index * days);
}

function visitIndexAtOrBefore(contract: MaintenanceContract, date: string) {
  if (contract.visitInterval.kind === "Dias" || contract.visitInterval.kind === "Quinzenal") {
    const interval = contract.visitInterval.kind === "Quinzenal" ? 15 : contract.visitInterval.days;
    const elapsed = Math.floor((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${contract.startsOn}T12:00:00Z`)) / 86_400_000);
    return Math.max(0, Math.floor(elapsed / interval));
  }
  const step = intervalMonths(contract);
  const dateMonth = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
  const startMonth = Number(contract.startsOn.slice(0, 4)) * 12 + Number(contract.startsOn.slice(5, 7));
  return Math.max(0, Math.floor((dateMonth - startMonth) / step));
}

export function plannedMaintenanceVisits(contract: MaintenanceContract, from: string, through: string) {
  if (through < from) throw new Error("O fim do período não pode anteceder o início.");
  let index = visitIndexAtOrBefore(contract, from);
  while (visitDateAt(contract, index) < from) index++;
  const visits: string[] = [];
  for (let date = visitDateAt(contract, index); date <= through && date <= contract.endsOn; index++, date = visitDateAt(contract, index)) {
    if (visits.length >= 1000) throw new Error("O período selecionado contém mais de 1.000 pré-agendamentos.");
    visits.push(date);
  }
  return visits;
}

export function maintenanceVisitAlerts(data: Database, today = localDay()) {
  const through = shiftDay(today, 5);
  const scheduled = new Map<string, Set<string>>();
  data.orders.forEach((order) => {
    const linked = order.details?.maintenanceContract;
    if (!linked || order.details?.archived) return;
    const dates = scheduled.get(linked.id) ?? new Set<string>();
    dates.add(order.date);
    scheduled.set(linked.id, dates);
  });
  const alerts = data.maintenanceContracts.flatMap((contract) => {
    if (maintenanceContractLifecycle(contract) !== "Ativo") return [];
    const scheduledDates = scheduled.get(contract.id) ?? new Set<string>();
    let index = visitIndexAtOrBefore(contract, contract.endsOn < today ? contract.endsOn : today);
    let overdue: string | undefined;
    for (let scanned = 0; index >= 0 && scanned <= scheduledDates.size; scanned++, index--) {
      const date = visitDateAt(contract, index);
      if (date < contract.startsOn) break;
      if (date < today && !scheduledDates.has(date)) {
        overdue = date;
        break;
      }
    }
    const upcoming = plannedMaintenanceVisits(contract, today, through)
      .filter((date) => !scheduledDates.has(date))
      .map((date) => ({ contract, date, daysUntil: Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) }));
    return [...(overdue ? [{ contract, date: overdue, daysUntil: Math.round((Date.parse(`${overdue}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) }] : []), ...upcoming];
  });
  return alerts.sort((left, right) => Math.abs(left.daysUntil) - Math.abs(right.daysUntil)).slice(0, 100);
}

export function saveMaintenanceContract(data: Database, input: MaintenanceContract, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme os dados e a vigência do contrato.");
  if (!input.equipmentIds.length) throw new Error("Selecione ao menos uma unidade/equipamento coberto.");
  const contract = maintenanceContractSchema.parse(input);
  if (contract.events.length || data.maintenanceContracts.some((item) => item.id === contract.id))
    throw new Error("Contrato já cadastrado ou com histórico inicial inválido.");
  const client = data.clients.find((item) => item.id === contract.clientId && item.active);
  if (!client) throw new Error("Selecione um cliente ativo para o contrato.");
  if (new Set(contract.equipmentIds).size !== contract.equipmentIds.length ||
    contract.equipmentIds.some((id) => !data.equipment.some((item) => item.id === id && item.clientId === client.id)))
    throw new Error("Selecione somente unidades/equipamentos vinculados ao cliente.");
  if (contract.equipmentTypeIds.some((id) => !data.maintenanceEquipmentTypes.some((item) => item.id === id && item.active)))
    throw new Error("Selecione somente tipos de equipamento ativos.");
  return validateDatabase({ ...data, maintenanceContracts: [...data.maintenanceContracts, contract] });
}

export function addMaintenanceContractCharge(details: OrderDetails, contract: MaintenanceContract): OrderDetails {
  if (details.maintenanceContract) throw new Error("Esta OS já tem um contrato vinculado.");
  return {
    ...details,
    maintenanceContract: { id: contract.id, monthlyAmount: contract.monthlyAmount },
    costs: [...details.costs, {
      id: `maintenance-contract:${contract.id}`,
      name: `Contrato: ${contract.name}`,
      value: contract.monthlyAmount,
    }],
  };
}

export function changeMaintenanceContractStatus(
  data: Database,
  expected: MaintenanceContract,
  status: "Ativo" | "Suspenso" | "Cancelado",
  reason: string,
  confirmed: boolean,
) {
  if (!confirmed) throw new Error("Confirme a alteração de situação do contrato.");
  const current = data.maintenanceContracts.find((item) => item.id === expected.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(expected))
    throw new Error("Contrato alterado. Atualize e revise novamente.");
  const previousStatus = maintenanceContractLifecycle(current);
  if (previousStatus === "Cancelado" || previousStatus === status)
    throw new Error("Transição indisponível; cancelamento do contrato é definitivo.");
  const updated = maintenanceContractSchema.parse({
    ...current,
    events: [...current.events, { status, reason, at: new Date().toISOString() }],
  });
  return validateDatabase({
    ...data,
    maintenanceContracts: data.maintenanceContracts.map((item) => item.id === updated.id ? updated : item),
  });
}
