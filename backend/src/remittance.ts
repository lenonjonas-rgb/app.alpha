import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context, CompanyData } from "./auth.js";
import type { Store } from "./store.js";
import { requireValue } from "./errors.js";
import { requireNfseCollection } from "./nfseReconciliation.js";
import { requireNfeCollection } from "./nfeCollection.js";

const accountConfigInputSchema = z.object({
  accountId: z.string().trim().min(1).max(200),
  agencia: z.string().regex(/^\d{4}$/),
  conta: z.string().regex(/^\d{5}$/),
  dac: z.string().regex(/^\d$/),
  carteira: z.string().regex(/^\d{3}$/),
  codigoCarteira: z.literal("I"),
  primeiroNossoNumero: z.string().regex(/^\d{8}$/),
  sequenciaInicialArquivo: z.number().int().min(1).max(999_999),
}).strict();

const addressSchema = z.object({
  logradouro: z.string().trim().min(1).max(40),
  bairro: z.string().trim().min(1).max(12),
  cep: z.string().regex(/^\d{8}$/),
  cidade: z.string().trim().min(1).max(15),
  uf: z.string().regex(/^[A-Za-z]{2}$/),
}).strict();

const createInputSchema = z.object({
  accountId: z.string().trim().min(1).max(200),
  entryIds: z.array(z.string().min(1).max(200)).min(1),
  addresses: z.record(z.string(), addressSchema),
}).strict().superRefine((input, context) => {
  if (new Set(input.entryIds).size !== input.entryIds.length) {
    context.addIssue({ code: "custom", path: ["entryIds"], message: "IDs de cobrança duplicados." });
  }
});

export const CNAB400_NOTICE =
  "Arquivo manual de cobrança simples (registros 0/1/9), sem transmissão bancária ou baixa automática. Confirme o contrato da carteira e homologue o layout CNAB400 com o Itaú antes de usar.";

type AccountConfig = z.infer<typeof accountConfigInputSchema> & {
  nextNossoNumero: number;
  nextFileSequence: number;
};
type PublicConfig = Omit<AccountConfig, "primeiroNossoNumero" | "sequenciaInicialArquivo"> & {
  cnpj: string;
  nome: string;
};
type RemittanceCreateInput = z.infer<typeof createInputSchema>;
type Remittance = {
  id: string;
  accountId: string;
  fileSequence: number;
  entryIds: string[];
  entries: Array<{ entryId: string; invoiceId?: string; nossoNumero: string; documento: string; species: "01" | "08";
    nfseCheckId?: string; nfseDocumentId?: string; amount?: number;
    fiscalDocumentId?: string; fiscalKind?: "nfe" | "nfse"; fiscalAccessKey?: string; fiscalProtocol?: string; fiscalCheckId?: string }>;
  file: string;
  notice: string;
  createdAt: string;
};

function transaction<T>(store: Store, action: () => T): T {
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    store.db.exec("COMMIT");
    return result;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}

function normalized(value: string, width: number, label: string): string {
  const result = value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  requireValue(result.length > 0 && result.length <= width, `${label} deve conter de 1 a ${width} caracteres ASCII.`);
  requireValue(/^[\x20-\x7E]+$/.test(result), `${label} contém caracteres não suportados pelo CNAB400.`);
  return result.padEnd(width, " ");
}

function digits(value: string, label: string, expectedLength: 11 | 14): string {
  requireValue(/^[\d./\-\s]+$/.test(value), `${label} deve conter somente dígitos e pontuação usual.`);
  const result = value.replace(/\D/g, "");
  requireValue(result.length === expectedLength, `${label} deve conter ${expectedLength} dígitos.`);
  requireValue(validCpfCnpj(result), `${label} inválido.`);
  return result;
}

function dateParts(value: string, label: string): { iso: string; cnab: string } {
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(value), `${label} deve estar no formato AAAA-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  requireValue(!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value, `${label} não é uma data válida.`);
  return { iso: value, cnab: `${value.slice(8, 10)}${value.slice(5, 7)}${value.slice(2, 4)}` };
}

function amountField(amount: number): string {
  requireValue(Number.isSafeInteger(amount) && amount > 0 && amount <= 9_999_999_999_999,
    "Valor da cobrança deve ser positivo e caber no campo CNAB400 de 13 dígitos (centavos).");
  return String(amount).padStart(13, "0");
}

function sequenceField(value: number): string {
  requireValue(Number.isSafeInteger(value) && value >= 1 && value <= 999_999, "Sequência de registros CNAB400 excede seis dígitos.");
  return String(value).padStart(6, "0");
}

function makeHeader(config: AccountConfig, issuer: { cnpj: string; name: string }, date: Date): string {
  const name = normalized(issuer.name, 30, "Nome do cedente");
  const dateDDMMAA = `${String(date.getUTCDate()).padStart(2, "0")}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCFullYear() % 100).padStart(2, "0")}`;
  return [
    "0", "1", "REMESSA", "01", "COBRANCA".padEnd(15, " "), config.agencia, "00", config.conta, config.dac, " ".repeat(8),
    name, "341", "BANCO ITAU SA".padEnd(15, " "), dateDDMMAA, " ".repeat(294), "000001",
  ].join("");
}

function makeDetail(
  config: AccountConfig,
  issuerDocument: string,
  item: {
    nossoNumero: string; documento: string; due: string; amount: number; species: "01" | "08";
    issued: string; payerDocument: string; payerName: string;
  },
  address: z.infer<typeof addressSchema>,
  sequence: number,
): string {
  return [
    "1", issuerDocument.length === 11 ? "01" : "02", issuerDocument.padStart(14, "0"), config.agencia, "00", config.conta,
    config.dac, " ".repeat(4), "0000", " ".repeat(25), item.nossoNumero, "0".repeat(13), config.carteira, " ".repeat(21),
    config.codigoCarteira, "01", item.documento, item.due, amountField(item.amount), "341", "00000", item.species, "N",
    item.issued, "0000", "0".repeat(13), "000000", "0".repeat(39),
    item.payerDocument.length === 11 ? "01" : "02", item.payerDocument.padStart(14, "0"),
    normalized(item.payerName, 30, "Nome do sacado"), " ".repeat(10), normalized(address.logradouro, 40, "Logradouro"),
    normalized(address.bairro, 12, "Bairro"), address.cep, normalized(address.cidade, 15, "Cidade"),
    normalized(address.uf, 2, "UF"), " ".repeat(30), " ".repeat(4), "000000", "00", " ", sequenceField(sequence),
  ].join("");
}

function buildFile(header: string, details: string[]): string {
  const trailer = `9${" ".repeat(393)}${sequenceField(details.length + 2)}`;
  const records = [header, ...details, trailer];
  for (const [index, record] of records.entries()) {
    requireValue(Buffer.byteLength(record, "ascii") === 400 && /^[\x20-\x7E]{400}$/.test(record),
      `Registro CNAB400 ${index + 1} inválido: ${Buffer.byteLength(record, "ascii")} bytes ASCII, ${record.length} caracteres.`);
  }
  return `${records.join("\r\n")}\r\n`;
}

export class RemittanceService {
  constructor(readonly store: Store) {}

  private issuer(context: Context): { cnpj: string; name: string } {
    const profile = this.store.get<{ cnpj?: string; name?: string }>(context.tenant, "settings", "issuer");
    requireValue(profile?.cnpj && profile.name, "Cadastre o CNPJ e o nome do cedente nos dados fiscais da empresa.");
    return { cnpj: digits(profile.cnpj, "CNPJ do cedente", 14), name: profile.name };
  }

  config(context: Context, accountId: string): PublicConfig | null {
    const saved = this.store.get<AccountConfig>(context.tenant, "remittance-config", accountId);
    if (!saved) return null;
    const issuer = this.issuer(context);
    return this.publicConfig(saved, issuer);
  }

  private publicConfig(config: AccountConfig, issuer: { cnpj: string; name: string }): PublicConfig {
    const { primeiroNossoNumero: _firstNumber, sequenciaInicialArquivo: _initialSequence, ...publicConfig } = config;
    return { ...publicConfig, cnpj: issuer.cnpj, nome: issuer.name };
  }

  saveConfig(context: Context, input: unknown): PublicConfig {
    const parsed = accountConfigInputSchema.parse(input);
    const issuer = this.issuer(context);
    normalized(issuer.name, 30, "Nome do cedente");
    const first = Number(parsed.primeiroNossoNumero);
    const initialSequence = parsed.sequenciaInicialArquivo;
    requireValue(first >= 1 && first <= 99_999_999 && initialSequence <= 999_999, "Contadores CNAB400 excedem os limites do layout.");
    const config: AccountConfig = {
      ...parsed,
      nextNossoNumero: first,
      nextFileSequence: initialSequence,
    };
    transaction(this.store, () => {
      const existing = this.store.get<AccountConfig>(context.tenant, "remittance-config", parsed.accountId);
      if (existing) {
        requireValue(first >= existing.nextNossoNumero && initialSequence >= existing.nextFileSequence,
          "A configuração não pode regredir nem liberar Nosso Número ou sequência já consumidos.", 409);
      }
      this.store.put(context.tenant, "remittance-config", config.accountId, config);
      this.store.audit(context.tenant, context.actor, "remittance.config.save", config.accountId);
    });
    return this.publicConfig(config, issuer);
  }

  list(context: Context): Remittance[] {
    return this.store.list<Remittance>(context.tenant, "remittances");
  }

  get(context: Context, id: string): Remittance {
    const remittance = this.store.get<Remittance>(context.tenant, "remittances", id);
    requireValue(remittance, "Remessa não encontrada.", 404);
    return remittance;
  }

  download(context: Context, id: string): Remittance {
    return this.get(context, id);
  }

  create(context: Context, company: CompanyData, input: unknown): Remittance {
    const request = createInputSchema.parse(input);
    const issuer = this.issuer(context);
    requireValue(new Set(company.finance.entries.map((entry) => entry.id)).size === company.finance.entries.length,
      "Dados da empresa contêm IDs de lançamentos duplicados.");
    requireValue(new Set(company.clients.map((client) => client.id)).size === company.clients.length,
      "Dados da empresa contêm IDs de clientes duplicados.");
    requireValue(new Set(company.finance.invoices.map((invoice) => invoice.id)).size === company.finance.invoices.length,
      "Dados da empresa contêm IDs de faturamentos duplicados.");
    return transaction(this.store, () => {
      const config = this.store.get<AccountConfig>(context.tenant, "remittance-config", request.accountId);
      requireValue(config, "Cadastre a configuração CNAB400 desta conta.");
      const previous = this.store.list<Remittance>(context.tenant, "remittances");
      const invoices = new Map(company.finance.invoices.map((invoice) => [invoice.id, invoice]));
      const clients = new Map(company.clients.map((client) => [client.id, client]));
      const entriesById = new Map(company.finance.entries.map((entry) => [entry.id, entry]));
      const entries = request.entryIds.map((entryId) => {
        const entry = entriesById.get(entryId);
        requireValue(entry, `Cobrança ${entryId} não encontrada.`, 404);
        requireValue(entry.accountId === request.accountId, `Cobrança ${entryId} pertence a outra conta.`);
        requireValue(entry.kind === "Receber" && entry.paymentMethod === "Boleto" && !entry.canceled,
          `Cobrança ${entryId} não é um boleto ativo a receber.`);
        return entry;
      });
      const priorEntryIds = new Set(previous.flatMap((remittance) => remittance.entryIds));
      const priorInvoices = new Set(previous.flatMap((remittance) => remittance.entries.flatMap((item) => item.invoiceId ? [item.invoiceId] : [])));
      const priorDocuments = new Set(previous.flatMap((remittance) => remittance.entries.flatMap((item) =>
        item.fiscalDocumentId || item.nfseDocumentId ? [item.fiscalDocumentId ?? item.nfseDocumentId!] : [])));
      const detailItems: Remittance["entries"] = [];
      const records: string[] = [];
      const usedDocuments = new Set(previous.flatMap((remittance) => remittance.entries.map((item) => item.documento)));
      for (const entry of entries) {
        requireValue(!entry.settlements.some((settlement) => !settlement.reversed),
          `A cobrança ${entry.id} possui baixa ativa e não pode ser remetida.`);
        requireValue(!priorEntryIds.has(entry.id), `A cobrança ${entry.id} já consta de outra remessa.`, 409);
        requireValue(entry.invoiceId, `A cobrança ${entry.id} não está vinculada a um faturamento.`);
        requireValue(!priorInvoices.has(entry.invoiceId), "Faturamento já consta de outra remessa; não substituir a conta para duplicar cobrança.", 409);
        this.store.assertInvoiceAvailable(context.tenant, entry.invoiceId);
        requireValue(!this.store.get(context.tenant, "financeCancellations", entry.id), "Conta com cancelamento interno reservado.", 409);
        const invoice = invoices.get(entry.invoiceId);
        requireValue(invoice && !invoice.canceled && (invoice.kind === "Produtos" || invoice.kind === "Serviços"),
          `A cobrança ${entry.id} não possui faturamento ativo de Produtos ou Serviços.`);
        requireValue((!entry.clientId || invoice.clientId === entry.clientId) && invoice.amount === entry.amount,
          `A cobrança ${entry.id} diverge do faturamento vinculado.`);
        requireValue(company.finance.entries.filter((item) => item.invoiceId === invoice.id).length === 1,
          "Faturamento exige uma única conta a receber; não remeter vínculos duplicados.", 409);
        const client = clients.get(entry.clientId ?? invoice.clientId);
        requireValue(client, `Cliente da cobrança ${entry.id} não encontrado.`);
        const address = request.addresses[client.id];
        requireValue(address, `Informe o endereço estruturado do sacado ${client.id}.`);
        const issued = dateParts(entry.issuedOn, `Emissão da cobrança ${entry.id}`);
        const due = dateParts(entry.dueOn, `Vencimento da cobrança ${entry.id}`);
        requireValue(due.iso >= issued.iso, `Vencimento anterior à emissão na cobrança ${entry.id}.`);
        const payerDocument = digits(client.document, `Documento do sacado ${client.id}`, client.document.replace(/\D/g, "").length === 11 ? 11 : 14);
        const nfse = invoice.kind === "Serviços" ? requireNfseCollection(this.store, context, company, invoice.id) : undefined;
        const nfe = invoice.kind === "Produtos" ? requireNfeCollection(this.store, context, company, invoice.id) : undefined;
        const collection = nfse ?? nfe;
        requireValue(collection, "Nota autorizada não conferida para a cobrança.", 409);
        requireValue(!priorDocuments.has(collection.documentId), "Nota fiscal já vinculada a outra remessa.", 409);
        const collectionAmount = nfse ? nfse.actual.net : nfe!.amount;
        const ourNumberValue = config.nextNossoNumero + detailItems.length;
        requireValue(ourNumberValue <= 99_999_999, "Nosso Número excede oito dígitos.", 409);
        const nossoNumero = String(ourNumberValue).padStart(8, "0");
        requireValue(!previous.some((remittance) => remittance.entries.some((item) => item.nossoNumero === nossoNumero)),
          `Nosso Número ${nossoNumero} já foi utilizado.`, 409);
        let documento = "";
        for (let attempt = 0; attempt < 10; attempt++) {
          documento = `R${randomBytes(5).toString("hex").slice(0, 9).toUpperCase()}`;
          if (!usedDocuments.has(documento)) break;
          documento = "";
        }
        requireValue(documento, "Não foi possível gerar um número de documento único.", 409);
        usedDocuments.add(documento);
        const species = invoice.kind === "Produtos" ? "01" as const : "08" as const;
        const metadata: Remittance["entries"][number] = { entryId: entry.id, invoiceId: invoice.id, nossoNumero, documento, species,
          fiscalDocumentId: collection.documentId, fiscalKind: invoice.kind === "Produtos" ? "nfe" : "nfse",
          fiscalAccessKey: collection.accessKey, fiscalCheckId: collection.id, amount: collectionAmount,
          ...(nfe ? { fiscalProtocol: nfe.protocol } : {}),
          ...(nfse ? { nfseCheckId: nfse.id, nfseDocumentId: nfse.documentId } : {}) };
        detailItems.push(metadata);
        records.push(makeDetail(config, issuer.cnpj, {
          nossoNumero, documento, due: due.cnab, amount: collectionAmount, species, issued: issued.cnab,
          payerDocument, payerName: client.name,
        }, address, detailItems.length + 1));
      }
      const fileSequence = config.nextFileSequence;
      requireValue(fileSequence <= 999_999, "Sequência de remessa esgotada. Atualize-a sem regredir.", 409);
      requireValue(!previous.some((remittance) => remittance.accountId === request.accountId && remittance.fileSequence === fileSequence),
        `Sequência de arquivo ${fileSequence} já utilizada.`, 409);
      const file = buildFile(makeHeader(config, issuer, new Date()), records);
      const remittance: Remittance = {
        id: randomUUID(), accountId: request.accountId, fileSequence,
        entryIds: detailItems.map((item) => item.entryId), entries: detailItems, file,
        notice: CNAB400_NOTICE, createdAt: new Date().toISOString(),
      };
      const updated: AccountConfig = {
        ...config,
        nextNossoNumero: config.nextNossoNumero + detailItems.length,
        nextFileSequence: config.nextFileSequence + 1,
      };
      requireValue(updated.nextFileSequence <= 1_000_000, "Sequência de remessa esgotada. Atualize-a sem regredir.");
      this.store.put(context.tenant, "remittance-config", request.accountId, updated);
      this.store.put(context.tenant, "remittances", remittance.id, remittance);
      this.store.audit(context.tenant, context.actor, "remittance.create", remittance.id);
      return remittance;
    });
  }
}

export type { AccountConfig, PublicConfig, Remittance, RemittanceCreateInput };
import { validCpfCnpj } from "./identification.js";
