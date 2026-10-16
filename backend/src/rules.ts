import { randomUUID } from "node:crypto";
import { z } from "zod";
import { elements, parseXml, single, text } from "./xml.js";
import { requireValue } from "./errors.js";

export const ruleSchema = z.object({
  id: z.string().min(1).default(() => randomUUID()),
  kind: z.enum(["nfe", "nfse"]),
  name: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(300),
  scope: z.string().trim().min(10).max(1000),
  reviewed: z.boolean().default(false),
  fields: z.record(z.string().max(100), z.string().max(3000)),
}).superRefine((rule, context) => {
  if (!rule.reviewed) return;
  const has = (keys: string[]) => keys.some((key) => Boolean(rule.fields[key]?.trim()));
  const complete = rule.kind === "nfe" ? has(["NCM", "prod.NCM"]) && has(["CFOP", "prod.CFOP"]) : has(["cTribNac"]) && has(["ISS_percent", "pAliq"]);
  if (!complete) context.addIssue({ code: "custom", message: "Referência revisada exige NCM/CFOP ou código de serviço/alíquota ISS." });
});
export type TaxRule = z.infer<typeof ruleSchema>;
export function assertRuleMatches(xml: string, rule: TaxRule) {
  const document = parseXml(xml);
  const numeric = (value: string) => Number(value.replace(",", "."));
  const same = (actual: string, expected: string, key: string) => {
    const matches = /percent|^p[A-Z]|basePercent/.test(key) ? numeric(actual) === numeric(expected) : actual.replace(/[.\s]/g, "") === expected.replace(/[.\s]/g, "");
    requireValue(matches, `Tributação XML diverge da referência revisada: ${key}. Confira a operação; não altere alíquotas automaticamente.`);
  };
  if (rule.kind === "nfse") {
    const info = single(document, "infDPS");
    const mapping: Record<string, string> = { cTribNac: "cTribNac", cTribMun: "cTribMun", cNBS: "cNBS", ISS_percent: "pAliq", pAliq: "pAliq", CST: "CST", cClassTrib: "cClassTrib", cIndOp: "cIndOp", tpRetISSQN: "tpRetISSQN" };
    for (const [key, tag] of Object.entries(mapping)) {
      const expected = rule.fields[key];
      if (expected !== undefined && expected !== "") same(text(key === "CST" ? single(info, "IBSCBS") : info, tag), expected, key);
    }
    if (rule.fields.reterISS === "N") requireValue(text(info, "tpRetISSQN") === "1", "Referência de serviço exige ISS não retido.");
    return;
  }
  const mapping: Record<string, [string, string]> = {
    NCM: ["prod", "NCM"], CFOP: ["prod", "CFOP"], origem: ["ICMS", "orig"], ICMS_CST: ["ICMS", "CST"],
    ICMS_percent: ["ICMS", "pICMS"], PIS_CST: ["PIS", "CST"], PIS_percent: ["PIS", "pPIS"],
    COFINS_CST: ["COFINS", "CST"], COFINS_percent: ["COFINS", "pCOFINS"],
    IBS_CBS_CST: ["IBSCBS", "CST"], cClassTrib: ["IBSCBS", "cClassTrib"],
    IBS_UF_percent: ["gIBSUF", "pIBSUF"], IBS_MUN_percent: ["gIBSMun", "pIBSMun"], CBS_percent: ["gCBS", "pCBS"],
  };
  for (const item of elements(document, "det")) {
    for (const [path, expected] of Object.entries(rule.fields)) {
      const names = path.split(".");
      const leaf = names.at(-1)!;
      if (names.length < 2 || !["prod", "ICMS", "IPI", "PIS", "COFINS", "IBSCBS"].includes(names[0]!) ||
        !(/^(NCM|CFOP|CST|CSOSN|orig|cClassTrib|p[A-Z].*)$/.test(leaf))) continue;
      let parent = item;
      for (const name of names) {
        const children = Array.from(parent.childNodes).filter((child): child is Element => child.nodeType === 1 && (child as Element).localName === name);
        requireValue(children.length === 1, `XML sem campo tributário ${path} da referência.`);
        parent = children[0]!;
      }
      same(parent.textContent ?? "", expected, leaf);
    }
    for (const [key, [group, tag]] of Object.entries(mapping)) {
      const expected = rule.fields[key];
      if (expected !== undefined && expected !== "") same(text(single(item, group), tag), expected, key);
    }
    for (const group of ["ICMS", "PIS", "COFINS"]) {
      const expected = rule.fields[`${group}_basePercent`];
      if (expected !== undefined) {
        const product = single(item, "prod");
        const base = Number(text(product, "vProd")) - Number(elements(product, "vDesc")[0]?.textContent ?? 0);
        const taxBase = Number(text(single(item, group), "vBC"));
        requireValue(Math.abs(taxBase - Math.round(base * numeric(expected)) / 100) < 0.0051, `Base ${group} diverge da referência revisada.`);
      }
    }
  }
}

export function importTaxReferences(xml: string): TaxRule[] {
  const document = parseXml(xml);
  const nfe = elements(document, "infNFe");
  if (nfe.length) {
    const protocol = single(document, "infProt");
    requireValue(["100", "150"].includes(text(protocol, "cStat")), "Importe XML processado de NF-e autorizada, com protocolo.");
    const info = single(document, "infNFe");
    requireValue(text(protocol, "chNFe") === (info.getAttribute("Id") ?? "").slice(3), "Protocolo não corresponde à chave importada.");
    return elements(info, "det").map((item, index) => {
      const fields: Record<string, string> = {};
      for (const group of ["prod", "ICMS", "IPI", "PIS", "COFINS", "IBSCBS"]) {
        const node = elements(item, group)[0];
        if (!node) continue;
        const walk = (element: Element, path: string) => {
          const children = Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1);
          if (!children.length) fields[path] = element.textContent ?? "";
          else children.forEach((child) => walk(child, `${path}.${child.localName}`));
        };
        walk(node, group);
      }
      return ruleSchema.parse({
        kind: "nfe", name: `Referência NF-e ${text(info, "nNF")} / item ${index + 1}`,
        source: `XML NF-e ${(info.getAttribute("Id") ?? "").slice(3)}`,
        scope: "Revisar produto/NCM, origem, destinatário, UF e vigência. Valores históricos não são alíquotas universais.",
        reviewed: false, fields,
      });
    });
  }
  const info = single(document, "infDPS");
  single(document, "infNFSe");
  const fields: Record<string, string> = {};
  for (const tag of ["cTribNac", "cTribMun", "cNBS", "cLocPrestacao", "tribISSQN", "tpRetISSQN", "pAliq", "cClassTrib", "cIndOp", "opSimpNac", "regEspTrib"]) {
    elements(info, tag).forEach((item, index) => { fields[`${tag}${index ? `.${index}` : ""}`] = item.textContent ?? ""; });
  }
  const ibs = elements(info, "IBSCBS")[0];
  if (ibs && elements(ibs, "CST").length === 1) fields.CST = text(ibs, "CST");
  requireValue(Object.keys(fields).length > 0, "XML NFS-e sem tributação da DPS.");
  return [ruleSchema.parse({
    kind: "nfse", name: "Referência de serviço NFS-e", source: `XML NFS-e ${single(document, "infNFSe").getAttribute("Id") ?? ""}`,
    scope: "Revisar serviço, local de incidência, retenções, regime e vigência antes de aplicar.",
    reviewed: false, fields,
  })];
}

export const blingReferences: TaxRule[] = [
  ruleSchema.parse({
    id: "bling-sale-reference", kind: "nfe", name: "Bling NF-e 16 / rolamentos",
    source: "Consulta visual de NF-e autorizada 16, série 1, em 15/10/2026",
    scope: "Somente referência da operação interna consultada; não generalizar para outro NCM, UF ou origem. Confirmar bases PIS/COFINS e classificação IBS/CBS.",
    fields: { NCM: "84821010", CFOP: "5102", origem: "0", ICMS_CST: "00", ICMS_percent: "17", ICMS_basePercent: "100",
      PIS_CST: "01", PIS_percent: "1.65", PIS_basePercent: "0", COFINS_CST: "01", COFINS_percent: "7.6", COFINS_basePercent: "0",
      IBS_CBS_CST: "000", IBS_UF_percent: "0.1", IBS_MUN_percent: "0", CBS_percent: "0.9", aviso: "Classificação tributária não confirmada na consulta. Não usar base zero sem conferência contábil." },
  }),
  ruleSchema.parse({
    id: "bling-service-reference", kind: "nfse", name: "Bling NFS-e 83 / RPS 96",
    source: "Consulta visual de NFS-e emitida 83, RPS 96, em 15/10/2026",
    scope: "Serviços descritos de montagem, deslocamento e hospedagem; prestação Florianópolis. Não substituir automaticamente o ISS padrão de outros serviços.",
    fields: { cTribNac: "140101", cNBS: "120029000", ISS_percent: "5", reterISS: "N", descontarISS: "N",
      reterINSS: "N", reterCsllPisCofins: "N", CST: "000", cClassTrib: "000001", cIndOp: "050102",
      aviso: "Nota emitida consultada usa ISS 5%; cadastro padrão consultado anteriormente usa 2%. Determinar aplicabilidade com a contabilidade." },
  }),
];
