import { z } from "zod";
import { requireValue } from "./errors.js";
import type { InvoiceCalculationRecord } from "./invoiceCalculation.js";
import type { FiscalAddress } from "./identification.js";
import { NFE_NS } from "./xml.js";

export const generatedNfeSchema = z.object({
  invoiceId: z.string().min(1).max(200),
  environment: z.literal("homologacao"),
  series: z.number().int().min(0).max(889),
  expectedNumber: z.number().int().min(1).max(999999999),
  issuedAt: z.iso.datetime({ offset: true }).refine((value) => value.startsWith("2026-") && value.endsWith("-03:00"),
    "Gerador limitado a 2026, com horário explícito de Santa Catarina (-03:00)."),
  nature: z.string().trim().min(1).max(60),
  presence: z.enum(["0", "1"]),
  paymentTiming: z.enum(["0", "1"]),
  confirmNoGtin: z.literal(true),
  confirmNoFreight: z.literal(true),
  confirmScope: z.literal(true),
}).strict();
export type GeneratedNfeInput = z.infer<typeof generatedNfeSchema>;
const escapeXml = (value: string) => {
  requireValue(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value), "Texto contém caracteres inválidos para XML.");
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
};
const tag = (name: string, value: string | number) => `<${name}>${escapeXml(String(value))}</${name}>`;
const cents = (value: string) => {
  requireValue(/^\d+\.\d{2}$/.test(value), "Valor inválido na memória fiscal.");
  const [integer, fraction] = value.split(".");
  return BigInt(integer!) * 100n + BigInt(fraction!);
};
const money = (value: bigint) => {
  requireValue(value >= 0n && value <= 999999999999999n, "Valor fora do limite monetário do XML NF-e.");
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
};
const rate = (value: string) => {
  const [integer, fraction = ""] = value.split(".");
  return `${integer}.${fraction.padEnd(2, "0")}`;
};
function address(address: FiscalAddress, phone?: string) {
  return tag("xLgr", address.street) + tag("nro", address.number) +
    (address.complement ? tag("xCpl", address.complement) : "") + tag("xBairro", address.district) +
    tag("cMun", address.municipality) + tag("xMun", address.city) + tag("UF", address.state) +
    tag("CEP", address.postalCode) + tag("cPais", "1058") + tag("xPais", "BRASIL") + (phone ? tag("fone", phone) : "");
}

export function generateNfe(calculation: InvoiceCalculationRecord, input: GeneratedNfeInput, numericCode: string) {
  generatedNfeSchema.parse(input);
  requireValue(calculation.kind === "nfe" && calculation.invoiceId === input.invoiceId, "Gerador exige faturamento de produtos correspondente.");
  requireValue(calculation.date === input.issuedAt.slice(0, 10), "Data da memória diferente da emissão.");
  requireValue(calculation.issuer.address.state === "SC" && calculation.recipient.address.state === "SC",
    "Gerador limitado a saída interna em Santa Catarina.");
  requireValue(/^\d{8}$/.test(numericCode), "Código numérico da chave inválido.");
  const keyBase = `42${input.issuedAt.slice(2, 4)}${input.issuedAt.slice(5, 7)}${calculation.issuer.cnpj}55${String(input.series).padStart(3, "0")}${String(input.expectedNumber).padStart(9, "0")}1${numericCode}`;
  const sum = [...keyBase].reverse().reduce((sum, digit, index) => sum + Number(digit) * (2 + index % 8), 0);
  const remainder = 11 - sum % 11;
  const digit = remainder >= 10 ? 0 : remainder;
  const key = `NFe${keyBase}${digit}`;
  const totals = new Map<string, bigint>();
  const accumulate = (name: string, value: string) => totals.set(name, (totals.get(name) ?? 0n) + cents(value));
  const total = (name: string) => money(totals.get(name) ?? 0n);
  const details = calculation.lines.map((line, index) => {
    const { item, classification, matrix } = line;
    requireValue(classification.kind === "nfe" && matrix.parameters.kind === "nfe", "Item não pertence ao modelo NF-e.");
    const parameters = matrix.parameters;
    requireValue(parameters.cfop === "5102" && parameters.icms.cst === "00" &&
      ["01", "02"].includes(parameters.pis.cst) && ["01", "02"].includes(parameters.cofins.cst) &&
      parameters.ibsCbs.cst === "000" && parameters.ibsCbs.classification === "000001",
    "Gerador limitado à revenda 5102, ICMS00, PIS/COFINS01/02 e IBS/CBS000/000001.");
    const code = z.string().min(1).max(60).parse(item.referenceId);
    z.string().min(1).max(120).parse(item.name);
    const quantity = item.quantity.toFixed(4);
    requireValue(Number(quantity) === item.quantity && item.price > 0, "Quantidade exige até 4 casas e preço unitário positivo; corrija a OS antes de faturar.");
    // Recalcula o bruto decimal exato para nao reproduzir diferencas do ponto flutuante da OS no XML.
    const quantityUnits = BigInt(quantity.replace(".", ""));
    requireValue((quantityUnits * BigInt(item.price) + 5000n) / 10000n === BigInt(item.gross),
      "Bruto faturado diverge da quantidade/preço decimal exatos. Reconfira o faturamento.");
    const result = line.calculation.items[0];
    requireValue(line.calculation.items.length === 1 && result, "Memória fiscal inválida por item.");
    const tax = (code: string) => {
      const found = result.taxes.filter((tax) => tax.code === code);
      requireValue(found.length === 1 && found[0] && !found[0].retained, `Tributo ${code} ausente/retido na memória.`);
      return found[0];
    };
    const icms = tax("icms"), pis = tax("pis"), cofins = tax("cofins"), uf = tax("ibs-state"), mun = tax("ibs-municipal"), cbs = tax("cbs");
    accumulate("vProd", result.gross); accumulate("vDesc", result.discount);
    accumulate("vBC", icms.base); accumulate("vICMS", icms.amount);
    accumulate("vPIS", pis.amount); accumulate("vCOFINS", cofins.amount);
    accumulate("vBCIBSCBS", uf.base); accumulate("vIBSUF", uf.amount);
    accumulate("vIBSMun", mun.amount); accumulate("vCBS", cbs.amount); accumulate("vNF", result.net);
    const prod = tag("cProd", code) + tag("cEAN", "SEM GTIN") + tag("xProd", item.name) + tag("NCM", classification.ncm) +
      tag("CFOP", parameters.cfop) + tag("uCom", classification.unit) + tag("qCom", quantity) + tag("vUnCom", money(BigInt(item.price))) +
      tag("vProd", result.gross) + tag("cEANTrib", "SEM GTIN") + tag("uTrib", classification.unit) +
      tag("qTrib", quantity) + tag("vUnTrib", money(BigInt(item.price))) +
      (cents(result.discount) > 0n ? tag("vDesc", result.discount) : "") + tag("indTot", 1);
    const contribution = (name: "PIS" | "COFINS", value: typeof pis, cst: string) =>
      `<${name}><${name}Aliq>${tag("CST", cst)}${tag("vBC", value.base)}${tag(`p${name}`, rate(value.rate))}${tag(`v${name}`, value.amount)}</${name}Aliq></${name}>`;
    const ibs = `<IBSCBS>${tag("CST", parameters.ibsCbs.cst)}${tag("cClassTrib", parameters.ibsCbs.classification)}<gIBSCBS>${tag("vBC", uf.base)}` +
      `<gIBSUF>${tag("pIBSUF", rate(uf.rate))}${tag("vIBSUF", uf.amount)}</gIBSUF>` +
      `<gIBSMun>${tag("pIBSMun", rate(mun.rate))}${tag("vIBSMun", mun.amount)}</gIBSMun>` +
      tag("vIBS", money(cents(uf.amount) + cents(mun.amount))) +
      `<gCBS>${tag("pCBS", rate(cbs.rate))}${tag("vCBS", cbs.amount)}</gCBS></gIBSCBS></IBSCBS>`;
    return `<det nItem="${index + 1}"><prod>${prod}</prod><imposto><ICMS><ICMS00>${tag("orig", classification.origin)}${tag("CST", "00")}${tag("modBC", 3)}${tag("vBC", icms.base)}${tag("pICMS", rate(icms.rate))}${tag("vICMS", icms.amount)}</ICMS00></ICMS>` +
      contribution("PIS", pis, parameters.pis.cst) + contribution("COFINS", cofins, parameters.cofins.cst) +
      ibs + `</imposto>${tag("vItem", result.net)}</det>`;
  }).join("");
  requireValue(total("vNF") === calculation.totals.net && cents(calculation.totals.withheld) === 0n,
    "Total de produtos/retencões incompatível com a memória fiscal.");
  const issuer = calculation.issuer, recipient = calculation.recipient;
  const ide = tag("cUF", 42) + tag("cNF", numericCode) + tag("natOp", input.nature) + tag("mod", 55) +
    tag("serie", input.series) + tag("nNF", input.expectedNumber) + tag("dhEmi", input.issuedAt) + tag("tpNF", 1) +
    tag("idDest", 1) + tag("cMunFG", issuer.municipality) + tag("tpImp", 1) + tag("tpEmis", 1) + tag("cDV", digit) +
    tag("tpAmb", 2) + tag("finNFe", 1) + tag("indFinal", recipient.finalConsumer ? 1 : 0) + tag("indPres", input.presence) +
    tag("procEmi", 0) + tag("verProc", "Alpha-0.1");
  const emit = tag("CNPJ", issuer.cnpj) + tag("xNome", issuer.name) + `<enderEmit>${address(issuer.address, issuer.phone)}</enderEmit>` +
    tag("IE", issuer.ie) + tag("CRT", 3);
  const dest = tag(recipient.document.length === 14 ? "CNPJ" : "CPF", recipient.document) +
    tag("xNome", "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL") +
    `<enderDest>${address(recipient.address, recipient.phone)}</enderDest>` + tag("indIEDest", recipient.ieIndicator) +
    (recipient.ieIndicator === "1" ? tag("IE", recipient.ie) : "") + (recipient.email ? tag("email", recipient.email) : "");
  const oldTotals = ["vBC", "vICMS", "vICMSDeson", "vFCP", "vBCST", "vST", "vFCPST", "vFCPSTRet", "vProd",
    "vFrete", "vSeg", "vDesc", "vII", "vIPI", "vIPIDevol", "vPIS", "vCOFINS", "vOutro", "vNF"].map((name) => tag(name, total(name))).join("");
  const ibsTotal = tag("vBCIBSCBS", total("vBCIBSCBS")) + `<gIBS><gIBSUF>${tag("vDif", "0.00")}${tag("vDevTrib", "0.00")}${tag("vIBSUF", total("vIBSUF"))}</gIBSUF>` +
    `<gIBSMun>${tag("vDif", "0.00")}${tag("vDevTrib", "0.00")}${tag("vIBSMun", total("vIBSMun"))}</gIBSMun>` +
    tag("vIBS", money((totals.get("vIBSUF") ?? 0n) + (totals.get("vIBSMun") ?? 0n))) +
    tag("vCredPres", "0.00") + tag("vCredPresCondSus", "0.00") + `</gIBS><gCBS>${tag("vDif", "0.00")}${tag("vDevTrib", "0.00")}${tag("vCBS", total("vCBS"))}${tag("vCredPres", "0.00")}${tag("vCredPresCondSus", "0.00")}</gCBS>`;
  requireValue(["Boleto", "Pix"].includes(calculation.payment.paymentMethod), "Pagamento incompatível com NF-e.");
  let billing = "";
  if (input.paymentTiming === "1") {
    const dueOn = z.iso.date().parse(calculation.payment.dueOn);
    requireValue(dueOn >= input.issuedAt.slice(0, 10), "Vencimento da cobrança a prazo anterior à emissão. Corrija o financeiro antes de gerar.");
    if (calculation.payment.paymentMethod === "Boleto") billing = `<cobr><fat>${tag("nFat", input.expectedNumber)}${tag("vOrig", total("vNF"))}${tag("vDesc", "0.00")}${tag("vLiq", total("vNF"))}</fat>` +
      `<dup>${tag("nDup", "001")}${tag("dVenc", dueOn)}${tag("vDup", total("vNF"))}</dup></cobr>`;
  }
  return { key, xml: `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="${NFE_NS}"><infNFe Id="${key}" versao="4.00"><ide>${ide}</ide><emit>${emit}</emit><dest>${dest}</dest>${details}` +
    `<total><ICMSTot>${oldTotals}</ICMSTot><IBSCBSTot>${ibsTotal}</IBSCBSTot>${tag("vNFTot", total("vNF"))}</total><transp>${tag("modFrete", 9)}</transp>` +
    billing + `<pag><detPag>${tag("indPag", input.paymentTiming)}${tag("tPag", calculation.payment.paymentMethod === "Boleto" ? "15" : "17")}${tag("vPag", total("vNF"))}</detPag></pag>` +
    `<infAdic>${tag("infCpl", "DOCUMENTO DE HOMOLOGACAO SEM VALOR FISCAL. Gerado a partir de itens faturados no Alpha.")}</infAdic></infNFe></NFe>` };
}
