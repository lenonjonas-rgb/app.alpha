import { describe, expect, it } from "vitest";
import { demoDatabase, saveSalesOrderDraft } from "./domain";
import { billSalesOrder, previewSalesOrderBilling, saveBankAccount } from "./finance";
import {
  blankNfse, cancelNfse, cloneNfse, deleteNfse, nfseAccountsPosted, nfseBillingTarget, nfseBlockingIssues, nfseDraftFromBillingInvoice,
  nfseRecipientFromClient, nfseTotals, postNfseAccounts, registerNfseIssue, reverseNfseAccounts, saveNfse,
} from "./serviceInvoices";
import type { ServiceInvoice } from "./serviceInvoiceSchema";

const bank = { id: "bank", name: "Conta principal", bank: "Banco", agency: "1", account: "1", kind: "Corrente" as const, active: true };
const base = () => saveBankAccount(demoDatabase(), bank);

function filled(data = base(), amount = 100000): ServiceInvoice {
  const nfse = blankNfse(data);
  return { ...nfse, issueDate: "2026-10-10", recipient: nfseRecipientFromClient(data.clients[0]),
    service: { ...nfse.service, description: "Manutenção preventiva", amount } };
}

describe("NFS-e", () => {
  it("calcula retenções e total como no Bling", () => {
    const nfse = filled();
    expect(nfseTotals({ ...nfse, taxes: { ...nfse.taxes, retainInss: true, retainFederal: true } }).total).toBe(84350);
    expect(nfseTotals({ ...nfse, taxes: { ...nfse.taxes, retainInss: true, retainFederal: true, issRate: 2, discountIss: true } }).total).toBe(82350);
    expect(nfseTotals({ ...nfse, taxes: { ...nfse.taxes, issRate: 2, retainIss: true } }).total).toBe(100000);
    const full = nfseTotals({ ...nfse, discount: 5000, taxes: { ...nfse.taxes, retainInss: true, retainFederal: true, issRate: 2, discountIss: true } });
    expect([full.pis, full.cofins, full.csll, full.inss, full.iss, full.total]).toEqual([618, 2850, 950, 10450, 1900, 78232]);
  });

  it("salva com parcelas, lança contas e muda o RPS se o número já foi usado", () => {
    const data = base();
    const first = saveNfse(data, filled(data));
    const draft = { ...filled(first), rpsNumber: 1 };
    expect(draft.rpsNumber).toBe(1);
    const nfse = { ...draft, payment: { ...draft.payment, installments: [
      { id: "p1", days: 30, dueOn: "2026-11-09", amount: 60000, method: "Boleto" as const, accountId: bank.id, paymentType: "", authorization: "", notes: "" },
      { id: "p2", days: 60, dueOn: "2026-12-09", amount: 40000, method: "Pix" as const, accountId: bank.id, paymentType: "", authorization: "", notes: "" },
    ] } };
    const saved = saveNfse(first, nfse);
    const stored = saved.serviceInvoices.find((item) => item.id === nfse.id)!;
    expect(stored.rpsNumber).toBe(2);
    expect(stored.entryIds).toHaveLength(2);
    expect(nfseAccountsPosted(saved, stored)).toBe(true);
    expect(saved.finance.entries.filter((entry) => stored.entryIds.includes(entry.id)).map((entry) => entry.amount)).toEqual([60000, 40000]);
    expect(() => deleteNfse(saved, stored.id)).toThrow("Estorne as contas");
    expect(() => cancelNfse(saved, stored.id, "Serviço não prestado")).toThrow("Estorne as contas");
    const reversed = reverseNfseAccounts(saved, stored.id);
    expect(reversed.serviceInvoices.find((item) => item.id === stored.id)!.entryIds).toEqual([]);
    expect(reversed.finance.entries.filter((entry) => stored.entryIds.includes(entry.id)).every((entry) => entry.canceled)).toBe(true);
    expect(cancelNfse(reversed, stored.id, "Serviço não prestado").serviceInvoices.find((item) => item.id === stored.id)!.status).toBe("Cancelada");
  });

  it("lança contas depois, registra a emissão e clona sem vínculos", () => {
    const data = base();
    const saved = saveNfse(data, { ...filled(data), payment: { ...filled(data).payment, terms: "3x" } });
    const nfse = saved.serviceInvoices[0];
    expect(nfseAccountsPosted(saved, nfse)).toBe(false);
    const posted = postNfseAccounts(saved, nfse.id);
    expect(posted.serviceInvoices[0].entryIds).toHaveLength(3);
    expect(() => postNfseAccounts(posted, nfse.id)).toThrow("já foram lançadas");
    expect(() => registerNfseIssue(posted, nfse.id, " ")).toThrow("número");
    const issued = registerNfseIssue(posted, nfse.id, "2026/123");
    expect(issued.serviceInvoices[0]).toMatchObject({ status: "Emitida", nfseNumber: "2026/123" });
    expect(() => saveNfse(issued, issued.serviceInvoices[0])).toThrow("pendentes");
    const clone = cloneNfse(issued, nfse.id);
    expect(clone).toMatchObject({ status: "Pendente", nfseNumber: "", entryIds: [], rpsNumber: 2 });
  });

  it("gera a nota do faturamento de serviços do pedido sem lançar contas novamente", () => {
    const data = base();
    const withOrder = saveSalesOrderDraft(data, {
      clientId: data.clients[0].id, date: "2026-10-10", expectedOn: "", quoteId: "", serviceOrderId: "",
      stockLocationId: data.inventory!.defaultLocationId, seller: "Ana", paymentTerms: "", shippingCost: 0, otherExpenses: 0, discount: 0,
      notes: "", internalNotes: "", items: [{ id: "s", kind: "servico", referenceId: data.services[0].id, name: data.services[0].name,
        quantity: 2, price: 5000, discountPercent: 0 }],
    });
    const orderId = withOrder.salesOrders[0].id;
    const terms = { accountId: bank.id, dueOn: "2026-11-20", paymentMethod: "Pix" as const };
    const billed = billSalesOrder(withOrder, orderId, { Serviços: terms }, previewSalesOrderBilling(withOrder, orderId));
    const invoice = billed.finance.invoices.find((item) => item.kind !== "Produtos")!;
    const draft = nfseDraftFromBillingInvoice(billed, invoice.id);
    expect(draft).toMatchObject({ salesOrderId: orderId, invoiceId: invoice.id, seller: "Ana" });
    expect(draft.service.amount).toBe(10000);
    expect(nfseBillingTarget(billed, draft).mode).toBe("linked");
    const entries = billed.finance.entries.length;
    const saved = saveNfse(billed, draft);
    expect(saved.finance.entries).toHaveLength(entries);
    expect(() => reverseNfseAccounts(saved, draft.id)).toThrow("faturamento");
    expect(nfseDraftFromBillingInvoice(saved, invoice.id).id).toBe(draft.id);
  });

  it("bloqueia nota sem cliente, descrição ou valor", () => {
    const nfse = blankNfse(base());
    expect(nfseBlockingIssues(nfse)).toEqual(expect.arrayContaining(["Informe o cliente da nota de serviço.", "Informe a descrição do serviço.", "Informe o valor do serviço."]));
    expect(() => saveNfse(base(), nfse)).toThrow("cliente");
  });
});
