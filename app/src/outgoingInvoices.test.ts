import { describe, expect, it } from "vitest";
import { demoDatabase, salesOrderTotal, saveSalesOrderDraft } from "./domain";
import type { Database } from "./domain";
import { billSalesOrder, cancelFinanceEntry, previewSalesOrderBilling, salesOrderInvoices, saveBankAccount } from "./finance";
import {
  blankNfe, blankNfeItem, calculateNfeItem, cancelNfe, cloneNfe, deleteNfe, generateNfeInstallments, nfeAccountsPosted,
  nfeBillingTarget, nfeBlockingIssues, nfeDraftFromSalesOrder, nfeTotals, parsePaymentTerms, postNfeAccounts, reverseNfeAccounts, saveNfe,
} from "./outgoingInvoices";
import type { OutgoingInvoice } from "./outgoingInvoiceSchema";

const bank = { id: "bank", name: "Conta principal", bank: "Banco", agency: "1", account: "1", kind: "Corrente" as const, active: true };

function withOrder(services = false) {
  const data = saveBankAccount(demoDatabase(), bank);
  const product = data.products[0];
  const items = [{ id: "line-1", kind: "produto" as "produto" | "servico", referenceId: product.id, name: product.name,
    quantity: 2, price: 10000, discountPercent: 2500 }];
  if (services) items.push({ id: "line-2", kind: "servico", referenceId: data.services[0].id, name: data.services[0].name,
    quantity: 1, price: 5000, discountPercent: 0 });
  const result = saveSalesOrderDraft(data, {
    clientId: data.clients[0].id, date: "2026-10-10", expectedOn: "", quoteId: "", serviceOrderId: "",
    stockLocationId: data.inventory!.defaultLocationId, seller: "", paymentTerms: "", shippingCost: services ? 0 : 500,
    otherExpenses: services ? 0 : 100, discount: services ? 0 : 1000, notes: "", internalNotes: "", items,
  });
  return { data: result, orderId: result.salesOrders[0].id };
}

function classified(nfe: OutgoingInvoice): OutgoingInvoice {
  return { ...nfe, items: nfe.items.map((item) => ({ ...item, fields: { ...item.fields,
    "ibs.classification": "000001", "cbs.classification": "000001" } })) };
}

describe("NF-e de saída", () => {
  it("interpreta condições de pagamento e deixa a sobra na primeira parcela", () => {
    expect(parsePaymentTerms("")).toEqual([0]);
    expect(parsePaymentTerms("30 60")).toEqual([30, 60]);
    expect(parsePaymentTerms("3x")).toEqual([30, 60, 90]);
    expect(parsePaymentTerms("15 +2x")).toEqual([15, 45, 75]);
    expect(() => parsePaymentTerms("60 30")).toThrow("fora de ordem");
    expect(() => parsePaymentTerms("abc")).toThrow("inválida");
    const installments = generateNfeInstallments("3x", 10000, "2026-01-31", { method: "Pix", accountId: "" });
    expect(installments.map((item) => item.amount)).toEqual([3334, 3333, 3333]);
    expect(installments.map((item) => item.dueOn)).toEqual(["2026-03-02", "2026-04-01", "2026-05-01"]);
  });

  it("calcula ICMS e a base de IBS/CBS como no Bling", () => {
    const item = calculateNfeItem({ ...blankNfeItem(), name: "Produto", quantity: 1, price: 4701,
      fields: { ...blankNfeItem().fields, "icms.rate": "17" } });
    expect(item.fields["icms.base"]).toBe("47.01");
    expect(item.fields["icms.value"]).toBe("7.99");
    expect(item.fields["ibs.base"]).toBe("39.02");
    expect(item.fields["cbs.value"]).toBe("0.35");
    expect(nfeTotals({ items: [item] }).total).toBe(4701);
  });

  it("bloqueia itens sem classificação tributária IBS/CBS", () => {
    const { data, orderId } = withOrder();
    const draft = nfeDraftFromSalesOrder(data, orderId);
    expect(nfeBlockingIssues(draft)).toContain("Item 1: CST e/ou Classificação Tributária (IBS/CBS) não informados.");
    expect(() => saveNfe(data, draft)).toThrow("Classificação Tributária");
    expect(nfeBlockingIssues(classified(draft))).toEqual([]);
  });

  it("gera a nota do pedido, cria faturamento com parcelas e marca o pedido como Atendido", () => {
    const { data, orderId } = withOrder();
    const order = data.salesOrders[0];
    const draft = classified(nfeDraftFromSalesOrder(data, orderId));
    expect(draft.recipient.clientId).toBe(order.clientId);
    expect(nfeTotals(draft).billed).toBe(salesOrderTotal(order));
    const nfe = { ...draft, payment: { ...draft.payment, terms: "30 60",
      installments: generateNfeInstallments("30 60", nfeTotals(draft).billed, draft.issueDate, { method: "Boleto", accountId: bank.id }) } };
    const saved = saveNfe(data, nfe);
    const stored = saved.outgoingInvoices[0];
    expect(stored.status).toBe("Pendente");
    expect(saved.salesOrders[0].status).toBe("Atendido");
    const invoices = salesOrderInvoices(saved, orderId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ kind: "Produtos", amount: salesOrderTotal(order), id: stored.invoiceId });
    const entries = saved.finance.entries.filter((entry) => entry.invoiceId === stored.invoiceId);
    expect(entries.map((entry) => entry.amount).reduce((a, b) => a + b, 0)).toBe(salesOrderTotal(order));
    expect(entries).toHaveLength(2);
    expect(nfeAccountsPosted(saved, stored)).toBe(true);
    expect(() => cancelNfe(saved, stored.id, "Erro de digitação")).toThrow("Estorne as contas");
    expect(() => deleteNfe(saved, stored.id)).toThrow("Estorne as contas");

    const reversed = reverseNfeAccounts(saved, stored.id);
    expect(salesOrderInvoices(reversed, orderId)).toHaveLength(0);
    expect(reversed.finance.entries.filter((entry) => entries.some((item) => item.id === entry.id)).every((entry) => entry.canceled)).toBe(true);
    const reposted = postNfeAccounts(reversed, stored.id);
    expect(salesOrderInvoices(reposted, orderId)).toHaveLength(1);
    const canceled = cancelNfe(reverseNfeAccounts(reposted, stored.id), stored.id, "Erro de digitação");
    expect(canceled.outgoingInvoices[0].status).toBe("Cancelada");
    expect(() => cancelNfe(canceled, stored.id, "Outra vez")).toThrow("já está cancelada");
  });

  it("usa o rateio existente quando o pedido já faturou serviços", () => {
    const { data, orderId } = withOrder(true);
    const draft = classified(nfeDraftFromSalesOrder(data, orderId));
    const target = nfeBillingTarget(data, draft);
    expect(target).toMatchObject({ mode: "create", fixed: false, amount: 15000 });
    const saved = saveNfe(data, { ...draft, payment: { ...draft.payment,
      installments: generateNfeInstallments("", 15000, draft.issueDate, { method: "Pix", accountId: bank.id }) } });
    const invoice = salesOrderInvoices(saved, orderId)[0];
    expect(invoice.orders[0].allocation).toEqual({ products: 15000, services: 5000 });

    const preview = previewSalesOrderBilling(data, orderId);
    const terms = { accountId: bank.id, dueOn: "2026-11-20", paymentMethod: "Pix" as const };
    const billedAll = billSalesOrder(data, orderId, { Produtos: terms, Serviços: terms }, preview);
    const productsInvoice = salesOrderInvoices(billedAll, orderId).find((item) => item.kind === "Produtos")!;
    const servicesBilled = cancelFinanceEntry(billedAll, billedAll.finance.entries.find((entry) => entry.invoiceId === productsInvoice.id)!.id);
    const fixed = classified(nfeDraftFromSalesOrder(servicesBilled, orderId));
    expect(nfeBillingTarget(servicesBilled, fixed)).toMatchObject({ mode: "create", fixed: true, amount: 15000 });
    expect(nfeTotals(fixed).billed).toBe(15000);
    const both = saveNfe(servicesBilled, fixed);
    expect(salesOrderInvoices(both, orderId).map((item) => item.kind).sort()).toEqual(["Produtos", "Serviços"]);
  });

  it("renumera ao gravar, salva nota avulsa sem contas e permite clonar e excluir", () => {
    const { data } = withOrder();
    const client = data.clients[0];
    const make = (base: Database): OutgoingInvoice => classified({ ...blankNfe(base),
      recipient: { ...blankNfe(base).recipient, clientId: client.id, name: client.name },
      items: [{ ...blankNfeItem(), name: "Peça avulsa", price: 2500 }] });
    const first = saveNfe(data, make(data));
    const duplicate = { ...make(data), number: first.outgoingInvoices[0].number };
    const second = saveNfe(first, duplicate);
    expect(second.outgoingInvoices.map((item) => item.number)).toEqual([1, 2]);
    expect(nfeAccountsPosted(second, second.outgoingInvoices[1])).toBe(false);

    const clone = cloneNfe(second, second.outgoingInvoices[0].id);
    expect(clone).toMatchObject({ status: "Pendente", number: 3, salesOrderId: "", invoiceId: "", entryIds: [] });
    expect(clone.id).not.toBe(second.outgoingInvoices[0].id);

    const posted = postNfeAccounts(second, second.outgoingInvoices[0].id);
    const nfe = posted.outgoingInvoices[0];
    expect(nfe.entryIds).toHaveLength(1);
    expect(posted.finance.entries.find((entry) => entry.id === nfe.entryIds[0])).toMatchObject({ amount: 2500, kind: "Receber" });
    expect(deleteNfe(posted, posted.outgoingInvoices[1].id).outgoingInvoices).toHaveLength(1);
  });
});
