import { createHash } from "node:crypto";
import { z } from "zod";
import { billingItemSchema, type CompanyData, type Context } from "./auth.js";
import { FiscalCatalog, fiscalItemSchema, assertClassificationMatches } from "./catalog.js";
import { FiscalParties, recipientSchema } from "./parties.js";
import { FiscalMatrix } from "./matrix.js";
import { calculateTaxes } from "./taxCalculation.js";
import { requireValue } from "./errors.js";
import { issuerSchema } from "./service.js";
import type { TaxRule } from "./rules.js";
import type { Store } from "./store.js";

const requestSchema = z.object({
  invoiceId: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  additionalServiceId: z.string().min(1).max(200).optional(),
}).strict();
const decimal = (value: number) => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;

export class InvoiceCalculation {
  constructor(private store: Store) {}
  list(context: Context) {
    return this.store.list<InvoiceCalculationRecord>(context.tenant, "invoiceCalculations")
      .map(({ id, invoiceId, kind, date, createdAt }) => ({ id, invoiceId, kind, date, createdAt }));
  }
  get(context: Context, id: string) {
    const record = this.store.get<InvoiceCalculationRecord>(context.tenant, "invoiceCalculations", id);
    requireValue(record, "Memória de cálculo não encontrada nesta empresa.", 404);
    return record;
  }
  prepare(context: Context, company: CompanyData, rules: TaxRule[], input: unknown) {
    const request = requestSchema.parse(input);
    const invoice = company.finance.invoices.find((item) => item.id === request.invoiceId);
    requireValue(invoice && !invoice.canceled && invoice.kind !== "Legado", "Faturamento ausente, cancelado ou legado.");
    requireValue(invoice.orders?.length && new Set(invoice.orders.map((order) => order.orderId)).size === invoice.orders.length,
      "Faturamento sem snapshots dos itens. Faturamentos antigos não são reconstruídos pela OS atual.");
    const entries = company.finance.entries.filter((item) => item.invoiceId === invoice.id);
    const entry = entries[0];
    requireValue(entries.length === 1 && entry && !entry.canceled && entry.kind === "Receber" &&
      entry.clientId === invoice.clientId && entry.amount === invoice.amount && ["Boleto", "Pix"].includes(entry.paymentMethod),
    "Conta a receber incompatível com o faturamento.");
    const issuer = issuerSchema.parse(this.store.get(context.tenant, "settings", "issuer"));
    const savedParty = new FiscalParties(this.store).list(context).find((item) => item.clientId === invoice.clientId);
    requireValue(savedParty, "Complete o cadastro fiscal do destinatário.");
    const recipient = recipientSchema.parse(savedParty);
    const client = company.clients.find((item) => item.id === invoice.clientId);
    requireValue(client && /^[\d./\-\s]+$/.test(client.document) && client.document.replace(/\D/g, "") === recipient.document,
      "Documento do cliente alterado; reconfira o cadastro fiscal.");
    const kind = invoice.kind === "Produtos" ? "nfe" : "nfse";
    const catalog = new FiscalCatalog(this.store).list(context);
    const matrices = new FiscalMatrix(this.store);
    let total = 0, gross = 0, discount = 0;
    const lines = invoice.orders.flatMap((order) => {
      requireValue(order.items?.length, `OS ${order.code}: snapshot dos itens ausente. Não use a OS atual para substituir dados faturados.`);
      requireValue(new Set(order.items.map((item) => item.id)).size === order.items.length, `OS ${order.code}: itens duplicados.`);
      let orderTotal = 0;
      return order.items.map((inputItem, index) => {
        const item = billingItemSchema.parse(inputItem);
        requireValue(item.kind === (kind === "nfe" ? "produto" : "servico"), "Item de outro grupo no faturamento.");
        const net = item.gross - item.itemDiscount - item.orderDiscount;
        requireValue(net > 0, `OS ${order.code}, ${item.name}: item zerado não suportado nesta preparação fiscal.`);
        orderTotal += net;
        requireValue(index !== order.items!.length - 1 || orderTotal === order.amount, "Soma dos itens diferente do total da OS faturada.");
        const referenceId = item.source === "item" ? item.referenceId : request.additionalServiceId;
        requireValue(referenceId, `Classifique os adicionais de serviço antes de calcular (${item.name}).`);
        const record = catalog.find((record) => record.kind === kind && record.referenceId === referenceId && record.active);
        requireValue(record, `Cadastro fiscal ativo ausente para ${item.name}.`);
        const classification = fiscalItemSchema.parse(record);
        const current = kind === "nfe" ? company.products : company.services;
        requireValue(current?.some((record) => record.id === referenceId), `Item ${item.name} ausente do catálogo canônico.`);
        const matrix = matrices.select(context, rules, { kind, ruleId: record.ruleId, date: request.date,
          destinationState: recipient.address.state, ieIndicator: recipient.ieIndicator, finalConsumer: recipient.finalConsumer });
        assertClassificationMatches(classification, matrix.ruleSnapshot);
        const calculation = calculateTaxes(matrix.parameters, [{
          id: createHash("sha256").update(JSON.stringify([order.orderId, item.id])).digest("hex"),
          gross: decimal(item.gross), discount: decimal(item.itemDiscount + item.orderDiscount),
        }]);
        total += net; gross += item.gross; discount += item.itemDiscount + item.orderDiscount;
        return { orderId: order.orderId, orderCode: order.code, item, classification, matrix: structuredClone(matrix), calculation };
      });
    });
    requireValue(lines.length <= 200 && Number.isSafeInteger(total) && Number.isSafeInteger(gross) && Number.isSafeInteger(discount) &&
      total === invoice.amount && invoice.amount > 0, "Total ou quantidade de itens incompatível com o faturamento.");
    const sum = (field: "ownTaxes" | "withheld" | "afterWithholding") => {
      const cents = lines.reduce((sum, line) => {
        const [integer, fraction] = line.calculation.totals[field].split(".");
        return sum + BigInt(integer!) * 100n + BigInt(fraction!);
      }, 0n);
      return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
    };
    const { retention: _retention, ...payment } = entry;
    const snapshot = { invoiceId: invoice.id, kind, date: request.date,
      ...(request.additionalServiceId ? { additionalServiceId: request.additionalServiceId } : {}), invoice: structuredClone(invoice),
      payment: structuredClone(payment), issuer, recipient, lines,
      totals: { gross: decimal(gross), discount: decimal(discount), net: decimal(total),
        ownTaxes: sum("ownTaxes"), withheld: sum("withheld"), afterWithholding: sum("afterWithholding") } };
    const id = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    const saved = { id, createdAt: new Date().toISOString(), createdBy: context.actor, ...snapshot,
      warning: "Memória de cálculo dos itens faturados. Não é XML, nota autorizada ou cobrança; não reserva numeração. Tributos próprios são informativos, sem somar ao preço. Calcular não altera a conta a receber; aplicar o líquido exige confirmação separada das retenções suportadas. Não verifica dispensas/mínimos de retenção, deduções especiais, créditos/compensações ou regras de transição IBS/CBS. Matrizes revisadas não comprovam enquadramento legal. Revalidar dados, regras e totais antes de qualquer emissão futura." };
    const previous = this.store.get<typeof saved>(context.tenant, "invoiceCalculations", id);
    if (previous) return previous;
    this.store.put(context.tenant, "invoiceCalculations", id, saved);
    this.store.audit(context.tenant, context.actor, "invoice.calculate", id);
    return saved;
  }
}
export type InvoiceCalculationRecord = ReturnType<InvoiceCalculation["prepare"]>;
