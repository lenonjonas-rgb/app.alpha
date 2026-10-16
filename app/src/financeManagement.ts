import { z } from "zod";
import { localDay, validateDatabase } from "./domain";
import type { Database } from "./domain";
import { entryBalance } from "./finance";
import { costCenterSchema, financeCategorySchema, financeClassificationSchema, openingBalanceSchema, settlementCashAmount } from "./financeSchema";
import type { CostCenter, FinanceCategory, FinanceClassification, FinanceEntry, FinanceManagement, OpeningBalance } from "./financeSchema";

export function financeManagement(data: Database): FinanceManagement {
  return data.finance.management ?? { categories: [], costCenters: [], classifications: [], openingBalances: [] };
}

function saveManagement(data: Database, management: FinanceManagement) {
  return validateDatabase({ ...data, finance: { ...data.finance, management } });
}

export function saveFinanceCategory(data: Database, input: FinanceCategory) {
  const category = financeCategorySchema.parse(input), management = financeManagement(data);
  if (management.categories.some((item) => item.id !== category.id && item.kind === category.kind &&
    item.name.toLocaleLowerCase("pt-BR") === category.name.toLocaleLowerCase("pt-BR")))
    throw new Error("Já existe uma categoria deste tipo com esse nome.");
  return saveManagement(data, { ...management, categories: [
    ...management.categories.filter((item) => item.id !== category.id), category,
  ] });
}

export function saveCostCenter(data: Database, input: CostCenter) {
  const center = costCenterSchema.parse(input), management = financeManagement(data);
  if (management.costCenters.some((item) => item.id !== center.id &&
    item.name.toLocaleLowerCase("pt-BR") === center.name.toLocaleLowerCase("pt-BR")))
    throw new Error("Já existe um centro de custo com esse nome.");
  return saveManagement(data, { ...management, costCenters: [
    ...management.costCenters.filter((item) => item.id !== center.id), center,
  ] });
}

export function classifyFinanceEntry(data: Database, input: FinanceClassification) {
  const classification = financeClassificationSchema.parse(input), management = financeManagement(data);
  const previous = management.classifications.find((item) => item.entryId === classification.entryId);
  if ((classification.categoryId && !management.categories.some((item) => item.id === classification.categoryId &&
    (item.active || previous?.categoryId === item.id))) ||
    (classification.costCenterId && !management.costCenters.some((item) => item.id === classification.costCenterId &&
      (item.active || previous?.costCenterId === item.id))))
    throw new Error("Selecione uma categoria e um centro de custo ativos.");
  return saveManagement(data, { ...management, classifications: [
    ...management.classifications.filter((item) => item.entryId !== classification.entryId), classification,
  ] });
}

export function saveOpeningBalance(data: Database, input: OpeningBalance) {
  const balance = openingBalanceSchema.parse(input), management = financeManagement(data);
  if (balance.date > localDay()) throw new Error("O saldo inicial não pode ter data futura.");
  if (!data.finance.accounts.some((item) => item.id === balance.accountId && item.active))
    throw new Error("Selecione uma conta bancária ativa.");
  return saveManagement(data, { ...management, openingBalances: [
    ...management.openingBalances.filter((item) => item.accountId !== balance.accountId), balance,
  ] });
}

const date = openingBalanceSchema.shape.date;
export const managementFilterSchema = z.object({
  start: date, end: date, accountId: z.string().default(""),
  categoryId: z.string().default(""), costCenterId: z.string().default(""),
}).refine((value) => value.start <= value.end, "A data inicial deve ser anterior ou igual à final.");
export type ManagementFilter = z.infer<typeof managementFilterSchema>;
export type ManagementMovement = {
  id: string; entryId: string; date: string; kind: FinanceEntry["kind"]; party: string; description: string;
  accountId: string; categoryId: string; costCenterId: string; amount: number; source: "realized" | "forecast";
  adjustment?: { principal: number; interest: number; fine: number; discount: number; reason: string };
};

export function defaultManagementFilter(today = localDay()): ManagementFilter {
  date.parse(today);
  const last = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return { start: `${today.slice(0, 7)}-01`, end: last.toISOString().slice(0, 10), accountId: "", categoryId: "", costCenterId: "" };
}

export function managementReport(data: Database, input: ManagementFilter, today = localDay()) {
  const filter = managementFilterSchema.parse(input);
  date.parse(today);
  const management = financeManagement(data);
  if ((filter.accountId && !data.finance.accounts.some((item) => item.id === filter.accountId)) ||
    (filter.categoryId && !management.categories.some((item) => item.id === filter.categoryId)) ||
    (filter.costCenterId && !management.costCenters.some((item) => item.id === filter.costCenterId)))
    throw new Error("Filtro gerencial indisponível. Selecione um cadastro existente.");
  const classifications = new Map(management.classifications.map((item) => [item.entryId, item]));
  const matches = (item: Pick<ManagementMovement, "accountId" | "categoryId" | "costCenterId">) =>
    (!filter.accountId || filter.accountId === item.accountId) &&
    (!filter.categoryId || filter.categoryId === item.categoryId) &&
    (!filter.costCenterId || filter.costCenterId === item.costCenterId);
  const movements: ManagementMovement[] = [];
  const open: { entry: FinanceEntry; amount: number }[] = [];
  for (const entry of data.finance.entries) {
    if (entry.canceled) continue;
    const classification = classifications.get(entry.id);
    const dimensions = { categoryId: classification?.categoryId ?? "", costCenterId: classification?.costCenterId ?? "" };
    const origin = entry.purchaseId ? `${entry.description} · Compra ${entry.purchaseId}` : entry.description;
    const description = entry.installment ? `${origin} · Parcela ${entry.installment.number}/${entry.installment.count}` :
      entry.recurrence ? `${origin} · Recorrência ${entry.recurrence.period}` : origin;
    const base = { entryId: entry.id, kind: entry.kind, party: entry.party, description, ...dimensions };
    for (const settlement of entry.settlements) {
      if (settlement.reversed || settlement.date < filter.start || settlement.date > filter.end) continue;
      const movement: ManagementMovement = { ...base, id: `${entry.id}:${settlement.id}`, date: settlement.date,
        accountId: settlement.accountId, amount: settlementCashAmount(settlement), source: "realized",
        ...(settlement.adjustment ? { adjustment: { principal: settlement.amount, ...settlement.adjustment } } : {}) };
      if (matches(movement)) movements.push(movement);
    }
    const amount = entryBalance(entry);
    if (amount > 0 && matches({ ...dimensions, accountId: entry.accountId })) {
      open.push({ entry, amount });
      const earliest = today > filter.start ? today : filter.start;
      const forecastDate = entry.dueOn > earliest ? entry.dueOn : earliest;
      if (forecastDate <= filter.end) movements.push({ ...base, id: entry.id, date: forecastDate, accountId: entry.accountId, amount, source: "forecast" });
    }
  }
  movements.sort((a, b) => a.date.localeCompare(b.date) || a.entryId.localeCompare(b.entryId) || a.id.localeCompare(b.id));
  const sum = (source: ManagementMovement["source"], kind: FinanceEntry["kind"]) =>
    movements.filter((item) => item.source === source && item.kind === kind).reduce((total, item) => total + item.amount, 0);
  const totals = { received: sum("realized", "Receber"), paid: sum("realized", "Pagar"),
    expectedReceipts: sum("forecast", "Receber"), expectedPayments: sum("forecast", "Pagar") };
  const transfers = filter.categoryId || filter.costCenterId ? [] : (data.finance.transfers ?? [])
    .filter((item) => !item.reversal && item.date >= filter.start && item.date <= filter.end)
    .flatMap((item) => [
      { transferId: item.id, date: item.date, description: item.description, accountId: item.fromAccountId, counterpartId: item.toAccountId, amount: -item.amount },
      { transferId: item.id, date: item.date, description: item.description, accountId: item.toAccountId, counterpartId: item.fromAccountId, amount: item.amount },
    ]).filter((item) => !filter.accountId || item.accountId === filter.accountId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.transferId.localeCompare(b.transferId));
  const transferTotals = {
    incoming: transfers.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0),
    outgoing: transfers.filter((item) => item.amount < 0).reduce((sum, item) => sum - item.amount, 0),
  };
  const daily = [...new Set([...movements.map((item) => item.date), ...transfers.map((item) => item.date)])].sort().map((day) => {
    const sumDay = (source: ManagementMovement["source"], kind: FinanceEntry["kind"]) =>
      movements.filter((item) => item.date === day && item.source === source && item.kind === kind).reduce((total, item) => total + item.amount, 0);
    return { date: day, received: sumDay("realized", "Receber"), paid: sumDay("realized", "Pagar"),
      expectedReceipts: sumDay("forecast", "Receber"), expectedPayments: sumDay("forecast", "Pagar"),
      transfersIn: transfers.filter((item) => item.date === day && item.amount > 0).reduce((sum, item) => sum + item.amount, 0),
      transfersOut: transfers.filter((item) => item.date === day && item.amount < 0).reduce((sum, item) => sum - item.amount, 0) };
  });
  const group = (dimension: "categoryId" | "costCenterId") => {
    const groups = new Map<string, typeof totals>();
    for (const movement of movements) {
      const key = movement[dimension], current = groups.get(key) ?? { received: 0, paid: 0, expectedReceipts: 0, expectedPayments: 0 };
      const field = movement.source === "realized"
        ? movement.kind === "Receber" ? "received" : "paid"
        : movement.kind === "Receber" ? "expectedReceipts" : "expectedPayments";
      current[field] += movement.amount;
      groups.set(key, current);
    }
    return [...groups].map(([id, values]) => ({ id, ...values }));
  };
  const aging = [
    { label: "Vencidas", test: (due: string) => due < today },
    { label: "Vencem hoje", test: (due: string) => due === today },
    { label: "A vencer", test: (due: string) => due > today },
  ].map(({ label, test }) => ({
    label, receivable: open.filter(({ entry }) => entry.kind === "Receber" && test(entry.dueOn)).reduce((total, item) => total + item.amount, 0),
    payable: open.filter(({ entry }) => entry.kind === "Pagar" && test(entry.dueOn)).reduce((total, item) => total + item.amount, 0),
  }));
  const positions = filter.categoryId || filter.costCenterId ? [] : data.finance.accounts
    .filter((account) => !filter.accountId || account.id === filter.accountId).map((account) => {
      const opening = management.openingBalances.find((item) => item.accountId === account.id);
      if (opening && opening.date > filter.end)
        return { accountId: account.id, opening, balance: null, projected: null };
      let balance = opening && opening.date <= filter.end ? opening.amount : 0;
      for (const entry of data.finance.entries) {
        if (entry.canceled) continue;
        for (const settlement of entry.settlements) {
          if (!settlement.reversed && settlement.accountId === account.id && settlement.date <= filter.end &&
            (!opening || settlement.date >= opening.date))
            balance += entry.kind === "Receber" ? settlementCashAmount(settlement) : -settlementCashAmount(settlement);
        }
      }
      for (const transfer of data.finance.transfers ?? []) {
        if (transfer.reversal || transfer.date > filter.end || (opening && transfer.date < opening.date)) continue;
        if (transfer.fromAccountId === account.id) balance -= transfer.amount;
        if (transfer.toAccountId === account.id) balance += transfer.amount;
      }
      const forecast = movements.filter((item) => item.source === "forecast" && item.accountId === account.id)
        .reduce((total, item) => total + (item.kind === "Receber" ? item.amount : -item.amount), 0);
      return { accountId: account.id, opening, balance, projected: balance + forecast };
    });
  return { filter, totals, daily, movements, transfers, transferTotals, categories: group("categoryId"), costCenters: group("costCenterId"), aging, positions };
}

export function managementCsv(data: Database, report: ReturnType<typeof managementReport>) {
  const management = financeManagement(data);
  const escape = (value: string) => `"${(/^[\s]*[=+@\-\t\r]/.test(value) ? "'" : "") + value.replace(/"/g, '""')}"`;
  const rows = [
    ["Data", "Origem", "Tipo", "Cliente/Favorecido", "Descrição", "Banco", "Categoria", "Centro de custo", "Valor (R$)",
      "Principal liquidado (R$)", "Juros (R$)", "Multa (R$)", "Desconto (R$)", "Motivo do ajuste"],
    ...report.movements.map((item) => [
      item.date, item.source === "realized" ? "Realizado" : "Previsto", item.kind, item.party, item.description,
      data.finance.accounts.find((account) => account.id === item.accountId)?.name ?? "",
      management.categories.find((category) => category.id === item.categoryId)?.name ?? "Sem categoria",
      management.costCenters.find((center) => center.id === item.costCenterId)?.name ?? "Sem centro de custo",
      (item.amount / 100).toFixed(2).replace(".", ","),
      ...[item.source === "realized" ? item.adjustment?.principal ?? item.amount : undefined,
        item.adjustment?.interest, item.adjustment?.fine, item.adjustment?.discount]
        .map((amount) => amount === undefined ? "" : (amount / 100).toFixed(2).replace(".", ",")),
      item.adjustment?.reason ?? "",
    ]),
    ...report.transfers.map((item) => [
      item.date, "Transferência interna", item.amount > 0 ? "Entrada" : "Saída",
      data.finance.accounts.find((account) => account.id === item.counterpartId)?.name ?? "", item.description,
      data.finance.accounts.find((account) => account.id === item.accountId)?.name ?? "", "Não se aplica", "Não se aplica",
      (Math.abs(item.amount) / 100).toFixed(2).replace(".", ","),
      "", "", "", "", "",
    ]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(escape).join(";")).join("\r\n");
}
