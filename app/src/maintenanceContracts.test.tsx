import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, getOrderDetails, orderValues, validateDatabase } from "./domain";
import type { MaintenanceContract } from "./domain";
import { billingItemSnapshots, splitBillingValues } from "./finance";
import { addMaintenanceContractCharge, changeMaintenanceContractStatus, clientMaintenanceEquipment, maintenanceContractLifecycle, maintenanceContractStatus,
  maintenanceVisitAlerts, plannedMaintenanceVisits, saveMaintenanceContract, saveMaintenanceEquipmentType } from "./maintenanceContracts";
import { MaintenanceContractsPanel } from "./MaintenanceContractsPanel";

const contract: MaintenanceContract = {
  id: "contract-1",
  name: "Manutenção anual",
  clientId: "demo-client-1",
  equipmentTypeIds: ["type-treadmill"],
  equipmentIds: ["demo-equipment-1"],
  coverage: "Duas visitas preventivas e mão de obra corretiva.",
  startsOn: "2026-01-01",
  endsOn: "2026-12-31",
  monthlyAmount: 25000,
  visitInterval: { kind: "Mensal" },
  createdAt: "2026-01-01T12:00:00.000Z",
  events: [],
};

function fixture() {
  return saveMaintenanceEquipmentType(demoDatabase(), { id: "type-treadmill", name: "Esteira", active: true });
}

describe("contratos de manutenção", () => {
  it("cadastra contrato confirmado para cliente ativo e unidades vinculadas, sem gerar OS ou financeiro", () => {
    const source = fixture(), data = saveMaintenanceContract(source, contract, true);
    expect(source.maintenanceContracts).toEqual([]);
    expect(data.maintenanceContracts).toEqual([contract]);
    expect(data.orders).toEqual(source.orders);
    expect(data.finance.entries).toEqual(source.finance.entries);
    expect(maintenanceContractStatus(contract, "2026-06-01")).toBe("Ativo");
    expect(validateDatabase(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it("preserva o anexo opcional do contrato assinado e o disponibiliza para baixar", () => {
    const signedAttachment = {
      id: "signed-contract-file",
      name: "contrato-assinado.pdf",
      mime: "application/pdf" as const,
      size: 8,
      data: "data:application/pdf;base64,JVBERi0=",
      at: "2026-01-01T12:00:00.000Z",
    };
    const data = saveMaintenanceContract(fixture(), { ...contract, signedAttachment }, true);
    expect(validateDatabase(JSON.parse(JSON.stringify(data))).maintenanceContracts[0].signedAttachment).toEqual(signedAttachment);
    const html = renderToStaticMarkup(<MaintenanceContractsPanel data={data} commit={() => {}} onSuccess={() => {}} />);
    expect(html).toContain("Contrato assinado: contrato-assinado.pdf");
    expect(html).toContain('download="contrato-assinado.pdf"');
    expect(() => saveMaintenanceContract(fixture(), {
      ...contract, signedAttachment: { ...signedAttachment, size: 500_001 },
    }, true)).toThrow();
  });

  it("cadastra tipos próprios reutilizáveis e preserva contratos ao inativar um tipo", () => {
    let data = fixture();
    data = saveMaintenanceContract(data, contract, true);
    data = saveMaintenanceEquipmentType(data, { id: "type-treadmill", name: "Esteira", active: false });
    expect(data.maintenanceEquipmentTypes[0].active).toBe(false);
    expect(data.maintenanceContracts[0].equipmentTypeIds).toEqual(["type-treadmill"]);
    expect(() => saveMaintenanceEquipmentType(data, { id: "other", name: " esteira ", active: true })).toThrow("Já existe");
  });

  it("busca as unidades já vinculadas ao cliente selecionado, sem misturar equipamentos de outros clientes", () => {
    const data = demoDatabase();
    expect(clientMaintenanceEquipment(data, "demo-client-1").map((item) => item.id)).toEqual(["demo-equipment-1"]);
    expect(clientMaintenanceEquipment(data, "demo-client-2").map((item) => item.id)).toEqual(["demo-equipment-2"]);
    expect(clientMaintenanceEquipment(data, "missing-client")).toEqual([]);
  });

  it("gera visitas quinzenais, mensais e semestrais com calendário e mantém o dia do início", () => {
    expect(plannedMaintenanceVisits({ ...contract, startsOn: "2026-01-31", visitInterval: { kind: "Mensal" } }, "2026-01-01", "2026-04-30"))
      .toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(plannedMaintenanceVisits({ ...contract, visitInterval: { kind: "Quinzenal" } }, "2026-01-01", "2026-02-01"))
      .toEqual(["2026-01-01", "2026-01-16", "2026-01-31"]);
    expect(plannedMaintenanceVisits({ ...contract, visitInterval: { kind: "Semestral" } }, "2026-01-01", "2026-12-31"))
      .toEqual(["2026-01-01", "2026-07-01"]);
    expect(plannedMaintenanceVisits({ ...contract, visitInterval: { kind: "Dias", days: 10 } }, "2026-01-01", "2026-01-25"))
      .toEqual(["2026-01-01", "2026-01-11", "2026-01-21"]);
  });

  it("alerta cinco dias antes das visitas não agendadas e deixa de alertar após criar OS vinculada", () => {
    const data = saveMaintenanceContract(fixture(), contract, true);
    const alerts = maintenanceVisitAlerts(data, "2026-01-27");
    expect(alerts).toContainEqual(expect.objectContaining({ contract, date: "2026-02-01", daysUntil: 5 }));
    expect(maintenanceVisitAlerts(data, "2026-02-10"))
      .toContainEqual(expect.objectContaining({ contract, date: "2026-02-01", daysUntil: -9 }));
    const order = data.orders[0];
    const details = addMaintenanceContractCharge(getOrderDetails(order), contract);
    const scheduled = { ...data, orders: [...data.orders, { ...order, id: "scheduled-order", date: "2026-02-01", details }] };
    expect(maintenanceVisitAlerts(scheduled, "2026-01-27").some((item) => item.date === "2026-02-01")).toBe(false);
    const archived = { ...data, orders: [...data.orders, { ...order, id: "archived-order", date: "2026-02-01",
      details: { ...details, archived: true } }] };
    expect(maintenanceVisitAlerts(archived, "2026-01-27").some((item) => item.date === "2026-02-01")).toBe(true);
  });

  it("leva o valor mensal para os custos faturáveis da OS, sem criar lançamento financeiro", () => {
    const data = saveMaintenanceContract(fixture(), contract, true), order = data.orders[0];
    const details = addMaintenanceContractCharge(getOrderDetails(order), contract);
    expect(details.maintenanceContract).toEqual({ id: contract.id, monthlyAmount: contract.monthlyAmount });
    expect(details.costs.at(-1)).toEqual({ id: `maintenance-contract:${contract.id}`, name: `Contrato: ${contract.name}`, value: 25000 });
    expect(orderValues(details).costs - orderValues(getOrderDetails(order)).costs).toBe(25000);
    const serviceAmount = splitBillingValues(details).services;
    expect(billingItemSnapshots(details, "Serviços", serviceAmount)).toContainEqual(expect.objectContaining({
      id: `cost:maintenance-contract:${contract.id}`, name: `Contrato: ${contract.name}`, gross: 25000,
    }));
    expect(data.finance.entries).toEqual([]);
    expect(() => addMaintenanceContractCharge(details, contract)).toThrow("já tem um contrato");
    const linked = { ...data, orders: data.orders.map((item) => item.id === order.id ? { ...item, details } : item) };
    expect(validateDatabase(linked).orders[0].details?.maintenanceContract?.monthlyAmount).toBe(25000);
    const invalid = structuredClone(linked);
    invalid.orders[0].details!.costs.pop();
    expect(() => validateDatabase(invalid)).toThrow("cobrança de contrato inválida");
    const uncoveredUnit = structuredClone(linked);
    uncoveredUnit.equipment.push({ ...uncoveredUnit.equipment[0], id: "demo-equipment-extra", name: "Outra esteira", serial: "DEMO-EST-EXTRA" });
    uncoveredUnit.orders[0].equipmentId = "demo-equipment-extra";
    uncoveredUnit.orders[0].details!.equipmentIds = ["demo-equipment-extra"];
    expect(() => validateDatabase(uncoveredUnit)).toThrow("cobrança de contrato inválida");
    const outsideTerm = structuredClone(linked);
    outsideTerm.orders[0].date = "2025-12-31";
    expect(() => validateDatabase(outsideTerm)).toThrow("cobrança de contrato inválida");
  });

  it("mantém compatibilidade com dados antigos sem contratos", () => {
    const data = fixture();
    delete (data as Partial<typeof data>).maintenanceContracts;
    expect(validateDatabase(data).maintenanceContracts).toEqual([]);
  });

  it("recusa criação sem confirmação, cliente inativo, equipamento de outro cliente ou IDs repetidos, mas não exige tipos", () => {
    const data = fixture();
    expect(() => saveMaintenanceContract(data, contract, false)).toThrow("Confirme");
    expect(() => saveMaintenanceContract(data, { ...contract, equipmentIds: [] }, true)).toThrow("Selecione ao menos uma unidade");
    expect(saveMaintenanceContract(data, { ...contract, equipmentTypeIds: [] }, true).maintenanceContracts[0].equipmentTypeIds).toEqual([]);
    expect(() => saveMaintenanceContract(data, { ...contract, clientId: "missing" }, true)).toThrow("cliente ativo");
    expect(() => saveMaintenanceContract(data, { ...contract, equipmentIds: ["demo-equipment-2"] }, true)).toThrow("vinculados");
    expect(() => saveMaintenanceContract(data, { ...contract, equipmentIds: ["demo-equipment-1", "demo-equipment-1"] }, true)).toThrow();
    data.clients[0].active = false;
    expect(() => saveMaintenanceContract(data, { ...contract, id: "another-contract" }, true)).toThrow("cliente ativo");
  });

  it("valida referências e datas também ao importar ou restaurar a base", () => {
    const data = saveMaintenanceContract(fixture(), contract, true);
    expect(() => validateDatabase({ ...data, maintenanceContracts: [{ ...contract, equipmentIds: ["demo-equipment-2"] }] })).toThrow("cliente ou equipamento");
    expect(() => validateDatabase({ ...data, maintenanceContracts: [{ ...contract, startsOn: "2026-12-31", endsOn: "2026-01-01" }] })).toThrow();
    expect(() => validateDatabase({ ...data, maintenanceContracts: [contract, contract] })).toThrow("Identificadores duplicados");
  });

  it("preserva histórico ao suspender, reativar e cancelar definitivamente", () => {
    let data = saveMaintenanceContract(fixture(), contract, true);
    data = changeMaintenanceContractStatus(data, contract, "Suspenso", "Parada solicitada pelo cliente.", true);
    expect(maintenanceContractLifecycle(data.maintenanceContracts[0])).toBe("Suspenso");
    expect(maintenanceContractStatus(data.maintenanceContracts[0], "2026-06-01")).toBe("Suspenso");
    expect(() => changeMaintenanceContractStatus(data, contract, "Ativo", "Reativar contrato.", true)).toThrow("alterado");
    data = changeMaintenanceContractStatus(data, data.maintenanceContracts[0], "Ativo", "Retomada acordada.", true);
    data = changeMaintenanceContractStatus(data, data.maintenanceContracts[0], "Cancelado", "Encerramento acordado.", true);
    expect(data.maintenanceContracts[0].events.map((event) => event.status)).toEqual(["Suspenso", "Ativo", "Cancelado"]);
    expect(() => changeMaintenanceContractStatus(data, data.maintenanceContracts[0], "Ativo", "Reativar contrato.", true)).toThrow("definitivo");
    expect(() => changeMaintenanceContractStatus(fixture(), contract, "Suspenso", "Motivo válido.", false)).toThrow("Confirme");
    expect(() => changeMaintenanceContractStatus(fixture(), contract, "Suspenso", "curto", true)).toThrow();
  });

  it("indica vigência futura e vencida sem alterar a situação persistida", () => {
    expect(maintenanceContractStatus({ ...contract, startsOn: "2026-07-01" }, "2026-06-01")).toBe("Vigência futura");
    expect(maintenanceContractStatus({ ...contract, endsOn: "2026-05-31" }, "2026-06-01")).toBe("Vencido");
    expect(maintenanceContractLifecycle(contract)).toBe("Ativo");
  });

  it("exibe a administração e deixa explícito que não gera OS ou cobranças", () => {
    const html = renderToStaticMarkup(<MaintenanceContractsPanel data={fixture()} commit={() => {}} onSuccess={() => {}} />);
    expect(html).toContain("Novo contrato");
    expect(html).toContain("O valor só entra na OS se o contrato for selecionado nela.");
    expect(html).not.toContain("Tipos de equipamento cobertos (além das unidades)");
    expect(html).toContain("Nenhum contrato encontrado");
  });
});
