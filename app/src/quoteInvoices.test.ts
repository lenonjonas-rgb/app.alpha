import { describe, expect, it } from "vitest";
import { convertQuoteToSalesOrder, demoDatabase } from "./domain";
import type { Database } from "./domain";
import { nfeTotals } from "./outgoingInvoices";
import { nfeDraftFromQuote, nfseDraftFromQuote, quoteInvoices, quoteInvoiceSplit } from "./quoteInvoices";
import { nfseTotals, saveNfse } from "./serviceInvoices";

function approved(changes: Partial<Database["quotes"][number]> = {}): Database {
  const data = demoDatabase();
  return { ...data, quotes: data.quotes.map((quote) => ({ ...quote, status: "Aprovado" as const, discount: 4350, ...changes })) };
}

describe("notas a partir da proposta comercial", () => {
  it("divide a proposta mista: serviços na NFS-e e produtos na NF-e de venda, rateando o desconto", () => {
    const data = approved();
    const quote = data.quotes[0];
    expect(quoteInvoiceSplit(quote)).toMatchObject({ services: { gross: 25000, discount: 2500 }, products: { gross: 18500, discount: 1850 } });

    const nfse = nfseDraftFromQuote(data, quote.id);
    expect(nfse).toMatchObject({ quoteId: quote.id, salesOrderId: "", discount: 2500, recipient: { clientId: quote.clientId } });
    expect(nfse.service.amount).toBe(25000);
    expect(nfse.service.description).toContain("Manutencao preventiva");
    expect(nfse.service.description).not.toContain("Correia");
    expect(nfse.payment.installments.reduce((sum, item) => sum + item.amount, 0)).toBe(nfseTotals(nfse).total);

    const nfe = nfeDraftFromQuote(data, quote.id);
    expect(nfe.quoteId).toBe(quote.id);
    expect(nfe.items).toHaveLength(1);
    expect(nfe.items[0]).toMatchObject({ kind: "produto", name: "Correia de transmissao", price: 18500, discount: 1850 });
    expect(nfeTotals(nfe).billed).toBe(16650);
  });

  it("exige proposta aprovada e itens do tipo da nota", () => {
    const data = demoDatabase();
    expect(() => nfseDraftFromQuote(data, data.quotes[0].id)).toThrow("Aprove a proposta");
    const services = approved({ discount: 0, items: demoDatabase().quotes[0].items.filter((item) => item.kind === "servico") });
    expect(() => nfeDraftFromQuote(services, services.quotes[0].id)).toThrow("não possui produtos");
    expect(nfseDraftFromQuote(services, services.quotes[0].id).service.amount).toBe(25000);
  });

  it("reabre a nota já gerada em vez de duplicar", () => {
    const data = approved();
    const quote = data.quotes[0];
    const draft = nfseDraftFromQuote(data, quote.id);
    const saved = saveNfse(data, { ...draft, payment: { ...draft.payment, installments: [] } });
    const existing = quoteInvoices(saved, saved.quotes[0]).nfse;
    expect(existing?.quoteId).toBe(quote.id);
    expect(nfseDraftFromQuote(saved, quote.id).id).toBe(existing!.id);
  });

  it("com pedido de venda gerado, as notas seguem o pedido vinculado", () => {
    const data = convertQuoteToSalesOrder(approved(), "demo-quote-1");
    const quote = data.quotes[0];
    const order = data.salesOrders.find((item) => item.id === quote.salesOrderId)!;
    const nfe = nfeDraftFromQuote(data, quote.id);
    expect(nfe).toMatchObject({ quoteId: quote.id, salesOrderId: order.id });
    const nfse = nfseDraftFromQuote(data, quote.id);
    expect(nfse).toMatchObject({ quoteId: quote.id, salesOrderId: order.id, payment: { installments: [] } });
    expect(nfse.service.amount).toBe(25000);
  });
});
