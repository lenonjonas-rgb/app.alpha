import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context, CompanyData, FinanceChange } from "./auth.js";
import { AppError, requireValue } from "./errors.js";
import type { FiscalService } from "./service.js";
import { RemittanceService } from "./remittance.js";
import { FiscalCatalog } from "./catalog.js";
import { FiscalParties } from "./parties.js";
import { FiscalMatrix } from "./matrix.js";
import { InvoiceCalculation } from "./invoiceCalculation.js";
import { FiscalNumbering } from "./numbering.js";
import { confirmNfse, getNfseCheck } from "./nfseReconciliation.js";
import { financeLinks, reserveFinanceCancellation } from "./financeLinks.js";
import { FiscalPdf } from "./fiscalPdf.js";
import type { CancellationEvent } from "./nfeCancellation.js";
import type { NfseCancellationEvent } from "./nfseCancellation.js";

export type ApiAuth = {
  authenticate(header: string | undefined): Promise<Context>; company(context: Context): Promise<CompanyData>;
  approveFinanceChange?(context: Context, change: FinanceChange): Promise<void>;
};
export async function readBody(request: IncomingMessage) {
  requireValue(request.headers["content-type"]?.split(";")[0] === "application/json", "Use application/json.", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    requireValue(size <= 4_000_000, "Requisição excede 4 MB.", 413);
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new AppError(400, "JSON inválido."); }
}
export function createApi(service: FiscalService, auth: ApiAuth, origins: Set<string>) {
  const remittances = new RemittanceService(service.store);
  const catalog = new FiscalCatalog(service.store);
  const parties = new FiscalParties(service.store);
  const matrix = new FiscalMatrix(service.store);
  const invoiceCalculation = new InvoiceCalculation(service.store);
  const numbering = new FiscalNumbering(service.store);
  const dpsNumbering = new FiscalNumbering(service.store, "nfse");
  const fiscalPdf = new FiscalPdf(service.store);
  const bankFor = (company: CompanyData, id: string) => {
    const bank = company.finance.accounts.find((item) => item.id === id && item.active);
    requireValue(bank && /itau|341/i.test(bank.bank.normalize("NFD").replace(/[\u0300-\u036f]/g, "")), "Selecione uma conta Itaú ativa cadastrada no financeiro.");
    return bank;
  };
  const limits = new Map<string, { start: number; count: number }>();
  return async (request: IncomingMessage, response: ServerResponse) => {
    const requestId = randomUUID();
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Referrer-Policy", "no-referrer");
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(data));
    };
    try {
      const origin = request.headers.origin;
      requireValue(!origin || origins.has(origin), "Origem não permitida.", 403);
      if (origin) { response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Vary", "Origin"); }
      if (request.method === "OPTIONS") {
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        response.writeHead(204); response.end(); return;
      }
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path === "/health" && request.method === "GET") { send(200, { status: "ok" }); return; }
      const peer = request.socket.remoteAddress ?? "unknown";
      const now = Date.now();
      for (const [key, value] of limits) if (now - value.start > 60000) limits.delete(key);
      requireValue(limits.size < 10000 || limits.has(peer), "Servidor ocupado.", 429);
      const rate = limits.get(peer) ?? { start: now, count: 0 };
      limits.set(peer, { ...rate, count: rate.count + 1 });
      requireValue(rate.count < 120, "Muitas requisições. Aguarde um minuto.", 429);
      const context = await auth.authenticate(request.headers.authorization);
      const companyData = async () => {
        const company = await auth.company(context);
        service.store.synchronizeFinanceChanges(context.tenant, company);
        return company;
      };
      const documentRoute = /^\/documents\/([a-f0-9-]{36})(?:\/(transmit|consult|xml|pdf|discard|cancel|events))?$/.exec(path);
      const eventRoute = /^\/fiscal-events\/([a-f0-9-]{36})\/xml$/.exec(path);
      if (eventRoute && request.method === "GET") {
        const event = service.store.get<CancellationEvent | NfseCancellationEvent>(context.tenant, "fiscalEvents", eventRoute[1]!);
        requireValue(event, "Evento fiscal não encontrado.", 404);
        response.writeHead(200, { "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="evento-${event.type}-${event.id}.xml"` });
        response.end(event.artifact ?? event.xml); return;
      }
      if (path === "/finance/links" && request.method === "GET") {
        send(200, { checkedAt: new Date().toISOString(), entries: financeLinks(service.store, context, await companyData()) }); return;
      }
      if (path === "/finance/cancellations" && request.method === "POST") {
        const body = await readBody(request);
        const company = await companyData();
        const reservation = reserveFinanceCancellation(service.store, context, company, body);
        requireValue(auth.approveFinanceChange, "Autorização de persistência financeira indisponível; cancelamento permanece reservado. Retente após configurar o backend.", 503);
        const entry = company.finance.entries.find((entry) => entry.id === reservation.entryId)!;
        await auth.approveFinanceChange(context, { entry, invoice: company.finance.invoices.find((item) => item.id === entry.invoiceId), action: "cancel" });
        send(200, reservation); return;
      }
      if (path === "/remittances" && request.method === "GET") {
        send(200, remittances.list(context).map(({ file: _file, ...metadata }) => metadata)); return;
      }
      if (path === "/remittances/config" && request.method === "GET") {
        const accountId = z.string().min(1).max(200).parse(new URL(request.url!, "http://localhost").searchParams.get("accountId"));
        send(200, remittances.config(context, accountId)); return;
      }
      if (path === "/remittances/config" && request.method === "PUT") {
        const body = await readBody(request);
        const config = z.object({ accountId: z.string(), agencia: z.string(), conta: z.string(), dac: z.string() }).parse(body);
        const bank = bankFor(await companyData(), config.accountId);
        requireValue(bank.agency.replace(/\D/g, "") === config.agencia && bank.account.replace(/\D/g, "") === config.conta + config.dac,
          "Agência/conta/DAC da remessa devem corresponder ao banco cadastrado. Aguarde Sincronizado.");
        send(200, remittances.saveConfig(context, body)); return;
      }
      if (path === "/remittances" && request.method === "POST") {
        const body = await readBody(request);
        const { accountId } = z.object({ accountId: z.string() }).parse(body);
        const company = await companyData();
        const bank = bankFor(company, accountId);
        const config = remittances.config(context, accountId);
        requireValue(config && bank.agency.replace(/\D/g, "") === config.agencia &&
          bank.account.replace(/\D/g, "") === config.conta + config.dac, "Revise a configuração Itaú: dados bancários alterados ou ausentes.");
        const { file: _file, ...metadata } = remittances.create(context, company, body);
        send(201, metadata); return;
      }
      const remittanceDownload = /^\/remittances\/([a-f0-9-]{36})\/file$/.exec(path);
      if (remittanceDownload && request.method === "GET") {
        const remittance = remittances.download(context, remittanceDownload[1]!);
        response.writeHead(200, { "Content-Type": "text/plain; charset=us-ascii", "Content-Disposition": `attachment; filename="ITAU-${String(remittance.fileSequence).padStart(6, "0")}.REM"` });
        response.end(remittance.file, "ascii"); return;
      }
      if (path === "/status" && request.method === "GET") {
        send(200, { issuer: service.profile(context), certificate: service.vault.metadata(context.tenant), schemas: await service.validator.ready(),
          documents: service.store.documents(context.tenant).map(({ xml: _xml, signedXml: _signed, response: _response, artifact: _artifact, ...metadata }) => metadata),
          rules: service.rules(context), catalog: catalog.list(context), recipients: parties.list(context), matrices: matrix.list(context),
          calculations: invoiceCalculation.list(context),
          numbering: service.profile(context) ? numbering.list(context, service.profile(context)!.cnpj) : [],
          numberReservations: service.profile(context) ? numbering.reservations(context, service.profile(context)!.cnpj) : [],
          dpsNumbering: service.profile(context) ? dpsNumbering.list(context, service.profile(context)!.cnpj) : [],
          dpsNumberReservations: service.profile(context) ? dpsNumbering.reservations(context, service.profile(context)!.cnpj) : [] }); return;
      }
      const nfseCheck = /^\/documents\/([a-f0-9-]{36})\/reconciliation$/.exec(path);
      if (nfseCheck && (request.method === "GET" || request.method === "POST")) {
        const input = request.method === "POST" ? await readBody(request) : undefined;
        const company = await companyData();
        const document = service.store.document(context.tenant, nfseCheck[1]!);
        send(200, request.method === "POST" ? confirmNfse(service.store, context, company, document, input) :
          getNfseCheck(service.store, context, company, document)); return;
      }
      if (path === "/numbering" && request.method === "PUT") {
        const profile = service.profile(context);
        requireValue(profile, "Cadastre o emitente antes da numeração.");
        send(200, numbering.configure(context, profile.cnpj, await readBody(request))); return;
      }
      if (path === "/dps-numbering" && request.method === "PUT") {
        const profile = service.profile(context);
        requireValue(profile, "Cadastre o emitente antes da numeração DPS.");
        send(200, dpsNumbering.configure(context, profile.cnpj, await readBody(request))); return;
      }
      if (path === "/matrices" && request.method === "PUT") {
        send(200, matrix.save(context, service.rules(context), await readBody(request))); return;
      }
      if (path === "/matrices/simulate" && request.method === "POST") {
        send(200, matrix.simulate(context, await readBody(request))); return;
      }
      if (path === "/invoices/calculate" && request.method === "POST") {
        const body = await readBody(request);
        send(200, invoiceCalculation.prepare(context, await companyData(), service.rules(context), body)); return;
      }
      if (path === "/invoices/retentions/confirm" && request.method === "POST") {
        const body = await readBody(request);
        const company = await companyData();
        const confirmation = service.confirmRetentions(context, company, body);
        requireValue(auth.approveFinanceChange, "Autorização de persistência das retenções indisponível.", 503);
        const entry = company.finance.entries.find((entry) => entry.id === confirmation.entryId)!;
        const invoice = company.finance.invoices.find((item) => item.id === entry.invoiceId)!;
        service.store.stageFinanceChange(context.tenant, { invoiceId: invoice.id, invoice, entry: { ...entry, retention: confirmation.retention } });
        await auth.approveFinanceChange(context, { entry, invoice,
          action: "retention", retention: confirmation.retention });
        send(200, confirmation); return;
      }
      if (path === "/invoices/retentions/clear" && request.method === "POST") {
        const body = await readBody(request);
        const company = await companyData();
        const confirmation = service.clearRetentions(context, company, body);
        requireValue(auth.approveFinanceChange, "Autorização de persistência das retenções indisponível.", 503);
        const entry = company.finance.entries.find((entry) => entry.id === confirmation.entryId)!;
        const invoice = company.finance.invoices.find((item) => item.id === entry.invoiceId)!;
        const { retention: _retention, ...after } = entry;
        service.store.stageFinanceChange(context.tenant, { invoiceId: invoice.id, invoice, entry: after });
        await auth.approveFinanceChange(context, { entry, invoice, action: "retention" });
        send(200, confirmation); return;
      }
      const calculationDownload = /^\/invoice-calculations\/([a-f0-9]{64})$/.exec(path);
      if (calculationDownload && request.method === "GET") {
        send(200, invoiceCalculation.get(context, calculationDownload[1]!)); return;
      }
      if (path === "/recipients" && request.method === "PUT") {
        const body = await readBody(request);
        send(200, parties.save(context, await companyData(), body)); return;
      }
      if (path === "/catalog" && request.method === "PUT") {
        const body = await readBody(request);
        send(200, catalog.save(context, await companyData(), service.rules(context), body)); return;
      }
      if (path === "/issuer" && request.method === "PUT") { send(200, service.saveProfile(context, await readBody(request))); return; }
      if (path === "/certificate" && request.method === "POST") {
        requireValue(context.role === "owner", "Somente Master pode substituir o certificado A1.", 403);
        const body = z.object({ pfxBase64: z.string().min(1), password: z.string().max(1000) }).parse(await readBody(request));
        const profile = service.profile(context); requireValue(profile, "Cadastre o emitente antes do certificado.");
        const metadata = await service.vault.save(context.tenant, body.pfxBase64, body.password, profile.cnpj);
        service.store.audit(context.tenant, context.actor, "certificate.replace", metadata.fingerprint);
        send(200, metadata); return;
      }
      if (path === "/rules" && request.method === "PUT") { send(200, service.saveRule(context, await readBody(request))); return; }
      if (path === "/rules/import" && request.method === "POST") {
        const body = z.object({ xml: z.string().max(2_000_000) }).parse(await readBody(request));
        send(201, service.importRules(context, body.xml)); return;
      }
      if (path === "/documents" && request.method === "POST") {
        const body = await readBody(request);
        const document = await service.createDraft(context, await companyData(), body, companyData);
        send(201, { id: document.id, key: document.key, status: document.status }); return;
      }
      if (path === "/documents/generate-nfe" && request.method === "POST") {
        const body = await readBody(request);
        const document = await service.generateNfeDraft(context, await companyData(), body, companyData);
        send(201, { id: document.id, key: document.key, status: document.status }); return;
      }
      if (path === "/documents/generate-dps" && request.method === "POST") {
        const body = await readBody(request);
        const document = await service.generateDpsDraft(context, await companyData(), body, companyData);
        send(201, { id: document.id, key: document.key, status: document.status }); return;
      }
      if (documentRoute) {
        const id = documentRoute[1]!;
        const action = documentRoute[2];
        if (action === "events" && request.method === "GET") {
          service.store.document(context.tenant, id);
          send(200, service.store.list<CancellationEvent | NfseCancellationEvent>(context.tenant, "fiscalEvents").filter((event) => event.documentId === id)
            .map((event) => {
              if ("model" in event && event.model === "nfse") {
                const { xml: _xml, response: _response, artifact: _artifact, consultation: _consultation, ...metadata } = event;
                return metadata;
              }
              const { xml: _xml, response: _response, artifact: _artifact, consultation: _consultation, ...metadata } = event;
              return metadata;
            })); return;
        }
        if (action === "cancel" && request.method === "POST") {
          const document = service.store.document(context.tenant, id), body = await readBody(request);
          const event = document.kind === "nfse"
            ? await service.cancelNfse(context, id, body, companyData)
            : await service.cancelNfe(context, id, body, companyData);
          send(200, { id: event.id, status: event.status, protocol: "protocol" in event ? event.protocol : undefined,
            message: event.message }); return;
        }
        if (action === "pdf" && request.method === "GET") {
          const pdf = fiscalPdf.download(context, id);
          response.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdf.filename}"`,
            "Content-Length": pdf.bytes.length, "Cache-Control": "private, no-store" });
          response.end(pdf.bytes); return;
        }
        if (action === "discard" && request.method === "POST") {
          const document = service.discardDraft(context, id);
          send(200, { status: document.status, message: document.message }); return;
        }
        if (action === "transmit" && request.method === "POST") {
          const body = z.object({ confirmation: z.string().min(1) }).parse(await readBody(request));
          const document = await service.transmit(context, await companyData(), id, body.confirmation, companyData);
          send(200, { status: document.status, message: document.message, protocol: document.protocol }); return;
        }
        if (action === "consult" && request.method === "POST") {
          const document = await service.consult(context, id);
          send(200, { status: document.status, message: document.message, protocol: document.protocol }); return;
        }
        if (action === "xml" && request.method === "GET") {
          const document = service.store.document(context.tenant, id);
          const xml = document.artifact ?? document.signedXml ?? document.xml;
          response.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${document.kind}-${document.id}.xml"` });
          response.end(xml); return;
        }
      }
      throw new AppError(404, "Operação não encontrada.");
    } catch (cause) {
      const status = cause instanceof AppError ? cause.status : cause instanceof z.ZodError ? 422 : 500;
      const message = cause instanceof AppError ? cause.message : cause instanceof z.ZodError ? "Dados inválidos. Confira os campos e formatos." :
        cause instanceof Error ? cause.message : "Falha interna.";
      console.error(JSON.stringify({ requestId, status, type: cause instanceof Error ? cause.name : "UnknownError" }));
      if (!response.headersSent) send(status, { error: message, requestId });
      else response.end();
    }
  };
}
