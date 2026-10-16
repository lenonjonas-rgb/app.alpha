import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { AppError, requireValue } from "./errors.js";
import type { CompanyData } from "./auth.js";

type PendingFinanceChange = {
  invoiceId: string; entry: CompanyData["finance"]["entries"][number]; invoice: CompanyData["finance"]["invoices"][number];
};

export type Kind = "nfe" | "nfse";
export type Environment = "homologacao" | "producao";
export type DocumentStatus = "rascunho" | "enviando" | "incerto" | "processando" | "autorizado" | "rejeitado" | "cancelado";
export type FiscalDocument = {
  id: string; invoiceId: string; kind: Kind; environment: Environment; key: string;
  status: DocumentStatus; xml: string; signedXml?: string; response?: string;
  artifact?: string; receipt?: string; protocol?: string; accessKey?: string; message?: string; createdAt: string;
};

export class Store {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    if (directory !== ":memory:") mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(directory === ":memory:" ? directory : join(directory, "fiscal.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (
        tenant TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(tenant,collection,id));
      CREATE TABLE IF NOT EXISTS documents (
        tenant TEXT NOT NULL, id TEXT NOT NULL, invoice_id TEXT NOT NULL, kind TEXT NOT NULL,
        environment TEXT NOT NULL, document_key TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(tenant,id), UNIQUE(tenant,environment,document_key));
      CREATE UNIQUE INDEX IF NOT EXISTS documents_live_invoice ON documents(tenant,environment,invoice_id)
        WHERE status NOT IN ('cancelado','rejeitado');
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY, tenant TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
        record_id TEXT NOT NULL, at TEXT NOT NULL);
    `);
    // Reiniciar nao autoriza reenviar uma requisicao que pode ter chegado ao fisco.
    for (const row of this.db.prepare("SELECT tenant,payload FROM documents WHERE status='enviando'").all()) {
      const document = JSON.parse(String(row.payload)) as FiscalDocument;
      this.saveDocument(String(row.tenant), { ...document, status: "incerto", message: "Processo interrompido. Consulte antes de qualquer nova transmissão." });
    }
    for (const row of this.db.prepare("SELECT tenant,id,payload FROM records WHERE collection='fiscalEvents'").all()) {
      const event = JSON.parse(String(row.payload)) as { status: string };
      if (event.status === "enviando") this.put(String(row.tenant), "fiscalEvents", String(row.id),
        { ...event, status: "incerto", message: "Processo interrompido após iniciar evento. Consulte; não reenviar." });
    }
  }
  list<T>(tenant: string, collection: string): T[] {
    return this.db.prepare("SELECT payload FROM records WHERE tenant=? AND collection=? ORDER BY rowid DESC").all(tenant, collection)
      .map((row) => JSON.parse(String(row.payload)) as T);
  }
  get<T>(tenant: string, collection: string, id: string): T | undefined {
    const row = this.db.prepare("SELECT payload FROM records WHERE tenant=? AND collection=? AND id=?").get(tenant, collection, id);
    return row ? JSON.parse(String(row.payload)) as T : undefined;
  }
  put(tenant: string, collection: string, id: string, value: unknown) {
    this.db.prepare("INSERT INTO records VALUES (?,?,?,?) ON CONFLICT(tenant,collection,id) DO UPDATE SET payload=excluded.payload")
      .run(tenant, collection, id, JSON.stringify(value));
  }
  audit(tenant: string, actor: string, action: string, id: string) {
    this.db.prepare("INSERT INTO audit(tenant,actor,action,record_id,at) VALUES(?,?,?,?,?)").run(tenant, actor, action, id, new Date().toISOString());
  }
  documents(tenant: string): FiscalDocument[] {
    return this.db.prepare("SELECT payload FROM documents WHERE tenant=? ORDER BY rowid DESC").all(tenant).map((row) => JSON.parse(String(row.payload)) as FiscalDocument);
  }
  document(tenant: string, id: string) {
    const document = this.documents(tenant).find((item) => item.id === id);
    requireValue(document, "Documento fiscal não encontrado.", 404);
    return document;
  }
  collectionDocument(tenant: string, invoiceId: string, kind: Kind) {
    this.assertInvoiceAvailable(tenant, invoiceId);
    const active = this.documents(tenant).filter((item) => item.invoiceId === invoiceId && !["cancelado", "rejeitado"].includes(item.status));
    requireValue(active.length === 1 && active[0]!.kind === kind && active[0]!.status === "autorizado" && active[0]!.environment === "producao",
      `Cobrança exige ${kind === "nfe" ? "NF-e" : "NFS-e"} autorizada em produção e nenhum outro documento ativo/incerto no faturamento; homologação não libera remessa.`, 409);
    return active[0]!;
  }
  createDocument(tenant: string, document: Omit<FiscalDocument, "id" | "createdAt" | "status">) {
    this.assertInvoiceAvailable(tenant, document.invoiceId);
    const current = this.documents(tenant).find((item) => item.environment === document.environment && item.invoiceId === document.invoiceId &&
      item.status !== "cancelado" && item.status !== "rejeitado");
    requireValue(!current, "Já existe documento ativo para este faturamento. Consulte o histórico.", 409);
    requireValue(!this.documents(tenant).some((item) => item.environment === document.environment && item.key === document.key),
      "Esta chave/identificador já foi utilizado. Não reutilize numeração fiscal.", 409);
    const value: FiscalDocument = { ...document, id: randomUUID(), status: "rascunho", createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)")
      .run(tenant, value.id, value.invoiceId, value.kind, value.environment, value.key, value.status, JSON.stringify(value));
    return value;
  }
  saveDocument(tenant: string, document: FiscalDocument) {
    this.db.prepare("UPDATE documents SET status=?,payload=? WHERE tenant=? AND id=?")
      .run(document.status, JSON.stringify(document), tenant, document.id);
    return document;
  }
  claim(tenant: string, id: string) {
    const document = this.document(tenant, id);
    this.assertInvoiceAvailable(tenant, document.invoiceId);
    requireValue(document.status === "rascunho", "Este documento já foi enviado. Consulte o resultado antes de prosseguir.", 409);
    const changed = this.db.prepare("UPDATE documents SET status='enviando',payload=? WHERE tenant=? AND id=? AND status='rascunho'")
      .run(JSON.stringify({ ...document, status: "enviando" }), tenant, id);
    if (changed.changes !== 1) throw new AppError(409, "Transmissão já iniciada.");
    return { ...document, status: "enviando" as const };
  }
  stageFinanceChange(tenant: string, change: PendingFinanceChange) {
    this.put(tenant, "pendingFinanceChanges", change.invoiceId, change);
  }
  synchronizeFinanceChanges(tenant: string, company: CompanyData) {
    for (const pending of this.list<PendingFinanceChange>(tenant, "pendingFinanceChanges")) {
      const entry = company.finance.entries.find((item) => item.id === pending.entry.id);
      const invoice = company.finance.invoices.find((item) => item.id === pending.invoiceId);
      if (entry && isDeepStrictEqual({ ...entry, settlements: [] }, { ...pending.entry, settlements: [] }) &&
        isDeepStrictEqual(invoice, pending.invoice)) {
        this.db.prepare("DELETE FROM records WHERE tenant=? AND collection='pendingFinanceChanges' AND id=?")
          .run(tenant, pending.invoiceId);
      }
    }
  }
  assertInvoiceAvailable(tenant: string, invoiceId: string, options?: { retentionUpdate: true }) {
    requireValue(!this.list<{ invoiceId: string; status: string }>(tenant, "fiscalEvents").some((event) =>
      event.invoiceId === invoiceId && ["enviando", "incerto"].includes(event.status)),
    "Evento fiscal pendente ou incerto para o faturamento. Consulte a situação; não emitir/remeter novamente.", 409);
    requireValue(!this.get(tenant, "invoiceCancellations", invoiceId),
      "Faturamento com cancelamento interno reservado. Conclua a sincronização da conta; não emitir ou remeter este título.", 409);
    requireValue(options?.retentionUpdate || !this.get(tenant, "pendingFinanceChanges", invoiceId),
      "Alteração de retenções aguardando gravação protegida no Supabase. Conclua/retente a conciliação e aguarde Sincronizado antes de emitir ou remeter.", 409);
  }
}
