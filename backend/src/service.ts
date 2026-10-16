import { z } from "zod";
import type { Context, CompanyData } from "./auth.js";
import type { CertificateVault } from "./certificate.js";
import type { FiscalDocument, Store, Environment, Kind } from "./store.js";
import type { Identity } from "./certificate.js";
import { inspectUnsigned, signXml } from "./xml.js";
import type { SchemaValidator } from "./xml.js";
import { requireValue } from "./errors.js";
import { assertRuleMatches, blingReferences, importTaxReferences, ruleSchema } from "./rules.js";
import type { TaxRule } from "./rules.js";
import { addressSchema, documentSchema } from "./identification.js";
import { FiscalNumbering } from "./numbering.js";
import { randomInt, randomUUID } from "node:crypto";
import { InvoiceCalculation, type InvoiceCalculationRecord } from "./invoiceCalculation.js";
import { generateNfe, generatedNfeSchema, type GeneratedNfeInput } from "./nfeGenerator.js";
import { generateDps, generatedDpsSchema, type GeneratedDpsInput } from "./dpsGenerator.js";
import { assertRetention, retentionSchema, serviceRetentions, type Retention } from "./retentions.js";
import { nfeCollectionSource, sameNfeCollectionSource, type NfeCollectionSource } from "./nfeCollection.js";
import { cancelNfe, pendingCancellation, type CancellationResult } from "./nfeCancellation.js";
import { cancelNfse, pendingNfseCancellation, type NfseCancellationResult } from "./nfseCancellation.js";

type GeneratedSource = { input: GeneratedNfeInput; numericCode: string; calculationId: string };
type GeneratedDpsSource = { input: GeneratedDpsInput; calculationId: string };

export const issuerSchema = z.object({
  cnpj: documentSchema.refine((value) => value.length === 14, "Emitente exige CNPJ."),
  name: z.string().trim().min(1).max(60),
  ie: z.string().regex(/^\d{2,14}$/),
  im: z.string().trim().min(1).max(30),
  municipality: z.literal("4205407"),
  taxRegime: z.literal("Lucro Real"),
  address: addressSchema,
  email: z.union([z.literal(""), z.email().max(80)]),
  phone: z.string().regex(/^\d{6,14}$|^$/),
}).superRefine((profile, context) => {
  if (profile.address.municipality !== "4205407" || profile.address.state !== "SC")
    context.addIssue({ code: "custom", path: ["address"], message: "Este conector exige emitente de Florianópolis/SC (4205407)." });
});
export type AuthorityResult = {
  status: "autorizado" | "rejeitado" | "processando" | "cancelado" | "incerto";
  message: string; response: string; artifact?: string; protocol?: string; accessKey?: string; receipt?: string;
};
export interface Authority {
  transmit(document: FiscalDocument, identity: Identity): Promise<AuthorityResult>;
  consult(document: FiscalDocument, identity: Identity): Promise<AuthorityResult>;
  cancelNfe?(document: FiscalDocument, xml: string, identity: Identity): Promise<CancellationResult>;
  cancelNfse?(document: FiscalDocument, xml: string, identity: Identity): Promise<NfseCancellationResult>;
  consultNfseCancellation?(document: FiscalDocument, xml: string, identity: Identity): Promise<NfseCancellationResult>;
}
export type Validator = Pick<SchemaValidator, "validate" | "ready">;
const draftSchema = z.object({
  invoiceId: z.string().min(1).max(200), kind: z.enum(["nfe", "nfse"]),
  environment: z.enum(["homologacao", "producao"]), xml: z.string().min(1).max(2_000_000),
  ruleId: z.string().min(1).max(200),
});
export class FiscalService {
  private busy = new Set<string>();
  constructor(readonly store: Store, readonly vault: CertificateVault, readonly validator: Validator,
    readonly authority: Authority, private production: boolean) {}
  profile(context: Context) { return this.store.get<z.infer<typeof issuerSchema>>(context.tenant, "settings", "issuer") ?? null; }
  saveProfile(context: Context, input: unknown) {
    const profile = issuerSchema.parse(input);
    const certificate = this.vault.metadata(context.tenant);
    requireValue(!certificate || certificate.cnpj === profile.cnpj, "O emitente deve corresponder ao certificado cadastrado.");
    this.store.put(context.tenant, "settings", "issuer", profile);
    this.store.audit(context.tenant, context.actor, "issuer.save", "issuer");
    return profile;
  }
  rules(context: Context) {
    const saved = this.store.list<TaxRule>(context.tenant, "rules");
    return [...saved, ...blingReferences.filter((reference) => !saved.some((rule) => rule.id === reference.id))];
  }
  saveRule(context: Context, input: unknown) {
    const rule = ruleSchema.parse(input);
    this.store.put(context.tenant, "rules", rule.id, rule);
    this.store.audit(context.tenant, context.actor, rule.reviewed ? "rule.review" : "rule.save", rule.id);
    return rule;
  }
  importRules(context: Context, xml: string) {
    const rules = importTaxReferences(xml);
    for (const rule of rules) this.saveRule(context, rule);
    return rules;
  }
  private checkEnvironment(environment: Environment) {
    requireValue(environment !== "producao" || this.production, "Produção bloqueada. Conclua homologação e habilite ALLOW_PRODUCTION no backend.", 403);
  }
  private invoice(context: Context, data: CompanyData, invoiceId: string, kind: Kind) {
    this.store.assertInvoiceAvailable(context.tenant, invoiceId);
    const invoice = data.finance.invoices.find((item) => item.id === invoiceId);
    requireValue(invoice && !invoice.canceled && invoice.kind === (kind === "nfe" ? "Produtos" : "Serviços"),
      "Faturamento inexistente, cancelado, legado ou diferente do modelo fiscal.");
    const entry = data.finance.entries.filter((item) => item.invoiceId === invoiceId);
    requireValue(entry.length === 1 && entry[0] && !entry[0].canceled && entry[0].kind === "Receber" &&
      entry[0].amount === invoice.amount && entry[0].clientId === invoice.clientId, "Conta a receber inconsistente com o faturamento.");
    const client = data.clients.find((item) => item.id === invoice.clientId);
    requireValue(client, "Cliente do faturamento não encontrado.");
    const profile = this.profile(context);
    requireValue(profile, "Cadastre o emitente fiscal no backend.");
    return { invoice, entry: entry[0], client, profile };
  }
  async createDraft(context: Context, data: CompanyData, input: unknown, refreshCompany: () => Promise<CompanyData> = async () => data) {
    const draft = draftSchema.parse(input);
    this.checkEnvironment(draft.environment);
    const { invoice, entry, client, profile } = this.invoice(context, data, draft.invoiceId, draft.kind);
    const source = draft.kind === "nfe" ? nfeCollectionSource(data, invoice.id, profile.cnpj) : undefined;
    requireValue(!entry.retention, "Faturamento com retenções conciliadas exige o gerador DPS; XML externo não suporta essa conciliação.");
    requireValue(["Boleto", "Pix"].includes(entry.paymentMethod), "Documento exige cobrança por Boleto ou Pix.");
    const rule = this.rules(context).find((item) => item.id === draft.ruleId);
    requireValue(rule?.reviewed && rule.kind === draft.kind, "Selecione uma regra do mesmo modelo revisada/aprovada para esta operação.");
    assertRuleMatches(draft.xml, rule);
    const key = inspectUnsigned(draft.xml, draft.kind, draft.environment, profile.cnpj, client.document, invoice.amount);
    const { text, parseXml, single } = await import("./xml.js");
    if (draft.kind === "nfe") {
      const payment = single(parseXml(draft.xml), "detPag");
      requireValue(text(payment, "tPag") === (entry.paymentMethod === "Boleto" ? "15" : "17"), "Forma de pagamento XML diferente da conta a receber.");
    }
    const identity = this.vault.identity(context.tenant);
    requireValue(identity.cnpj === profile.cnpj, "Certificado não corresponde ao emitente.");
    // O XSD NF-e exige Signature mesmo na preparacao; validar uma copia assinada nao transmite a nota.
    await this.validator.validate(signXml(draft.xml, draft.kind, identity), draft.kind);
    if (source) requireValue(sameNfeCollectionSource(source, nfeCollectionSource(await refreshCompany(), invoice.id, profile.cnpj)),
      "Origem comercial alterada durante preparação da NF-e. Sincronize e prepare novamente.", 409);
    const document = new FiscalNumbering(this.store).createDocument(context, { invoiceId: draft.invoiceId, kind: draft.kind, environment: draft.environment, key, xml: draft.xml },
      source ? [{ collection: "externalNfeSource", value: source }] : []);
    this.store.put(context.tenant, "documentRule", document.id, rule);
    this.store.audit(context.tenant, context.actor, "document.draft", document.id);
    return document;
  }
  async generateNfeDraft(context: Context, data: CompanyData, input: unknown, refreshCompany: () => Promise<CompanyData> = async () => data) {
    const request = generatedNfeSchema.parse(input);
    this.store.assertInvoiceAvailable(context.tenant, request.invoiceId);
    const numbering = new FiscalNumbering(this.store);
    const profile = this.profile(context);
    requireValue(profile, "Cadastre o emitente.");
    const counter = numbering.list(context, profile.cnpj).find((item) => item.environment === request.environment && item.series === request.series);
    requireValue(counter && counter.nextNumber === request.expectedNumber && counter.nextNumber <= 999999999,
      "Série ausente, esgotada ou número alterado. Atualize o backend antes de gerar.", 409);
    const calculations = new InvoiceCalculation(this.store);
    const calculationRequest = { invoiceId: request.invoiceId, date: request.issuedAt.slice(0, 10) };
    const calculation = calculations.prepare(context, data, this.rules(context), calculationRequest);
    const numericCode = String(randomInt(100000000)).padStart(8, "0");
    const generated = generateNfe(calculation, request, numericCode);
    inspectUnsigned(generated.xml, "nfe", request.environment, calculation.issuer.cnpj, calculation.recipient.document, calculation.invoice.amount);
    const identity = this.vault.identity(context.tenant);
    requireValue(identity.cnpj === calculation.issuer.cnpj, "Certificado não corresponde ao emitente.");
    await this.validator.validate(signXml(generated.xml, "nfe", identity), "nfe");
    const refreshed = await refreshCompany();
    requireValue(calculations.prepare(context, refreshed, this.rules(context), calculationRequest).id === calculation.id,
      "Dados fiscais alterados durante a geração. Recalcule antes de continuar.", 409);
    const source: GeneratedSource = { input: request, numericCode, calculationId: calculation.id };
    const document = numbering.createDocument(context, { invoiceId: request.invoiceId, kind: "nfe",
      environment: "homologacao", key: generated.key, xml: generated.xml },
    [{ collection: "generatedNfe", value: source }]);
    this.store.audit(context.tenant, context.actor, "document.generate-nfe", document.id);
    return document;
  }
  async generateDpsDraft(context: Context, data: CompanyData, input: unknown, refreshCompany: () => Promise<CompanyData> = async () => data) {
    const request = generatedDpsSchema.parse(input);
    this.store.assertInvoiceAvailable(context.tenant, request.invoiceId);
    const profile = this.profile(context);
    requireValue(profile, "Cadastre o emitente.");
    const numbering = new FiscalNumbering(this.store, "nfse");
    const counter = numbering.list(context, profile.cnpj).find((item) => item.environment === request.environment && item.series === request.series);
    requireValue(counter && counter.nextNumber === request.expectedNumber && counter.nextNumber <= 999999999999999,
      "Série DPS ausente, esgotada ou número alterado. Atualize o backend.", 409);
    const calculations = new InvoiceCalculation(this.store);
    const calculationRequest = { invoiceId: request.invoiceId, date: request.competence,
      ...(request.additionalServiceId ? { additionalServiceId: request.additionalServiceId } : {}) };
    const calculation = calculations.prepare(context, data, this.rules(context), calculationRequest);
    const retention = this.dpsRetention(context, data, calculation);
    requireValue(!retention || request.confirmRetentions === true, "Confirme a revisão da incidência, dispensas e limites das retenções antes de gerar.");
    const generated = generateDps(calculation, request);
    inspectUnsigned(generated.xml, "nfse", "homologacao", calculation.issuer.cnpj, calculation.recipient.document, calculation.invoice.amount, retention);
    const identity = this.vault.identity(context.tenant);
    requireValue(identity.cnpj === calculation.issuer.cnpj, "Certificado não corresponde ao emitente.");
    await this.validator.validate(signXml(generated.xml, "nfse", identity), "nfse");
    const refreshed = await refreshCompany();
    const current = calculations.prepare(context, refreshed, this.rules(context), calculationRequest);
    requireValue(current.id === calculation.id,
      "Dados fiscais alterados durante a geração DPS. Recalcule antes de continuar.", 409);
    this.dpsRetention(context, refreshed, current);
    const source: GeneratedDpsSource = { input: request, calculationId: calculation.id };
    const document = numbering.createDocument(context, { invoiceId: request.invoiceId, kind: "nfse",
      environment: "homologacao", key: generated.key, xml: generated.xml }, [{ collection: "generatedDps", value: source }]);
    this.store.audit(context.tenant, context.actor, "document.generate-dps", document.id);
    return document;
  }
  confirmRetentions(context: Context, data: CompanyData, input: unknown) {
    const request = z.object({ calculationId: z.string().regex(/^[a-f0-9]{64}$/), confirmation: z.literal(true) }).strict().parse(input);
    const calculations = new InvoiceCalculation(this.store);
    const saved = calculations.get(context, request.calculationId);
    const calculation = calculations.prepare(context, data, this.rules(context), { invoiceId: saved.invoiceId, date: saved.date,
      ...(saved.additionalServiceId ? { additionalServiceId: saved.additionalServiceId } : {}) });
    requireValue(calculation.id === saved.id, "Memória obsoleta. Recalcule os itens antes de confirmar as retenções.", 409);
    const values = serviceRetentions(calculation);
    requireValue(values.withheld > 0, "Não há retenções suportadas para conciliar.");
    this.assertRetentionChangeAllowed(context, calculation);
    const record = this.store.get<Retention>(context.tenant, "retentionReviews", calculation.id) ??
      retentionSchema.parse({ ...values, confirmedAt: new Date().toISOString(), confirmedBy: context.actor });
    this.store.put(context.tenant, "retentionReviews", calculation.id, record);
    this.store.audit(context.tenant, context.actor, "retention.confirm", calculation.id);
    return { invoiceId: calculation.invoiceId, entryId: calculation.payment.id, retention: record };
  }
  clearRetentions(context: Context, data: CompanyData, input: unknown) {
    const request = z.object({ entryId: z.string().min(1), calculationId: z.string().regex(/^[a-f0-9]{64}$/),
      confirmation: z.literal(true) }).strict().parse(input);
    const entry = data.finance.entries.find((item) => item.id === request.entryId && !item.canceled);
    requireValue(entry?.retention && entry.retention.calculationId === request.calculationId,
      "Conciliação alterada ou indisponível. Atualize antes de remover.", 409);
    const invoice = data.finance.invoices.find((item) => item.id === entry.invoiceId && !item.canceled && item.kind === "Serviços");
    requireValue(invoice && entry.kind === "Receber", "Retenção exige faturamento de serviços ativo.", 409);
    const record = this.store.get<Retention>(context.tenant, "retentionReviews", request.calculationId);
    requireValue(record && JSON.stringify(record) === JSON.stringify(retentionSchema.parse(entry.retention)),
      "Conciliação não corresponde à confirmação salva nesta empresa.", 409);
    this.assertRetentionChangeAllowed(context, { invoiceId: invoice.id, payment: entry });
    this.store.audit(context.tenant, context.actor, "retention.clear", request.calculationId);
    return { entryId: entry.id, calculationId: request.calculationId };
  }
  private assertRetentionChangeAllowed(context: Context, calculation: {
    invoiceId: string; payment: Pick<CompanyData["finance"]["entries"][number], "id" | "settlements">;
  }) {
    this.store.assertInvoiceAvailable(context.tenant, calculation.invoiceId, { retentionUpdate: true });
    requireValue(!calculation.payment.settlements.some((item) => !item.reversed),
      "Estorne as baixas antes de conciliar retenções; retenção não é recebimento.", 409);
    const remittances = this.store.list<{ entryIds: string[] }>(context.tenant, "remittances");
    requireValue(!remittances.some((item) => item.entryIds.includes(calculation.payment.id)),
      "Cobrança já consta de remessa. Resolva a cobrança bancária antes de alterar retenções.", 409);
    requireValue(!this.store.documents(context.tenant).some((document) => document.invoiceId === calculation.invoiceId &&
      !["cancelado", "rejeitado"].includes(document.status)),
    "Já existe documento fiscal ativo. Não altere as retenções; resolva o documento antes de conciliar novamente.", 409);
  }
  private dpsRetention(context: Context, company: CompanyData, calculation: InvoiceCalculationRecord) {
    const values = serviceRetentions(calculation);
    const entry = company.finance.entries.find((entry) => entry.id === calculation.payment.id)!;
    if (values.withheld === 0) {
      requireValue(!entry.retention, "Conta possui retenção anterior incompatível com a matriz atual. Reconcilie antes de gerar.", 409);
      return undefined;
    }
    requireValue(entry.retention, "Confirme e sincronize a conciliação das retenções no financeiro antes de gerar.", 409);
    const actual = assertRetention(calculation, entry.retention);
    const review = this.store.get<Retention>(context.tenant, "retentionReviews", calculation.id);
    requireValue(review && JSON.stringify(review) === JSON.stringify(actual),
      "Confirmação das retenções ausente ou divergente no backend. Confira e sincronize o financeiro.", 409);
    return actual;
  }
  async transmit(context: Context, data: CompanyData, id: string, confirmation: string, refreshCompany: () => Promise<CompanyData> = async () => data) {
    const document = this.store.document(context.tenant, id);
    this.checkEnvironment(document.environment);
    requireValue(confirmation === document.key, "Confirme a chave/Id exato para transmitir.");
    const { invoice, entry, client, profile } = this.invoice(context, data, document.invoiceId, document.kind);
    const identity = this.vault.identity(context.tenant);
    requireValue(identity.cnpj === profile.cnpj, "Certificado não corresponde ao emitente.");
    const generatedDps = this.store.get<GeneratedDpsSource>(context.tenant, "generatedDps", id);
    requireValue(!entry.retention || generatedDps, "Conciliação de retenções não é suportada neste documento externo.");
    inspectUnsigned(document.xml, document.kind, document.environment, identity.cnpj, client.document, invoice.amount, generatedDps ? entry.retention : undefined);
    const { parseXml, single, text } = await import("./xml.js");
    requireValue(["Boleto", "Pix"].includes(entry.paymentMethod), "Documento exige cobrança por Boleto ou Pix.");
    if (document.kind === "nfe") requireValue(text(single(parseXml(document.xml), "detPag"), "tPag") === (entry.paymentMethod === "Boleto" ? "15" : "17"), "Pagamento alterado após preparar o XML. Refaça o documento antes de transmitir.");
    const generatedSource = this.store.get<GeneratedSource>(context.tenant, "generatedNfe", id);
    const externalSource = this.store.get<NfeCollectionSource>(context.tenant, "externalNfeSource", id);
    const checkGenerated = (company: CompanyData) => {
      if (externalSource) requireValue(sameNfeCollectionSource(externalSource, nfeCollectionSource(company, document.invoiceId, profile.cnpj)),
        "Origem comercial alterada após preparar a NF-e externa. Não transmitir este rascunho.", 409);
      if (generatedDps) {
        const input = generatedDpsSchema.parse(generatedDps.input);
        requireValue(document.environment === "homologacao", "Gerador DPS não liberado para produção.", 403);
        const calculation = new InvoiceCalculation(this.store).prepare(context, company, this.rules(context),
          { invoiceId: document.invoiceId, date: input.competence,
            ...(input.additionalServiceId ? { additionalServiceId: input.additionalServiceId } : {}) });
        this.dpsRetention(context, company, calculation);
        requireValue(calculation.id === generatedDps.calculationId && generateDps(calculation, input).xml === document.xml,
          "Itens, cobrança ou dados fiscais alterados após gerar a DPS. Não transmitir este rascunho.", 409);
      }
      if (!generatedSource) return;
      const input = generatedNfeSchema.parse(generatedSource.input);
      requireValue(document.environment === "homologacao", "Gerador automático ainda não liberado para produção.", 403);
      const calculation = new InvoiceCalculation(this.store).prepare(context, company, this.rules(context),
        { invoiceId: document.invoiceId, date: input.issuedAt.slice(0, 10) });
      requireValue(calculation.id === generatedSource.calculationId &&
        generateNfe(calculation, input, generatedSource.numericCode).xml === document.xml,
      "Itens, pagamento ou dados fiscais alterados após gerar a NF-e. Não transmitir este rascunho.", 409);
    };
    checkGenerated(data);
    const signedXml = signXml(document.xml, document.kind, identity);
    await this.validator.validate(signedXml, document.kind);
    if (generatedSource || generatedDps || externalSource) checkGenerated(await refreshCompany());
    const claimed = this.store.claim(context.tenant, id);
    this.store.saveDocument(context.tenant, { ...claimed, signedXml });
    this.store.audit(context.tenant, context.actor, "document.transmit", id);
    try {
      const result = await this.authority.transmit({ ...claimed, signedXml }, identity);
      return this.store.saveDocument(context.tenant, { ...claimed, signedXml, ...result });
    } catch (cause) {
      this.store.saveDocument(context.tenant, { ...claimed, signedXml, status: "incerto", message: "Falha após iniciar transmissão. Consulte a situação; não reenvie." });
      throw cause;
    }
  }
  async consult(context: Context, id: string) {
    const lock = `${context.tenant}:${id}`;
    requireValue(!this.busy.has(lock), "Consulta já em andamento.", 409);
    const document = this.store.document(context.tenant, id);
    const event = pendingCancellation(this.store, context.tenant, id);
    const nfseEvent = pendingNfseCancellation(this.store, context.tenant, id);
    requireValue(event?.status !== "enviando", "Cancelamento ainda em envio. Aguarde o retorno antes de consultar.", 409);
    requireValue(nfseEvent?.status !== "enviando", "Cancelamento NFS-e ainda em envio. Aguarde o retorno antes de consultar.", 409);
    requireValue(!["rascunho", "enviando", "cancelado"].includes(document.status), "Documento não está disponível para consulta.", 409);
    this.busy.add(lock);
    try {
      if (nfseEvent) {
        const consult = this.authority.consultNfseCancellation?.bind(this.authority);
        requireValue(consult, "Consulta de evento NFS-e indisponível no conector.", 503);
        let result = await consult(document, nfseEvent.xml, this.vault.identity(context.tenant));
        if (result.status === "registrado") {
          try {
            requireValue(result.artifact, "Consulta não trouxe o XML do evento registrado.", 502);
            await this.validator.validate(result.artifact, "nfse", true);
          } catch (cause) {
            result = { ...result, status: "incerto", message:
              `Consulta não confirmou evento após validação XSD: ${cause instanceof Error ? cause.message.slice(0, 400) : "XML inválido"}` };
          }
        }
        requireValue(JSON.stringify(this.store.document(context.tenant, id)) === JSON.stringify(document),
          "Documento alterado durante consulta do evento NFS-e. Atualize o histórico.", 409);
        this.store.db.exec("BEGIN IMMEDIATE");
        try {
          const confirmed = result.status === "registrado";
          const savedEvent = { ...nfseEvent, status: confirmed ? "cancelamento_confirmado" as const : "incerto" as const,
            consultation: result.response, message: confirmed ? result.message :
              result.message ?? "Consulta não confirmou o evento. A situação permanece incerta; não reenviar." };
          this.store.put(context.tenant, "fiscalEvents", nfseEvent.id, savedEvent);
          this.store.put(context.tenant, "fiscalEventConsultations", randomUUID(), { eventId: nfseEvent.id, documentId: id,
            checkedAt: new Date().toISOString(), checkedBy: context.actor, response: result.response, status: result.status });
          const saved = this.store.saveDocument(context.tenant, { ...document,
            status: confirmed ? "cancelado" : "incerto", message: savedEvent.message });
          this.store.audit(context.tenant, context.actor, `nfse.event.cancel.consult.${confirmed ? "confirmed" : "uncertain"}`, nfseEvent.id);
          this.store.db.exec("COMMIT");
          return saved;
        } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
      }
      const result = await this.authority.consult(document, this.vault.identity(context.tenant));
      this.store.audit(context.tenant, context.actor, "document.consult", id);
      if (event) {
        requireValue(JSON.stringify(this.store.document(context.tenant, id)) === JSON.stringify(document),
          "Documento alterado durante consulta. Atualize o histórico.", 409);
        this.store.db.exec("BEGIN IMMEDIATE");
        try {
          this.store.put(context.tenant, "fiscalEventConsultations", randomUUID(), { eventId: event.id, documentId: id,
            checkedAt: new Date().toISOString(), checkedBy: context.actor, response: result.response, status: result.status });
          this.store.put(context.tenant, "fiscalEvents", event.id, { ...event,
            status: result.status === "cancelado" ? "cancelamento_confirmado" : "incerto",
            consultation: result.response, message: result.status === "cancelado" ? "Cancelamento confirmado pela consulta da chave; retorno do evento original preservado." :
              "Cancelamento permanece incerto. Consulta sem cancelamento não autoriza reenviar o evento." });
          const saved = this.store.saveDocument(context.tenant, { ...document, status: result.status === "cancelado" ? "cancelado" : "incerto",
            message: result.status === "cancelado" ? result.message : "Evento de cancelamento pendente. Não reenviar; consulte novamente ou solicite suporte." });
          this.store.db.exec("COMMIT");
          return saved;
        } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
      }
      return this.store.saveDocument(context.tenant, { ...document, ...result });
    } finally { this.busy.delete(lock); }
  }
  async cancelNfe(context: Context, id: string, input: unknown, company: () => Promise<CompanyData>) {
    const document = this.store.document(context.tenant, id);
    this.checkEnvironment(document.environment);
    const lock = `${context.tenant}:${id}`;
    requireValue(!this.busy.has(lock), "Operação fiscal em andamento para este documento.", 409);
    const send = this.authority.cancelNfe?.bind(this.authority);
    requireValue(send, "Conector de cancelamento NF-e indisponível.", 503);
    this.busy.add(lock);
    try {
      return await cancelNfe({ store: this.store, context, id, input, company, validator: this.validator,
        identity: this.vault.identity(context.tenant), send });
    } finally { this.busy.delete(lock); }
  }
  async cancelNfse(context: Context, id: string, input: unknown, company: () => Promise<CompanyData>) {
    const document = this.store.document(context.tenant, id);
    this.checkEnvironment(document.environment);
    const lock = `${context.tenant}:${id}`;
    requireValue(!this.busy.has(lock), "Operação fiscal em andamento para este documento.", 409);
    const send = this.authority.cancelNfse?.bind(this.authority);
    requireValue(send, "Conector de cancelamento NFS-e indisponível.", 503);
    this.busy.add(lock);
    try {
      return await cancelNfse({ store: this.store, context, id, input, company, validator: this.validator,
        identity: this.vault.identity(context.tenant), send });
    } finally { this.busy.delete(lock); }
  }
  discardDraft(context: Context, id: string) {
    const document = this.store.document(context.tenant, id);
    requireValue(document.status === "rascunho", "Somente rascunhos nunca transmitidos podem ser descartados.", 409);
    const result = this.store.saveDocument(context.tenant, { ...document, status: "cancelado", message: "Rascunho descartado internamente. Nunca transmitido ao fisco; numeração não reutilizável." });
    this.store.audit(context.tenant, context.actor, "document.discardDraft", id);
    return result;
  }
}
