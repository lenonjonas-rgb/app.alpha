import {
  changeSalesOrderStatus, getOrderDetails, localDay, makeId, postSalesOrderStock, reverseSalesOrderStock, salesOrderLineTotal,
  salesOrderStockPosted, salesOrderTotal, validateDatabase,
} from "./domain";
import type { Client, Database, SalesOrder } from "./domain";
import { cancelFinanceEntry, salesOrderInvoices, splitBillingValues } from "./finance";
import { financeEntrySchema } from "./financeSchema";
import type { FinanceEntry, Invoice } from "./financeSchema";
import { outgoingInvoiceSchema } from "./outgoingInvoiceSchema";
import type { NfeInstallment, NfeItem, OutgoingInvoice } from "./outgoingInvoiceSchema";

export type NfeFieldType = "text" | "number" | "money" | "percent" | "select" | "checkbox" | "date" | "textarea";
export type NfeField = {
  key: string;
  label: string;
  type: NfeFieldType;
  options?: readonly (readonly [string, string])[];
  calculated?: boolean;
  wide?: boolean;
};
export type NfeItemTab = { id: string; label: string; fields: NfeField[] };

const cstIcms = [
  ["00", "00 - Tributada integralmente"],
  ["02", "02 - Tributação monofásica própria sobre combustíveis"],
  ["10", "10 - Tributada e com cobrança do ICMS por substituição tributária"],
  ["15", "15 - Tributação monofásica própria e com responsabilidade pela retenção sobre combustíveis"],
  ["20", "20 - Com redução de base de cálculo"],
  ["30", "30 - Isenta ou não tributada e com cobrança do ICMS por substituição tributária"],
  ["40", "40 - Isenta"],
  ["41", "41 - Não tributada"],
  ["50", "50 - Suspensão"],
  ["51", "51 - Diferimento"],
  ["53", "53 - Tributação monofásica sobre combustíveis com recolhimento diferido"],
  ["60", "60 - ICMS cobrado anteriormente por substituição tributária"],
  ["61", "61 - Tributação monofásica sobre combustíveis cobrada anteriormente"],
  ["70", "70 - Com redução de base de cálculo e cobrança do ICMS por substituição tributária"],
  ["90", "90 - Outras"],
] as const;
const origins = [
  ["0", "0 - Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8"],
  ["1", "1 - Estrangeira - Importação direta"],
  ["2", "2 - Estrangeira - Adquirida no mercado interno"],
  ["3", "3 - Nacional, conteúdo de importação superior a 40% e inferior ou igual a 70%"],
  ["4", "4 - Nacional, produção conforme processos produtivos básicos"],
  ["5", "5 - Nacional, conteúdo de importação inferior ou igual a 40%"],
  ["6", "6 - Estrangeira - Importação direta, sem similar nacional (CAMEX)"],
  ["7", "7 - Estrangeira - Adquirida no mercado interno, sem similar nacional (CAMEX)"],
  ["8", "8 - Nacional, conteúdo de importação superior a 70%"],
] as const;
const bcModalities = [
  ["0", "Margem Valor Agregado (%)"],
  ["1", "Pauta (valor)"],
  ["2", "Preço tabelado máximo (valor)"],
  ["3", "Valor da operação"],
] as const;
const ipiSituations = [
  ["", "Sem IPI"],
  ["50", "50 - Saída tributada"],
  ["51", "51 - Saída tributável com alíquota zero"],
  ["52", "52 - Saída isenta"],
  ["53", "53 - Saída não tributada"],
  ["54", "54 - Saída imune"],
  ["55", "55 - Saída com suspensão"],
  ["99", "99 - Outras saídas"],
] as const;
const pisCofinsCst = [
  ["01", "01 - Operação tributável (alíquota normal)"],
  ["02", "02 - Operação tributável (alíquota diferenciada)"],
  ["03", "03 - Operação tributável (alíquota por unidade de medida)"],
  ["04", "04 - Operação tributável monofásica (alíquota zero)"],
  ["05", "05 - Operação tributável por substituição tributária"],
  ["06", "06 - Operação tributável a alíquota zero"],
  ["07", "07 - Operação isenta da contribuição"],
  ["08", "08 - Operação sem incidência da contribuição"],
  ["09", "09 - Operação com suspensão da contribuição"],
  ["49", "49 - Outras operações de saída"],
  ["99", "99 - Outras operações"],
] as const;
const ibsCbsCst = [
  ["000", "000 - Tributação integral"],
  ["200", "200 - Alíquota reduzida"],
  ["410", "410 - Imunidade e não incidência"],
  ["510", "510 - Diferimento"],
  ["515", "515 - Diferimento com redução de alíquota"],
  ["550", "550 - Suspensão"],
  ["620", "620 - Tributação monofásica"],
  ["800", "800 - Transferência de crédito"],
  ["810", "810 - Ajuste de IBS na ZFM"],
  ["811", "811 - Ajustes"],
  ["830", "830 - Exclusão de base de cálculo"],
] as const;
const itemTypes = [
  ["00", "Mercadoria para revenda"],
  ["01", "Matéria-prima"],
  ["02", "Embalagem"],
  ["03", "Produto em processo"],
  ["04", "Produto acabado"],
  ["05", "Subproduto"],
  ["06", "Produto intermediário"],
  ["07", "Material de uso e consumo"],
  ["08", "Ativo imobilizado"],
  ["09", "Serviços"],
  ["10", "Outros insumos"],
  ["99", "Outras"],
] as const;

export const nfeItemTabs: NfeItemTab[] = [
  { id: "data", label: "Dados do item", fields: [
    { key: "data.discountType", label: "Tipo desconto", type: "select", options: [["incondicional", "Incondicional"], ["condicional", "Condicional"]] },
    { key: "data.insurance", label: "Valor seguro", type: "money" },
    { key: "data.nature", label: "Natureza", type: "text" },
    { key: "data.cfop", label: "CFOP", type: "text" },
    { key: "data.ncm", label: "NCM", type: "text" },
    { key: "data.cest", label: "CEST", type: "text" },
    { key: "data.gtin", label: "GTIN/EAN", type: "text" },
    { key: "data.gtinTax", label: "GTIN/EAN tributário", type: "text" },
    { key: "data.barcode", label: "Código de barras interno", type: "text" },
    { key: "data.barcodeTax", label: "Código de barras tributário", type: "text" },
    { key: "data.billed", label: "Faturado", type: "checkbox" },
    { key: "data.additionalInfo", label: "Informações adicionais (infAdProd)", type: "textarea", wide: true },
    { key: "data.complementaryInfo", label: "Informações complementares do item", type: "textarea", wide: true },
    { key: "data.fiscoInfo", label: "Informações de interesse do fisco do item", type: "textarea", wide: true },
  ] },
  { id: "icms", label: "ICMS", fields: [
    { key: "icms.cst", label: "Situação tributária", type: "select", options: cstIcms, wide: true },
    { key: "icms.origin", label: "Origem", type: "select", options: origins, wide: true },
    { key: "icms.modality", label: "Modalidade BC", type: "select", options: bcModalities },
    { key: "icms.baseReduction", label: "% redução da base", type: "percent" },
    { key: "icms.presumed", label: "Presumido %", type: "percent" },
    { key: "icms.rate", label: "% ICMS", type: "percent" },
    { key: "icms.base", label: "Base ICMS", type: "money", calculated: true },
    { key: "icms.value", label: "Valor ICMS", type: "money", calculated: true },
    { key: "icms.ratePosition", label: "Posição de alíquota", type: "text" },
    { key: "icms.fcpRate", label: "% FCP", type: "percent" },
    { key: "icms.fcpValue", label: "Valor FCP", type: "money", calculated: true },
    { key: "icms.stMva", label: "% MVA ST", type: "percent" },
    { key: "icms.stRate", label: "% ICMS ST", type: "percent" },
    { key: "icms.stBase", label: "Base ICMS ST", type: "money", calculated: true },
    { key: "icms.stValue", label: "Valor ICMS ST", type: "money", calculated: true },
    { key: "icms.creditCode", label: "Código de crédito presumido", type: "text" },
    { key: "icms.complementaryInfo", label: "Informações complementares", type: "textarea", wide: true },
    { key: "icms.fiscoInfo", label: "Informações de interesse do fisco", type: "textarea", wide: true },
  ] },
  { id: "ipi", label: "IPI", fields: [
    { key: "ipi.situation", label: "Situação tributária", type: "select", options: ipiSituations, wide: true },
    { key: "ipi.rate", label: "Alíquota IPI %", type: "percent" },
    { key: "ipi.value", label: "Valor IPI", type: "money", calculated: true },
    { key: "ipi.fixedUnit", label: "Valor fixo unitário", type: "money" },
    { key: "ipi.class", label: "Classe de enquadramento", type: "text" },
    { key: "ipi.framing", label: "Código de enquadramento", type: "text" },
    { key: "ipi.tipiException", label: "Código de exceção da TIPI", type: "text" },
  ] },
  { id: "pis", label: "PIS", fields: [
    { key: "pis.cst", label: "Situação tributária", type: "select", options: pisCofinsCst, wide: true },
    { key: "pis.basePercent", label: "% base de cálculo", type: "percent" },
    { key: "pis.base", label: "Valor base de cálculo", type: "money", calculated: true },
    { key: "pis.rate", label: "Alíquota %", type: "percent" },
    { key: "pis.value", label: "Valor PIS", type: "money", calculated: true },
    { key: "pis.fixed", label: "Valor fixo", type: "money" },
  ] },
  { id: "cofins", label: "COFINS", fields: [
    { key: "cofins.cst", label: "Situação tributária", type: "select", options: pisCofinsCst, wide: true },
    { key: "cofins.basePercent", label: "% base de cálculo", type: "percent" },
    { key: "cofins.base", label: "Valor base de cálculo", type: "money", calculated: true },
    { key: "cofins.rate", label: "Alíquota %", type: "percent" },
    { key: "cofins.value", label: "Valor COFINS", type: "money", calculated: true },
    { key: "cofins.fixed", label: "Valor fixo", type: "money" },
  ] },
  { id: "import", label: "Importação", fields: [
    { key: "import.situation", label: "Situação tributária", type: "select", options: [["tributado", "Tributado"], ["nao-tributado", "Não tributado"]] },
  ] },
  { id: "others", label: "Outros", fields: [
    { key: "others.presumedPisCofins", label: "Considerar presumido no cálculo do PIS/COFINS", type: "checkbox", wide: true },
    { key: "others.funruralRate", label: "Alíquota Funrural %", type: "percent" },
    { key: "others.funruralValue", label: "Valor Funrural", type: "money", calculated: true },
    { key: "others.itemType", label: "Tipo do item", type: "select", options: itemTypes },
    { key: "others.commissionBase", label: "Base comissão", type: "money", calculated: true },
    { key: "others.commissionRate", label: "Alíquota comissão %", type: "percent" },
    { key: "others.commissionValue", label: "Valor comissão", type: "money", calculated: true },
    { key: "others.purchaseOrder", label: "Nº do pedido de compra", type: "text" },
    { key: "others.purchaseOrderItem", label: "Nº do item no pedido de compra", type: "text" },
    { key: "others.approxPercent", label: "% aproximado de tributos", type: "percent" },
    { key: "others.approxValue", label: "Valor aproximado de tributos", type: "money", calculated: true },
    { key: "others.taxUnit", label: "Unidade tributável", type: "text" },
    { key: "others.taxQuantity", label: "Quantidade tributável", type: "number" },
    { key: "others.taxUnitValue", label: "Valor unitário tributável", type: "money" },
    { key: "others.otherExpenses", label: "Outras despesas", type: "money" },
    { key: "others.originKey", label: "Chave da nota de origem", type: "text", wide: true },
    { key: "others.originNumber", label: "Número da nota de origem", type: "text" },
    { key: "others.originSeries", label: "Série da nota de origem", type: "text" },
    { key: "others.originItem", label: "Nº do item na nota de origem", type: "text" },
  ] },
  { id: "stock", label: "Estoque", fields: [
    { key: "stock.supplierCode", label: "Código no fornecedor", type: "text" },
    { key: "stock.scale", label: "Indicador de escala relevante", type: "select", options: [["", "Não informado"], ["S", "S - Produzido em escala relevante"], ["N", "N - Produzido em escala não relevante"]] },
    { key: "stock.lot", label: "Lote", type: "text" },
    { key: "stock.manufacturedOn", label: "Data de fabricação", type: "date" },
    { key: "stock.expiresOn", label: "Data de validade", type: "date" },
    { key: "stock.aggregationCode", label: "Código de agregação", type: "text" },
  ] },
  { id: "retentions", label: "Retenções", fields: [
    { key: "ret.csrf", label: "Reter CSRF", type: "checkbox" },
    { key: "ret.csllRate", label: "Alíquota CSLL %", type: "percent" },
    { key: "ret.csllValue", label: "Valor CSLL", type: "money", calculated: true },
    { key: "ret.ir", label: "Reter IR", type: "checkbox" },
    { key: "ret.irBase", label: "Base IR/CSLL", type: "money", calculated: true },
    { key: "ret.irRate", label: "Alíquota IR %", type: "percent" },
    { key: "ret.irValue", label: "Valor IR", type: "money", calculated: true },
  ] },
  { id: "is", label: "IS", fields: [
    { key: "is.cst", label: "Situação tributária", type: "text" },
    { key: "is.classification", label: "Classificação tributária", type: "text" },
    { key: "is.base", label: "Base de cálculo", type: "money", calculated: true },
    { key: "is.rate", label: "Alíquota %", type: "percent" },
    { key: "is.value", label: "Valor IS", type: "money", calculated: true },
    { key: "is.unit", label: "Unidade tributável", type: "text" },
    { key: "is.quantity", label: "Quantidade tributável", type: "number" },
  ] },
  { id: "ibs", label: "IBS", fields: [
    { key: "ibs.cst", label: "Situação tributária", type: "select", options: ibsCbsCst, wide: true },
    { key: "ibs.classification", label: "Código de Classificação Tributária", type: "text" },
    { key: "ibs.base", label: "Base de cálculo", type: "money", calculated: true },
    { key: "ibs.ufRate", label: "Alíquota IBS/UF %", type: "percent" },
    { key: "ibs.ufValue", label: "Valor IBS/UF", type: "money", calculated: true },
    { key: "ibs.cashbackPercent", label: "% cashback", type: "percent" },
    { key: "ibs.cashbackValue", label: "Valor cashback", type: "money", calculated: true },
    { key: "ibs.munRate", label: "Alíquota IBS/Mun %", type: "percent" },
    { key: "ibs.munValue", label: "Valor IBS/Mun", type: "money", calculated: true },
  ] },
  { id: "cbs", label: "CBS", fields: [
    { key: "cbs.cst", label: "Situação tributária", type: "select", options: ibsCbsCst, wide: true },
    { key: "cbs.classification", label: "Código de Classificação Tributária", type: "text" },
    { key: "cbs.base", label: "Base de cálculo", type: "money", calculated: true },
    { key: "cbs.rate", label: "Alíquota CBS %", type: "percent" },
    { key: "cbs.value", label: "Valor CBS", type: "money", calculated: true },
    { key: "cbs.cashbackPercent", label: "% cashback", type: "percent" },
    { key: "cbs.cashbackValue", label: "Valor cashback", type: "money", calculated: true },
  ] },
];

export const defaultOperationNature = "5102 - Venda de mercadoria";

export function defaultItemFields(): Record<string, string> {
  return {
    "data.discountType": "incondicional", "data.cfop": "5102", "data.nature": defaultOperationNature, "data.billed": "true",
    "icms.cst": "00", "icms.origin": "0", "icms.modality": "3", "icms.rate": "0",
    "ipi.situation": "", "ipi.framing": "999",
    "pis.cst": "49", "pis.basePercent": "100", "pis.rate": "0",
    "cofins.cst": "49", "cofins.basePercent": "100", "cofins.rate": "0",
    "import.situation": "tributado", "others.itemType": "00",
    "ibs.cst": "000", "ibs.classification": "", "ibs.ufRate": "0.1", "ibs.munRate": "0",
    "cbs.cst": "000", "cbs.classification": "", "cbs.rate": "0.9",
  };
}

export const toCents = (value: string | undefined) => {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
};
export const fromCents = (value: number) => (value / 100).toFixed(2);
const rate = (value: string | undefined) => {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};
const percentOf = (base: number, percent: number) => Math.round((base * percent) / 100);
const field = (item: NfeItem, key: string) => item.fields[key] ?? "";

export const itemGross = (item: Pick<NfeItem, "quantity" | "price">) => Math.round(item.quantity * item.price);
/** Valor da operação do item: produtos − desconto + frete + seguro + outras despesas. */
export function itemOperationValue(item: NfeItem) {
  return itemGross(item) - item.discount + item.freight + toCents(field(item, "data.insurance")) + toCents(field(item, "others.otherExpenses"));
}

const icmsTaxed = new Set(["00", "10", "20", "51", "70", "90"]);
const icmsWithSt = new Set(["10", "30", "70", "90"]);
const pisCofinsExempt = new Set(["04", "05", "06", "07", "08", "09"]);

export function calculateNfeItem(item: NfeItem): NfeItem {
  const fields = { ...item.fields };
  const set = (key: string, cents: number) => { fields[key] = fromCents(cents); };
  const operation = itemOperationValue(item);
  const goods = itemGross(item) - item.discount + item.freight + toCents(fields["data.insurance"]) + toCents(fields["others.otherExpenses"]);
  const ipiTaxed = fields["ipi.situation"] === "50" || fields["ipi.situation"] === "99";
  const ipi = ipiTaxed ? percentOf(goods, rate(fields["ipi.rate"])) + Math.round(toCents(fields["ipi.fixedUnit"]) * item.quantity) : 0;
  set("ipi.value", ipi);
  const cst = fields["icms.cst"] ?? "";
  const icmsBase = icmsTaxed.has(cst) ? Math.round(operation * (1 - Math.min(100, rate(fields["icms.baseReduction"])) / 100)) : 0;
  const icms = percentOf(icmsBase, rate(fields["icms.rate"]));
  set("icms.base", icmsBase);
  set("icms.value", icms);
  set("icms.fcpValue", percentOf(icmsBase, rate(fields["icms.fcpRate"])));
  const stRate = rate(fields["icms.stRate"]);
  const stBase = icmsWithSt.has(cst) && stRate > 0 ? Math.round((operation + ipi) * (1 + rate(fields["icms.stMva"]) / 100)) : 0;
  set("icms.stBase", stBase);
  set("icms.stValue", stBase ? Math.max(0, percentOf(stBase, stRate) - icms) : 0);
  const contribution = (prefix: "pis" | "cofins") => {
    const exempt = pisCofinsExempt.has(fields[`${prefix}.cst`] ?? "");
    const base = exempt ? 0 : percentOf(operation, fields[`${prefix}.basePercent`] === undefined ? 100 : rate(fields[`${prefix}.basePercent`]));
    const value = exempt ? 0 : percentOf(base, rate(fields[`${prefix}.rate`])) + toCents(fields[`${prefix}.fixed`]);
    set(`${prefix}.base`, base);
    set(`${prefix}.value`, value);
    return value;
  };
  const pis = contribution("pis");
  const cofins = contribution("cofins");
  set("is.base", operation);
  set("is.value", percentOf(operation, rate(fields["is.rate"])));
  // Mesma base usada pelo Bling na fase de testes da Reforma: valor da operação sem ICMS, PIS e COFINS.
  const ibsCbsBase = Math.max(0, operation - icms - pis - cofins);
  const immune = (prefix: "ibs" | "cbs") => fields[`${prefix}.cst`] === "410";
  const ibsBase = immune("ibs") ? 0 : ibsCbsBase;
  const ibsUf = percentOf(ibsBase, rate(fields["ibs.ufRate"]));
  const ibsMun = percentOf(ibsBase, rate(fields["ibs.munRate"]));
  set("ibs.base", ibsBase);
  set("ibs.ufValue", ibsUf);
  set("ibs.munValue", ibsMun);
  set("ibs.cashbackValue", percentOf(ibsUf + ibsMun, rate(fields["ibs.cashbackPercent"])));
  const cbsBase = immune("cbs") ? 0 : ibsCbsBase;
  const cbs = percentOf(cbsBase, rate(fields["cbs.rate"]));
  set("cbs.base", cbsBase);
  set("cbs.value", cbs);
  set("cbs.cashbackValue", percentOf(cbs, rate(fields["cbs.cashbackPercent"])));
  set("others.funruralValue", percentOf(operation, rate(fields["others.funruralRate"])));
  set("others.commissionBase", operation);
  set("others.commissionValue", percentOf(operation, rate(fields["others.commissionRate"])));
  set("others.approxValue", percentOf(operation, rate(fields["others.approxPercent"])));
  const irBase = fields["ret.ir"] === "true" || fields["ret.csrf"] === "true" ? operation : 0;
  set("ret.irBase", irBase);
  set("ret.irValue", fields["ret.ir"] === "true" ? percentOf(irBase, rate(fields["ret.irRate"])) : 0);
  set("ret.csllValue", fields["ret.csrf"] === "true" ? percentOf(irBase, rate(fields["ret.csllRate"])) : 0);
  return { ...item, fields };
}

export function itemNoteValue(item: NfeItem) {
  return itemOperationValue(item) + toCents(field(item, "ipi.value")) + toCents(field(item, "icms.stValue"));
}

export function nfeTotals(nfe: Pick<OutgoingInvoice, "items">) {
  const sum = (pick: (item: NfeItem) => number, items = nfe.items) => items.reduce((total, item) => total + pick(item), 0);
  const money = (key: string) => (item: NfeItem) => toCents(field(item, key));
  const products = nfe.items.filter((item) => item.kind === "produto");
  const services = nfe.items.filter((item) => item.kind === "servico");
  const totals = {
    products: sum(itemGross, products),
    services: sum(itemGross, services),
    freight: sum((item) => item.freight),
    insurance: sum(money("data.insurance")),
    otherExpenses: sum(money("others.otherExpenses")),
    discount: sum((item) => item.discount),
    icmsBase: sum(money("icms.base")),
    icms: sum(money("icms.value")),
    icmsStBase: sum(money("icms.stBase")),
    icmsSt: sum(money("icms.stValue")),
    ipi: sum(money("ipi.value")),
    is: sum(money("is.value")),
    ibs: sum(money("ibs.ufValue")) + sum(money("ibs.munValue")),
    cbs: sum(money("cbs.value")),
    issqn: 0,
    funrural: sum(money("others.funruralValue")),
    approximateTaxes: sum(money("others.approxValue")),
    total: sum(itemNoteValue),
    billed: sum(itemNoteValue, nfe.items.filter((item) => field(item, "data.billed") !== "false")),
  };
  return totals;
}

export function recalculateNfe(nfe: OutgoingInvoice): OutgoingInvoice {
  if (!nfe.autoCalculation) return nfe;
  const items = nfe.items.map(calculateNfeItem);
  const sum = (key: string) => items.reduce((total, item) => total + toCents(item.fields[key]), 0);
  const withRetention = items.filter((item) => item.fields["ret.ir"] === "true" || item.fields["ret.csrf"] === "true");
  const totals = nfeTotals({ items });
  const approximate = totals.approximateTaxes && totals.total
    ? `Total aproximado de tributos: R$ ${fromCents(totals.approximateTaxes).replace(".", ",")} (${(totals.approximateTaxes / totals.total * 100).toFixed(2).replace(".", ",")}%). Fonte: IBPT.`
    : "";
  return {
    ...nfe,
    items,
    retentions: {
      ...nfe.retentions,
      base: withRetention.reduce((total, item) => total + itemOperationValue(item), 0),
      ir: sum("ret.irValue"),
      csll: sum("ret.csllValue"),
    },
    additional: { ...nfe.additional, natureComplementary: approximate },
  };
}

export function nfeBlockingIssues(nfe: OutgoingInvoice) {
  const issues: string[] = [];
  if (!nfe.recipient.name.trim()) issues.push("Informe o destinatário da nota.");
  if (!nfe.operationNature.trim()) issues.push("Informe a natureza de operação.");
  if (!nfe.items.length) issues.push("Inclua pelo menos um item na nota.");
  nfe.items.forEach((item, index) => {
    if (!item.name.trim()) issues.push(`Item ${index + 1}: descrição não informada.`);
    if (!field(item, "icms.cst")) issues.push(`Item ${index + 1}: situação tributária do ICMS não informada.`);
    if (!field(item, "ibs.cst") || !field(item, "ibs.classification").trim() || !field(item, "cbs.cst") || !field(item, "cbs.classification").trim())
      issues.push(`Item ${index + 1}: CST e/ou Classificação Tributária (IBS/CBS) não informados.`);
  });
  return issues;
}

/** Avisos que, como no Bling, podem causar rejeição na SEFAZ mas não impedem salvar a nota. */
export function nfeWarnings(nfe: OutgoingInvoice) {
  const warnings: string[] = [];
  if (!nfe.recipient.document) warnings.push("Destinatário sem CPF/CNPJ.");
  if (!nfe.recipient.state || !nfe.recipient.city) warnings.push("Endereço do destinatário incompleto (UF/Município).");
  nfe.items.forEach((item, index) => {
    if (!/^\d{8}$/.test(field(item, "data.ncm"))) warnings.push(`Item ${index + 1}: NCM não informado ou inválido.`);
    if (!/^\d{4}$/.test(field(item, "data.cfop"))) warnings.push(`Item ${index + 1}: CFOP não informado ou inválido.`);
  });
  return warnings;
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Interpreta condições como "30 60", "3x" ou "15 +2x" (primeira em 15 dias e mais duas a cada 30). */
export function parsePaymentTerms(terms: string): number[] {
  const text = terms.trim().toLocaleLowerCase("pt-BR");
  if (!text) return [0];
  const days: number[] = [];
  for (const token of text.split(/[\s,;/]+/).filter(Boolean)) {
    const plus = token.match(/^\+(\d{1,3})x$/);
    const times = token.match(/^(\d{1,3})x$/);
    const number = token.match(/^\d{1,4}$/);
    if (plus) {
      const last = days.at(-1) ?? 0;
      for (let index = 1; index <= Number(plus[1]); index++) days.push(last + index * 30);
    } else if (times) {
      const last = days.at(-1) ?? 0;
      for (let index = 1; index <= Number(times[1]); index++) days.push(last + index * 30);
    } else if (number) days.push(Number(token));
    else throw new Error(`Condição de pagamento inválida: "${terms}". Use, por exemplo, "30 60", "3x" ou "15 +2x".`);
  }
  if (!days.length || days.length > 120 || days.some((value, index) => value > 3650 || (index > 0 && value <= days[index - 1])))
    throw new Error("Condição de pagamento com prazos inválidos ou fora de ordem.");
  return days;
}

export function generateNfeInstallments(terms: string, amount: number, issueDate: string,
  defaults: Pick<NfeInstallment, "method" | "accountId">): NfeInstallment[] {
  const days = parsePaymentTerms(terms);
  const base = Math.floor(amount / days.length);
  // Como no Bling, a sobra do arredondamento fica na primeira parcela.
  return days.map((value, index) => ({
    id: makeId(), days: value, dueOn: addDays(issueDate, value),
    amount: base + (index === 0 ? amount - base * days.length : 0),
    method: defaults.method, accountId: defaults.accountId, paymentType: defaults.method === "Pix" ? "17 - Pagamento Instantâneo (PIX)" : "15 - Boleto Bancário",
    authorization: "", notes: "",
  }));
}

export function nextNfeNumber(data: Database, series = "1") {
  return data.outgoingInvoices.filter((item) => Number(item.series) === Number(series))
    .reduce((max, item) => Math.max(max, item.number), 0) + 1;
}

function splitAddress(address: string) {
  const [street = "", rest = ""] = address.split(/,(.*)/s).map((part) => part.trim());
  return { street: street.slice(0, 160), number: rest.split(/\s*[-,]\s*/)[0]?.slice(0, 20) ?? "" };
}

export function recipientFromClient(client: Client | undefined): OutgoingInvoice["recipient"] {
  const document = (client?.document ?? "").replace(/\D/g, "");
  const address = splitAddress(client?.address ?? "");
  const state = client?.address.match(/\b([A-Z]{2})\b(?!.*\b[A-Z]{2}\b)/)?.[1] ?? "";
  return {
    clientId: client?.id ?? "", name: client?.name ?? "", personType: document.length === 11 ? "F" : "J",
    document, stateRegistration: "", seller: "", finalConsumer: document.length === 11, phone: client?.phone ?? "",
    email: client?.email ?? "", governmentPurchase: "", postalCode: client?.address.match(/\b\d{5}-?\d{3}\b/)?.[0] ?? "",
    state, city: "", district: "", street: address.street, number: address.number, complement: "",
  };
}

function eventAt(previous?: string) {
  const now = new Date();
  if (previous && now.toISOString() <= previous) return new Date(Date.parse(previous) + 1).toISOString();
  return now.toISOString();
}

export function blankNfe(data: Database): OutgoingInvoice {
  const at = new Date().toISOString();
  return {
    id: makeId(), kind: "nfe", status: "Pendente", number: nextNfeNumber(data), series: "1",
    outputType: "Emissão própria", store: "", businessUnit: "", operationNature: defaultOperationNature,
    issueDate: localDay(), exitDate: localDay(), exitTime: "",
    taxRegime: data.settings.simpleNationalOptIn === false ? "3" : data.settings.meiOptIn ? "4" : "1",
    purpose: "1", presence: "9", recipient: recipientFromClient(undefined), items: [], autoCalculation: true,
    retentions: { minimum: 0, base: 0, ir: 0, csll: 0, pis: 0, cofins: 0, iss: 0 },
    transport: {
      mode: "none", freightBy: "9", logistics: "",
      carrier: { name: "", plate: "", plateState: "", rntc: "", document: "", stateRegistration: "", state: "", city: "", address: "" },
      volumes: { quantity: "", grossWeight: "", netWeight: "", numbering: "", species: "", brand: "" },
      differentDelivery: false,
      delivery: { name: "", document: "", postalCode: "", state: "", city: "", district: "", street: "", number: "", complement: "" },
    },
    payment: { terms: "", category: "Vendas de mercadorias", installments: [] },
    xmlAuthorized: [],
    additional: { storeOrderNumber: "", storeOrigin: "", channel: "", complementary: "", natureComplementary: "", fiscoInfo: "" },
    salesOrderId: "", serviceOrderId: "", invoiceId: "", entryIds: [], createdAt: at, updatedAt: at,
    events: [{ at, description: "Nota fiscal incluída" }],
  };
}

export function blankNfeItem(): NfeItem {
  return { id: makeId(), kind: "produto", referenceId: "", salesOrderLineId: "", name: "", code: "", unit: "UN",
    quantity: 1, price: 0, freight: 0, discount: 0, fields: defaultItemFields() };
}

/** Distribui um valor proporcionalmente aos pesos, conservando os centavos. */
function distribute(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let accumulated = 0, allocated = 0;
  return weights.map((weight) => {
    accumulated += weight;
    const next = sum ? Math.round((total * accumulated) / sum) : 0;
    const share = next - allocated;
    allocated = next;
    return share;
  });
}

export function nfeDraftFromSalesOrder(data: Database, orderId: string): OutgoingInvoice {
  const order = data.salesOrders.find((item) => item.id === orderId);
  if (!order) throw new Error("Pedido de venda não encontrado.");
  if (order.status === "Cancelado") throw new Error("Pedidos cancelados não geram nota fiscal.");
  const lines = order.items.filter((item) => item.kind === "produto");
  if (!lines.length) throw new Error("O pedido não possui produtos para gerar a nota fiscal.");
  const client = data.clients.find((item) => item.id === order.clientId);
  const draft = blankNfe(data);
  const nets = lines.map(salesOrderLineTotal);
  const products = nets.reduce((a, b) => a + b, 0);
  const base = salesOrderTotal({ ...order, discount: 0 });
  const allocation = salesOrderInvoices(data, order.id).flatMap((invoice) => invoice.orders).find((item) => item.orderId === order.id)?.allocation;
  // Sem faturamento anterior, frete e outras despesas vão na NF-e; com rateio existente, eles já foram cobrados nos serviços.
  const shipping = allocation ? 0 : order.shippingCost;
  const otherExpenses = allocation ? 0 : order.otherExpenses;
  const productDiscount = allocation ? Math.max(0, products - allocation.products)
    : base ? Math.round((order.discount * (products + shipping + otherExpenses)) / base) : 0;
  const discounts = distribute(productDiscount, nets);
  const freights = distribute(shipping, nets);
  const others = distribute(otherExpenses, nets);
  const items = lines.map((line, index): NfeItem => {
    const product = data.products.find((item) => item.id === line.referenceId);
    const fields = defaultItemFields();
    if (others[index]) fields["others.otherExpenses"] = fromCents(others[index]);
    return {
      id: makeId(), kind: "produto", referenceId: line.referenceId, salesOrderLineId: line.id, name: line.name.slice(0, 120),
      code: product?.code ?? "", unit: "UN", quantity: line.quantity, price: line.price, freight: freights[index],
      discount: Math.round(line.quantity * line.price) - nets[index] + discounts[index], fields,
    };
  });
  const recipient = { ...recipientFromClient(client), seller: order.seller };
  const nfe = recalculateNfe({
    ...draft, recipient, items, salesOrderId: order.id,
    transport: { ...draft.transport, freightBy: order.shippingCost ? "0" : "9" },
    payment: { ...draft.payment, terms: order.paymentTerms.slice(0, 120) },
    additional: { ...draft.additional, complementary: order.notes.slice(0, 5000) },
    events: [{ at: draft.createdAt, description: `Nota fiscal gerada a partir do pedido ${order.code}` }],
  });
  return { ...nfe, payment: { ...nfe.payment, installments: defaultInstallments(data, nfe) } };
}

/** Gera a NF-e com as peças da OS (menu da OS › Gerar nota fiscal); as contas vêm do faturamento da OS. */
export function nfeDraftFromServiceOrder(data: Database, orderId: string): OutgoingInvoice {
  const order = data.orders.find((item) => item.id === orderId);
  if (!order) throw new Error("Ordem de serviço não encontrada.");
  const existing = data.outgoingInvoices.find((item) => item.serviceOrderId === order.id && item.status !== "Cancelada");
  if (existing) return existing;
  const details = getOrderDetails(order);
  const lines = details.items.filter((item) => item.kind === "produto");
  if (!lines.length) throw new Error("A OS não possui produtos para gerar a nota fiscal.");
  const nets = lines.map((line) => Math.round(line.quantity * line.price) - line.discount);
  const orderDiscount = Math.max(0, nets.reduce((a, b) => a + b, 0) - splitBillingValues(details).products);
  const discounts = distribute(orderDiscount, nets);
  const client = data.clients.find((item) => item.id === order.clientId);
  const draft = blankNfe(data);
  const items = lines.map((line, index): NfeItem => {
    const product = data.products.find((item) => item.id === line.referenceId);
    return {
      id: makeId(), kind: "produto", referenceId: line.referenceId, salesOrderLineId: "", name: line.name.slice(0, 120),
      code: product?.code ?? "", unit: "UN", quantity: line.quantity, price: line.price, freight: 0,
      discount: line.discount + discounts[index], fields: defaultItemFields(),
    };
  });
  return recalculateNfe({
    ...draft, recipient: { ...recipientFromClient(client), seller: order.technician.slice(0, 120) }, items, serviceOrderId: order.id,
    additional: { ...draft.additional, complementary: `Ordem de serviço ${order.code}` },
    events: [{ at: draft.createdAt, description: `Nota fiscal gerada da ordem de serviço ${order.code}` }],
  });
}

export function defaultInstallments(data: Database, nfe: OutgoingInvoice): NfeInstallment[] {
  const target = nfeBillingTarget(data, nfe);
  if (target.mode !== "create" || target.amount <= 0) return [];
  const accountId = data.finance.accounts.find((account) => account.active)?.id ?? "";
  try {
    return generateNfeInstallments(nfe.payment.terms, target.amount, nfe.issueDate, { method: "Boleto", accountId });
  } catch {
    return generateNfeInstallments("", target.amount, nfe.issueDate, { method: "Boleto", accountId });
  }
}

export type NfeBillingTarget =
  | { mode: "linked"; invoice: Invoice; entries: FinanceEntry[] }
  | { mode: "entries"; entries: FinanceEntry[] }
  | { mode: "external"; message: string }
  | { mode: "create"; amount: number; fixed: boolean; order?: SalesOrder };

/** Indica de onde vêm as parcelas da nota: contas já lançadas, ou o valor a faturar ao salvar. */
export function nfeBillingTarget(data: Database, nfe: OutgoingInvoice): NfeBillingTarget {
  const linked = nfe.invoiceId ? data.finance.invoices.find((item) => item.id === nfe.invoiceId && !item.canceled) : undefined;
  if (linked) return { mode: "linked", invoice: linked, entries: data.finance.entries.filter((entry) => entry.invoiceId === linked.id) };
  const own = data.finance.entries.filter((entry) => nfe.entryIds.includes(entry.id) && !entry.canceled);
  if (own.length) return { mode: "entries", entries: own };
  const order = nfe.salesOrderId ? data.salesOrders.find((item) => item.id === nfe.salesOrderId) : undefined;
  if (order) {
    const active = salesOrderInvoices(data, order.id);
    const products = active.find((invoice) => invoice.kind === "Produtos");
    if (products) return { mode: "linked", invoice: products, entries: data.finance.entries.filter((entry) => entry.invoiceId === products.id) };
    const allocation = active.flatMap((invoice) => invoice.orders).find((item) => item.orderId === order.id)?.allocation;
    if (allocation) return { mode: "create", amount: allocation.products, fixed: true, order };
    return { mode: "create", amount: nfeTotals(nfe).billed, fixed: false, order };
  }
  if (nfe.serviceOrderId) {
    const billed = salesOrderInvoices(data, nfe.serviceOrderId).find((invoice) => invoice.kind !== "Serviços");
    if (billed) return { mode: "linked", invoice: billed, entries: data.finance.entries.filter((entry) => entry.invoiceId === billed.id) };
    return { mode: "external", message: "As contas desta nota são lançadas pelo faturamento da ordem de serviço (Financeiro › Faturamento)." };
  }
  return { mode: "create", amount: nfeTotals(nfe).billed, fixed: false };
}

export function nfeAccountsPosted(data: Database, nfe: OutgoingInvoice) {
  const target = nfeBillingTarget(data, nfe);
  return target.mode === "linked" || target.mode === "entries";
}

function activeAccountId(data: Database, accountId: string) {
  const account = data.finance.accounts.find((item) => item.id === accountId && item.active)
    ?? (!accountId ? data.finance.accounts.find((item) => item.active) : undefined);
  if (!account) throw new Error("Selecione uma conta financeira ativa para as parcelas.");
  return account.id;
}

function postAccounts(data: Database, nfe: OutgoingInvoice): { data: Database; nfe: OutgoingInvoice } {
  const target = nfeBillingTarget(data, nfe);
  if (target.mode === "linked") return { data, nfe: { ...nfe, invoiceId: target.invoice.id } };
  if (target.mode === "entries") return { data, nfe };
  if (target.mode === "external") throw new Error(target.message);
  const installments = nfe.payment.installments;
  if (!installments.length) throw new Error("Gere as parcelas da nota antes de lançar as contas.");
  const sum = installments.reduce((total, item) => total + item.amount, 0);
  if (target.amount <= 0) throw new Error("A nota não possui valor faturado para lançar contas.");
  if (sum !== target.amount)
    throw new Error(`A soma das parcelas (R$ ${fromCents(sum).replace(".", ",")}) deve ser igual ao ${target.fixed ? "valor de produtos já rateado no pedido" : "total faturado"} (R$ ${fromCents(target.amount).replace(".", ",")}).`);
  if (installments.some((item) => item.amount <= 0)) throw new Error("Todas as parcelas devem ter valor maior que zero.");
  if (installments.some((item) => item.dueOn < nfe.issueDate)) throw new Error("O vencimento das parcelas não pode anteceder a emissão.");
  const order = target.order;
  const client = data.clients.find((item) => item.id === (order?.clientId ?? nfe.recipient.clientId));
  const party = (client?.name ?? nfe.recipient.name).slice(0, 160);
  const invoiceId = order ? makeId() : "";
  const entries = installments.map((item, index) => financeEntrySchema.parse({
    id: makeId(), kind: "Receber", party, clientId: client?.id,
    description: `NF ${nfe.number}${order ? ` · Pedido ${order.code}` : ""}${installments.length > 1 ? ` · Parcela ${index + 1}/${installments.length}` : ""}`,
    amount: item.amount, issuedOn: nfe.issueDate, dueOn: item.dueOn, accountId: activeAccountId(data, item.accountId),
    paymentMethod: item.method, ...(invoiceId ? { invoiceId } : {}),
  }));
  if (order) {
    if (!client) throw new Error("Cliente do pedido não encontrado.");
    const active = salesOrderInvoices(data, order.id);
    const previous = active.flatMap((invoice) => invoice.orders).find((item) => item.orderId === order.id)?.allocation;
    const allocation = previous ?? { products: target.amount, services: Math.max(0, salesOrderTotal(order) - target.amount) };
    const invoice: Invoice = {
      id: invoiceId, kind: "Produtos", clientId: client.id, clientName: client.name, createdOn: localDay(), canceled: false,
      amount: target.amount,
      orders: [{ orderId: order.id, code: order.code, title: "Pedido de venda", amount: target.amount, allocation }],
    };
    return {
      data: { ...data, finance: { ...data.finance, invoices: [...data.finance.invoices, invoice], entries: [...data.finance.entries, ...entries] } },
      nfe: { ...nfe, invoiceId },
    };
  }
  return {
    data: { ...data, finance: { ...data.finance, entries: [...data.finance.entries, ...entries] } },
    nfe: { ...nfe, entryIds: entries.map((entry) => entry.id) },
  };
}

function replaceNfe(data: Database, nfe: OutgoingInvoice) {
  const exists = data.outgoingInvoices.some((item) => item.id === nfe.id);
  return { ...data, outgoingInvoices: exists ? data.outgoingInvoices.map((item) => item.id === nfe.id ? nfe : item) : [...data.outgoingInvoices, nfe] };
}

function findNfe(data: Database, id: string) {
  const nfe = data.outgoingInvoices.find((item) => item.id === id);
  if (!nfe) throw new Error("Nota fiscal não encontrada.");
  return nfe;
}

/** Salva a nota como Pendente; lança as contas pelas parcelas e marca o pedido como Atendido. */
export function saveNfe(data: Database, input: OutgoingInvoice): Database {
  const existing = data.outgoingInvoices.find((item) => item.id === input.id);
  if (existing && existing.status !== "Pendente") throw new Error("Somente notas pendentes podem ser alteradas.");
  let nfe = outgoingInvoiceSchema.parse(recalculateNfe(input));
  const issues = nfeBlockingIssues(nfe);
  if (issues.length) throw new Error(issues[0]);
  if (nfe.salesOrderId) {
    const order = data.salesOrders.find((item) => item.id === nfe.salesOrderId);
    if (!order) throw new Error("Pedido de venda da nota não encontrado.");
    if (order.status === "Cancelado") throw new Error("Pedidos cancelados não geram nota fiscal.");
    if (nfe.recipient.clientId !== order.clientId) throw new Error("O destinatário deve ser o cliente do pedido de venda.");
  }
  const taken = data.outgoingInvoices.some((item) => item.id !== nfe.id && Number(item.series) === Number(nfe.series) && item.number === nfe.number);
  // Como no Bling, o número pode mudar ao gravar se já tiver sido usado na série.
  if (taken) nfe = { ...nfe, number: nextNfeNumber(data, nfe.series) };
  const at = eventAt(existing?.events.at(-1)?.at ?? nfe.createdAt);
  nfe = { ...nfe, updatedAt: at, events: existing ? [...existing.events, { at, description: "Nota fiscal alterada" }] : nfe.events };
  let result: Database = data;
  const target = nfeBillingTarget(data, nfe);
  if (target.mode === "linked") nfe = { ...nfe, invoiceId: target.invoice.id };
  else if (target.mode === "external") nfe = { ...nfe, payment: { ...nfe.payment, installments: [] } };
  else if (target.mode === "create" && nfe.payment.installments.length) {
    const posted = postAccounts(result, nfe);
    result = posted.data;
    nfe = { ...posted.nfe, events: [...posted.nfe.events, { at, description: "Contas lançadas pela nota fiscal" }] };
  }
  result = replaceNfe(result, nfe);
  const order = nfe.salesOrderId ? result.salesOrders.find((item) => item.id === nfe.salesOrderId) : undefined;
  if (order && order.status !== "Atendido") result = changeSalesOrderStatus(result, order.id, "Atendido");
  return validateDatabase(result);
}

export function postNfeAccounts(data: Database, id: string): Database {
  const nfe = findNfe(data, id);
  if (nfe.status !== "Pendente") throw new Error("Notas canceladas não lançam contas.");
  if (nfeAccountsPosted(data, nfe)) throw new Error("As contas desta nota já foram lançadas.");
  let installments = nfe.payment.installments;
  const target = nfeBillingTarget(data, nfe);
  if (target.mode === "create" && installments.reduce((sum, item) => sum + item.amount, 0) !== target.amount)
    installments = generateNfeInstallments(nfe.payment.terms, target.amount, localDay() > nfe.issueDate ? localDay() : nfe.issueDate,
      { method: installments[0]?.method ?? "Boleto", accountId: installments[0]?.accountId ?? "" });
  const posted = postAccounts(data, { ...nfe, payment: { ...nfe.payment, installments } });
  const at = eventAt(nfe.events.at(-1)?.at);
  return validateDatabase(replaceNfe(posted.data, { ...posted.nfe, updatedAt: at,
    events: [...posted.nfe.events, { at, description: "Contas lançadas pela nota fiscal" }] }));
}

export function reverseNfeAccounts(data: Database, id: string): Database {
  const nfe = findNfe(data, id);
  const target = nfeBillingTarget(data, nfe);
  if (target.mode === "create" || target.mode === "external") throw new Error("Esta nota não possui contas lançadas.");
  if (target.entries.some((entry) => entry.settlements.some((item) => !item.reversed)))
    throw new Error("Estorne os recebimentos das parcelas antes de estornar as contas.");
  let result = data;
  if (target.mode === "linked") result = cancelFinanceEntry(result, target.entries[0].id);
  else for (const entry of target.entries) result = cancelFinanceEntry(result, entry.id);
  const at = eventAt(nfe.events.at(-1)?.at);
  return validateDatabase(replaceNfe(result, { ...nfe, invoiceId: "", entryIds: [], updatedAt: at,
    events: [...nfe.events, { at, description: "Contas da nota fiscal estornadas" }] }));
}

export function nfeStockPosted(data: Database, nfe: OutgoingInvoice) {
  const order = nfe.salesOrderId ? data.salesOrders.find((item) => item.id === nfe.salesOrderId) : undefined;
  return order ? salesOrderStockPosted(order) : false;
}

export function postNfeStock(data: Database, id: string): Database {
  const nfe = findNfe(data, id);
  if (!nfe.salesOrderId) throw new Error("Notas sem pedido de venda ainda não movimentam estoque.");
  if (nfe.status !== "Pendente") throw new Error("Notas canceladas não movimentam estoque.");
  return postSalesOrderStock(data, nfe.salesOrderId);
}

export function reverseNfeStock(data: Database, id: string): Database {
  const nfe = findNfe(data, id);
  if (!nfe.salesOrderId) throw new Error("Esta nota não possui estoque lançado.");
  return reverseSalesOrderStock(data, nfe.salesOrderId);
}

export function cancelNfe(data: Database, id: string, reason: string): Database {
  const nfe = findNfe(data, id);
  if (nfe.status === "Cancelada") throw new Error("Esta nota já está cancelada.");
  if (reason.trim().length < 5) throw new Error("Informe o motivo do cancelamento com pelo menos 5 caracteres.");
  if (nfeAccountsPosted(data, nfe))
    throw new Error("Estorne as contas da nota antes de cancelá-la.");
  const at = eventAt(nfe.events.at(-1)?.at);
  return validateDatabase(replaceNfe(data, { ...nfe, status: "Cancelada", updatedAt: at,
    events: [...nfe.events, { at, description: `Nota fiscal cancelada: ${reason.trim()}`.slice(0, 500) }] }));
}

export function deleteNfe(data: Database, id: string): Database {
  const nfe = findNfe(data, id);
  if (nfe.status !== "Pendente") throw new Error("Somente notas pendentes podem ser excluídas.");
  if (nfeAccountsPosted(data, nfe)) throw new Error("Estorne as contas da nota antes de excluí-la.");
  return validateDatabase({ ...data, outgoingInvoices: data.outgoingInvoices.filter((item) => item.id !== id) });
}

export function cloneNfe(data: Database, id: string): OutgoingInvoice {
  const source = findNfe(data, id);
  const blank = blankNfe(data);
  return {
    ...source, id: blank.id, status: "Pendente", number: blank.number, issueDate: blank.issueDate, exitDate: blank.exitDate,
    exitTime: "", salesOrderId: "", invoiceId: "", entryIds: [], createdAt: blank.createdAt, updatedAt: blank.updatedAt,
    items: source.items.map((item) => ({ ...item, id: makeId(), salesOrderLineId: "" })),
    payment: { ...source.payment, installments: source.payment.installments.map((item) => ({
      ...item, id: makeId(), dueOn: addDays(blank.issueDate, item.days) })) },
    events: [{ at: blank.createdAt, description: `Nota fiscal clonada da NF ${String(source.number).padStart(6, "0")}` }],
  };
}

export const nfeNumberLabel = (nfe: Pick<OutgoingInvoice, "number">) => String(nfe.number).padStart(6, "0");
