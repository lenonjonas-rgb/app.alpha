import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { changeOrderSituation, demoDatabase } from "./domain";
import type { Database, MaintenanceContract } from "./domain";
import { contractBilling } from "./contractChargeSchema";
import { generateContractCharges, updateContractBilling } from "./contractCharges";
import { saveBankAccount } from "./finance";
import { saveMaintenanceContract } from "./maintenanceContracts";
import { defaultReportFilters, filterOrders } from "./reporting";
import { ReportsPanel } from "./Reports";
import {
  contractReportRows, groupContractRows, nfseInstallmentRows, nfseReportRows, serviceOrderSituationSummary,
} from "./serviceReporting";

const bank = { id: "bank", name: "Conta principal", bank: "Banco", agency: "1", account: "1", kind: "Corrente" as const, active: true };
const contract = (id: string, startsOn: string, endsOn: string): MaintenanceContract => ({
  id, name: `Contrato ${id}`, clientId: "demo-client-1", equipmentTypeIds: [], equipmentIds: ["demo-equipment-1"],
  coverage: "Visitas preventivas.", startsOn, endsOn, monthlyAmount: 10000,
  visitInterval: { kind: "Mensal" }, createdAt: "2026-01-01T12:00:00.000Z", events: [],
});

function fixture(): Database {
  let data = saveBankAccount(demoDatabase(), bank);
  for (const item of [contract("a", "2026-01-15", "2026-12-31"), contract("b", "2026-01-20", "2026-06-30"), contract("c", "2026-03-01", "2027-02-28")]) {
    data = saveMaintenanceContract(data, item, true);
    data = updateContractBilling(data, item.id, contractBilling({ accountId: bank.id, generateNfse: true }));
  }
  return data;
}

describe("relatórios de serviço", () => {
  it("lista contratos por início e término e agrupa por mês", () => {
    const data = fixture();
    const filters = { ...defaultReportFilters(), from: "2026-01-01", to: "2026-06-30" };
    expect(contractReportRows(data, filters, "start", "2026-02-01").map((row) => row.contract.id)).toEqual(["a", "b", "c"]);
    expect(contractReportRows(data, filters, "end").map((row) => row.contract.id)).toEqual(["b"]);
    const groups = groupContractRows(contractReportRows(data, filters, "startMonth"));
    expect(groups.map((group) => [group.month, group.rows.length, group.amount])).toEqual([["01/2026", 2, 20000], ["03/2026", 1, 10000]]);
    expect(contractReportRows(data, { ...filters, query: "contrato c" }, "start").map((row) => row.contract.id)).toEqual(["c"]);
  });

  it("lista notas de serviço e as parcelas das contas", () => {
    const data = generateContractCharges(fixture(), { from: "2026-01", through: "2026-02", contractIds: ["a"] }).data;
    const filters = defaultReportFilters();
    const notes = nfseReportRows(data, filters);
    expect(notes).toHaveLength(2);
    expect(notes.every((row) => row.total === 10000 && row.nfse.status === "Pendente")).toBe(true);
    expect(nfseReportRows(data, { ...filters, status: "Emitida" })).toHaveLength(0);
    const installments = nfseInstallmentRows(data, filters, "2026-01-05");
    expect(installments.map((row) => [row.installment, row.amount, row.status])).toEqual([["1/1", 10000, "Em aberto"], ["1/1", 10000, "Em aberto"]]);
    expect(nfseInstallmentRows(data, { ...filters, from: "2026-02-01" }, "2026-01-15")).toHaveLength(1);
  });

  it("conta OS pelas 9 situações e filtra por situação ou status", () => {
    const base = demoDatabase();
    const order = base.orders[0];
    const data = changeOrderSituation(base, order.id, "Orçada");
    const summary = serviceOrderSituationSummary(data.orders);
    expect(summary).toHaveLength(9);
    expect(summary.find((item) => item.situation === "Orçada")?.count).toBe(1);
    const filters = defaultReportFilters();
    expect(filterOrders(data, { ...filters, status: "situacao:Orçada" }).map((item) => item.id)).toEqual([order.id]);
    expect(filterOrders(data, { ...filters, status: "Aberta" }).some((item) => item.id === order.id)).toBe(true);
  });

  it("mostra o grupo Serviços no menu de relatórios", () => {
    const html = renderToStaticMarkup(<ReportsPanel data={fixture()} commit={() => {}} onOpenOrder={() => {}} onSuccess={() => {}} onError={() => {}} />);
    expect(html).toContain("Relatórios: Serviços");
  });
});
