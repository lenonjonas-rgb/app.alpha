import { z } from "zod";
import { requireValue } from "./errors.js";
import { taxParametersSchema } from "./taxParameters.js";

const money = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, "Informe valor monetário não negativo com até 2 casas decimais e ponto.");
export const calculationItemsSchema = z.array(z.object({
  id: z.string().min(1).max(200),
  gross: money,
  discount: money,
}).strict()).min(1).max(200).refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Itens duplicados.");

const cents = (value: string) => {
  const [integer, decimal = ""] = value.split(".");
  return BigInt(integer!) * 100n + BigInt(decimal.padEnd(2, "0"));
};
const decimal = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
const percentage = (value: bigint, rate: string) => {
  const [integer, fraction = ""] = rate.split(".");
  const scaled = BigInt(integer!) * 10000n + BigInt(fraction.padEnd(4, "0"));
  return (value * scaled + 500000n) / 1000000n;
};
type TaxLine = { code: string; label: string; base: string; rate: string; amount: string; retained: boolean };

export function calculateTaxes(parametersInput: unknown, itemsInput: unknown) {
  const parameters = taxParametersSchema.parse(parametersInput);
  const items = calculationItemsSchema.parse(itemsInput);
  requireValue(parameters.ibsCbs.cst === "000" && parameters.ibsCbs.classification === "000001" &&
    Number(parameters.ibsCbs.basePercent) === 100,
  "Cálculo disponível somente para IBS/CBS CST 000, classificação 000001 e base integral; regimes especiais ainda não suportados.");
  if (parameters.kind === "nfe") {
    requireValue(parameters.cfop === "5102", "Cálculo NF-e limitado à revenda interna CFOP 5102; outras operações, DIFAL e FCP não suportados.");
    requireValue(parameters.icms.cst === "00" && Number(parameters.icms.basePercent) === 100,
      "Cálculo ICMS disponível somente para CST 00 com base integral, sem ST, redução, diferimento ou benefícios.");
    for (const tax of [parameters.pis, parameters.cofins])
      requireValue(["01", "02"].includes(tax.cst) && Number(tax.basePercent) === 100,
        "Cálculo PIS/COFINS disponível somente para CST 01/02 com base integral da composição escolhida.");
  } else {
    requireValue(Number(parameters.iss.basePercent) === 100,
      "Cálculo ISS disponível somente para base integral; deduções e regimes especiais não suportados.");
  }

  let totalGross = 0n, totalDiscount = 0n, totalNet = 0n, totalOwn = 0n, totalRetained = 0n;
  const calculated = items.map((item) => {
    const gross = cents(item.gross), discount = cents(item.discount), net = gross - discount;
    requireValue(gross > 0n && net > 0n, `Item ${item.id}: valor bruto deve ser positivo e desconto menor que o bruto.`);
    const taxes: TaxLine[] = [];
    let own = 0n, retained = 0n;
    const add = (code: string, label: string, base: bigint, rate: string, isRetained = false) => {
      requireValue(base >= 0n, `Item ${item.id}: base negativa para ${label}; confira a composição e as alíquotas.`);
      const amount = percentage(base, rate);
      taxes.push({ code, label, base: decimal(base), rate, amount: decimal(amount), retained: isRetained });
      if (isRetained) retained += amount; else own += amount;
      return amount;
    };
    let ibsBase = net;
    if (parameters.kind === "nfe") {
      const icms = add("icms", "ICMS", net, parameters.icms.rate);
      const pis = add("pis", "PIS", parameters.pis.baseMode === "net" ? net : net - icms, parameters.pis.rate);
      const cofins = add("cofins", "COFINS", parameters.cofins.baseMode === "net" ? net : net - icms, parameters.cofins.rate);
      if (parameters.ibsCbs.baseMode === "net-minus-icms-pis-cofins") ibsBase = net - icms - pis - cofins;
    } else {
      const iss = add("iss", "ISS", net, parameters.iss.rate, parameters.iss.retained);
      if (parameters.ibsCbs.baseMode === "net-minus-iss") ibsBase = net - iss;
      for (const [code, label, rate] of [
        ["pis-retained", "PIS retido", parameters.federalWithholding.pisRate],
        ["cofins-retained", "COFINS retida", parameters.federalWithholding.cofinsRate],
        ["csll-retained", "CSLL retida", parameters.federalWithholding.csllRate],
        ["inss-retained", "INSS retido", parameters.federalWithholding.inssRate],
        ["irrf-retained", "IRRF retido", parameters.federalWithholding.irrfRate],
      ] as const) add(code, label, net, rate, true);
    }
    add("ibs-state", "IBS estadual", ibsBase, parameters.ibsCbs.stateRate);
    add("ibs-municipal", "IBS municipal", ibsBase, parameters.ibsCbs.municipalRate);
    add("cbs", "CBS", ibsBase, parameters.ibsCbs.cbsRate);
    requireValue(retained <= net, `Item ${item.id}: retenções excedem o valor após desconto.`);
    totalGross += gross; totalDiscount += discount; totalNet += net; totalOwn += own; totalRetained += retained;
    return { id: item.id, gross: decimal(gross), discount: decimal(discount), net: decimal(net), taxes,
      ownTaxes: decimal(own), withheld: decimal(retained), afterWithholding: decimal(net - retained) };
  });
  return { kind: parameters.kind, rounding: "half-up-per-item" as const, items: calculated,
    totals: { gross: decimal(totalGross), discount: decimal(totalDiscount), net: decimal(totalNet),
      ownTaxes: decimal(totalOwn), withheld: decimal(totalRetained), afterWithholding: decimal(totalNet - totalRetained) } };
}
