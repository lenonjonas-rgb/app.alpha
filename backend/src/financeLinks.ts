import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { companySchema, type CompanyData, type Context } from "./auth.js";
import type { Store } from "./store.js";
import { requireValue } from "./errors.js";

type Cancellation = { id: string; entryId: string; invoiceId?: string; confirmedAt: string; confirmedBy: string; fingerprint: string };
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function financeLinks(store: Store, context: Context, company: CompanyData) {
  requireValue(new Set(company.finance.entries.map((item) => item.id)).size === company.finance.entries.length &&
    new Set(company.finance.invoices.map((item) => item.id)).size === company.finance.invoices.length,
    "Identificadores financeiros duplicados; corrija os dados antes de consultar ou cancelar.", 409);
  const documents = store.documents(context.tenant);
  const remittances = store.list<{ id: string; entryIds: string[]; createdAt: string; fileSequence: number }>(context.tenant, "remittances");
  return company.finance.entries.map((entry) => {
    const linked = entry.invoiceId ? documents.filter((item) => item.invoiceId === entry.invoiceId) : [];
    const remitted = remittances.filter((item) => item.entryIds.includes(entry.id));
    const cancellation = store.get<Cancellation>(context.tenant, "financeCancellations", entry.id);
    const reasons: string[] = [];
    if (entry.invoiceId && store.get(context.tenant, "pendingFinanceChanges", entry.invoiceId))
      reasons.push("Alteração de retenções aguardando sincronização protegida. Conclua ou retente a conciliação antes de cancelar.");
    if (entry.canceled) reasons.push("Conta já cancelada.");
    if (entry.settlements.some((item) => !item.reversed)) reasons.push("Estorne as baixas ativas antes de cancelar.");
    if (linked.some((item) => !["cancelado", "rejeitado"].includes(item.status)))
      reasons.push("Há documento fiscal ativo, inclusive rascunho/homologação. Resolva-o na aba Fiscal antes de cancelar a conta.");
    if (remitted.length) reasons.push("Conta incluída em remessa. Resolva a cobrança no banco; não há baixa/cancelamento bancário implementado.");
    return { entryId: entry.id, ...(entry.invoiceId ? { invoiceId: entry.invoiceId } : {}),
      documents: linked.map(({ id, kind, environment, status, key, accessKey, protocol, message }) =>
        ({ id, kind, environment, status, key, accessKey, protocol, message })),
      remittances: remitted.map(({ id, createdAt, fileSequence }) => ({ id, createdAt, fileSequence })),
      cancellationPending: Boolean(cancellation && !entry.canceled),
      cancellationAllowed: reasons.length === 0, reasons };
  });
}
export function reserveFinanceCancellation(store: Store, context: Context, company: CompanyData, input: unknown) {
  const request = z.object({
    expectedEntry: companySchema.shape.finance.shape.entries.element,
    expectedInvoice: companySchema.shape.finance.shape.invoices.element.optional(),
    confirmation: z.literal(true),
  }).strict().parse(input);
  const entry = company.finance.entries.find((item) => item.id === request.expectedEntry.id);
  requireValue(entry && fingerprint(entry) === fingerprint(request.expectedEntry),
    "Conta alterada ou ainda não sincronizada. Atualize e confira novamente.", 409);
  const invoice = entry.invoiceId ? company.finance.invoices.find((item) => item.id === entry.invoiceId) : undefined;
  requireValue(!entry.invoiceId || (invoice && !invoice.canceled && invoice.id === request.expectedInvoice?.id &&
    fingerprint(invoice) === fingerprint(request.expectedInvoice)), "Faturamento alterado ou indisponível para cancelamento.", 409);
  requireValue(!request.expectedInvoice || request.expectedInvoice.id === entry.invoiceId, "Faturamento diferente da conta.", 409);
  requireValue(!invoice || (company.finance.entries.filter((item) => item.invoiceId === invoice.id).length === 1 &&
    entry.kind === "Receber" && entry.amount === invoice.amount && entry.clientId === invoice.clientId),
    "Conta a receber inconsistente com o faturamento; não cancelar parcialmente um vínculo corrompido.", 409);
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const link = financeLinks(store, context, company).find((item) => item.entryId === entry.id)!;
    requireValue(link.cancellationAllowed, link.reasons.join(" "), 409);
    const currentFingerprint = fingerprint({ entry, invoice });
    const previous = store.get<Cancellation>(context.tenant, "financeCancellations", entry.id);
    const invoiceReservation = entry.invoiceId ? store.get<Cancellation>(context.tenant, "invoiceCancellations", entry.invoiceId) : undefined;
    requireValue(!invoiceReservation || invoiceReservation.entryId === entry.id, "Faturamento com reserva de outra conta.", 409);
    const reservation: Cancellation = previous?.fingerprint === currentFingerprint ? previous : { id: randomUUID(), entryId: entry.id,
      ...(entry.invoiceId ? { invoiceId: entry.invoiceId } : {}), fingerprint: currentFingerprint,
      confirmedAt: new Date().toISOString(), confirmedBy: context.actor };
    if (previous && previous.id !== reservation.id) store.put(context.tenant, "financeCancellationHistory", previous.id, previous);
    store.put(context.tenant, "financeCancellations", entry.id, reservation);
    if (entry.invoiceId) store.put(context.tenant, "invoiceCancellations", entry.invoiceId, reservation);
    store.audit(context.tenant, context.actor, "finance.cancel.reserve", entry.id);
    store.db.exec("COMMIT");
    return { id: reservation.id, entryId: entry.id, invoiceId: entry.invoiceId, confirmedAt: reservation.confirmedAt };
  } catch (error) { store.db.exec("ROLLBACK"); throw error; }
}
