import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CompanyData, Context } from "./auth.js";
import type { Identity } from "./certificate.js";
import type { FiscalDocument, Store } from "./store.js";
import type { Validator } from "./service.js";
import { authorizedNfeArtifact } from "./authorizedXml.js";
import { requireValue } from "./errors.js";
import { NFE_NS, parseXml, serialize, signFiscalElement, single, text } from "./xml.js";

export type CancellationEvent = {
  id: string; documentId: string; invoiceId: string; type: "110111"; environment: FiscalDocument["environment"];
  key: string; justification: string; createdAt: string; createdBy: string; xml: string;
  status: "enviando" | "incerto" | "registrado" | "rejeitado" | "cancelamento_confirmado";
  response?: string; artifact?: string; protocol?: string; message?: string;
  consultation?: string;
  declarations: { noCirculation: true; noService: true; noBookEntry: true };
};
export type CancellationResult = Pick<CancellationEvent, "response" | "artifact" | "protocol" | "message"> & {
  status: "registrado" | "rejeitado" | "incerto";
};
export const nfeCancellationSchema = z.object({
  confirmation: z.string().regex(/^\d{44}$/),
  justification: z.string().trim().min(15).max(255).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Justificativa contém caracteres inválidos."),
  noCirculation: z.literal(true), noService: z.literal(true), noBookEntry: z.literal(true),
}).strict();
export function pendingCancellation(store: Store, tenant: string, documentId: string) {
  return store.list<CancellationEvent>(tenant, "fiscalEvents").find((event) =>
    event.type === "110111" && event.documentId === documentId && ["enviando", "incerto"].includes(event.status));
}
function eligibility(store: Store, context: Context, company: CompanyData, document: FiscalDocument, now: Date) {
  const artifact = authorizedNfeArtifact(document);
  requireValue(!pendingCancellation(store, context.tenant, document.id), "Cancelamento já enviado ou incerto. Consulte; não repetir o evento.", 409);
  store.assertInvoiceAvailable(context.tenant, document.invoiceId);
  const entries = company.finance.entries.filter((entry) => entry.invoiceId === document.invoiceId);
  const invoice = company.finance.invoices.find((invoice) => invoice.id === document.invoiceId);
  requireValue(invoice && !invoice.canceled && invoice.kind === "Produtos" && entries.length === 1 && entries[0] &&
    !entries[0].canceled && entries[0].kind === "Receber" && entries[0].clientId === invoice.clientId && entries[0].amount === invoice.amount,
  "Conta/faturamento canônicos inconsistentes; não cancelar a NF-e.", 409);
  requireValue(!entries[0].settlements.some((settlement) => !settlement.reversed),
    "Estorne as baixas ativas antes de solicitar cancelamento fiscal.", 409);
  const remittances = store.list<{ entryIds: string[]; entries?: Array<{ invoiceId: string; fiscalDocumentId?: string }> }>(context.tenant, "remittances");
  requireValue(!remittances.some((remittance) => remittance.entryIds.includes(entries[0]!.id) ||
    remittance.entries?.some((title) => title.invoiceId === invoice.id || title.fiscalDocumentId === document.id)),
  "Há remessa vinculada. Cancelamento bancário/retorno ainda não implementado; não cancelar a NF-e por este fluxo.", 409);
  const timestamp = text(single(parseXml(artifact), "infProt"), "dhRecbto");
  requireValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/.test(timestamp),
    "Data/hora de autorização ausente ou inválida; não presumir o prazo de cancelamento.", 409);
  const elapsed = now.getTime() - Date.parse(timestamp);
  requireValue(Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 24 * 60 * 60 * 1000,
    "Cancelamento normal de SC exige até 24 horas da autorização. Consulte a contabilidade para regularização; sem cancelamento extemporâneo neste fluxo.", 409);
}
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export async function cancelNfe(options: {
  store: Store; context: Context; id: string; input: unknown; identity: Identity; validator: Validator;
  company: () => Promise<CompanyData>; send: (document: FiscalDocument, xml: string, identity: Identity) => Promise<CancellationResult>;
  now?: () => Date;
}) {
  const { store, context, id, identity, validator } = options;
  const input = nfeCancellationSchema.parse(options.input);
  const document = store.document(context.tenant, id), now = options.now ?? (() => new Date());
  requireValue(document.kind === "nfe" && input.confirmation === document.key.slice(3),
    "Cancelamento disponível somente para NF-e e exige confirmação da chave completa.", 409);
  const issuer = text(single(parseXml(document.xml), "emit"), "CNPJ");
  requireValue(identity.cnpj === issuer, "A1 não corresponde ao emitente original da NF-e.", 409);
  eligibility(store, context, await options.company(), document, now());
  const eventKey = `ID110111${document.key.slice(3)}01`;
  const eventXml = `<evento xmlns="${NFE_NS}" versao="1.00"><infEvento Id="${eventKey}"><cOrgao>42</cOrgao><tpAmb>${document.environment === "producao" ? "1" : "2"}</tpAmb><CNPJ>${issuer}</CNPJ><chNFe>${document.key.slice(3)}</chNFe><dhEvento>${now().toISOString().replace(/\.\d{3}Z$/, "+00:00")}</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${document.protocol}</nProt><xJust>${escape(input.justification)}</xJust></detEvento></infEvento></evento>`;
  const xml = `<envEvento xmlns="${NFE_NS}" versao="1.00"><idLote>${Date.now()}</idLote>${signFiscalElement(eventXml, "infEvento", identity)}</envEvento>`;
  await validator.validate(xml, "nfe", true);
  const company = await options.company();
  const event: CancellationEvent = { id: randomUUID(), documentId: id, invoiceId: document.invoiceId, type: "110111",
    environment: document.environment, key: document.key, justification: input.justification, createdAt: now().toISOString(),
    createdBy: context.actor, xml, status: "enviando",
    declarations: { noCirculation: input.noCirculation, noService: input.noService, noBookEntry: input.noBookEntry } };
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const current = store.document(context.tenant, id);
    requireValue(JSON.stringify(current) === JSON.stringify(document), "Documento alterado durante a preparação do cancelamento.", 409);
    eligibility(store, context, company, current, now());
    store.put(context.tenant, "fiscalEvents", event.id, event);
    store.saveDocument(context.tenant, { ...document, status: "incerto", message: "Cancelamento fiscal iniciado. Aguarde o retorno; não reenviar." });
    store.audit(context.tenant, context.actor, "event.cancel.send", event.id);
    store.db.exec("COMMIT");
  } catch (error) { store.db.exec("ROLLBACK"); throw error; }
  try {
    const result = await options.send(document, xml, identity);
    const saved: CancellationEvent = { ...event, ...result };
    store.db.exec("BEGIN IMMEDIATE");
    try {
      store.put(context.tenant, "fiscalEvents", event.id, saved);
      store.saveDocument(context.tenant, { ...document, status: result.status === "registrado" ? "cancelado" :
        result.status === "rejeitado" ? "autorizado" : "incerto", message: result.message });
      store.audit(context.tenant, context.actor, `event.cancel.${result.status}`, event.id);
      store.db.exec("COMMIT");
    } catch (error) { store.db.exec("ROLLBACK"); throw error; }
    return saved;
  } catch (error) {
    store.put(context.tenant, "fiscalEvents", event.id, { ...event, status: "incerto", message: "Falha após iniciar cancelamento. Consulte; não reenviar." });
    store.audit(context.tenant, context.actor, "event.cancel.uncertain", event.id);
    throw error;
  }
}

export function cancellationReply(document: FiscalDocument, signed: string, response: string): CancellationResult {
  const xml = parseXml(response), result = single(xml, "retEnvEvento");
  requireValue(result.namespaceURI === NFE_NS, "Retorno de evento com namespace inválido.", 502);
  const field = (name: string) => {
    const matches = Array.from(result.childNodes).filter((node) => node.nodeType === 1 &&
      (node as Element).localName === name && (node as Element).namespaceURI === NFE_NS);
    requireValue(matches.length === 1, `Lote de eventos sem ${name} único.`, 502);
    return matches[0]!.textContent?.trim();
  };
  requireValue(field("tpAmb") === (document.environment === "producao" ? "1" : "2") && field("cOrgao") === "42",
    "Lote de eventos de outro ambiente/órgão.", 502);
  const code = field("cStat");
  if (code !== "128") return { status: "incerto", response, message: `${code} · Lote de evento não confirmado. Consulte a NF-e.` };
  const returned = single(result, "retEvento"), info = single(returned, "infEvento");
  requireValue(returned.parentNode === result && returned.namespaceURI === NFE_NS && info.namespaceURI === NFE_NS &&
    info.parentNode === returned && text(info, "chNFe") === document.key.slice(3) &&
    text(info, "tpAmb") === (document.environment === "producao" ? "1" : "2") &&
    text(info, "tpEvento") === "110111" && text(info, "nSeqEvento") === "1" && text(info, "cOrgao") === "42",
  "Retorno de cancelamento de outra chave, ambiente, órgão ou evento.", 502);
  const eventCode = text(info, "cStat"), message = `${eventCode} · ${text(info, "xMotivo")}`;
  if (["135", "155"].includes(eventCode)) {
    const protocol = text(info, "nProt");
    requireValue(/^\d{15}$/.test(protocol), "Protocolo de cancelamento inválido.", 502);
    const event = single(parseXml(signed), "evento");
    return { status: "registrado", response, protocol, message,
      artifact: `<procEventoNFe xmlns="${NFE_NS}" versao="1.00">${serialize(event)}${serialize(returned)}</procEventoNFe>` };
  }
  const rejected = ["215", "225", "239", "249", "250", "251", "252", "253", "254", "255", "256", "257", "258", "259", "260", "280", "281", "283", "284", "285", "286", "420", "501", "572", "574", "575", "577", "578", "580"].includes(eventCode);
  return { status: rejected ? "rejeitado" : "incerto", response, message };
}
