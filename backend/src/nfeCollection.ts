import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CompanyData, Context } from "./auth.js";
import type { Store } from "./store.js";
import type { InvoiceCalculationRecord } from "./invoiceCalculation.js";
import { generateNfe, generatedNfeSchema } from "./nfeGenerator.js";
import { requireValue } from "./errors.js";
import { elements, inspectUnsigned, parseXml, single, text } from "./xml.js";
import { authorizedNfeArtifact } from "./authorizedXml.js";

export type NfeCollectionSource = {
  invoice: CompanyData["finance"]["invoices"][number];
  entry: CompanyData["finance"]["entries"][number];
  client: CompanyData["clients"][number]; issuerCnpj: string;
};
export function nfeCollectionSource(company: CompanyData, invoiceId: string, issuerCnpj: string): NfeCollectionSource {
  const invoice = company.finance.invoices.find((item) => item.id === invoiceId);
  const entries = company.finance.entries.filter((item) => item.invoiceId === invoiceId);
  const entry = entries[0], client = company.clients.find((item) => item.id === invoice?.clientId);
  requireValue(invoice?.kind === "Produtos" && !invoice.canceled && entries.length === 1 && entry && !entry.canceled &&
    entry.kind === "Receber" && entry.amount === invoice.amount && (!entry.clientId || entry.clientId === invoice.clientId) && client &&
    !entry.retention, "Origem da NF-e exige faturamento de produtos e conta única coerente, sem retenção.", 409);
  return structuredClone({ invoice, entry, client, issuerCnpj });
}
const payment = ({ settlements: _settlements, ...entry }: NfeCollectionSource["entry"]) => entry;
export function sameNfeCollectionSource(before: NfeCollectionSource, after: NfeCollectionSource) {
  return isDeepStrictEqual({ ...before, entry: payment(before.entry) }, { ...after, entry: payment(after.entry) });
}
export function requireNfeCollection(store: Store, context: Context, company: CompanyData, invoiceId: string) {
  const document = store.collectionDocument(context.tenant, invoiceId, "nfe");
  const issuer = store.get<{ cnpj: string }>(context.tenant, "settings", "issuer");
  requireValue(issuer?.cnpj, "Emitente fiscal ausente.", 409);
  const current = nfeCollectionSource(company, invoiceId, issuer.cnpj);
  const external = store.get<NfeCollectionSource>(context.tenant, "externalNfeSource", document.id);
  const generated = store.get<{ calculationId: string; input: unknown; numericCode: string }>(context.tenant, "generatedNfe", document.id);
  const calculation = generated && store.get<InvoiceCalculationRecord>(context.tenant, "invoiceCalculations", generated.calculationId);
  if (generated) {
    requireValue(calculation?.kind === "nfe" && calculation.invoiceId === invoiceId &&
      isDeepStrictEqual(calculation.invoice, current.invoice) && isDeepStrictEqual(payment(calculation.payment), payment(current.entry)) &&
      calculation.issuer.cnpj === issuer.cnpj && calculation.recipient.document === current.client.document.replace(/\D/g, "") &&
      generateNfe(calculation, generatedNfeSchema.parse(generated.input), generated.numericCode).xml === document.xml,
    "NF-e gerada sem memória/origem comercial atual e íntegra. Não liberar cobrança.", 409);
  } else {
    requireValue(external && sameNfeCollectionSource(external, current),
      "NF-e externa sem origem comercial preservada ou com dados alterados. Documento legado exige conciliação própria; não liberar cobrança.", 409);
  }
  requireValue(document.signedXml && document.artifact && document.protocol, "NF-e sem XML assinado, nfeProc ou protocolo autorizado.", 409);
  const key = inspectUnsigned(document.xml, "nfe", "producao", issuer.cnpj, current.client.document, current.invoice.amount);
  requireValue(key === document.key, "Chave da NF-e diferente do documento vinculado.", 409);
  authorizedNfeArtifact(document);
  const unsigned = parseXml(document.xml);
  const declaredPayment = single(unsigned, "detPag");
  requireValue(current.entry.paymentMethod === "Boleto" && text(declaredPayment, "tPag") === "15" &&
    !elements(unsigned, "vTroco").some((item) => item.textContent !== "0.00"),
  "Forma de pagamento/troco da NF-e incompatível com a cobrança por boleto.", 409);
  const snapshot = { documentId: document.id, key, protocol: document.protocol, xml: document.xml, signedXml: document.signedXml,
    artifact: document.artifact, source: current };
  return { id: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), documentId: document.id,
    accessKey: key.slice(3), protocol: document.protocol, amount: current.invoice.amount };
}
