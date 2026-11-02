import { currency, makeId, salesOrderLineTotal, salesOrderTotal } from "./domain";
import type { Database, Quote } from "./domain";
import {
  blankNfe, defaultInstallments, defaultItemFields, distribute, nfeDraftFromSalesOrder, recalculateNfe, recipientFromClient,
} from "./outgoingInvoices";
import type { NfeItem, OutgoingInvoice } from "./outgoingInvoiceSchema";
import { blankNfse, defaultNfseInstallments, nfseDraftFromBillingInvoice, nfseRecipientFromClient, serviceInvoiceFor } from "./serviceInvoices";
import type { ServiceInvoice } from "./serviceInvoiceSchema";

const gross = (item: { quantity: number; price: number }) => Math.round(item.quantity * item.price);
const describe = (item: { name: string; quantity: number; price: number }) =>
  `${item.name} (${item.quantity.toLocaleString("pt-BR")} x ${currency(item.price)})`;

/** Valores da proposta por tipo de item; o desconto geral é rateado pelo valor bruto de serviços e produtos. */
export function quoteInvoiceSplit(quote: Quote) {
  const services = quote.items.filter((item) => item.kind === "servico");
  const products = quote.items.filter((item) => item.kind === "produto");
  const servicesGross = services.reduce((sum, item) => sum + gross(item), 0);
  const productsGross = products.reduce((sum, item) => sum + gross(item), 0);
  const base = servicesGross + productsGross;
  const servicesDiscount = base ? Math.round((quote.discount * servicesGross) / base) : 0;
  return {
    services: { lines: services, gross: servicesGross, discount: servicesDiscount },
    products: { lines: products, gross: productsGross, discount: quote.discount - servicesDiscount },
  };
}

/** Notas ativas da proposta, inclusive as geradas pelo pedido de venda vinculado a ela. */
export function quoteInvoices(data: Database, quote: Quote) {
  const linked = (item: { status: string; quoteId: string; salesOrderId: string }) => item.status !== "Cancelada" &&
    (item.quoteId === quote.id || (!!quote.salesOrderId && item.salesOrderId === quote.salesOrderId));
  return { nfe: data.outgoingInvoices.find(linked), nfse: data.serviceInvoices.find(linked) };
}

function approvedQuote(data: Database, quoteId: string) {
  const quote = data.quotes.find((item) => item.id === quoteId);
  if (!quote) throw new Error("Proposta comercial não encontrada.");
  if (quote.status !== "Aprovado") throw new Error("Aprove a proposta antes de gerar as notas fiscais.");
  return quote;
}

/** NFS-e com os serviços da proposta; os produtos ficam para a nota fiscal de venda. */
export function nfseDraftFromQuote(data: Database, quoteId: string): ServiceInvoice {
  const quote = approvedQuote(data, quoteId);
  const existing = quoteInvoices(data, quote).nfse;
  if (existing) return existing;
  const split = quoteInvoiceSplit(quote);
  if (!split.services.lines.length) throw new Error("A proposta não possui serviços para gerar a nota de serviço.");
  const order = quote.salesOrderId ? data.salesOrders.find((item) => item.id === quote.salesOrderId) : undefined;
  const event = `Nota de serviço gerada da proposta ${quote.code}`;
  if (order) {
    const billed = serviceInvoiceFor(data, order.id);
    if (billed) {
      const draft = nfseDraftFromBillingInvoice(data, billed.id);
      return { ...draft, quoteId: quote.id, events: [{ at: draft.createdAt, description: event }] };
    }
  }
  const client = data.clients.find((item) => item.id === quote.clientId);
  const draft = blankNfse(data);
  let lines = split.services.lines.map(describe);
  let amount = split.services.gross;
  let discount = split.services.discount;
  if (order) {
    // O pedido pode ter sido ajustado depois da proposta; a nota acompanha o pedido e as contas são lançadas por ele.
    const services = order.items.filter((item) => item.kind === "servico");
    if (!services.length) throw new Error("O pedido de venda da proposta não possui serviços.");
    const nets = services.reduce((sum, item) => sum + salesOrderLineTotal(item), 0);
    const base = salesOrderTotal({ ...order, discount: 0 });
    lines = services.map(describe);
    amount = services.reduce((sum, item) => sum + gross(item), 0);
    discount = amount - nets + (base ? Math.round((order.discount * nets) / base) : 0);
  }
  const nfse: ServiceInvoice = {
    ...draft, recipient: nfseRecipientFromClient(client), quoteId: quote.id, salesOrderId: order?.id ?? "",
    seller: order?.seller ?? "",
    service: { ...draft.service, description: lines.join("\n").slice(0, 2000), amount },
    discount: Math.min(discount, amount),
    payment: { ...draft.payment, terms: order?.paymentTerms.slice(0, 120) ?? "" },
    complementary: `Proposta comercial ${quote.code}${order ? ` · Pedido ${order.code}` : ""}`,
    events: [{ at: draft.createdAt, description: event }],
  };
  return { ...nfse, payment: { ...nfse.payment, installments: defaultNfseInstallments(data, nfse) } };
}

/** NF-e de venda com os produtos da proposta (ou do pedido de venda gerado por ela). */
export function nfeDraftFromQuote(data: Database, quoteId: string): OutgoingInvoice {
  const quote = approvedQuote(data, quoteId);
  const existing = quoteInvoices(data, quote).nfe;
  if (existing) return existing;
  const split = quoteInvoiceSplit(quote);
  if (!split.products.lines.length) throw new Error("A proposta não possui produtos para gerar a nota fiscal de venda.");
  const event = `Nota fiscal gerada da proposta ${quote.code}`;
  if (quote.salesOrderId) {
    const nfe = nfeDraftFromSalesOrder(data, quote.salesOrderId);
    return { ...nfe, quoteId: quote.id, events: [{ at: nfe.createdAt, description: `${event} (pedido vinculado)` }] };
  }
  const client = data.clients.find((item) => item.id === quote.clientId);
  const draft = blankNfe(data);
  const discounts = distribute(split.products.discount, split.products.lines.map(gross));
  const items = split.products.lines.map((line, index): NfeItem => ({
    id: makeId(), kind: "produto", referenceId: line.referenceId, salesOrderLineId: "",
    name: line.name.slice(0, 120), code: data.products.find((item) => item.id === line.referenceId)?.code ?? "", unit: "UN",
    quantity: line.quantity, price: line.price, freight: 0, discount: discounts[index], fields: defaultItemFields(),
  }));
  const nfe = recalculateNfe({
    ...draft, recipient: recipientFromClient(client), items, quoteId: quote.id,
    additional: { ...draft.additional, complementary: `Proposta comercial ${quote.code}` },
    events: [{ at: draft.createdAt, description: event }],
  });
  return { ...nfe, payment: { ...nfe.payment, installments: defaultInstallments(data, nfe) } };
}
