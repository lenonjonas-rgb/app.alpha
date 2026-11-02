import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase } from "./domain";
import type { Database, MaintenanceContract } from "./domain";
import { contractBilling } from "./contractChargeSchema";
import {
  contractChargeAmount, contractChargeDueOn, contractChargeRows, contractChargeStats, contractExpectedTotal, contractPeriodNote, contractPeriods,
  deleteContractCharges, generateChargeInvoices, generateContractCharges, updateContractBilling,
} from "./contractCharges";
import { saveBankAccount, settleFinanceEntry } from "./finance";
import { changeMaintenanceContractStatus, saveMaintenanceContract } from "./maintenanceContracts";
import { MaintenanceContractsPanel } from "./MaintenanceContractsPanel";
import { nfseTotals } from "./serviceInvoices";
import { SalesChargesPanel } from "./SalesChargesPanel";

const bank = { id: "bank", name: "Conta principal", bank: "Banco", agency: "1", account: "1", kind: "Corrente" as const, active: true };
const contract: MaintenanceContract = {
  id: "contract-1", name: "Manutenção mensal", clientId: "demo-client-1", equipmentTypeIds: [], equipmentIds: ["demo-equipment-1"],
  coverage: "Visitas preventivas.", startsOn: "2026-01-15", endsOn: "2026-12-31", monthlyAmount: 10000,
  visitInterval: { kind: "Mensal" }, createdAt: "2026-01-01T12:00:00.000Z", events: [],
};

function fixture(billing: Partial<ReturnType<typeof contractBilling>> = {}): Database {
  const data = saveMaintenanceContract(saveBankAccount(demoDatabase(), bank), contract, true);
  return updateContractBilling(data, contract.id, contractBilling({ number: "CT-1", accountId: bank.id, ...billing }));
}
const current = (data: Database) => data.maintenanceContracts[0];

describe("cobranças de contratos", () => {
  it("calcula meses, vencimento, desconto e total previsto como no Bling", () => {
    const data = fixture({ dueDay: 31, dueRule: "1", discountRate: 10, discountAmount: 500, discountUntil: "2026-03", periodPrint: "previous" });
    const item = current(data);
    expect(contractPeriods(item)).toHaveLength(12);
    expect(contractChargeDueOn(item, "2026-01")).toBe("2026-02-28");
    expect(contractChargeAmount(item, "2026-03")).toEqual({ gross: 10000, discount: 1500, amount: 8500 });
    expect(contractChargeAmount(item, "2026-04").discount).toBe(0);
    expect(contractExpectedTotal(item)).toBe(3 * 8500 + 9 * 10000);
    expect(contractPeriodNote(item, "2026-01")).toBe("Referente a 12/2025");
    const quarterly = current(fixture({ periodicity: "Trimestral", baseDate: "2026-02-10" }));
    expect(contractPeriods(quarterly)).toEqual(["2026-02", "2026-05", "2026-08", "2026-11"]);
    expect(contractPeriods(quarterly, "2026-03", "2026-09")).toEqual(["2026-05", "2026-08"]);
  });

  it("gera contas, NFS-e e OS por mês sem duplicar e mostra parcelas pagas", () => {
    const data = fixture({ generateNfse: true, generateServiceOrder: true, issRate: 2, discountIss: true });
    const orders = data.orders.length;
    const first = generateContractCharges(data, { from: "2026-01", through: "2026-03" });
    expect(first.created).toBe(3);
    expect(first.data.contractCharges.map((charge) => charge.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(first.data.orders).toHaveLength(orders + 3);
    const charge = first.data.contractCharges[0];
    const entry = first.data.finance.entries.find((item) => item.id === charge.entryId)!;
    expect(entry).toMatchObject({ amount: 10000, dueOn: "2026-01-10", paymentMethod: "Boleto", accountId: bank.id, kind: "Receber" });
    const nfse = first.data.serviceInvoices.find((item) => item.id === charge.serviceInvoiceId)!;
    expect(nfse).toMatchObject({ status: "Pendente", contractChargeId: charge.id, entryIds: [entry.id], serviceOrderId: charge.serviceOrderId });
    expect(nfseTotals(nfse).total).toBe(9800);
    expect(generateContractCharges(first.data, { from: "2026-01", through: "2026-03" }).created).toBe(0);
    const paid = settleFinanceEntry(first.data, entry.id, { id: "pay-1", amount: 10000, date: "2026-01-10", accountId: bank.id });
    expect(contractChargeStats(paid, current(paid))).toMatchObject({ installments: 12, generated: 3, paid: 1, open: 2, openAmount: 20000 });
    expect(contractChargeRows(paid, "2026-01", "2026-02-01")[0]).toMatchObject({ status: "Recebida", clientName: "Academia Horizonte (demo)" });
  });

  it("não cobra contratos suspensos, isentos ou em avaliação", () => {
    const data = fixture();
    const isento = changeMaintenanceContractStatus(data, current(data), "Isento", "Cortesia ao cliente.", true);
    const result = generateContractCharges(isento, { from: "2026-01", through: "2026-01" });
    expect(result.created).toBe(0);
    expect(result.skipped[0]).toContain("Isento");
  });

  it("gera notas depois e exclui as cobranças do mês cancelando contas e notas pendentes", () => {
    const generated = generateContractCharges(fixture(), { from: "2026-02", through: "2026-02" }).data;
    const charge = generated.contractCharges[0];
    expect(charge.serviceInvoiceId).toBe("");
    const invoiced = generateChargeInvoices(generated, [charge.id]);
    expect(invoiced.created).toBe(1);
    expect(generateChargeInvoices(invoiced.data, [charge.id]).created).toBe(0);
    expect(() => deleteContractCharges(invoiced.data, [charge.id], false)).toThrow("ciente");
    const removed = deleteContractCharges(invoiced.data, [charge.id], true);
    expect(removed.contractCharges).toEqual([]);
    expect(removed.serviceInvoices).toEqual([]);
    expect(removed.finance.entries.find((item) => item.id === charge.entryId)!.canceled).toBe(true);
  });

  it("lista contratos com cobrança, parcelas pagas e menu de ações", () => {
    const html = renderToStaticMarkup(<MaintenanceContractsPanel data={fixture()} commit={() => {}} onSuccess={() => {}} />);
    expect(html).toContain("CT-1 · Manutenção mensal");
    expect(html).toContain("Parcelas pagas");
    expect(html).toContain("0/12");
    expect(html).toContain("Mensal · dia 10");
    expect(html).toContain("Gerar cobranças");
  });

  it("mostra a tela de cobranças do mês com conta, situação e ações", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-20T12:00:00"));
    try {
      const data = generateContractCharges(fixture(), { from: "2026-01", through: "2026-01" }).data;
      const html = renderToStaticMarkup(<SalesChargesPanel data={data} commit={() => {}} onOpenContracts={() => {}} onOpenNfse={() => {}} />);
      expect(html).toContain("Cobranças");
      expect(html).toContain("Academia Horizonte (demo)");
      expect(html).toContain("Gerar notas neste filtro");
      expect(html).toContain("Excluir cobranças do mês");
    } finally {
      vi.useRealTimers();
    }
  });
});
