import { z } from "zod";
import { requireValue } from "./errors.js";
import type { InvoiceCalculationRecord } from "./invoiceCalculation.js";
import type { FiscalAddress } from "./identification.js";
import { NFSE_NS } from "./xml.js";
import { serviceRetentions } from "./retentions.js";

const percent = z.string().regex(/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/).refine((value) => Number(value) <= 100);
export const generatedDpsSchema = z.object({
  invoiceId: z.string().min(1).max(200),
  additionalServiceId: z.string().min(1).max(200).optional(),
  environment: z.literal("homologacao"),
  series: z.number().int().min(1).max(49999),
  expectedNumber: z.number().int().min(1).max(999999999999999),
  issuedAt: z.iso.datetime({ offset: true }).refine((value) => value.startsWith("2026-") && value.endsWith("-03:00")),
  competence: z.iso.date().refine((value) => value.startsWith("2026-")),
  operationIndicator: z.string().regex(/^\d{6}$/),
  personalUse: z.enum(["0", "1"]),
  totalTaxPercent: z.object({ federal: percent, state: percent, municipal: percent }).strict(),
  confirmScope: z.literal(true),
  confirmUnconditionalDiscount: z.literal(true),
  confirmRetentions: z.literal(true).optional(),
}).strict().refine((value) => value.competence <= value.issuedAt.slice(0, 10), "Competência posterior à emissão.");
export type GeneratedDpsInput = z.infer<typeof generatedDpsSchema>;
const tag = (name: string, value: string | number) => {
  const text = String(value);
  requireValue(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(text), "Texto contém caracteres inválidos para XML.");
  return `<${name}>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")}</${name}>`;
};
const amount = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
const address = (value: FiscalAddress) => `<end><endNac>${tag("cMun", value.municipality)}${tag("CEP", value.postalCode)}</endNac>` +
  tag("xLgr", value.street) + tag("nro", value.number) + (value.complement ? tag("xCpl", value.complement) : "") + tag("xBairro", value.district) + "</end>";

export function generateDps(calculation: InvoiceCalculationRecord, input: GeneratedDpsInput) {
  generatedDpsSchema.parse(input);
  requireValue(calculation.kind === "nfse" && calculation.invoiceId === input.invoiceId && calculation.date === input.competence,
    "Gerador DPS exige faturamento de serviços e competência correspondentes.");
  requireValue(calculation.lines.length > 0 && calculation.issuer.municipality === "4205407", "Emitente ou itens incompatíveis com DPS.");
  const first = calculation.lines[0]!;
  requireValue(first.classification.kind === "nfse" && first.matrix.parameters.kind === "nfse", "Classificação de serviço ausente.");
  const classification = first.classification, parameters = first.matrix.parameters;
  requireValue(classification.nationalCode === "140101", "Gerador limitado à manutenção cTribNac140101; outros serviços e grupos específicos ainda não suportados.");
  const retentions = serviceRetentions(calculation);
  requireValue(parameters.iss.incidenceMunicipality === "4205407" && Number(parameters.iss.basePercent) === 100 &&
    Number(parameters.iss.rate) >= 2 && Number(parameters.iss.rate) <= 5 &&
    /^\d+(?:\.\d{1,2})?$/.test(parameters.iss.rate),
  "Gerador limitado a ISS próprio de Florianópolis, base integral, alíquota de 2 a 5 com até 2 casas, sem benefícios.");
  requireValue(parameters.ibsCbs.cst === "000" && parameters.ibsCbs.classification === "000001",
    "Gerador DPS limitado a IBS/CBS000/000001.");
  const descriptions = calculation.lines.map((line) => {
    requireValue(line.classification.kind === "nfse" && line.matrix.parameters.kind === "nfse" &&
      line.classification.nationalCode === classification.nationalCode &&
      line.classification.municipalCode === classification.municipalCode && line.classification.nbs === classification.nbs &&
      JSON.stringify(line.matrix.parameters) === JSON.stringify(parameters),
    "Uma DPS exige classificação e parâmetros tributários idênticos em todos os serviços/adicionais. Agrupamentos distintos ainda não suportados; não use código genérico.");
    const fields = line.matrix.ruleSnapshot.fields;
    for (const [field, actual] of Object.entries({ cIndOp: input.operationIndicator, tribISSQN: "1",
      cLocPrestacao: "4205407", opSimpNac: "1", regEspTrib: "0", tpRetISSQN: "1" })) {
      requireValue(!fields[field] || fields[field] === actual, `DPS diverge da referência revisada em ${field}. Reconcilie a operação antes de gerar.`);
    }
    return `${line.orderCode} - ${line.item.name} | qtd ${line.item.quantity} | bruto ${amount(line.item.gross)} | desconto ${amount(line.item.itemDiscount + line.item.orderDiscount)} | líquido ${line.calculation.totals.net}`;
  });
  const description = descriptions.join("; ");
  requireValue(description.length <= 2000, "Discriminação dos serviços excede 2000 caracteres; não será truncada.");
  const issuer = calculation.issuer, recipient = calculation.recipient;
  const key = `DPS42054072${issuer.cnpj}${String(input.series).padStart(5, "0")}${String(input.expectedNumber).padStart(15, "0")}`;
  const prest = tag("CNPJ", issuer.cnpj) + `<regTrib>${tag("opSimpNac", "1")}${tag("regEspTrib", "0")}</regTrib>`;
  const toma = tag(recipient.document.length === 14 ? "CNPJ" : "CPF", recipient.document) +
    (recipient.im ? tag("IM", recipient.im) : "") + tag("xNome", recipient.name) + address(recipient.address) +
    (recipient.phone ? tag("fone", recipient.phone) : "") + (recipient.email ? tag("email", recipient.email) : "");
  const serv = `<locPrest>${tag("cLocPrestacao", "4205407")}</locPrest><cServ>${tag("cTribNac", classification.nationalCode)}` +
    (classification.municipalCode ? tag("cTribMun", classification.municipalCode) : "") + tag("xDescServ", description) +
    tag("cNBS", classification.nbs) + `</cServ><infoCompl>${tag("xInfComp", "TESTE SEM VALOR FISCAL. ISS e IBS/CBS dependem da parametrização nacional/municipal; valores da memória são prévia, não autorização.")}</infoCompl>`;
  // A DPS declara a classificacao; aliquotas/valores de ISS e IBS/CBS sao apurados pelo sistema nacional.
  const federal = retentions.withheld > 0 ? `<tribFed>` +
    (retentions.inss > 0 ? tag("vRetCP", amount(retentions.inss)) : "") +
    (retentions.irrf > 0 ? tag("vRetIRRF", amount(retentions.irrf)) : "") +
    (retentions.csll > 0 ? tag("vRetCSLL", amount(retentions.csll)) : "") + "</tribFed>" : "";
  const values = `<vServPrest>${tag("vServ", calculation.totals.gross)}</vServPrest>` +
    (calculation.totals.discount !== "0.00" ? `<vDescCondIncond>${tag("vDescIncond", calculation.totals.discount)}</vDescCondIncond>` : "") +
    `<trib><tribMun>${tag("tribISSQN", "1")}${tag("tpRetISSQN", "1")}</tribMun>${federal}<totTrib><pTotTrib>` +
    tag("pTotTribFed", input.totalTaxPercent.federal) + tag("pTotTribEst", input.totalTaxPercent.state) +
    tag("pTotTribMun", input.totalTaxPercent.municipal) + "</pTotTrib></totTrib></trib>";
  const rtc = tag("finNFSe", "0") + tag("indFinal", input.personalUse) + tag("cIndOp", input.operationIndicator) +
    tag("indDest", "0") + `<valores><trib><gIBSCBS>${tag("CST", parameters.ibsCbs.cst)}${tag("cClassTrib", parameters.ibsCbs.classification)}</gIBSCBS></trib></valores>`;
  return { key, xml: `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="${NFSE_NS}" versao="1.01"><infDPS Id="${key}">` +
    tag("tpAmb", "2") + tag("dhEmi", input.issuedAt) + tag("verAplic", "Alpha-0.1") + tag("serie", input.series) +
    tag("nDPS", input.expectedNumber) + tag("dCompet", input.competence) + tag("tpEmit", "1") + tag("cLocEmi", "4205407") +
    `<prest>${prest}</prest><toma>${toma}</toma><serv>${serv}</serv><valores>${values}</valores><IBSCBS>${rtc}</IBSCBS></infDPS></DPS>` };
}
