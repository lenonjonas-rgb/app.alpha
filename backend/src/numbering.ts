import { z } from "zod";
import type { Context } from "./auth.js";
import type { Environment, Store } from "./store.js";
import { requireValue } from "./errors.js";

export const numberingConfigSchema = z.object({
  environment: z.enum(["homologacao", "producao"]),
  series: z.number().int().min(0).max(889),
  nextNumber: z.number().int().min(1).max(999999999),
  expectedNextNumber: z.number().int().min(1).max(1000000000).nullable(),
  confirmation: z.literal(true),
}).strict();
export const dpsNumberingConfigSchema = numberingConfigSchema.extend({
  series: z.number().int().min(1).max(49999),
  nextNumber: z.number().int().min(1).max(999999999999999),
  expectedNextNumber: z.number().int().min(1).max(1000000000000000).nullable(),
});
export type NumberingConfig = {
  cnpj: string; environment: Environment; series: number; nextNumber: number; updatedAt: string; updatedBy: string;
};
export type NumberReservation = {
  cnpj: string; environment: Environment; series: number; number: number; invoiceId: string;
  createdAt: string; createdBy: string; documentId?: string;
};
const scopeKey = (cnpj: string, environment: Environment, series: number) => `${cnpj}:${environment}:${series}`;
const accessKey = (id: string) => {
  requireValue(/^NFe\d{44}$/.test(id), "Identificador NF-e inválido para controle de numeração.");
  return id.slice(3);
};

export class FiscalNumbering {
  constructor(private store: Store, private model: "nfe" | "nfse" = "nfe") {}
  private get collection() { return this.model === "nfe" ? "nfeNumbering" : "dpsNumbering"; }
  private get numbers() { return this.model === "nfe" ? "nfeNumbers" : "dpsNumbers"; }
  private get maximum() { return this.model === "nfe" ? 999999999 : 999999999999999; }
  private coordinates(id: string) {
    if (this.model === "nfe") {
      const key = accessKey(id);
      return { cnpj: key.slice(6, 20), series: Number(key.slice(22, 25)), number: Number(key.slice(25, 34)) };
    }
    requireValue(/^DPS42054072\d{34}$/.test(id), "Identificador DPS inválido para numeração de Florianópolis/CNPJ.");
    return { cnpj: id.slice(11, 25), series: Number(id.slice(25, 30)), number: Number(id.slice(30)) };
  }
  private transaction<T>(operation: () => T): T {
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.store.db.exec("COMMIT");
      return result;
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
  }
  list(context: Context, cnpj: string) {
    return this.store.list<NumberingConfig>(context.tenant, this.collection).filter((item) => item.cnpj === cnpj);
  }
  reservations(context: Context, cnpj: string) {
    return this.store.list<NumberReservation>(context.tenant, this.numbers).filter((item) => item.cnpj === cnpj);
  }
  configure(context: Context, cnpj: string, input: unknown) {
    requireValue(context.role === "owner", "Somente Master pode configurar a numeração fiscal.", 403);
    requireValue(/^\d{14}$/.test(cnpj), "Cadastre o emitente antes da numeração.");
    const request = (this.model === "nfe" ? numberingConfigSchema : dpsNumberingConfigSchema).parse(input);
    return this.transaction(() => {
      const key = scopeKey(cnpj, request.environment, request.series);
      const current = this.store.get<NumberingConfig>(context.tenant, this.collection, key);
      requireValue((current?.nextNumber ?? null) === request.expectedNextNumber,
        "Numeração alterada ou configuração já existente. Atualize o backend antes de salvar.", 409);
      requireValue(!current || request.nextNumber >= current.nextNumber, "Não é permitido reduzir a numeração.", 409);
      const historical = this.store.documents(context.tenant).filter((document) => document.kind === this.model &&
        document.environment === request.environment && this.coordinates(document.key).cnpj === cnpj &&
        this.coordinates(document.key).series === request.series);
      requireValue(historical.every((document) => this.coordinates(document.key).number < request.nextNumber),
        "Próximo número deve superar todos os documentos já preparados, inclusive descartados/rejeitados.", 409);
      const reservations = this.reservations(context, cnpj).filter((item) => item.environment === request.environment && item.series === request.series);
      requireValue(reservations.every((item) => item.number < request.nextNumber), "Próximo número já reservado.", 409);
      const saved: NumberingConfig = { cnpj, environment: request.environment, series: request.series,
        nextNumber: request.nextNumber, updatedAt: new Date().toISOString(), updatedBy: context.actor };
      this.store.put(context.tenant, this.collection, key, saved);
      this.store.audit(context.tenant, context.actor, this.model === "nfe" ? "numbering.configure" : "dpsNumbering.configure", key);
      return saved;
    });
  }
  // Chamado dentro da transacao que persiste o documento, nunca antes do XSD/assinatura.
  private attach(context: Context, input: { cnpj: string; environment: Environment; series: number; number: number; invoiceId: string; documentId: string }) {
    const key = scopeKey(input.cnpj, input.environment, input.series);
    const config = this.store.get<NumberingConfig>(context.tenant, this.collection, key);
    requireValue(config, `Configure esta série/ambiente de ${this.model === "nfe" ? "NF-e" : "DPS"} antes de preparar o documento.`);
    const numberKey = `${key}:${input.number}`;
    requireValue(!this.store.get(context.tenant, this.numbers, numberKey), "Número fiscal já reservado; não reutilize.", 409);
    requireValue(input.number === config.nextNumber && input.number <= this.maximum,
      "Número do XML diferente do próximo disponível. Atualize a tela e coordene a série antes de preparar.", 409);
    const reservation: NumberReservation = { ...input, createdAt: new Date().toISOString(), createdBy: context.actor };
    this.store.put(context.tenant, this.numbers, numberKey, reservation);
    this.store.put(context.tenant, this.collection, key, { ...config, nextNumber: input.number + 1,
      updatedAt: new Date().toISOString(), updatedBy: context.actor });
    this.store.audit(context.tenant, context.actor, this.model === "nfe" ? "numbering.attach" : "dpsNumbering.attach", numberKey);
    return reservation;
  }
  createDocument(context: Context, input: Parameters<Store["createDocument"]>[1],
    records: Array<{ collection: string; value: unknown }> = []) {
    return this.transaction(() => {
      const document = this.store.createDocument(context.tenant, input);
      const numbering = new FiscalNumbering(this.store, input.kind);
      numbering.attach(context, { ...numbering.coordinates(input.key), environment: input.environment,
        invoiceId: input.invoiceId, documentId: document.id });
      for (const record of records) this.store.put(context.tenant, record.collection, document.id, record.value);
      return document;
    });
  }
}
