import type { FiscalDocument } from "./store.js";
import { cents, elements, parseXml, single, text } from "./xml.js";
import { requireValue } from "./errors.js";

function optionalText(node: Node, name: string) {
  const matches = elements(node, name);
  requireValue(matches.length <= 1, `Metadado fiscal ${name} duplicado.`, 409);
  return matches[0]?.textContent?.trim() || undefined;
}

export function documentMetadata(document: FiscalDocument) {
  const { xml, signedXml: _signed, response: _response, artifact, ...metadata } = document;
  const root = parseXml(xml);
  const nfe = document.kind === "nfe";
  const info = single(root, nfe ? "infNFe" : "infDPS");
  const recipient = single(info, nfe ? "dest" : "toma");
  const issuedAt = text(nfe ? single(info, "ide") : info, "dhEmi");
  requireValue(/^\d{4}-\d{2}-\d{2}T/.test(issuedAt) && Number.isFinite(Date.parse(issuedAt)),
    "Data de emissão fiscal inválida no XML.", 409);
  const nfseInfo = !nfe && artifact ? single(parseXml(artifact), "infNFSe") : undefined;
  return {
    ...metadata,
    issuedAt,
    number: nfe ? text(single(info, "ide"), "nNF") : nfseInfo ? text(nfseInfo, "nNFSe") : undefined,
    series: text(nfe ? single(info, "ide") : info, "serie"),
    recipientName: optionalText(recipient, "xNome"),
    recipientDocument: optionalText(recipient, "CNPJ") ?? optionalText(recipient, "CPF"),
    destinationState: optionalText(recipient, "UF"),
    amount: nfe ? cents(text(single(info, "ICMSTot"), "vNF")) : undefined,
    products: elements(info, nfe ? "xProd" : "xDescServ").map((item) => item.textContent?.trim() ?? ""),
  };
}
