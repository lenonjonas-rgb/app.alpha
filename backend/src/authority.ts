import { request } from "node:https";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import type { Identity } from "./certificate.js";
import type { Environment, FiscalDocument } from "./store.js";
import type { Authority, AuthorityResult } from "./service.js";
import { elements, NFE_NS, NFSE_NS, parseXml, serialize, single, text } from "./xml.js";
import { requireValue } from "./errors.js";
import { cancellationReply } from "./nfeCancellation.js";
import { nfseCancellationReply, type NfseCancellationResult } from "./nfseCancellation.js";

type Reply = { status: number; body: string };
export type HttpsTransport = (url: string, identity: Identity, method: string, body?: string, headers?: Record<string, string>) => Promise<Reply>;
export const fiscalHttps: HttpsTransport = (url, identity, method, body, headers = {}) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const call = request(target, { method, cert: [identity.cert, identity.chain].filter(Boolean).join("\n"), key: identity.key, minVersion: "TLSv1.2", rejectUnauthorized: true, signal: AbortSignal.timeout(30000),
    headers: { Accept: "*/*", ...headers, ...(body !== undefined ? { "Content-Length": Buffer.byteLength(body) } : {}) } }, (response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8_000_000) call.destroy(new Error("Resposta fiscal excede 8 MB."));
      else chunks.push(chunk);
    });
    response.on("error", reject);
    response.on("end", () => resolve({ status: response.statusCode ?? 502, body: Buffer.concat(chunks).toString("utf8") }));
  });
  call.setTimeout(30000, () => call.destroy(new Error("Tempo excedido na comunicação fiscal; consulte a situação antes de repetir.")));
  call.on("error", reject);
  call.end(body);
});
const xmlContent = (xml: string) => xml.replace(/^\s*<\?xml[^>]*\?>\s*/, "");
function childText(node: Node, name: string) { return elements(node, name)[0]?.textContent?.trim(); }
function authorityXml(body: string) {
  const document = parseXml(body);
  const fault = elements(document, "Fault")[0];
  requireValue(!fault, `Falha SOAP do fisco: ${fault?.textContent?.slice(0, 500) ?? ""}`, 502);
  return document;
}
const sefazPaths = {
  authorization: "NfeAutorizacao/NFeAutorizacao4.asmx",
  receipt: "NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
  consultation: "NfeConsulta/NfeConsulta4.asmx",
  event: "recepcaoevento/recepcaoevento4.asmx",
};
export class DirectAuthority implements Authority {
  private bindings = new Map<string, { namespace: string; action: string }>();
  constructor(private transport: HttpsTransport = fiscalHttps) {}
  private async soap(environment: Environment, type: keyof typeof sefazPaths, content: string, identity: Identity) {
    const host = environment === "producao" ? "nfe.svrs.rs.gov.br" : "nfe-homologacao.svrs.rs.gov.br";
    const endpoint = `https://${host}/ws/${sefazPaths[type]}`;
    let binding = this.bindings.get(endpoint);
    if (!binding) {
      const reply = await this.transport(`${endpoint}?WSDL`, identity, "GET");
      requireValue(reply.status === 200, `Não foi possível consultar o WSDL oficial SVRS (${reply.status}).`, 502);
      const wsdl = parseXml(reply.body);
      const namespace = wsdl.documentElement.getAttribute("targetNamespace");
      requireValue(namespace && namespace.startsWith("http://www.portalfiscal.inf.br/nfe/wsdl/"), "WSDL retornou namespace desconhecido.", 502);
      const expectedOperation = type === "authorization" ? "nfeAutorizacaoLote" : type === "receipt" ? "nfeRetAutorizacaoLote" :
        type === "event" ? "nfeRecepcaoEvento" : "nfeConsultaNF";
      const operation = elements(wsdl, "operation").find((item) =>
        item.namespaceURI === "http://schemas.xmlsoap.org/wsdl/soap12/" && item.getAttribute("soapAction")?.endsWith(`/${expectedOperation}`));
      const action = operation?.getAttribute("soapAction");
      requireValue(action, `WSDL sem operação SOAP 1.2 ${expectedOperation}.`, 502);
      binding = { namespace, action };
      this.bindings.set(endpoint, binding);
    }
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="${binding.namespace}">${content}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
    const result = await this.transport(endpoint, identity, "POST", envelope, { "Content-Type": `application/soap+xml; charset=utf-8; action="${binding.action}"` });
    requireValue(result.status === 200, `SVRS retornou HTTP ${result.status}. Consulte o estado antes de reenviar.`, 502);
    return result.body;
  }
  private sefazResult(document: FiscalDocument, response: string): AuthorityResult {
    const xml = authorityXml(response);
    const topStatus = childText(xml.documentElement, "cStat");
    if (["101", "151", "155"].includes(topStatus ?? "")) {
      requireValue(childText(xml, "chNFe") === document.key.slice(3) &&
        childText(xml, "tpAmb") === (document.environment === "producao" ? "1" : "2"), "Cancelamento retornado para outra chave/ambiente.", 502);
      return { status: "cancelado", message: `${topStatus} · ${childText(xml.documentElement, "xMotivo") ?? ""}`, response };
    }
    const protocol = elements(xml, "protNFe")[0];
    if (protocol) {
      const info = single(protocol, "infProt");
      requireValue(text(info, "chNFe") === document.key.slice(3), "Protocolo SEFAZ não corresponde à chave enviada.", 502);
      requireValue(text(info, "tpAmb") === (document.environment === "producao" ? "1" : "2"), "Protocolo SEFAZ de outro ambiente.", 502);
      const code = text(info, "cStat");
      const message = `${code} · ${text(info, "xMotivo")}`;
      if (["100", "150"].includes(code)) {
        requireValue(document.signedXml, "XML assinado não está disponível para compor o protocolo.", 500);
        const digest = childText(info, "digVal");
        requireValue(digest && childText(parseXml(document.signedXml), "DigestValue") === digest, "Digest do protocolo não corresponde ao XML assinado.", 502);
        return { status: "autorizado", protocol: text(info, "nProt"), message, response,
          artifact: `<nfeProc xmlns="${NFE_NS}" versao="4.00">${xmlContent(document.signedXml)}${serialize(protocol)}</nfeProc>` };
      }
      return { status: ["106", "108", "109", "110", "204", "217", "301", "302", "303", "539", "656"].includes(code) ? "incerto" : "rejeitado", message, response };
    }
    const status = childText(xml, "cStat");
    requireValue(status, "Resposta SVRS sem situação fiscal reconhecida.", 502);
    const message = `${status} · ${childText(xml, "xMotivo") ?? ""}`;
    if (["101", "151", "155"].includes(status)) return { status: "cancelado", message, response };
    if (["103", "105"].includes(status)) return { status: "processando", receipt: childText(xml, "nRec") ?? document.receipt, message, response };
    if (["106", "108", "109", "204", "217", "539", "656"].includes(status)) return { status: "incerto", message, response };
    requireValue(!["100", "104"].includes(status), "Resposta SEFAZ sem protocolo da nota; consulte a chave.", 502);
    return { status: "rejeitado", message, response };
  }
  private nfseBase(environment: Environment) {
    return environment === "producao" ? "https://sefin.nfse.gov.br/SefinNacional" : "https://sefin.producaorestrita.nfse.gov.br/SefinNacional";
  }
  private nfseResult(document: FiscalDocument, reply: Reply): AuthorityResult {
    const payload = z.object({
      chaveAcesso: z.string().optional(), nfseXmlGZipB64: z.string().optional(),
      erros: z.array(z.object({ Codigo: z.string().optional(), Descricao: z.string().optional(), Complemento: z.string().optional(),
        codigo: z.string().optional(), descricao: z.string().optional() })).nullable().optional(),
    }).passthrough().parse(JSON.parse(reply.body) as unknown);
    if (reply.status >= 400) {
      requireValue(payload.erros?.length, `NFS-e Nacional retornou HTTP ${reply.status} sem erro estruturado.`, 502);
      const message = payload.erros.map((error) => `${error.Codigo ?? error.codigo ?? ""}: ${error.Descricao ?? error.descricao ?? ""} ${error.Complemento ?? ""}`).join("; ").slice(0, 2000);
      return { status: reply.status >= 500 || reply.status === 429 || /duplic|já exist|ja exist|já receb|ja receb/i.test(message) ? "incerto" : "rejeitado", message, response: reply.body };
    }
    requireValue(payload.nfseXmlGZipB64 && payload.chaveAcesso, "Resposta NFS-e sem XML autorizado/chave de acesso.", 502);
    requireValue(/^\d{50}$/.test(payload.chaveAcesso), "Chave NFS-e retornada inválida.", 502);
    const artifact = gunzipSync(Buffer.from(payload.nfseXmlGZipB64, "base64"), { maxOutputLength: 2_000_000 }).toString("utf8");
    const xml = parseXml(artifact);
    requireValue(xml.documentElement.localName === "NFSe" && xml.documentElement.namespaceURI === NFSE_NS, "Resposta não contém NFS-e Nacional.", 502);
    const dps = single(xml, "infDPS");
    requireValue(dps.getAttribute("Id") === document.key, "NFS-e retornada corresponde a outra DPS.", 502);
    requireValue(text(dps, "tpAmb") === (document.environment === "producao" ? "1" : "2"), "NFS-e retornada de outro ambiente.", 502);
    const nfse = single(xml, "infNFSe");
    requireValue(nfse.getAttribute("Id") === `NFS${payload.chaveAcesso}`, "Chave NFS-e retornada diverge do XML.", 502);
    return { status: "autorizado", accessKey: payload.chaveAcesso, message: `NFS-e ${text(nfse, "nNFSe")} gerada pela plataforma nacional.`, response: reply.body, artifact };
  }
  async transmit(document: FiscalDocument, identity: Identity): Promise<AuthorityResult> {
    requireValue(document.signedXml, "Documento ainda não foi assinado.");
    if (document.kind === "nfe") {
      const batch = `<enviNFe xmlns="${NFE_NS}" versao="4.00"><idLote>${Date.now()}</idLote><indSinc>1</indSinc>${xmlContent(document.signedXml)}</enviNFe>`;
      return this.sefazResult(document, await this.soap(document.environment, "authorization", batch, identity));
    }
    const body = JSON.stringify({ dpsXmlGZipB64: gzipSync(document.signedXml).toString("base64") });
    return this.nfseResult(document, await this.transport(`${this.nfseBase(document.environment)}/nfse`, identity, "POST", body, { "Content-Type": "application/json", Accept: "application/json" }));
  }
  async consult(document: FiscalDocument, identity: Identity): Promise<AuthorityResult> {
    if (document.kind === "nfe") {
      const content = document.receipt && document.status === "processando"
        ? `<consReciNFe xmlns="${NFE_NS}" versao="4.00"><tpAmb>${document.environment === "producao" ? 1 : 2}</tpAmb><nRec>${document.receipt}</nRec></consReciNFe>`
        : `<consSitNFe xmlns="${NFE_NS}" versao="4.00"><tpAmb>${document.environment === "producao" ? 1 : 2}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${document.key.slice(3)}</chNFe></consSitNFe>`;
      const reply = await this.soap(document.environment, document.receipt && document.status === "processando" ? "receipt" : "consultation", content, identity);
      return this.sefazResult(document, reply);
    }
    let key = document.accessKey;
    if (!key) {
      const lookup = await this.transport(`${this.nfseBase(document.environment)}/dps/${encodeURIComponent(document.key)}`, identity, "GET", undefined, { Accept: "application/json" });
      if (lookup.status === 404) return { status: "incerto", message: "DPS ainda não localizada. Não reenviar automaticamente.", response: lookup.body };
      requireValue(lookup.status === 200, `Consulta DPS retornou HTTP ${lookup.status}.`, 502);
      key = z.object({ chaveAcesso: z.string().regex(/^\d{50}$/) }).parse(JSON.parse(lookup.body) as unknown).chaveAcesso;
    }
    return this.nfseResult(document, await this.transport(`${this.nfseBase(document.environment)}/nfse/${key}`, identity, "GET", undefined, { Accept: "application/json" }));
  }
  async cancelNfe(document: FiscalDocument, xml: string, identity: Identity) {
    requireValue(document.kind === "nfe", "Este evento é exclusivo da NF-e.", 422);
    return cancellationReply(document, xml, await this.soap(document.environment, "event", xml, identity));
  }
  async cancelNfse(document: FiscalDocument, xml: string, identity: Identity): Promise<NfseCancellationResult> {
    requireValue(document.kind === "nfse" && document.accessKey && /^\d{50}$/.test(document.accessKey),
      "Este evento exige uma NFS-e Nacional autorizada com chave de 50 dígitos.", 422);
    const body = JSON.stringify({ pedidoRegistroEventoXmlGZipB64: gzipSync(xml).toString("base64") });
    const reply = await this.transport(`${this.nfseBase(document.environment)}/nfse/${document.accessKey}/eventos`,
      identity, "POST", body, { "Content-Type": "application/json", Accept: "application/json" });
    if (reply.status === 201) {
      try { return nfseCancellationReply(document, xml, reply.body); }
      catch (cause) {
        return { status: "incerto", response: reply.body,
          message: `SEFIN Nacional respondeu HTTP 201, mas o evento não pôde ser correlacionado/validado: ${cause instanceof Error ? cause.message.slice(0, 400) : "resposta inválida"}` };
      }
    }
    let message = `SEFIN Nacional retornou HTTP ${reply.status} ao registrar evento NFS-e.`;
    try {
      const payload = z.object({
        tipoAmbiente: z.number().optional(),
        erro: z.object({ codigo: z.string().optional(), descricao: z.string().optional(), complemento: z.string().optional(),
          Codigo: z.string().optional(), Descricao: z.string().optional(), Complemento: z.string().optional() }).optional(),
        erros: z.array(z.object({ codigo: z.string().optional(), descricao: z.string().optional(), complemento: z.string().optional(),
          Codigo: z.string().optional(), Descricao: z.string().optional(), Complemento: z.string().optional() })).optional(),
      }).passthrough().parse(JSON.parse(reply.body) as unknown);
      requireValue(payload.tipoAmbiente === undefined || payload.tipoAmbiente === (document.environment === "producao" ? 1 : 2),
        "Erro do evento retornado para outro ambiente.", 502);
      const errors = [...(payload.erros ?? []), ...(payload.erro ? [payload.erro] : [])];
      if (errors.length) message = errors.map((error) =>
        `${error.codigo ?? error.Codigo ?? ""}: ${error.descricao ?? error.Descricao ?? ""} ${error.complemento ?? error.Complemento ?? ""}`).join("; ").slice(0, 2000);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AppError") throw cause;
      if (reply.status < 500 && reply.status !== 429) {
        return { status: "incerto", response: reply.body,
          message: `${message} Resposta não reconhecida; consulte antes de qualquer nova ação.` };
      }
    }
    const duplicate = /duplic|já existe|ja existe|já receb|ja receb|registrad/i.test(message);
    return { status: reply.status >= 500 || reply.status === 429 || duplicate ? "incerto" : "rejeitado",
      response: reply.body, message };
  }
  async consultNfseCancellation(document: FiscalDocument, xml: string, identity: Identity): Promise<NfseCancellationResult> {
    requireValue(document.kind === "nfse" && document.accessKey && /^\d{50}$/.test(document.accessKey),
      "Consulta de evento exige chave NFS-e Nacional válida.", 422);
    const url = `${this.nfseBase(document.environment)}/nfse/${document.accessKey}/eventos/101101/1`;
    const reply = await this.transport(url, identity, "GET", undefined, { Accept: "application/json" });
    if (reply.status === 404) return { status: "incerto", response: reply.body,
      message: "Evento não encontrado nesta consulta; a situação permanece incerta. Não reenviar." };
    if (reply.status !== 200) return { status: "incerto", response: reply.body,
      message: `Consulta de evento retornou HTTP ${reply.status}. Situação permanece incerta; não reenviar.` };
    try { return nfseCancellationReply(document, xml, reply.body); }
    catch (cause) {
      return { status: "incerto", response: reply.body,
        message: `Consulta retornou HTTP 200, mas o evento não pôde ser correlacionado/validado: ${cause instanceof Error ? cause.message.slice(0, 400) : "resposta inválida"}` };
    }
  }
}
