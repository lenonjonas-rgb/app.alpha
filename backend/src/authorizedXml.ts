import { isDeepStrictEqual } from "node:util";
import { SignedXml } from "xml-crypto";
import type { FiscalDocument } from "./store.js";
import { requireValue } from "./errors.js";
import { cents, inspectUnsigned, NFE_NS, NFSE_NS, parseXml, single, text, xmlContent } from "./xml.js";

function signature(xml: string, key: string) {
  const signed = parseXml(xml), node = single(signed, "Signature");
  requireValue(node.namespaceURI === "http://www.w3.org/2000/09/xmldsig#" &&
    single(node, "Reference").getAttribute("URI") === `#${key}`,
  "Assinatura fiscal não referencia a chave do documento.", 409);
  const certificate = text(node, "X509Certificate");
  requireValue(/^[A-Za-z0-9+/=\s]+$/.test(certificate), "Certificado da assinatura fiscal inválido.", 409);
  const cert = `-----BEGIN CERTIFICATE-----\n${certificate}\n-----END CERTIFICATE-----`;
  const verifier = new SignedXml({ publicCert: cert, getCertFromKeyInfo: () => cert });
  verifier.loadSignature(node);
  requireValue(verifier.checkSignature(xml), "Assinatura fiscal inválida; documento auxiliar indisponível.", 409);
  return node;
}
export function authorizedNfeArtifact(document: FiscalDocument) {
  requireValue(document.kind === "nfe" && document.status === "autorizado" && document.signedXml && document.artifact && document.protocol,
    "NF-e sem autorização, XML assinado, nfeProc ou protocolo.", 409);
  const unsigned = parseXml(document.xml), signed = parseXml(document.signedXml), artifact = parseXml(document.artifact);
  const issuer = text(single(unsigned, "emit"), "CNPJ"), recipient = single(unsigned, "dest");
  const client = recipient.getElementsByTagNameNS(NFE_NS, "CNPJ")[0] ?? recipient.getElementsByTagNameNS(NFE_NS, "CPF")[0];
  requireValue(client, "Destinatário da NF-e ausente.", 409);
  const key = inspectUnsigned(document.xml, "nfe", document.environment, issuer, client.textContent ?? "",
    cents(text(single(unsigned, "ICMSTot"), "vNF")));
  requireValue(key === document.key, "Chave da NF-e diferente do documento vinculado.", 409);
  requireValue(signed.documentElement.localName === "NFe" && signed.documentElement.namespaceURI === NFE_NS &&
    artifact.documentElement.localName === "nfeProc" && artifact.documentElement.namespaceURI === NFE_NS,
  "NF-e autorizada sem modelo/namespace esperado.", 409);
  const authorized = single(artifact, "NFe"), protocol = single(artifact, "protNFe"), info = single(protocol, "infProt");
  requireValue(authorized.parentNode === artifact.documentElement && protocol.parentNode === artifact.documentElement &&
    protocol.namespaceURI === NFE_NS && info.namespaceURI === NFE_NS && info.parentNode === protocol &&
    isDeepStrictEqual(xmlContent(authorized), xmlContent(signed.documentElement)) &&
    isDeepStrictEqual(xmlContent(single(signed, "infNFe")), xmlContent(single(unsigned, "infNFe"))),
  "XML autorizado diferente do XML preparado/assinado.", 409);
  const sign = signature(document.signedXml, key);
  requireValue(text(info, "chNFe") === key.slice(3) && text(info, "tpAmb") === (document.environment === "producao" ? "1" : "2") &&
    ["100", "150"].includes(text(info, "cStat")) && /^\d{15}$/.test(document.protocol) && text(info, "nProt") === document.protocol &&
    text(info, "digVal") === text(sign, "DigestValue"), "Protocolo NF-e não corresponde à autorização/XML/ambiente.", 409);
  return document.artifact;
}
export function authorizedNfseArtifact(document: FiscalDocument) {
  requireValue(document.kind === "nfse" && document.status === "autorizado" && document.signedXml && document.artifact &&
    document.accessKey && /^\d{50}$/.test(document.accessKey), "NFS-e sem autorização, XML assinado ou chave nacional.", 409);
  const artifact = parseXml(document.artifact), signed = parseXml(document.signedXml), original = parseXml(document.xml);
  requireValue(artifact.documentElement.localName === "NFSe" && artifact.documentElement.namespaceURI === NFSE_NS &&
    signed.documentElement.localName === "DPS" && signed.documentElement.namespaceURI === NFSE_NS &&
    original.documentElement.localName === "DPS" && original.documentElement.namespaceURI === NFSE_NS,
  "Modelo/namespace da NFS-e ou DPS inválido.", 409);
  const info = single(artifact, "infNFSe"), dpsRoot = single(info, "DPS"), dps = single(dpsRoot, "infDPS");
  requireValue(info.parentNode === artifact.documentElement && info.namespaceURI === NFSE_NS &&
    info.getAttribute("Id") === `NFS${document.accessKey}` && dpsRoot.parentNode === info && dps.parentNode === dpsRoot &&
    dpsRoot.namespaceURI === NFSE_NS && dps.namespaceURI === NFSE_NS &&
    dps.getAttribute("Id") === document.key && text(dps, "tpAmb") === (document.environment === "producao" ? "1" : "2") &&
    isDeepStrictEqual(xmlContent(dps), xmlContent(single(original, "infDPS"))) &&
    isDeepStrictEqual(xmlContent(dps), xmlContent(single(signed, "infDPS"))),
  "Chave/ambiente/DPS da NFS-e diferente da declaração enviada.", 409);
  requireValue(text(single(info, "emit"), "CNPJ") === text(single(dps, "prest"), "CNPJ"),
    "Emitente da NFS-e diferente do prestador da DPS.", 409);
  signature(document.signedXml, document.key);
  return document.artifact;
}
