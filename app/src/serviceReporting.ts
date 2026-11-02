import { orderSituation, orderSituations } from "./domain";
import type { Database, MaintenanceContract, Order, OrderSituation } from "./domain";
import { contractBillingOf, contractChargeAmount, contractLabel, monthLabel } from "./contractCharges";
import { entryStatus } from "./finance";
import { maintenanceContractStatus } from "./maintenanceContracts";
import type { ReportFilters } from "./reporting";
import { nfseBillingTarget, nfseNumberLabel, nfseTotals } from "./serviceInvoices";
import type { ServiceInvoice } from "./serviceInvoiceSchema";

/** Relatórios da coluna Serviços do Bling: contratos por início/término (também agrupados por mês), NFS-e, parcelas e OS. */
export type ContractReportMode = "start" | "end" | "startMonth" | "endMonth";
export const contractReportModes: [ContractReportMode, string][] = [
  ["start", "Por data de início"], ["end", "Por data de término"],
  ["startMonth", "Agrupados por mês de início"], ["endMonth", "Agrupados por mês de término"],
];

const lower = (value: string) => value.toLocaleLowerCase("pt-BR");
const inRange = (date: string, filters: ReportFilters) =>
  (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
const matchesQuery = (filters: ReportFilters, ...values: string[]) =>
  !filters.query.trim() || lower(values.join(" ")).includes(lower(filters.query.trim()));

export type ContractReportRow = {
  contract: MaintenanceContract; client: string; date: string; month: string; label: string;
  periodicity: string; amount: number; status: string;
};

export function contractReportRows(data: Database, filters: ReportFilters, mode: ContractReportMode, today?: string): ContractReportRow[] {
  const byEnd = mode === "end" || mode === "endMonth";
  return data.maintenanceContracts
    .map((contract) => {
      const date = byEnd ? contract.endsOn : contract.startsOn;
      const first = contractChargeAmount(contract, contract.startsOn.slice(0, 7));
      return {
        contract, date, month: monthLabel(date.slice(0, 7)), label: contractLabel(contract),
        client: data.clients.find((item) => item.id === contract.clientId)?.name ?? "—",
        periodicity: contractBillingOf(contract).periodicity, amount: first.amount,
        status: maintenanceContractStatus(contract, today),
      };
    })
    .filter((row) => inRange(row.date, filters) && (!filters.clientId || row.contract.clientId === filters.clientId)
      && matchesQuery(filters, row.label, row.client))
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, "pt-BR"));
}

export function groupContractRows(rows: ContractReportRow[]) {
  const groups = new Map<string, ContractReportRow[]>();
  for (const row of rows) groups.set(row.month, [...(groups.get(row.month) ?? []), row]);
  return [...groups.entries()].map(([month, items]) => ({ month, rows: items, amount: items.reduce((sum, item) => sum + item.amount, 0) }));
}

export type NfseReportRow = { nfse: ServiceInvoice; client: string; number: string; total: number; iss: number; retentions: number };

export function nfseReportRows(data: Database, filters: ReportFilters): NfseReportRow[] {
  return data.serviceInvoices
    .filter((nfse) => inRange(nfse.issueDate, filters) && (!filters.clientId || nfse.recipient.clientId === filters.clientId)
      && (!filters.status || nfse.status === filters.status)
      && matchesQuery(filters, nfseNumberLabel(nfse), nfse.nfseNumber, nfse.recipient.name, nfse.service.description))
    .map((nfse) => {
      const totals = nfseTotals(nfse);
      return { nfse, client: nfse.recipient.name || "—", number: nfseNumberLabel(nfse), total: totals.total, iss: totals.iss, retentions: totals.retentions };
    })
    .sort((a, b) => a.nfse.issueDate.localeCompare(b.nfse.issueDate) || a.nfse.rpsNumber - b.nfse.rpsNumber);
}

export type NfseInstallmentRow = {
  nfse: ServiceInvoice; number: string; client: string; installment: string; dueOn: string; amount: number; status: string;
};

/** Parcelas das NFS-e: contas lançadas (faturamento, cobrança de contrato ou da própria nota) ou parcelas previstas na nota. */
export function nfseInstallmentRows(data: Database, filters: ReportFilters, today?: string): NfseInstallmentRow[] {
  const rows: NfseInstallmentRow[] = [];
  for (const nfse of data.serviceInvoices) {
    if (nfse.status === "Cancelada" || (filters.clientId && nfse.recipient.clientId !== filters.clientId)) continue;
    if (!matchesQuery(filters, nfseNumberLabel(nfse), nfse.recipient.name)) continue;
    const target = nfseBillingTarget(data, nfse);
    const base = { nfse, number: nfseNumberLabel(nfse), client: nfse.recipient.name || "—" };
    const charge = nfse.contractChargeId ? data.contractCharges.find((item) => item.id === nfse.contractChargeId) : undefined;
    const chargeEntries = charge ? data.finance.entries.filter((entry) => entry.id === charge.entryId) : [];
    if (target.mode === "linked" || target.mode === "entries" || chargeEntries.length) {
      const entries = (target.mode === "linked" || target.mode === "entries" ? target.entries : chargeEntries).filter((entry) => !entry.canceled);
      entries.forEach((entry, index) => rows.push({ ...base, installment: `${index + 1}/${entries.length}`, dueOn: entry.dueOn,
        amount: entry.amount, status: entryStatus(entry, today) }));
    } else {
      const planned = nfse.payment.installments;
      planned.forEach((item, index) => rows.push({ ...base, installment: `${index + 1}/${planned.length}`, dueOn: item.dueOn,
        amount: item.amount, status: "Prevista (contas não lançadas)" }));
    }
  }
  return rows.filter((row) => inRange(row.dueOn, filters) && (!filters.status || row.status === filters.status))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.number.localeCompare(b.number));
}

export function serviceOrderSituationSummary(orders: Order[]) {
  const counts = Object.fromEntries(orderSituations.map((situation) => [situation, 0])) as Record<OrderSituation, number>;
  for (const order of orders) counts[orderSituation(order)] += 1;
  return orderSituations.map((situation) => ({ situation, count: counts[situation] }));
}
