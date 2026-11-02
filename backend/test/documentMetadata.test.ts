import { test } from "node:test";
import assert from "node:assert/strict";
import { documentMetadata } from "../src/documentMetadata.js";
import type { FiscalDocument } from "../src/store.js";

const document: FiscalDocument = {
  id: "test", invoiceId: "invoice", kind: "nfe", environment: "homologacao", key: "key",
  status: "rascunho", createdAt: "2026-10-19T12:00:00Z",
  xml: `<NFe><infNFe><ide><dhEmi>2026-10-15T23:30:00-03:00</dhEmi><nNF>17</nNF><serie>1</serie></ide>
    <dest><xNome>Cliente histórico</xNome><CPF>52998224725</CPF><enderDest><UF>SC</UF></enderDest></dest>
    <det><prod><xProd>Peça &amp; componente</xProd></prod></det><total><ICMSTot><vNF>259.80</vNF></ICMSTot></total></infNFe></NFe>`,
};

test("metadados fiscais vêm do XML sem expor XML/assinatura/resposta na listagem", () => {
  const metadata = documentMetadata({ ...document, signedXml: "private", response: "private", artifact: "private" });
  assert.equal(metadata.issuedAt, "2026-10-15T23:30:00-03:00");
  assert.equal(metadata.createdAt, document.createdAt);
  assert.equal(metadata.number, "17");
  assert.equal(metadata.amount, 25980);
  assert.equal(metadata.recipientName, "Cliente histórico");
  assert.equal(metadata.recipientDocument, "52998224725");
  assert.equal(metadata.destinationState, "SC");
  assert.deepEqual(metadata.products, ["Peça & componente"]);
  for (const key of ["xml", "signedXml", "response", "artifact"]) assert.ok(!(key in metadata));
});
test("DPS não usa número da declaração como número autorizado de NFS-e", () => {
  const dps = { ...document, kind: "nfse" as const, xml: `<DPS><infDPS><dhEmi>2026-10-15T12:00:00-03:00</dhEmi><serie>1</serie><nDPS>999</nDPS><toma><xNome>Cliente</xNome><CNPJ>12345678000190</CNPJ></toma><serv><xDescServ>Manutenção</xDescServ></serv></infDPS></DPS>` };
  assert.equal(documentMetadata(dps).number, undefined);
  assert.equal(documentMetadata({ ...dps, artifact: "<NFSe><infNFSe><nNFSe>83</nNFSe></infNFSe></NFSe>" }).number, "83");
});
test("metadados inválidos não viram datas presumidas ou resultados silenciosos", () => {
  assert.throws(() => documentMetadata({ ...document, xml: document.xml.replace("2026-10-15T23:30:00-03:00", "invalid") }), /Data de emissão/);
  assert.throws(() => documentMetadata({ ...document, xml: document.xml.replace("<UF>SC</UF>", "<UF>SC</UF><UF>SP</UF>") }), /duplicado/);
});
