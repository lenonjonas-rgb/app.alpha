import { defaultQuestionnaires, localDay, makeId, nextCode, orderDetailsSchema, validateDatabase } from "./domain";
import type { Database, MaintenanceContract, Order } from "./domain";
import { contractBilling, contractBillingSchema, contractPeriodicities } from "./contractChargeSchema";
import type { ContractBilling, ContractCharge } from "./contractChargeSchema";
import { cancelFinanceEntry, entryBalance, entryStatus } from "./finance";
import { financeEntrySchema } from "./financeSchema";
import { maintenanceContractLifecycle } from "./maintenanceContracts";
import { blankNfse, nfseRecipientFromClient } from "./serviceInvoices";
import type { ServiceInvoice } from "./serviceInvoiceSchema";

const monthIndex = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;
const fromIndex = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

export const addMonths = (period: string, months: number) => fromIndex(monthIndex(period) + months);
export const monthLabel = (period: string) => `${period.slice(5, 7)}/${period.slice(0, 4)}`;

export function contractBillingOf(contract: MaintenanceContract): ContractBilling {
  return contractBilling(contract.billing);
}

export function contractPeriodMonths(contract: MaintenanceContract) {
  const periodicity = contractBillingOf(contract).periodicity;
  return contractPeriodicities.find(([name]) => name === periodicity)?.[1] ?? 1;
}

/** Meses de cobrança do contrato, alinhados à data base e à periodicidade, dentro da vigência. */
export function contractPeriods(contract: MaintenanceContract, from?: string, through?: string) {
  const billing = contractBillingOf(contract);
  const step = contractPeriodMonths(contract);
  const anchor = monthIndex((billing.baseDate || contract.startsOn).slice(0, 7));
  const first = Math.max(monthIndex(contract.startsOn.slice(0, 7)), from ? monthIndex(from) : -Infinity);
  const last = Math.min(monthIndex(contract.endsOn.slice(0, 7)), through ? monthIndex(through) : Infinity);
  const periods: string[] = [];
  let index = anchor + Math.ceil((first - anchor) / step) * step;
  for (; index <= last; index += step) {
    if (periods.length >= 1000) throw new Error("O período selecionado contém mais de 1.000 cobranças.");
    periods.push(fromIndex(index));
  }
  return periods;
}

export function contractChargeAmount(contract: MaintenanceContract, period: string) {
  const billing = contractBillingOf(contract);
  const applies = (billing.discountRate > 0 || billing.discountAmount > 0) && (!billing.discountUntil || period <= billing.discountUntil);
  const discount = applies ? Math.min(contract.monthlyAmount, Math.round((contract.monthlyAmount * billing.discountRate) / 100) + billing.discountAmount) : 0;
  return { gross: contract.monthlyAmount, discount, amount: contract.monthlyAmount - discount };
}

export function contractChargeDueOn(contract: MaintenanceContract, period: string) {
  const billing = contractBillingOf(contract);
  const month = addMonths(period, Number(billing.dueRule));
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return `${month}-${String(Math.min(billing.dueDay, lastDay)).padStart(2, "0")}`;
}

/** Texto do período impresso nas observações da conta e nas informações complementares da nota. */
export function contractPeriodNote(contract: MaintenanceContract, period: string) {
  const print = contractBillingOf(contract).periodPrint;
  if (print === "none") return "";
  return `Referente a ${monthLabel(print === "previous" ? addMonths(period, -1) : period)}`;
}

export function contractExpectedTotal(contract: MaintenanceContract) {
  return contractPeriods(contract).reduce((sum, period) => sum + contractChargeAmount(contract, period).amount, 0);
}

export function contractLabel(contract: MaintenanceContract) {
  const number = contractBillingOf(contract).number;
  return number ? `${number} · ${contract.name}` : contract.name;
}

export function contractChargeStats(data: Database, contract: MaintenanceContract) {
  const charges = data.contractCharges.filter((charge) => charge.contractId === contract.id);
  const entries = charges.map((charge) => data.finance.entries.find((entry) => entry.id === charge.entryId)).filter((entry) => entry && !entry.canceled);
  return {
    installments: contractPeriods(contract).length,
    generated: charges.length,
    paid: entries.filter((entry) => entryBalance(entry!) === 0).length,
    open: entries.filter((entry) => entryBalance(entry!) > 0).length,
    openAmount: entries.reduce((sum, entry) => sum + Math.max(0, entryBalance(entry!)), 0),
  };
}

export function updateContractBilling(data: Database, contractId: string, input: Partial<ContractBilling>) {
  const contract = data.maintenanceContracts.find((item) => item.id === contractId);
  if (!contract) throw new Error("Contrato não encontrado.");
  const billing = contractBillingSchema.parse(input);
  if (billing.billingClientId && !data.clients.some((client) => client.id === billing.billingClientId))
    throw new Error("Cliente de cobrança não encontrado.");
  if (billing.accountId && !data.finance.accounts.some((account) => account.id === billing.accountId && account.active))
    throw new Error("Selecione uma conta financeira ativa para a cobrança.");
  if (billing.number && data.maintenanceContracts.some((item) => item.id !== contractId && contractBillingOf(item).number === billing.number))
    throw new Error("Já existe um contrato com este número.");
  return validateDatabase({ ...data, maintenanceContracts: data.maintenanceContracts.map((item) => item.id === contractId ? { ...item, billing } : item) });
}

function nfseForCharge(data: Database, contract: MaintenanceContract, charge: ContractCharge): ServiceInvoice {
  const billing = contractBillingOf(contract);
  const draft = blankNfse(data);
  const note = contractPeriodNote(contract, charge.period);
  const client = data.clients.find((item) => item.id === charge.clientId);
  return {
    ...draft,
    recipient: nfseRecipientFromClient(client),
    service: { ...draft.service, description: (billing.nfseDescription || `Contrato de manutenção ${contractLabel(contract)}`).slice(0, 2000),
      amount: charge.amount + charge.discount, taxSet: billing.serviceCode },
    discount: charge.discount,
    taxes: { ...draft.taxes, issRate: billing.issRate, discountIss: billing.discountIss },
    seller: billing.seller, commissionRate: billing.commissionRate,
    complementary: [note, `Cobrança do contrato ${contractLabel(contract)} · ${monthLabel(charge.period)}`].filter(Boolean).join("\n"),
    contractChargeId: charge.id, entryIds: [charge.entryId],
    events: [{ at: draft.createdAt, description: `Nota de serviço gerada pela cobrança ${monthLabel(charge.period)} do contrato ${contract.name}` }],
  };
}

function orderForCharge(data: Database, contract: MaintenanceContract, charge: ContractCharge): Order {
  const at = new Date().toISOString();
  return {
    id: makeId(), code: nextCode(data.orders, "OS"), clientId: contract.clientId, equipmentId: contract.equipmentIds[0] ?? "",
    title: `Contrato ${contract.name} · ${monthLabel(charge.period)}`.slice(0, 160), technician: data.settings.technician, technicianUserId: "",
    date: localDay(), time: "09:00", duration: 60, type: "Preventiva", priority: "Media", status: "Aberta",
    details: orderDetailsSchema.parse({ createdAt: at, ...defaultQuestionnaires(data, "Preventiva") }),
    notes: [contract.coverage, contractPeriodNote(contract, charge.period)].filter(Boolean).join("\n\n").slice(0, 5000),
    history: [{ id: makeId(), at, description: `Criada pela cobrança ${monthLabel(charge.period)} do contrato ${contract.name}` }],
  };
}

export type ChargeGeneration = { data: Database; created: number; skipped: string[] };

/** Gera as cobranças (conta a receber e, conforme o contrato, NFS-e pendente e OS) dos contratos ativos no período. */
export function generateContractCharges(data: Database, options: { from: string; through: string; contractIds?: string[] }): ChargeGeneration {
  if (!/^\d{4}-\d{2}$/.test(options.from) || !/^\d{4}-\d{2}$/.test(options.through)) throw new Error("Informe o mês inicial e final.");
  if (options.through < options.from) throw new Error("O mês final não pode anteceder o inicial.");
  if (monthIndex(options.through) - monthIndex(options.from) > 60) throw new Error("Gere no máximo 60 meses por vez.");
  const contracts = data.maintenanceContracts.filter((contract) => !options.contractIds || options.contractIds.includes(contract.id));
  let result = data;
  let created = 0;
  const skipped: string[] = [];
  const today = localDay();
  for (const contract of contracts) {
    const lifecycle = maintenanceContractLifecycle(contract);
    if (lifecycle !== "Ativo") { skipped.push(`${contract.name}: situação ${lifecycle}.`); continue; }
    const billing = contractBillingOf(contract);
    const clientId = billing.billingClientId || contract.clientId;
    const client = result.clients.find((item) => item.id === clientId);
    if (!client) { skipped.push(`${contract.name}: cliente de cobrança não encontrado.`); continue; }
    const account = result.finance.accounts.find((item) => item.id === billing.accountId && item.active)
      ?? (!billing.accountId ? result.finance.accounts.find((item) => item.active) : undefined);
    if (!account) { skipped.push(`${contract.name}: cadastre ou selecione uma conta financeira ativa.`); continue; }
    for (const period of contractPeriods(contract, options.from, options.through)) {
      if (result.contractCharges.some((charge) => charge.contractId === contract.id && charge.period === period)) continue;
      const { amount, discount } = contractChargeAmount(contract, period);
      if (amount <= 0) { skipped.push(`${contract.name} ${monthLabel(period)}: desconto zera a cobrança.`); continue; }
      const dueOn = contractChargeDueOn(contract, period);
      const note = contractPeriodNote(contract, period);
      const entry = financeEntrySchema.parse({
        id: makeId(), kind: "Receber", party: client.name.slice(0, 160), clientId: client.id,
        description: `Contrato ${contractLabel(contract)} · ${monthLabel(period)}${note ? ` · ${note}` : ""}`.slice(0, 160),
        amount, issuedOn: today < dueOn ? today : dueOn, dueOn, accountId: account.id, paymentMethod: billing.paymentMethod,
      });
      let charge: ContractCharge = {
        id: makeId(), contractId: contract.id, clientId: client.id, period, dueOn, amount, discount, entryId: entry.id,
        serviceInvoiceId: "", serviceOrderId: "", createdAt: new Date().toISOString(),
      };
      result = { ...result, finance: { ...result.finance, entries: [...result.finance.entries, entry] } };
      if (billing.generateServiceOrder) {
        const order = orderForCharge(result, contract, charge);
        result = { ...result, orders: [...result.orders, order] };
        charge = { ...charge, serviceOrderId: order.id };
      }
      if (billing.generateNfse) {
        const nfse = nfseForCharge(result, contract, charge);
        result = { ...result, serviceInvoices: [...result.serviceInvoices, { ...nfse, serviceOrderId: charge.serviceOrderId }] };
        charge = { ...charge, serviceInvoiceId: nfse.id };
      }
      result = { ...result, contractCharges: [...result.contractCharges, charge] };
      created++;
    }
  }
  return { data: created ? validateDatabase(result) : data, created, skipped };
}

/** Gera NFS-e pendentes para as cobranças selecionadas que ainda não possuem nota ("Gerar notas neste filtro"). */
export function generateChargeInvoices(data: Database, chargeIds: string[]) {
  let result = data;
  let created = 0;
  for (const charge of data.contractCharges.filter((item) => chargeIds.includes(item.id) && !item.serviceInvoiceId)) {
    const entry = result.finance.entries.find((item) => item.id === charge.entryId);
    if (!entry || entry.canceled) continue;
    const contract = result.maintenanceContracts.find((item) => item.id === charge.contractId);
    if (!contract) continue;
    const nfse = { ...nfseForCharge(result, contract, charge), serviceOrderId: charge.serviceOrderId };
    result = {
      ...result,
      serviceInvoices: [...result.serviceInvoices, nfse],
      contractCharges: result.contractCharges.map((item) => item.id === charge.id ? { ...item, serviceInvoiceId: nfse.id } : item),
    };
    created++;
  }
  return { data: created ? validateDatabase(result) : data, created };
}

/** Exclui cobranças: cancela as contas a receber e remove as notas de serviço pendentes geradas por elas. */
export function deleteContractCharges(data: Database, chargeIds: string[], confirmed: boolean) {
  if (!confirmed) throw new Error("Confirme que está ciente da exclusão das cobranças.");
  const charges = data.contractCharges.filter((charge) => chargeIds.includes(charge.id));
  if (!charges.length) throw new Error("Nenhuma cobrança selecionada.");
  let result = data;
  for (const charge of charges) {
    const nfse = result.serviceInvoices.find((item) => item.id === charge.serviceInvoiceId);
    if (nfse?.status === "Emitida") throw new Error(`A cobrança ${monthLabel(charge.period)} possui NFS-e emitida; cancele a nota antes.`);
    const entry = result.finance.entries.find((item) => item.id === charge.entryId);
    if (entry && entry.settlements.some((item) => !item.reversed))
      throw new Error(`A cobrança ${monthLabel(charge.period)} de ${entry.party} já possui recebimento; estorne a baixa antes.`);
    result = {
      ...result,
      serviceInvoices: result.serviceInvoices.filter((item) => item.contractChargeId !== charge.id || item.status === "Cancelada")
        .map((item) => item.contractChargeId === charge.id ? { ...item, contractChargeId: "", entryIds: [] } : item),
      contractCharges: result.contractCharges.filter((item) => item.id !== charge.id),
    };
    if (entry && !entry.canceled) result = cancelFinanceEntry(result, entry.id);
  }
  return validateDatabase(result);
}

export type ChargeRow = {
  charge: ContractCharge; contract?: MaintenanceContract; clientName: string; status: string; balance: number;
  nfse?: ServiceInvoice;
};

export function contractChargeRows(data: Database, period: string, today = localDay()): ChargeRow[] {
  return data.contractCharges.filter((charge) => charge.period === period).map((charge) => {
    const entry = data.finance.entries.find((item) => item.id === charge.entryId);
    return {
      charge,
      contract: data.maintenanceContracts.find((item) => item.id === charge.contractId),
      clientName: data.clients.find((item) => item.id === charge.clientId)?.name ?? "Cliente indisponível",
      status: entry ? entryStatus(entry, today) : "Cancelada",
      balance: entry && !entry.canceled ? entryBalance(entry) : 0,
      nfse: data.serviceInvoices.find((item) => item.id === charge.serviceInvoiceId),
    };
  });
}
