import { currency, getOrderDetails, localDay, makeId, validateDatabase } from "./domain";
import type { Client, Database } from "./domain";
import { cancelFinanceEntry, salesOrderInvoices, splitBillingValues } from "./finance";
import { financeEntrySchema } from "./financeSchema";
import type { FinanceEntry, Invoice } from "./financeSchema";
import { generateNfeInstallments, recipientFromClient } from "./outgoingInvoices";
import type { NfeInstallment } from "./outgoingInvoiceSchema";
import {
  NFSE_COFINS_RATE, NFSE_CSLL_RATE, NFSE_INSS_RATE, NFSE_PIS_RATE, serviceInvoiceSchema,
} from "./serviceInvoiceSchema";
import type { ServiceInvoice } from "./serviceInvoiceSchema";
import { applyNfseTaxSet } from "./nfseTaxSets";
import { existingFiscalCode, normalizedFiscalCode } from "./nfseTaxCodes";

const percent = (base: number, rate: number) => Math.round((base * rate) / 100);

/**
 * Totais da NFS-e no padrão do Bling: as retenções de INSS (11%), PIS (0,65%), COFINS (3%), CSLL (1%) e IR
 * abatem o total da nota; o ISS só abate quando "Descontar ISS" está marcado ("Reter ISS" apenas informa).
 */
export function nfseTotals(nfse: Pick<ServiceInvoice, "service" | "discount" | "taxes" | "commissionRate">) {
  const services = nfse.service.amount;
  const discount = Math.min(nfse.discount, services);
  const base = services - discount;
  const iss = percent(base, nfse.taxes.issRate);
  const inss = nfse.taxes.retainInss ? percent(base, NFSE_INSS_RATE) : 0;
  const pis = nfse.taxes.retainFederal ? percent(base, NFSE_PIS_RATE) : 0;
  const cofins = nfse.taxes.retainFederal ? percent(base, NFSE_COFINS_RATE) : 0;
  const csll = nfse.taxes.retainFederal ? percent(base, NFSE_CSLL_RATE) : 0;
  const ir = percent(base, nfse.taxes.irRate);
  const issDeducted = nfse.taxes.discountIss ? iss : 0;
  const retentions = inss + pis + cofins + csll + ir;
  const total = Math.max(0, base - retentions - issDeducted);
  return {
    services, discount, base, iss, issDeducted, inss, pis, cofins, csll, ir, retentions, total,
    ibpt: percent(base, nfse.taxes.ibptRate), commission: percent(base, nfse.commissionRate),
  };
}

export const nfseNumberLabel = (nfse: Pick<ServiceInvoice, "rpsNumber">) => String(nfse.rpsNumber).padStart(6, "0");

export function nextRpsNumber(data: Database, series = "1") {
  return data.serviceInvoices.filter((item) => item.rpsSeries.toUpperCase() === series.toUpperCase())
    .reduce((max, item) => Math.max(max, item.rpsNumber), 0) + 1;
}

export function nfseRecipientFromClient(client: Client | undefined): ServiceInvoice["recipient"] {
  const base = recipientFromClient(client);
  return {
    clientId: base.clientId, name: base.name, document: base.document, stateRegistration: "", municipalRegistration: "",
    governmentPurchase: "", operationType: "", consumptionIndicator: base.finalConsumer ? "1" : "",
    postalCode: base.postalCode, state: base.state, city: base.city, district: base.district, street: base.street,
    number: base.number, complement: "", phone: base.phone, email: base.email, serviceState: base.state, serviceCity: base.city,
  };
}

function eventAt(previous?: string) {
  const now = new Date();
  if (previous && now.toISOString() <= previous) return new Date(Date.parse(previous) + 1).toISOString();
  return now.toISOString();
}

export function blankNfse(data: Database, options: { applyDefaultTaxSet?: boolean } = {}): ServiceInvoice {
  const at = new Date().toISOString();
  const nfse: ServiceInvoice = {
    id: makeId(), status: "Pendente", rpsNumber: nextRpsNumber(data), rpsSeries: "1", nfseNumber: "", issueDate: localDay(),
    operationNature: "1", recipient: nfseRecipientFromClient(undefined),
    service: { description: "", amount: 0, taxSetId: "", taxSet: "", nationalCode: "", municipalCode: "", nbs: "", operationIndicator: "", cst: "", classification: "" },
    taxes: { irRate: 0, issRate: 0, retainIss: false, discountIss: false, retainInss: false, retainFederal: false, ibptRate: 0 },
    discount: 0, seller: "", commissionRate: 0,
    payment: { terms: "", category: "Prestação de serviços", installments: [] },
    complementary: "", salesOrderId: "", serviceOrderId: "", quoteId: "", contractChargeId: "", invoiceId: "", entryIds: [],
    createdAt: at, updatedAt: at, events: [{ at, description: "Nota de serviço incluída" }],
  };
  const defaultSet = options.applyDefaultTaxSet === false ? undefined : data.settings.nfseTaxSets.find((set) => set.active && set.isDefault);
  return defaultSet ? applyNfseTaxSet(nfse, defaultSet) : nfse;
}

export type NfseBillingTarget =
  | { mode: "linked"; invoice: Invoice; entries: FinanceEntry[] }
  | { mode: "entries"; entries: FinanceEntry[] }
  | { mode: "external"; message: string }
  | { mode: "create"; amount: number };

export function serviceInvoiceFor(data: Database, orderId: string) {
  return salesOrderInvoices(data, orderId).find((invoice) => invoice.kind !== "Produtos");
}

/** Indica de onde vêm as contas da nota: faturamento do pedido/OS, contas próprias ou a lançar ao salvar. */
export function nfseBillingTarget(data: Database, nfse: ServiceInvoice): NfseBillingTarget {
  const linked = nfse.invoiceId ? data.finance.invoices.find((item) => item.id === nfse.invoiceId && !item.canceled) : undefined;
  if (linked) return { mode: "linked", invoice: linked, entries: data.finance.entries.filter((entry) => entry.invoiceId === linked.id) };
  const own = data.finance.entries.filter((entry) => nfse.entryIds.includes(entry.id) && !entry.canceled);
  if (own.length) return { mode: "entries", entries: own };
  for (const orderId of [nfse.salesOrderId, nfse.serviceOrderId].filter(Boolean)) {
    const invoice = serviceInvoiceFor(data, orderId);
    if (invoice) return { mode: "linked", invoice, entries: data.finance.entries.filter((entry) => entry.invoiceId === invoice.id) };
  }
  if (nfse.salesOrderId) return { mode: "external", message: "As contas desta nota são lançadas pelo pedido de venda (menu do pedido › Lançar contas)." };
  if (nfse.serviceOrderId) return { mode: "external", message: "As contas desta nota são lançadas pelo faturamento da ordem de serviço (Financeiro › Faturamento)." };
  if (nfse.contractChargeId) return { mode: "external", message: "As contas desta nota pertencem à cobrança do contrato." };
  return { mode: "create", amount: nfseTotals(nfse).total };
}

export function nfseAccountsPosted(data: Database, nfse: ServiceInvoice) {
  const target = nfseBillingTarget(data, nfse);
  return target.mode === "linked" || target.mode === "entries";
}

export function nfseBlockingIssues(nfse: ServiceInvoice) {
  const issues: string[] = [];
  if (!nfse.recipient.name.trim()) issues.push("Informe o cliente da nota de serviço.");
  if (!nfse.service.description.trim()) issues.push("Informe a descrição do serviço.");
  if (nfse.service.amount <= 0) issues.push("Informe o valor do serviço.");
  if (nfse.discount > nfse.service.amount) issues.push("O desconto não pode ser maior que o valor do serviço.");
  if (nfse.service.amount > 0 && nfseTotals(nfse).total <= 0) issues.push("As retenções e o desconto zeram o total da nota.");
  if (nfse.payment.installments.some((item) => item.dueOn < nfse.issueDate)) issues.push("O vencimento das parcelas não pode anteceder a emissão.");
  return issues;
}

export function nfseWarnings(nfse: ServiceInvoice) {
  const warnings: string[] = [];
  if (!nfse.recipient.document) warnings.push("CPF/CNPJ do cliente não informado.");
  if (!nfse.service.municipalCode) warnings.push("Código municipal não informado; verifique se é exigido pelo município.");
  if (!nfse.service.nationalCode) warnings.push("Código de tributação nacional não informado.");
  else if (!/^\d{6}$/.test(normalizedFiscalCode(nfse.service.nationalCode))) warnings.push("Confira o código de tributação nacional: são 6 dígitos.");
  if (nfse.service.nbs && !/^\d{9}$/.test(normalizedFiscalCode(nfse.service.nbs))) warnings.push("Confira o NBS: são 9 dígitos.");
  const operation = existingFiscalCode(nfse.service.operationIndicator, 6);
  const cst = existingFiscalCode(nfse.service.cst, 3);
  const classification = existingFiscalCode(nfse.service.classification, 6);
  if (operation && !/^\d{6}$/.test(operation)) warnings.push("Confira o indicador de operação: são 6 dígitos.");
  if (cst && !/^\d{3}$/.test(cst)) warnings.push("Confira o CST IBS/CBS: são 3 dígitos.");
  if (classification && !/^\d{6}$/.test(classification)) warnings.push("Confira a classificação tributária: são 6 dígitos.");
  if (cst && !operation) warnings.push("CST informado sem indicador de operação; revise os campos.");
  if (classification && !cst) warnings.push("Classificação tributária informada sem CST; revise os campos.");
  if (/^\d{3}$/.test(cst) && /^\d{6}$/.test(classification) && !classification.startsWith(cst))
    warnings.push("A classificação tributária informada não corresponde ao CST; revise os campos.");
  if (!nfse.recipient.serviceCity) warnings.push("Município de prestação do serviço não informado.");
  if (nfse.taxes.issRate <= 0 && nfse.operationNature === "1") warnings.push("ISS está em 0%; confirme a alíquota para a operação tributável.");
  return warnings;
}

export function defaultNfseInstallments(data: Database, nfse: ServiceInvoice): NfeInstallment[] {
  const target = nfseBillingTarget(data, nfse);
  if (target.mode !== "create" || target.amount <= 0) return [];
  const accountId = data.finance.accounts.find((account) => account.active)?.id ?? "";
  try {
    return generateNfeInstallments(nfse.payment.terms, target.amount, nfse.issueDate, { method: "Boleto", accountId });
  } catch {
    return generateNfeInstallments("", target.amount, nfse.issueDate, { method: "Boleto", accountId });
  }
}

function activeAccountId(data: Database, accountId: string) {
  const account = data.finance.accounts.find((item) => item.id === accountId && item.active)
    ?? (!accountId ? data.finance.accounts.find((item) => item.active) : undefined);
  if (!account) throw new Error("Selecione uma conta financeira ativa para as parcelas.");
  return account.id;
}

function postAccounts(data: Database, nfse: ServiceInvoice): { data: Database; nfse: ServiceInvoice } {
  const target = nfseBillingTarget(data, nfse);
  if (target.mode === "linked") return { data, nfse: { ...nfse, invoiceId: target.invoice.id } };
  if (target.mode === "entries") return { data, nfse };
  if (target.mode === "external") throw new Error(target.message);
  const installments = nfse.payment.installments;
  if (!installments.length) throw new Error("Gere as parcelas da nota antes de lançar as contas.");
  if (target.amount <= 0) throw new Error("A nota não possui valor para lançar contas.");
  const sum = installments.reduce((total, item) => total + item.amount, 0);
  if (sum !== target.amount)
    throw new Error(`A soma das parcelas (${currency(sum)}) deve ser igual ao total da nota (${currency(target.amount)}).`);
  if (installments.some((item) => item.amount <= 0)) throw new Error("Todas as parcelas devem ter valor maior que zero.");
  if (installments.some((item) => item.dueOn < nfse.issueDate)) throw new Error("O vencimento das parcelas não pode anteceder a emissão.");
  const client = data.clients.find((item) => item.id === nfse.recipient.clientId);
  const entries = installments.map((item, index) => financeEntrySchema.parse({
    id: makeId(), kind: "Receber", party: (client?.name ?? nfse.recipient.name).slice(0, 160), clientId: client?.id,
    description: `NFS-e RPS ${nfseNumberLabel(nfse)}${installments.length > 1 ? ` · Parcela ${index + 1}/${installments.length}` : ""}`,
    amount: item.amount, issuedOn: nfse.issueDate, dueOn: item.dueOn, accountId: activeAccountId(data, item.accountId),
    paymentMethod: item.method,
  }));
  return {
    data: { ...data, finance: { ...data.finance, entries: [...data.finance.entries, ...entries] } },
    nfse: { ...nfse, entryIds: entries.map((entry) => entry.id) },
  };
}

function replaceNfse(data: Database, nfse: ServiceInvoice) {
  const exists = data.serviceInvoices.some((item) => item.id === nfse.id);
  return { ...data, serviceInvoices: exists ? data.serviceInvoices.map((item) => item.id === nfse.id ? nfse : item) : [...data.serviceInvoices, nfse] };
}

function findNfse(data: Database, id: string) {
  const nfse = data.serviceInvoices.find((item) => item.id === id);
  if (!nfse) throw new Error("Nota de serviço não encontrada.");
  return nfse;
}

function withEvent(nfse: ServiceInvoice, description: string, previous = nfse.events.at(-1)?.at): ServiceInvoice {
  const at = eventAt(previous);
  return { ...nfse, updatedAt: at, events: [...nfse.events, { at, description: description.slice(0, 500) }] };
}

/** Salva a nota como Pendente; quando há parcelas próprias, lança as contas a receber. */
export function saveNfse(data: Database, input: ServiceInvoice): Database {
  const existing = data.serviceInvoices.find((item) => item.id === input.id);
  if (existing && existing.status !== "Pendente") throw new Error("Somente notas de serviço pendentes podem ser alteradas.");
  let nfse = serviceInvoiceSchema.parse(input);
  const issues = nfseBlockingIssues(nfse);
  if (issues.length) throw new Error(issues[0]);
  if (nfse.recipient.clientId && !data.clients.some((client) => client.id === nfse.recipient.clientId))
    throw new Error("Cliente da nota não encontrado.");
  const taken = data.serviceInvoices.some((item) => item.id !== nfse.id &&
    item.rpsSeries.toUpperCase() === nfse.rpsSeries.toUpperCase() && item.rpsNumber === nfse.rpsNumber);
  // Como no Bling, o número do RPS pode mudar ao gravar se já tiver sido usado na série.
  if (taken) nfse = { ...nfse, rpsNumber: nextRpsNumber(data, nfse.rpsSeries) };
  if (existing) nfse = withEvent(nfse, "Nota de serviço alterada", existing.events.at(-1)?.at);
  let result = data;
  const target = nfseBillingTarget(data, nfse);
  if (target.mode === "linked") nfse = { ...nfse, invoiceId: target.invoice.id, payment: { ...nfse.payment, installments: [] } };
  else if (target.mode === "external") nfse = { ...nfse, payment: { ...nfse.payment, installments: [] } };
  else if (target.mode === "create" && nfse.payment.installments.length) {
    const posted = postAccounts(result, nfse);
    result = posted.data;
    nfse = posted.nfse;
  }
  result = replaceNfse(result, nfse);
  if (nfse.contractChargeId)
    result = { ...result, contractCharges: result.contractCharges.map((charge) =>
      charge.id === nfse.contractChargeId ? { ...charge, serviceInvoiceId: nfse.id } : charge) };
  return validateDatabase(result);
}

export function postNfseAccounts(data: Database, id: string): Database {
  const nfse = findNfse(data, id);
  if (nfse.status === "Cancelada") throw new Error("Notas canceladas não lançam contas.");
  if (nfseAccountsPosted(data, nfse)) throw new Error("As contas desta nota já foram lançadas.");
  const target = nfseBillingTarget(data, nfse);
  if (target.mode === "external") throw new Error(target.message);
  let installments = nfse.payment.installments;
  if (target.mode === "create" && installments.reduce((sum, item) => sum + item.amount, 0) !== target.amount)
    installments = generateNfeInstallments(nfse.payment.terms, target.amount, localDay() > nfse.issueDate ? localDay() : nfse.issueDate,
      { method: installments[0]?.method ?? "Boleto", accountId: installments[0]?.accountId ?? "" });
  const posted = postAccounts(data, { ...nfse, payment: { ...nfse.payment, installments } });
  return validateDatabase(replaceNfse(posted.data, withEvent(posted.nfse, "Contas lançadas pela nota de serviço")));
}

export function reverseNfseAccounts(data: Database, id: string): Database {
  const nfse = findNfse(data, id);
  const target = nfseBillingTarget(data, nfse);
  if (target.mode === "linked") throw new Error("As contas desta nota pertencem ao faturamento do pedido/OS; estorne por lá.");
  if (target.mode !== "entries") throw new Error("Esta nota não possui contas lançadas.");
  if (nfse.contractChargeId) throw new Error("As contas desta nota pertencem à cobrança do contrato; exclua a cobrança do mês.");
  if (target.entries.some((entry) => entry.settlements.some((item) => !item.reversed)))
    throw new Error("Estorne os recebimentos das parcelas antes de estornar as contas.");
  let result = data;
  for (const entry of target.entries) result = cancelFinanceEntry(result, entry.id);
  return validateDatabase(replaceNfse(result, withEvent({ ...nfse, entryIds: [] }, "Contas da nota de serviço estornadas")));
}

/** Registra o número da NFS-e emitida no portal da prefeitura (sem transmissão automática). */
export function registerNfseIssue(data: Database, id: string, nfseNumber: string): Database {
  const nfse = findNfse(data, id);
  if (nfse.status !== "Pendente") throw new Error("Somente notas pendentes podem ser marcadas como emitidas.");
  const number = nfseNumber.trim();
  if (!number) throw new Error("Informe o número da NFS-e emitida.");
  const issues = nfseBlockingIssues(nfse);
  if (issues.length) throw new Error(issues[0]);
  return validateDatabase(replaceNfse(data, withEvent({ ...nfse, status: "Emitida", nfseNumber: number.slice(0, 30) },
    `NFS-e ${number} registrada como emitida`)));
}

export function cancelNfse(data: Database, id: string, reason: string): Database {
  const nfse = findNfse(data, id);
  if (nfse.status === "Cancelada") throw new Error("Esta nota de serviço já está cancelada.");
  if (reason.trim().length < 5) throw new Error("Informe o motivo do cancelamento com pelo menos 5 caracteres.");
  const target = nfseBillingTarget(data, nfse);
  if (target.mode === "entries" && !nfse.contractChargeId) throw new Error("Estorne as contas da nota antes de cancelá-la.");
  let result = replaceNfse(data, withEvent({ ...nfse, status: "Cancelada" }, `Nota de serviço cancelada: ${reason.trim()}`));
  if (nfse.contractChargeId)
    result = { ...result, contractCharges: result.contractCharges.map((charge) =>
      charge.serviceInvoiceId === nfse.id ? { ...charge, serviceInvoiceId: "" } : charge) };
  return validateDatabase(result);
}

export function deleteNfse(data: Database, id: string): Database {
  const nfse = findNfse(data, id);
  if (nfse.status !== "Pendente") throw new Error("Somente notas de serviço pendentes podem ser excluídas.");
  if (nfseBillingTarget(data, nfse).mode === "entries" && !nfse.contractChargeId)
    throw new Error("Estorne as contas da nota antes de excluí-la.");
  return validateDatabase({
    ...data,
    serviceInvoices: data.serviceInvoices.filter((item) => item.id !== id),
    contractCharges: data.contractCharges.map((charge) => charge.serviceInvoiceId === id ? { ...charge, serviceInvoiceId: "" } : charge),
  });
}

export function cloneNfse(data: Database, id: string): ServiceInvoice {
  const source = findNfse(data, id);
  const blank = blankNfse(data);
  return {
    ...source, id: blank.id, status: "Pendente", rpsNumber: nextRpsNumber(data, source.rpsSeries), nfseNumber: "",
    issueDate: blank.issueDate, salesOrderId: "", serviceOrderId: "", quoteId: "", contractChargeId: "", invoiceId: "", entryIds: [],
    createdAt: blank.createdAt, updatedAt: blank.updatedAt,
    payment: { ...source.payment, installments: [] },
    events: [{ at: blank.createdAt, description: `Nota de serviço clonada do RPS ${nfseNumberLabel(source)}` }],
  };
}

const describeLine = (name: string, quantity: number, price: number) =>
  `${name} (${quantity.toLocaleString("pt-BR")} x ${currency(price)})`;

/** Monta a nota a partir de um faturamento de serviços (pedido de venda ou OS), com as contas já lançadas. */
export function nfseDraftFromBillingInvoice(data: Database, invoiceId: string): ServiceInvoice {
  const invoice = data.finance.invoices.find((item) => item.id === invoiceId && !item.canceled);
  if (!invoice || invoice.kind === "Produtos") throw new Error("Faturamento de serviços não encontrado.");
  const existing = data.serviceInvoices.find((item) => item.invoiceId === invoice.id && item.status !== "Cancelada");
  if (existing) return existing;
  const client = data.clients.find((item) => item.id === invoice.clientId);
  const draft = blankNfse(data);
  const lines = invoice.orders.flatMap((order) => order.items?.length
    ? order.items.map((item) => describeLine(item.name, item.quantity, item.price))
    : [`${order.title} ${order.code}`]);
  const single = invoice.orders.length === 1 ? invoice.orders[0].orderId : "";
  const salesOrder = single ? data.salesOrders.find((item) => item.id === single) : undefined;
  const serviceOrder = single && !salesOrder ? data.orders.find((item) => item.id === single) : undefined;
  return {
    ...draft, recipient: { ...nfseRecipientFromClient(client), name: client?.name ?? invoice.clientName },
    seller: salesOrder?.seller ?? "",
    service: { ...draft.service, description: lines.join("\n").slice(0, 2000), amount: invoice.amount },
    salesOrderId: salesOrder?.id ?? "", serviceOrderId: serviceOrder?.id ?? "", invoiceId: invoice.id,
    complementary: invoice.orders.map((order) => `${order.title} ${order.code}`).join(" · ").slice(0, 5000),
    events: [{ at: draft.createdAt, description: `Nota de serviço gerada do faturamento ${invoice.orders.map((order) => order.code).join(", ")}` }],
  };
}

/** Gera a nota de serviço da OS: usa o faturamento quando existe; senão, monta pelos serviços da OS. */
export function nfseDraftFromServiceOrder(data: Database, orderId: string): ServiceInvoice {
  const order = data.orders.find((item) => item.id === orderId);
  if (!order) throw new Error("Ordem de serviço não encontrada.");
  const existing = data.serviceInvoices.find((item) => item.serviceOrderId === order.id && item.status !== "Cancelada");
  if (existing) return existing;
  const invoice = serviceInvoiceFor(data, order.id);
  if (invoice) return { ...nfseDraftFromBillingInvoice(data, invoice.id), serviceOrderId: order.id };
  const details = getOrderDetails(order);
  const amount = splitBillingValues(details).services;
  if (amount <= 0) throw new Error("A OS não possui serviços para gerar a nota de serviço.");
  const client = data.clients.find((item) => item.id === order.clientId);
  const lines = [
    ...details.items.filter((item) => item.kind === "servico").map((item) => describeLine(item.name, item.quantity, item.price)),
    ...details.costs.map((cost) => describeLine(cost.name, 1, cost.value)),
  ];
  const draft = blankNfse(data);
  return {
    ...draft, recipient: nfseRecipientFromClient(client), serviceOrderId: order.id,
    service: { ...draft.service, description: (lines.join("\n") || order.title).slice(0, 2000), amount },
    complementary: `Ordem de serviço ${order.code}`,
    events: [{ at: draft.createdAt, description: `Nota de serviço gerada da ordem de serviço ${order.code}` }],
  };
}
