import { randomUUID } from "node:crypto";
import { z } from "zod";
import { gunzipSync } from "node:zlib";
import type { CompanyData, Context } from "./auth.js";
import type { Identity } from "./certificate.js";
import type { FiscalDocument, Store } from "./store.js";
import type { Validator } from "./service.js";
import { authorizedNfseArtifact } from "./authorizedXml.js";
import { requireValue } from "./errors.js";
import { NFSE_NS, parseXml, signFiscalElement, single, text } from "./xml.js";

export type NfseCancellationEvent = {
  id: string; model: "nfse"; documentId: string; invoiceId: string; type: "101101";
  environment: FiscalDocument["environment"]; key: string; reasonCode: "1" | "2" | "9";
  justification: string; createdAt: string; createdBy: string; xml: string;
  status: "enviando" | "incerto" | "registrado" | "rejeitado" | "cancelamento_confirmado";
  response?: string; artifact?: string; message?: string; consultation?: string;
};
export type NfseCancellationResult = Pick<NfseCancellationEvent, "response" | "artifact" | "message"> &
  { status: "registrado" | "rejeitado" | "incerto" };
export const nfseCancellationSchema = z.object({
  confirmation: z.string().regex(/^\d{50}$/),
  reasonCode: z.enum(["1", "2", "9"]),
  justification: z.string().trim().min(15).max(255)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Justificativa contém caracteres inválidos."),
}).strict();

export function pendingNfseCancellation(store: Store, tenant: string, documentId: string) {
  return store.list<NfseCancellationEvent>(tenant, "fiscalEvents").find((event) =>
    event.model === "nfse" && event.documentId === documentId && ["enviando", "incerto"].includes(event.status));
}

function eligibility(store: Store, context: Context, company: CompanyData, document: FiscalDocument) {
  requireValue(!pendingNfseCancellation(store, context.tenant, document.id),
    "Cancelamento NFS-e já enviado ou incerto. Consulte o evento; não repita o pedido.", 409);
  authorizedNfseArtifact(document);
  store.assertInvoiceAvailable(context.tenant, document.invoiceId);
  const invoice = company.finance.invoices.find((item) => item.id === document.invoiceId);
  const entries = company.finance.entries.filter((item) => item.invoiceId === document.invoiceId);
  requireValue(invoice && !invoice.canceled && invoice.kind === "Serviços" && entries.length === 1 && entries[0] &&
    !entries[0].canceled && entries[0].kind === "Receber" && entries[0].clientId === invoice.clientId &&
    entries[0].amount === invoice.amount,
  "Conta/faturamento canônicos inconsistentes; não cancelar a NFS-e.", 409);
  requireValue(!entries[0].settlements.some((settlement) => !settlement.reversed),
    "Estorne as baixas ativas antes de solicitar cancelamento da NFS-e.", 409);
  const remittances = store.list<{ entryIds: string[]; entries?: Array<{ invoiceId: string; fiscalDocumentId?: string }> }>(context.tenant, "remittances");
  requireValue(!remittances.some((remittance) => remittance.entryIds.includes(entries[0]!.id) ||
    remittance.entries?.some((title) => title.invoiceId === invoice.id || title.fiscalDocumentId === document.id)),
  "Há remessa vinculada. Resolva a remessa bancária antes de solicitar cancelamento fiscal da NFS-e.", 409);
}

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nfseEventCode = "101101";
function eventRequest(document: FiscalDocument, input: z.infer<typeof nfseCancellationSchema>, issuer: string, identity: Identity, now: Date) {
  const id = `PRE${document.accessKey}${nfseEventCode}`;
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const request = `<pedRegEvento xmlns="${NFSE_NS}" versao="1.01"><infPedReg Id="${id}"><tpAmb>${document.environment === "producao" ? "1" : "2"}</tpAmb><verAplic>AlphaTec 1.0</verAplic><dhEvento>${timestamp}</dhEvento><CNPJAutor>${issuer}</CNPJAutor><chNFSe>${document.accessKey}</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>${input.reasonCode}</cMotivo><xMotivo>${escape(input.justification)}</xMotivo></e101101></infPedReg></pedRegEvento>`;
  return signFiscalElement(request, "infPedReg", identity);
}

export async function cancelNfse(options: {
  store: Store; context: Context; id: string; input: unknown; identity: Identity; validator: Validator;
  company: () => Promise<CompanyData>;
  send: (document: FiscalDocument, xml: string, identity: Identity) => Promise<NfseCancellationResult>;
  now?: () => Date;
}) {
  const { store, context, id, identity, validator } = options;
  const input = nfseCancellationSchema.parse(options.input);
  const document = store.document(context.tenant, id), now = options.now ?? (() => new Date());
  requireValue(document.kind === "nfse" && input.confirmation === document.accessKey,
    "Cancelamento disponível somente para NFS-e e exige a confirmação da chave de acesso completa.", 409);
  const issuer = text(single(parseXml(document.xml), "prest"), "CNPJ");
  requireValue(identity.cnpj === issuer, "A1 não corresponde ao prestador original da NFS-e.", 409);
  eligibility(store, context, await options.company(), document);
  const xml = eventRequest(document, input, issuer, identity, now());
  await validator.validate(xml, "nfse", "pedRegEvento");
  const company = await options.company();
  const event: NfseCancellationEvent = {
    id: randomUUID(), model: "nfse", documentId: id, invoiceId: document.invoiceId, type: nfseEventCode,
    environment: document.environment, key: document.accessKey!, reasonCode: input.reasonCode,
    justification: input.justification, createdAt: now().toISOString(), createdBy: context.actor,
    xml, status: "enviando",
  };
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const current = store.document(context.tenant, id);
    requireValue(JSON.stringify(current) === JSON.stringify(document),
      "Documento alterado durante a preparação do cancelamento NFS-e.", 409);
    eligibility(store, context, company, current);
    store.put(context.tenant, "fiscalEvents", event.id, event);
    store.saveDocument(context.tenant, { ...document, status: "incerto", message: "Pedido de cancelamento NFS-e iniciado. Consulte o evento; não reenviar." });
    store.audit(context.tenant, context.actor, "nfse.event.cancel.send", event.id);
    store.db.exec("COMMIT");
  } catch (error) { store.db.exec("ROLLBACK"); throw error; }
  let result: NfseCancellationResult | undefined;
  try {
    result = await options.send(document, xml, identity);
    if (result.status === "registrado") {
      requireValue(result.artifact, "Resposta de registro não trouxe o XML do evento.", 502);
      await validator.validate(result.artifact, "nfse", true);
    }
    const saved: NfseCancellationEvent = { ...event, ...result };
    store.db.exec("BEGIN IMMEDIATE");
    try {
      store.put(context.tenant, "fiscalEvents", event.id, saved);
      store.saveDocument(context.tenant, { ...document,
        status: result.status === "registrado" ? "cancelado" : result.status === "rejeitado" ? "autorizado" : "incerto",
        message: result.message });
      store.audit(context.tenant, context.actor, `nfse.event.cancel.${result.status}`, event.id);
      store.db.exec("COMMIT");
    } catch (error) { store.db.exec("ROLLBACK"); throw error; }
    return saved;
  } catch (error) {
    store.put(context.tenant, "fiscalEvents", event.id, {
      ...event, ...(result ?? {}), status: "incerto", message: result
        ? "Resposta do evento recebida, mas não passou nas validações; consulte o evento e não reenvie."
        : "Falha após iniciar pedido de cancelamento NFS-e. Consulte o evento; não reenviar.",
    });
    store.audit(context.tenant, context.actor, "nfse.event.cancel.uncertain", event.id);
    throw error;
  }
}

export function nfseCancellationReply(document: FiscalDocument, requestXml: string, response: string): NfseCancellationResult {
  const payload = z.object({
    tipoAmbiente: z.number().int().min(1).max(2),
    versaoAplicativo: z.string().min(1),
    dataHoraProcessamento: z.string().datetime({ offset: true }),
    eventoXmlGZipB64: z.string().min(1),
  }).passthrough().parse(JSON.parse(response) as unknown);
  requireValue(document.kind === "nfse" && document.accessKey && /^\d{50}$/.test(document.accessKey),
    "Documento não tem chave NFS-e Nacional válida.", 502);
  requireValue(payload.tipoAmbiente === (document.environment === "producao" ? 1 : 2),
    "Resposta do evento pertence a outro ambiente.", 502);
  const bytes = Buffer.from(payload.eventoXmlGZipB64, "base64");
  requireValue(bytes.length > 0 && bytes.toString("base64") === payload.eventoXmlGZipB64,
    "XML do evento não está em Base64 canônico.", 502);
  const artifact = gunzipSync(bytes, { maxOutputLength: 2_000_000 }).toString("utf8");
  const xml = parseXml(artifact);
  requireValue(xml.documentElement.localName === "evento" && xml.documentElement.namespaceURI === NFSE_NS,
    "Resposta não contém o XML do evento NFS-e esperado.", 502);
  const info = single(xml, "infEvento"), requestRoot = parseXml(requestXml), eventId = single(requestRoot, "infPedReg").getAttribute("Id")!;
  requireValue(info.parentNode === xml.documentElement && info.getAttribute("Id") === `EVT${eventId.slice(3)}001` &&
    text(info, "ambGer") === "2" && text(info, "nSeqEvento") === "001",
  "Evento retornado tem identificador, gerador ou sequência divergente.", 502);
  const registeredRequest = single(info, "pedRegEvento"), registeredInfo = single(registeredRequest, "infPedReg");
  requireValue(registeredInfo.getAttribute("Id") === eventId &&
    text(registeredInfo, "tpAmb") === (document.environment === "producao" ? "1" : "2") &&
    text(registeredInfo, "chNFSe") === document.accessKey &&
    text(single(registeredInfo, "e101101"), "xDesc") === "Cancelamento de NFS-e",
  "Evento retornado não corresponde ao pedido, chave ou ambiente desta NFS-e.", 502);
  const reason = single(registeredInfo, "e101101");
  const sentReason = single(single(single(requestRoot, "infPedReg"), "e101101"), "cMotivo").textContent?.trim();
  requireValue(text(reason, "cMotivo") === sentReason &&
    text(reason, "xMotivo") === text(single(single(requestRoot, "infPedReg"), "e101101"), "xMotivo"),
  "Motivo do evento registrado difere do pedido enviado.", 502);
  return { status: "registrado", response, artifact, message: "Cancelamento NFS-e registrado pela Sefin Nacional." };
}
