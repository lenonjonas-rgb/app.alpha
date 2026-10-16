import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { requireValue } from "./errors.js";
import type { Identity } from "./certificate.js";
import type { Environment, Kind } from "./store.js";
import type { Retention } from "./retentions.js";

export const NFE_NS = "http://www.portalfiscal.inf.br/nfe";
export const NFSE_NS = "http://www.sped.fazenda.gov.br/nfse";
export function parseXml(xml: string) {
  requireValue(Buffer.byteLength(xml) <= 2_000_000 && !/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml), "XML grande demais ou com entidades externas.");
  const errors: string[] = [];
  const document = new DOMParser({ errorHandler: { warning: (message) => errors.push(message), error: (message) => errors.push(message), fatalError: (message) => errors.push(message) } }).parseFromString(xml, "application/xml");
  requireValue(errors.length === 0 && document.documentElement, "XML malformado.");
  return document;
}
export function elements(node: Node, localName: string): Element[] {
  const found: Element[] = [];
  const visit = (current: Node) => {
    if (current.nodeType === 1 && (current as Element).localName === localName) found.push(current as Element);
    for (let child = current.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(node);
  return found;
}
export function single(node: Node, localName: string) {
  const matches = elements(node, localName);
  requireValue(matches.length === 1, `XML deve conter exatamente um ${localName}.`);
  return matches[0]!;
}
export function text(node: Node, localName: string) { return single(node, localName).textContent?.trim() ?? ""; }
export function cents(value: string) {
  requireValue(/^\d{1,12}\.\d{2}$/.test(value), "Valor monetário XML inválido.");
  const [integer, fraction] = value.split(".");
  return Number(integer) * 100 + Number(fraction);
}
export function serialize(node: Node) { return new XMLSerializer().serializeToString(node); }
export function xmlContent(node: Element): unknown {
  const attributes = Array.from(node.attributes).filter((item) => item.namespaceURI !== "http://www.w3.org/2000/xmlns/")
    .map((item) => [item.namespaceURI, item.localName, item.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const children: unknown[] = [];
  for (let item = node.firstChild; item; item = item.nextSibling) {
    if (item.nodeType === 1) children.push(xmlContent(item as Element));
    else if ((item.nodeType === 3 || item.nodeType === 4) && item.nodeValue?.trim()) children.push(item.nodeValue);
  }
  return [node.namespaceURI, node.localName, attributes, children];
}
export function checkNfeKey(key: string) {
  requireValue(/^\d{44}$/.test(key), "Chave NF-e inválida.");
  const sum = [...key.slice(0, 43)].reverse().reduce((total, digit, index) => total + Number(digit) * (2 + index % 8), 0);
  const result = 11 - sum % 11;
  requireValue(Number(key[43]) === (result >= 10 ? 0 : result), "Dígito verificador da chave NF-e inválido.");
}
export function inspectUnsigned(xml: string, kind: Kind, environment: Environment, cnpj: string, clientDocument: string, amount: number, reconciliation?: Retention) {
  const document = parseXml(xml);
  const root = document.documentElement;
  requireValue(root.localName === (kind === "nfe" ? "NFe" : "DPS") && root.namespaceURI === (kind === "nfe" ? NFE_NS : NFSE_NS), "Modelo/namespace do XML diferente do grupo faturado.");
  requireValue(!elements(root, "Signature").length, "Envie o XML não assinado; o backend assina com o A1 da empresa.");
  const info = single(root, kind === "nfe" ? "infNFe" : "infDPS");
  const key = info.getAttribute("Id") ?? "";
  requireValue(text(info, "tpAmb") === (environment === "producao" ? "1" : "2"), "Ambiente do XML não corresponde ao selecionado.");
  const issuer = single(info, kind === "nfe" ? "emit" : "prest");
  requireValue(text(issuer, "CNPJ") === cnpj, "CNPJ do XML diferente do emitente/A1.");
  const recipient = single(info, kind === "nfe" ? "dest" : "toma");
  const documentNodes = [...elements(recipient, "CNPJ"), ...elements(recipient, "CPF")];
  requireValue(documentNodes.length === 1 && documentNodes[0]!.textContent === clientDocument.replace(/\D/g, ""), "Destinatário do XML diferente do cliente do faturamento.");
  if (kind === "nfe") {
    requireValue(key.startsWith("NFe"), "Id NF-e inválido."); checkNfeKey(key.slice(3));
    requireValue(key.slice(3, 5) === "42" && text(single(info, "ide"), "cUF") === "42", "Este conector atende NF-e de Santa Catarina (SVRS).");
    requireValue(text(info, "mod") === "55" && key.slice(23, 25) === "55" && key.slice(9, 23) === cnpj, "Chave/modelo/emitente incompatíveis.");
    const ide = single(info, "ide");
    requireValue(text(issuer, "CRT") === "3", "Emitente informado como Lucro Real exige CRT 3 na NF-e.");
    const emission = text(ide, "dhEmi");
    requireValue(key.slice(5, 9) === emission.slice(2, 4) + emission.slice(5, 7) &&
      key.slice(25, 28) === text(ide, "serie").padStart(3, "0") &&
      key.slice(28, 37) === text(ide, "nNF").padStart(9, "0") &&
      key[37] === text(ide, "tpEmis") && key.slice(38, 46) === text(ide, "cNF").padStart(8, "0") &&
      key[46] === text(ide, "cDV"), "Campos de emissão/numeração não correspondem à chave NF-e.");
    requireValue(cents(text(single(info, "ICMSTot"), "vNF")) === amount, "Total da NF-e diferente da cobrança de produtos.");
    const payment = single(info, "detPag");
    requireValue(cents(text(payment, "vPag")) === amount, "Valor do pagamento NF-e diferente da cobrança.");
  } else {
    requireValue(/^DPS\d{42}$/.test(key), "Id DPS inválido (DPS + 42 dígitos).");
    requireValue(text(info, "cLocEmi") === "4205407", "Este conector atende o emitente de Florianópolis.");
    requireValue(key.slice(3, 10) === "4205407" && key[10] === "2" && key.slice(11, 25) === cnpj &&
      key.slice(25, 30) === text(info, "serie").padStart(5, "0") && key.slice(30) === text(info, "nDPS").padStart(15, "0"),
    "Id DPS incompatível com município, CNPJ, série ou numeração.");
    const value = cents(text(single(info, "vServPrest"), "vServ"));
    requireValue(text(single(issuer, "regTrib"), "opSimpNac") === "1", "Emitente Lucro Real não pode ser optante do Simples na DPS.");
    const discounts = elements(info, "vDescIncond").map((item) => cents(item.textContent ?? "0.00")).reduce((a, b) => a + b, 0);
    const retained = ["vRetCP", "vRetIRRF", "vRetCSLL"].flatMap((tag) => elements(info, tag)).reduce((sum, item) => sum + cents(item.textContent ?? ""), 0);
    requireValue((retained === 0 || reconciliation) && !elements(info, "tpRetISSQN").some((item) => item.textContent !== "1") &&
      !elements(info, "tpRetPisCofins").some((item) => !["0", "2"].includes(item.textContent ?? "")),
    "DPS com retenções exige conciliação fiscal/líquida específica; não transmitir contra cobrança bruta.");
    requireValue(value - discounts === amount, "Valor líquido previsto da DPS diferente da cobrança de serviços.");
    if (reconciliation) {
      const component = (name: string, expected: number) => {
        const values = elements(info, name);
        requireValue(values.length <= 1 && (values[0] ? cents(values[0].textContent ?? "") : 0) === expected,
          `Retenção XML ${name} diferente da conciliação financeira.`);
      };
      component("vRetCP", reconciliation.inss); component("vRetIRRF", reconciliation.irrf); component("vRetCSLL", reconciliation.csll);
      requireValue(reconciliation.invoiceAmount === amount && reconciliation.withheld === retained &&
        reconciliation.withheld === reconciliation.inss + reconciliation.irrf + reconciliation.csll &&
        reconciliation.net > 0 && reconciliation.net === amount - retained,
      "Líquido da DPS diferente da conciliação financeira.");
    }
  }
  return key;
}
export function signXml(xml: string, kind: Kind, identity: Identity) {
  const localName = kind === "nfe" ? "infNFe" : "infDPS";
  return signFiscalElement(xml, localName, identity);
}
export function signFiscalElement(xml: string, localName: "infNFe" | "infDPS" | "infEvento" | "infPedReg", identity: Identity) {
  const signer = new SignedXml({
    privateKey: identity.key, publicCert: identity.cert,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    getKeyInfoContent: SignedXml.getKeyInfoContent,
  });
  signer.addReference({
    xpath: `//*[local-name()='${localName}']`,
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"],
  });
  signer.computeSignature(xml, { location: { reference: `//*[local-name()='${localName}']`, action: "after" } });
  return signer.getSignedXml();
}

export class SchemaValidator {
  constructor(private directory: string) {}
  path(kind: Kind, event: boolean | "pedRegEvento" = false) {
    if (event && kind === "nfe") return join(this.directory, "nfe", "events", "envEventoCancNFe_v1.00.xsd");
    if (event === "pedRegEvento" && kind === "nfse") return join(this.directory, "nfse", "pedRegEvento_v1.01.xsd");
    return join(this.directory, kind === "nfe" ? "nfe" : "nfse", event ? "evento_v1.01.xsd" : kind === "nfe" ? "nfe_v4.00.xsd" : "DPS_v1.01.xsd");
  }
  async ready() {
    const result: Record<string, boolean> = {};
    for (const kind of ["nfe", "nfse"] as const) {
      try { await access(this.path(kind)); result[kind] = true; }
      catch { result[kind] = false; }
    }
    try { await access(this.path("nfe", true)); result.nfeCancellation = true; }
    catch { result.nfeCancellation = false; }
    try { await access(this.path("nfse", "pedRegEvento")); result.nfseCancellation = true; }
    catch { result.nfseCancellation = false; }
    return result;
  }
  async validate(xml: string, kind: Kind, event: boolean | "pedRegEvento" = false) {
    parseXml(xml);
    const path = this.path(kind, event);
    try { await access(path); } catch { throw new Error(`Instale os schemas oficiais vigentes de ${kind.toUpperCase()} no volume privado do backend.`); }
    await new Promise<void>((resolve, reject) => {
      const child = spawn("xmllint", ["--nonet", "--noout", "--schema", path, "-"], { windowsHide: true });
      let diagnostic = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("Validação XSD excedeu o tempo limite.")); }, 10000);
      child.stdout.resume();
      child.stderr.on("data", (chunk: Buffer) => { diagnostic += chunk.toString("utf8").slice(0, Math.max(0, 2000 - diagnostic.length)); });
      child.on("error", () => { clearTimeout(timer); reject(new Error("Validador XSD indisponível: instale libxml2-utils (incluído no Docker).")); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`XML não passou no XSD oficial: ${diagnostic.replace(/<[^>]+>/g, "").slice(-800)}`));
      });
      child.stdin.on("error", () => reject(new Error("Falha ao entregar XML ao validador XSD.")));
      child.stdin.end(xml);
    });
  }
}
