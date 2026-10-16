import { createHash } from "node:crypto";
import { z } from "zod";
import type { CompanyData, Context } from "./auth.js";
import type { FiscalDocument, Store } from "./store.js";
import type { InvoiceCalculationRecord } from "./invoiceCalculation.js";
import { serviceRetentions } from "./retentions.js";
import { requireValue } from "./errors.js";
import { cents, elements, NFSE_NS, parseXml, single, text, xmlContent } from "./xml.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function child(node: Node, name: string) {
  const matches: Element[] = [];
  for (let item = node.firstChild; item; item = item.nextSibling)
    if (item.nodeType === 1 && (item as Element).localName === name && (item as Element).namespaceURI === NFSE_NS) matches.push(item as Element);
  requireValue(matches.length === 1, `NFS-e deve conter exatamente um ${name} direto no grupo esperado.`);
  return matches[0]!;
}
const value = (node: Node, name: string) => cents(child(node, name).textContent?.trim() ?? "");
function optionalValue(node: Node, name: string) {
  const matches = elements(node, name);
  requireValue(matches.length <= 1, `NFS-e possui ${name} duplicado.`);
  requireValue(matches.every((item) => item.namespaceURI === NFSE_NS), `Namespace inválido em ${name}.`);
  return matches.length ? cents(matches[0]!.textContent?.trim() ?? "") : 0;
}

export function inspectNfse(store: Store, context: Context, company: CompanyData, document: FiscalDocument) {
  requireValue(document.kind === "nfse" && document.status === "autorizado" && document.artifact &&
    document.accessKey && /^\d{50}$/.test(document.accessKey), "Conferência exige NFS-e autorizada com XML e chave retornados pela autoridade.", 409);
  const invoice = company.finance.invoices.find((item) => item.id === document.invoiceId && !item.canceled);
  const entries = company.finance.entries.filter((item) => item.invoiceId === document.invoiceId);
  const entry = entries[0];
  requireValue(invoice?.kind === "Serviços" && entries.length === 1 && entry && !entry.canceled && entry.kind === "Receber" &&
    entry.clientId === invoice.clientId && entry.amount === invoice.amount, "Conta/faturamento de serviços ausente ou divergente.", 409);
  const source = store.get<{ calculationId: string }>(context.tenant, "generatedDps", document.id);
  const calculation = source && store.get<InvoiceCalculationRecord>(context.tenant, "invoiceCalculations", source.calculationId);
  requireValue(calculation && calculation.invoiceId === invoice.id && calculation.kind === "nfse",
    "Conferência automática exige origem e memória da DPS gerada; XML externo ainda não suportado.", 409);
  requireValue(entry.id === calculation.payment.id, "Conta vinculada diferente da origem da DPS.", 409);
  const xml = parseXml(document.artifact);
  requireValue(xml.documentElement.localName === "NFSe" && xml.documentElement.namespaceURI === NFSE_NS, "XML retornado não é NFS-e Nacional.");
  const info = child(xml.documentElement, "infNFSe");
  requireValue(info.getAttribute("Id") === `NFS${document.accessKey}`, "Chave autorizada diverge do XML.");
  const dps = child(child(info, "DPS"), "infDPS");
  requireValue(dps.getAttribute("Id") === document.key &&
    text(dps, "tpAmb") === (document.environment === "producao" ? "1" : "2"), "DPS/ambiente do XML autorizado divergente.");
  const original = single(parseXml(document.xml), "infDPS");
  requireValue(hash(xmlContent(dps)) === hash(xmlContent(original)), "DPS retornada diferente da declaração enviada; conferir retorno fiscal.", 409);
  requireValue(text(child(info, "emit"), "CNPJ") === calculation.issuer.cnpj &&
    text(child(dps, "prest"), "CNPJ") === calculation.issuer.cnpj, "Emitente autorizado diferente da memória.");
  const recipient = child(dps, "toma");
  const client = company.clients.find((item) => item.id === invoice.clientId);
  requireValue(client && text(recipient, calculation.recipient.document.length === 11 ? "CPF" : "CNPJ") === calculation.recipient.document &&
    client.document.replace(/\D/g, "") === calculation.recipient.document, "Tomador autorizado diferente do cliente.");
  const service = child(dps, "valores");
  const commercial = value(child(service, "vServPrest"), "vServ");
  const discounts = elements(service, "vDescIncond");
  requireValue(discounts.length <= 1 && !elements(service, "vDescCond").some((node) => cents(node.textContent ?? "") > 0),
    "Desconto condicionado ou descontos duplicados não suportados na conciliação.");
  const discount = discounts.length ? cents(discounts[0]!.textContent ?? "") : 0;
  const totals = child(info, "valores");
  const expected = serviceRetentions(calculation);
  const taxTotal = (code: string, field: "amount" | "base" = "amount") =>
    calculation.lines.reduce((sum, line) => sum + line.calculation.items.reduce((subtotal, item) =>
      subtotal + item.taxes.filter((tax) => tax.code === code && !tax.retained).reduce((total, tax) => total + cents(tax[field]), 0), 0), 0);
  const rtcGroups: Element[] = [];
  for (let item = info.firstChild; item; item = item.nextSibling)
    if (item.nodeType === 1 && (item as Element).localName === "IBSCBS") rtcGroups.push(item as Element);
  requireValue(rtcGroups.length <= 1, "IBS/CBS oficial duplicado.");
  const rtc = rtcGroups[0];
  requireValue(!rtc || rtc.namespaceURI === NFSE_NS, "Namespace inválido no IBS/CBS oficial.");
  const rtcTotals = rtc ? child(rtc, "totCIBS") : undefined;
  const ibs = rtcTotals ? child(rtcTotals, "gIBS") : undefined;
  const actual = { invoiceAmount: commercial - discount, withheld: optionalValue(totals, "vTotalRet"),
    net: value(totals, "vLiq"), iss: value(totals, "vISSQN"), issBase: value(totals, "vBC"),
    irrf: optionalValue(service, "vRetIRRF"), inss: optionalValue(service, "vRetCP"), csll: optionalValue(service, "vRetCSLL"),
    rtcBase: rtc ? value(child(rtc, "valores"), "vBC") : null,
    ibsState: ibs ? value(child(ibs, "gIBSUFTot"), "vIBSUF") : null,
    ibsMunicipal: ibs ? value(child(ibs, "gIBSMunTot"), "vIBSMun") : null,
    ibsTotal: ibs ? value(ibs, "vIBSTot") : null,
    cbs: rtcTotals ? value(child(rtcTotals, "gCBS"), "vCBS") : null,
    total: rtcTotals ? value(rtcTotals, "vTotNF") : null };
  const differences: string[] = [];
  if (hash(invoice) !== hash(calculation.invoice)) differences.push("Faturamento alterado após gerar a DPS.");
  const compare = (label: string, actual: number, expected: number) => {
    if (actual !== expected) differences.push(`${label}: oficial ${actual} centavos; esperado ${expected} centavos.`);
  };
  compare("Bruto após desconto", actual.invoiceAmount, invoice.amount);
  compare("Bruto da memória", invoice.amount, calculation.invoice.amount);
  compare("ISS próprio", actual.iss, taxTotal("iss")); compare("Base ISS", actual.issBase, invoice.amount);
  for (const field of ["withheld", "net", "irrf", "inss", "csll"] as const) compare(field, actual[field], expected[field]);
  compare("Soma das retenções oficiais", actual.withheld, actual.irrf + actual.inss + actual.csll);
  compare("Líquido oficial", actual.net, actual.invoiceAmount - actual.withheld);
  compare("Saldo financeiro antes de baixas", entry.amount - (entry.retention?.withheld ?? 0), actual.net);
  if (expected.withheld > 0) {
    const review = store.get(context.tenant, "retentionReviews", calculation.id);
    if (!entry.retention || hash(entry.retention) !== hash(review)) differences.push("Conciliação de retenções da conta ausente ou diferente da revisão confirmada.");
  } else if (entry.retention) differences.push("Conta possui retenção não declarada.");
  if (!rtc) differences.push("IBS/CBS oficial ausente: conferência tributária incompleta; não presumir valores iguais a zero.");
  else {
    compare("Base IBS/CBS", actual.rtcBase!, taxTotal("cbs", "base"));
    compare("IBS estadual", actual.ibsState!, taxTotal("ibs-state"));
    compare("IBS municipal", actual.ibsMunicipal!, taxTotal("ibs-municipal"));
    compare("IBS total", actual.ibsTotal!, taxTotal("ibs-state") + taxTotal("ibs-municipal"));
    compare("CBS", actual.cbs!, taxTotal("cbs"));
    compare("Total RTC em 2026", actual.total!, actual.net);
  }
  requireValue(text(dps, "dCompet").startsWith("2026-"), "Conferência de total RTC limitada a 2026.");
  const snapshot = { documentId: document.id, invoiceId: invoice.id, entryId: entry.id, environment: document.environment,
    accessKey: document.accessKey, calculationId: calculation.id, calculationHash: hash(calculation),
    declarationHash: hash(document.xml), artifactHash: hash(document.artifact), invoice, entry, client };
  return { id: hash(snapshot), documentId: document.id, invoiceId: invoice.id, entryId: entry.id,
    environment: document.environment, accessKey: document.accessKey, calculationId: calculation.id, actual, differences,
    matches: differences.length === 0 };
}
export type NfseCheck = ReturnType<typeof inspectNfse> & { confirmedAt?: string; confirmedBy?: string };
export function getNfseCheck(store: Store, context: Context, company: CompanyData, document: FiscalDocument): NfseCheck {
  const current = inspectNfse(store, context, company, document);
  const saved = store.get<NfseCheck>(context.tenant, "nfseChecks", document.id);
  return saved?.id === current.id && current.matches ? { ...current, confirmedAt: saved.confirmedAt, confirmedBy: saved.confirmedBy } : current;
}
export function confirmNfse(store: Store, context: Context, company: CompanyData, document: FiscalDocument, input: unknown) {
  const request = z.object({ checkId: z.string().regex(/^[a-f0-9]{64}$/), confirmation: z.literal(true) }).strict().parse(input);
  const check = inspectNfse(store, context, company, document);
  requireValue(check.id === request.checkId, "Conferência obsoleta. Atualize e confira novamente.", 409);
  requireValue(check.matches, "Valores oficiais divergentes; não alterar o saldo nem liberar cobrança automaticamente.", 409);
  const saved: NfseCheck = { ...check, confirmedAt: new Date().toISOString(), confirmedBy: context.actor };
  store.put(context.tenant, "nfseChecks", document.id, saved);
  store.audit(context.tenant, context.actor, "nfse.reconcile", document.id);
  return saved;
}
export function requireNfseCollection(store: Store, context: Context, company: CompanyData, invoiceId: string) {
  const document = store.collectionDocument(context.tenant, invoiceId, "nfse");
  const check = inspectNfse(store, context, company, document);
  const source = store.get<{ calculationId: string }>(context.tenant, "generatedDps", document.id)!;
  const calculation = store.get<InvoiceCalculationRecord>(context.tenant, "invoiceCalculations", source.calculationId)!;
  const issuer = store.get<{ cnpj: string }>(context.tenant, "settings", "issuer");
  requireValue(issuer?.cnpj === calculation.issuer.cnpj, "Emitente da NFS-e diferente do cedente atual; não liberar cobrança.", 409);
  const saved = store.get<NfseCheck>(context.tenant, "nfseChecks", document.id);
  requireValue(check.matches && saved?.id === check.id && saved.confirmedAt,
    "Remessa aguarda conferência explícita e atual dos valores oficiais da NFS-e.", 409);
  return check;
}
