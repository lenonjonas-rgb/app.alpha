import { createHash } from "node:crypto";
import type { CompanyData, Context } from "../src/auth.js";
import type { Store } from "../src/store.js";
import { nfeCollectionSource } from "../src/nfeCollection.js";
import { NFE_NS, NFSE_NS, signXml, single, text, parseXml, cents } from "../src/xml.js";
import { syntheticIdentity } from "./syntheticIdentity.js";
import { issuerFixture, fiscalAddress } from "./partyFixtures.js";
import { FiscalParties } from "../src/parties.js";
import { FiscalCatalog } from "../src/catalog.js";
import { FiscalMatrix } from "../src/matrix.js";
import { InvoiceCalculation } from "../src/invoiceCalculation.js";
import { blingReferences } from "../src/rules.js";
import { serviceParameters } from "./taxFixtures.js";
import { generateDps } from "../src/dpsGenerator.js";
import { inspectNfse, confirmNfse } from "../src/nfseReconciliation.js";

const identities = new Map<string, ReturnType<typeof syntheticIdentity>>();
const money = (value: number) => (value / 100).toFixed(2);
// Somente documentos sintéticos armazenados localmente; nenhuma autoridade é acessada.
export function authorizedNfe(store: Store, context: Context, company: CompanyData, invoiceId: string) {
  const issuer = store.get<{ cnpj: string }>(context.tenant, "settings", "issuer")!;
  const source = nfeCollectionSource(company, invoiceId, issuer.cnpj);
  const numericCode = String(parseInt(createHash("sha256").update(invoiceId).digest("hex").slice(0, 6), 16)).padStart(8, "0");
  const base = `422610${issuer.cnpj}550010000000011${numericCode}`;
  const sum = [...base].reverse().reduce((total, digit, index) => total + Number(digit) * (2 + index % 8), 0);
  const digit = 11 - sum % 11, key = base + (digit >= 10 ? 0 : digit);
  const documentNumber = source.client.document.replace(/\D/g, "");
  const tag = documentNumber.length === 11 ? "CPF" : "CNPJ";
  const amount = money(source.invoice.amount);
  const xml = `<NFe xmlns="${NFE_NS}"><infNFe Id="NFe${key}" versao="4.00"><ide><cUF>42</cUF><tpAmb>1</tpAmb><mod>55</mod><dhEmi>2026-10-15T12:00:00-03:00</dhEmi><serie>1</serie><nNF>1</nNF><tpEmis>1</tpEmis><cNF>${numericCode}</cNF><cDV>${key.at(-1)}</cDV></ide><emit><CNPJ>${issuer.cnpj}</CNPJ><CRT>3</CRT></emit><dest><${tag}>${documentNumber}</${tag}></dest><total><ICMSTot><vNF>${amount}</vNF></ICMSTot></total><pag><detPag><tPag>15</tPag><vPag>${amount}</vPag></detPag></pag></infNFe></NFe>`;
  let identity = identities.get(issuer.cnpj);
  if (!identity) { identity = syntheticIdentity(issuer.cnpj); identities.set(issuer.cnpj, identity); }
  const signedXml = signXml(xml, "nfe", identity);
  const protocol = "142260000000001";
  const proc = `<protNFe xmlns="${NFE_NS}" versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${key}</chNFe><nProt>${protocol}</nProt><digVal>${text(single(parseXml(signedXml), "Signature"), "DigestValue")}</digVal><cStat>100</cStat><xMotivo>Autorizado em teste sintetico</xMotivo></infProt></protNFe>`;
  const draft = store.createDocument(context.tenant, { invoiceId, kind: "nfe", environment: "producao", key: `NFe${key}`, xml });
  store.put(context.tenant, "externalNfeSource", draft.id, source);
  return store.saveDocument(context.tenant, { ...draft, status: "autorizado", signedXml, protocol,
    artifact: `<nfeProc xmlns="${NFE_NS}" versao="4.00">${signedXml}${proc}</nfeProc>` });
}
export function authorizedNfse(store: Store, context: Context, company: CompanyData, invoiceId: string) {
  const invoice = company.finance.invoices.find((item) => item.id === invoiceId)!;
  const client = company.clients.find((item) => item.id === invoice.clientId)!;
  const issuer = store.get<{ cnpj: string; name: string }>(context.tenant, "settings", "issuer")!;
  store.put(context.tenant, "settings", "issuer", { ...issuerFixture, cnpj: issuer.cnpj, name: issuer.name });
  company.services = [{ id: "service-fixture", name: "Servico" }];
  invoice.orders = [{ orderId: `order-${invoiceId}`, code: "OS1", amount: invoice.amount, items: [{
    id: "line", source: "item", kind: "servico", referenceId: "service-fixture", name: "Servico", quantity: 1,
    price: invoice.amount, gross: invoice.amount, itemDiscount: 0, orderDiscount: 0,
  }] }];
  const rule = { ...blingReferences.find((item) => item.kind === "nfse")!, reviewed: true };
  new FiscalCatalog(store).save(context, company, [rule], { kind: "nfse", referenceId: "service-fixture", ruleId: rule.id,
    active: true, notes: "", nationalCode: "140101", municipalCode: "", nbs: "120029000" });
  new FiscalParties(store).save(context, company, { clientId: client.id, document: client.document.replace(/\D/g, ""),
    name: client.name, address: fiscalAddress, ieIndicator: "9", ie: "", im: "", finalConsumer: true, email: "", phone: "" });
  new FiscalMatrix(store).save(context, [rule], { id: "service-matrix", kind: "nfse", ruleId: rule.id, name: "Teste",
    operation: "Servico local sintetico", validFrom: "2026-01-01", validUntil: "2026-12-31", destinationState: "SC",
    ieIndicator: "9", finalConsumer: true, active: true, reviewed: true, approval: "Aprovacao sintetica de teste", parameters: serviceParameters });
  const calculation = new InvoiceCalculation(store).prepare(context, company, [rule], { invoiceId, date: "2026-10-15" });
  const generated = generateDps(calculation, { invoiceId, environment: "homologacao", series: 1, expectedNumber: 1,
    competence: "2026-10-15", issuedAt: "2026-10-15T12:00:00-03:00", operationIndicator: "050102",
    personalUse: "0", totalTaxPercent: { federal: "0", state: "0", municipal: "0" },
    confirmScope: true, confirmUnconditionalDiscount: true });
  const xml = generated.xml.replace("<tpAmb>2", "<tpAmb>1"), key = "3".repeat(50);
  const tax = (code: string, field: "amount" | "base" = "amount") => calculation.lines.reduce((total, line) => total +
    line.calculation.items.reduce((sum, item) => sum + item.taxes.filter((item) => item.code === code && !item.retained)
      .reduce((sum, item) => sum + cents(item[field]), 0), 0), 0);
  const draft = store.createDocument(context.tenant, { invoiceId, kind: "nfse", environment: "producao", key: generated.key, xml });
  store.put(context.tenant, "generatedDps", draft.id, { calculationId: calculation.id });
  const artifact = `<NFSe xmlns="${NFSE_NS}" versao="1.01"><infNFSe Id="NFS${key}"><nNFSe>1</nNFSe><emit><CNPJ>${issuer.cnpj}</CNPJ></emit><valores><vBC>${money(invoice.amount)}</vBC><vISSQN>${money(tax("iss"))}</vISSQN><vLiq>${money(invoice.amount)}</vLiq></valores><IBSCBS><valores><vBC>${money(tax("ibs-state", "base"))}</vBC></valores><totCIBS><vTotNF>${money(invoice.amount)}</vTotNF><gIBS><vIBSTot>${money(tax("ibs-state") + tax("ibs-municipal"))}</vIBSTot><gIBSUFTot><vIBSUF>${money(tax("ibs-state"))}</vIBSUF></gIBSUFTot><gIBSMunTot><vIBSMun>${money(tax("ibs-municipal"))}</vIBSMun></gIBSMunTot></gIBS><gCBS><vCBS>${money(tax("cbs"))}</vCBS></gCBS></totCIBS></IBSCBS>${xml}</infNFSe></NFSe>`;
  const document = store.saveDocument(context.tenant, { ...draft, status: "autorizado", accessKey: key, artifact });
  const check = inspectNfse(store, context, company, document);
  confirmNfse(store, context, company, document, { checkId: check.id, confirmation: true });
  return document;
}
