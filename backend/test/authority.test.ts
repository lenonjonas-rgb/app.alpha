import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { DirectAuthority } from "../src/authority.js";
import type { HttpsTransport } from "../src/authority.js";
import type { FiscalDocument } from "../src/store.js";
import type { Identity } from "../src/certificate.js";
import { assertRuleMatches, blingReferences, ruleSchema } from "../src/rules.js";

const identity: Identity = { key: "test-key", cert: "test-cert", cnpj: "12345678000195" };
const key = "4".repeat(44);
const document: FiscalDocument = { id: "id", invoiceId: "invoice", kind: "nfe", environment: "homologacao", key: `NFe${key}`,
  status: "enviando", xml: "", signedXml: '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><Signature><DigestValue>hash</DigestValue></Signature></NFe>', createdAt: "" };
function wsdl(action: string) {
  return `<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" targetNamespace="http://www.portalfiscal.inf.br/nfe/wsdl/NFeServico4"><binding><operation><soap12:operation soapAction="http://www.portalfiscal.inf.br/nfe/wsdl/NFeServico4/${action}"/></operation></binding></definitions>`;
}
function protocol(code = "100", digest = "hash") {
  return `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${key}</chNFe><nProt>12345</nProt><digVal>${digest}</digVal><cStat>${code}</cStat><xMotivo>Resultado teste</xMotivo></infProt></protNFe>`;
}
function sefaz(reply: string, check?: HttpsTransport) {
  return new DirectAuthority(async (...args) => {
    if (check) await check(...args);
    return { status: 200, body: args[0].endsWith("?WSDL") ? wsdl(args[0].includes("NfeAutorizacao") ? "nfeAutorizacaoLote" : "nfeConsultaNF") : reply };
  });
}
test("SVRS descobre soapAction SOAP1.2, usa homologação e compõe nfeProc somente com digest correspondente", async () => {
  let calls = 0;
  const authority = sefaz(`<retEnviNFe><cStat>104</cStat>${protocol()}</retEnviNFe>`, async (url, credential, method, body, headers) => {
    assert.match(url, /^https:\/\/nfe-homologacao\.svrs\.rs\.gov\.br/);
    assert.equal(credential, identity);
    if (method === "POST") {
      calls++;
      assert.match(body!, /<indSinc>1<\/indSinc>/);
      assert.match(headers!["Content-Type"]!, /action=".*\/nfeAutorizacaoLote"/);
    }
    return { status: 200, body: "" };
  });
  const result = await authority.transmit(document, identity);
  assert.equal(result.status, "autorizado");
  assert.equal(result.protocol, "12345");
  assert.match(result.artifact!, /<nfeProc/);
  assert.equal(calls, 1);
  await assert.rejects(sefaz(`<retEnviNFe>${protocol("100", "other")}</retEnviNFe>`).transmit(document, identity), /Digest/);
  await assert.rejects(sefaz(`<retEnviNFe>${protocol().replace(key, "3".repeat(44))}</retEnviNFe>`).transmit(document, identity), /chave/);
});
test("cancelamento externo prevalece sobre protocolo original autorizado e confere chave/ambiente", async () => {
  const reply = `<retConsSitNFe><tpAmb>2</tpAmb><cStat>101</cStat><xMotivo>Cancelada</xMotivo><chNFe>${key}</chNFe>${protocol()}</retConsSitNFe>`;
  assert.equal((await sefaz(reply).consult(document, identity)).status, "cancelado");
  await assert.rejects(sefaz(reply.replace(`<tpAmb>2</tpAmb>`, `<tpAmb>1</tpAmb>`)).consult(document, identity), /chave\/ambiente/);
});
test("rejeição não é autorização e duplicidade/indisponibilidade permanecem incertas", async () => {
  assert.equal((await sefaz(`<retEnviNFe>${protocol("225")}</retEnviNFe>`).transmit(document, identity)).status, "rejeitado");
  assert.equal((await sefaz(`<retEnviNFe>${protocol("539")}</retEnviNFe>`).transmit(document, identity)).status, "incerto");
  for (const status of ["204", "217", "539", "108", "656"]) {
    assert.equal((await sefaz(`<retEnviNFe><cStat>${status}</cStat><xMotivo>Teste</xMotivo></retEnviNFe>`).transmit(document, identity)).status, "incerto");
  }
  const processing = await sefaz("<retEnviNFe><cStat>103</cStat><nRec>123456</nRec></retEnviNFe>").transmit(document, identity);
  assert.equal(processing.status, "processando");
  assert.equal(processing.receipt, "123456");
  await assert.rejects(sefaz("<retEnviNFe><cStat>104</cStat></retEnviNFe>").transmit(document, identity), /sem protocolo/);
});
const dps: FiscalDocument = { ...document, kind: "nfse", key: `DPS${"1".repeat(42)}`, signedXml: "<DPS>teste</DPS>" };
const nfseKey = "2".repeat(50);
function nfseReply(id = dps.key, environment = "2") {
  const xml = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${nfseKey}"><nNFSe>83</nNFSe><DPS><infDPS Id="${id}"><tpAmb>${environment}</tpAmb></infDPS></DPS></infNFSe></NFSe>`;
  return JSON.stringify({ chaveAcesso: nfseKey, nfseXmlGZipB64: gzipSync(xml).toString("base64") });
}
test("NFS-e transmite envelope JSON/gzip e vincula XML autorizado à DPS e ao ambiente", async () => {
  const authority = new DirectAuthority(async (url, _identity, method, body, headers) => {
    assert.equal(url, "https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse");
    assert.equal(method, "POST");
    assert.equal(headers!["Content-Type"], "application/json");
    assert.equal(gunzipSync(Buffer.from(JSON.parse(body!).dpsXmlGZipB64, "base64")).toString(), dps.signedXml);
    return { status: 201, body: nfseReply() };
  });
  const result = await authority.transmit(dps, identity);
  assert.equal(result.status, "autorizado");
  assert.equal(result.accessKey, nfseKey);
  for (const reply of [nfseReply("DPS-outro"), nfseReply(dps.key, "1")]) {
    await assert.rejects(new DirectAuthority(async () => ({ status: 201, body: reply })).transmit(dps, identity), /outra DPS|outro ambiente/);
  }
});
test("NFS-e DPS não localizada e duplicidade não permitem reenvio automático", async () => {
  const unknown = await new DirectAuthority(async () => ({ status: 404, body: "{}" })).consult(dps, identity);
  assert.equal(unknown.status, "incerto");
  const duplicate = await new DirectAuthority(async () => ({ status: 400, body: JSON.stringify({ erros: [{ Codigo: "teste", Descricao: "DPS já recebida" }] }) })).transmit(dps, identity);
  assert.equal(duplicate.status, "incerto");
  const rejected = await new DirectAuthority(async () => ({ status: 400, body: JSON.stringify({ erros: [{ Codigo: "teste", Descricao: "Dados inválidos" }] }) })).transmit(dps, identity);
  assert.equal(rejected.status, "rejeitado");
});
test("referência revisada exige campos mínimos e confere NCM/CFOP/alíquotas em cada item", () => {
  assert.throws(() => ruleSchema.parse({ ...blingReferences[0], fields: {}, reviewed: true }));
  const rule = ruleSchema.parse({ ...blingReferences[0], reviewed: true, fields: { NCM: "84821010", CFOP: "5102", ICMS_percent: "17" } });
  const xml = "<NFe><det><prod><NCM>84821010</NCM><CFOP>5102</CFOP></prod><ICMS><ICMS00><pICMS>17.00</pICMS></ICMS00></ICMS></det></NFe>";
  assert.doesNotThrow(() => assertRuleMatches(xml, rule));
  assert.throws(() => assertRuleMatches(xml.replace("5102", "6102"), rule), /CFOP/);
  assert.throws(() => assertRuleMatches(xml.replace("17.00", "18.00"), rule), /ICMS_percent/);
  assert.throws(() => assertRuleMatches(xml.replace("</NFe>", "<det><prod><NCM>00000000</NCM><CFOP>5102</CFOP></prod></det></NFe>"), rule), /NCM/);
});
