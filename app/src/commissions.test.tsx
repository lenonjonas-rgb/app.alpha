import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, getOrderDetails, localDay, saveSalesOrderDraft, validateDatabase } from "./domain";
import { applyFinanceRetention, billOrders, billSalesOrder, cancelFinanceEntry, reverseSettlement, saveBankAccount, settleFinanceEntry } from "./finance";
import { commissionRuleSchema } from "./commissionSchema";
import type { CommissionRule, CommissionSeller } from "./commissionSchema";
import { commissionRelease, previewCommission, recordCommission, saveCommissionSeller } from "./commissions";
import { FinancePanel } from "./FinancePanel";

const bank = { id: "bank", name: "Banco", bank: "Teste", agency: "", account: "", kind: "Corrente" as const, active: true };
const rule: CommissionRule = { release: "proportional", calculation: { type: "fixed", rate: 1000 } };
const seller: CommissionSeller = { id: "seller", name: "Vendedor teste", active: true, rule };
const terms = { accountId: "bank", dueOn: localDay(), paymentMethod: "Pix" as const };
function billedSale() {
  let data = saveBankAccount(demoDatabase(), bank);
  data = saveSalesOrderDraft(data, { clientId: data.clients[0].id, date: localDay(), expectedOn: "", quoteId: "", serviceOrderId: "",
    stockLocationId: data.inventory!.defaultLocationId, seller: seller.name, paymentTerms: "", shippingCost: 0,
    otherExpenses: 0, discount: 0, notes: "", internalNotes: "", items: [
      { id: "one", kind: "produto", referenceId: data.products[0].id, name: "Produto A", quantity: 1, price: 10000, discountPercent: 1000 },
      { id: "two", kind: "produto", referenceId: data.products[0].id, name: "Produto B", quantity: 1, price: 5000, discountPercent: 0 },
    ] });
  const orderId = data.salesOrders[0].id;
  data = billSalesOrder(data, orderId, { Produtos: terms });
  return { data, orderId, invoiceId: data.finance.invoices[0].id };
}
function recorded() {
  const { data: original, orderId, invoiceId } = billedSale();
  const data = saveCommissionSeller(original, seller);
  const preview = previewCommission(data, invoiceId, orderId, seller.id);
  return { data: recordCommission(data, preview, true, "commission"), orderId, invoiceId, preview };
}

describe("regras e apuração de comissões", () => {
  it("calcula por item com desconto exato, inclusive limite de faixa e centavos", () => {
    const { data: original, invoiceId, orderId } = billedSale();
    const discountSeller: CommissionSeller = { ...seller, rule: { release: "billing",
      calculation: { type: "discount", tiers: [{ upTo: 1000, rate: 500 }, { upTo: 10000, rate: 200 }] } } };
    const data = saveCommissionSeller(original, discountSeller);
    const preview = previewCommission(data, invoiceId, orderId, seller.id);
    expect(preview.items.map((item) => [item.discount, item.base, item.rate, item.amount]))
      .toEqual([[1000, 9000, 500, 450], [0, 5000, 500, 250]]);
    expect(preview).toMatchObject({ base: 14000, amount: 700 });
    expect(() => commissionRuleSchema.parse({ release: "billing",
      calculation: { type: "discount", tiers: [{ upTo: 9000, rate: 500 }] } })).toThrow("100%");
    expect(() => commissionRuleSchema.parse({ release: "billing",
      calculation: { type: "discount", tiers: [{ upTo: 5000, rate: 500 }, { upTo: 5000, rate: 200 }, { upTo: 10000, rate: 100 }] } }))
      .toThrow("faixas");
  });
  it("exige confirmação, evita duplicidade e conserva regra e vendedor após mudança", () => {
    const { data: original, invoiceId, orderId } = billedSale();
    const data = saveCommissionSeller(original, seller);
    const preview = previewCommission(data, invoiceId, orderId, seller.id);
    expect(() => recordCommission(data, preview, false)).toThrow("confirme");
    const changed = saveCommissionSeller(data, { ...seller, name: "Novo nome", rule: { ...rule, calculation: { type: "fixed", rate: 2000 } } }, seller);
    expect(() => recordCommission(changed, preview, true)).toThrow("alterados");
    const saved = recordCommission(data, preview, true, "commission");
    expect(() => recordCommission(saved, preview, true)).toThrow("já foi apurada");
    const renamed = saveCommissionSeller(saved, { ...seller, name: "Novo nome", rule: { ...rule, calculation: { type: "fixed", rate: 2000 } } }, seller);
    expect(renamed.finance.commissions!.records[0]).toMatchObject({ sellerName: seller.name, rule, base: 14000, amount: 1400 });
    expect(validateDatabase(JSON.parse(JSON.stringify(renamed))).finance.commissions).toEqual(renamed.finance.commissions);
    const tampered = structuredClone(renamed); tampered.finance.commissions!.records[0].items[0].amount++;
    expect(() => validateDatabase(tampered)).toThrow("Snapshot");
    expect(() => saveCommissionSeller(renamed, { ...seller, id: "other", name: "novo nome" })).toThrow("Já existe");
  });
  it("libera pelo principal líquido, exige quitação da primeira ou última parcela e reflete estornos", () => {
    const { data, invoiceId } = recorded();
    const original = data.finance.entries.find((item) => item.invoiceId === invoiceId)!;
    let split = validateDatabase({ ...data, finance: { ...data.finance, entries: [
      { ...original, id: "first", amount: 6000, dueOn: "2024-01-01" },
      { ...original, id: "last", amount: 8000, dueOn: "2024-02-01" },
    ] } });
    const record = split.finance.commissions!.records[0];
    const amountFor = (release: CommissionRule["release"]) =>
      commissionRelease(split, { ...record, rule: { ...record.rule, release } }).released;
    expect(amountFor("billing")).toBe(1400);
    expect(amountFor("first")).toBe(0);
    split = settleFinanceEntry(split, "first", { id: "first-half", date: localDay(), amount: 3000, accountId: bank.id });
    expect(amountFor("proportional")).toBe(300);
    expect(amountFor("first")).toBe(0);
    split = settleFinanceEntry(split, "first", { id: "first-rest", date: localDay(), amount: 3000, accountId: bank.id });
    expect(amountFor("first")).toBe(1400);
    expect(amountFor("last")).toBe(0);
    split = settleFinanceEntry(split, "last", { id: "last-paid", date: localDay(), amount: 8000, accountId: bank.id });
    expect(amountFor("last")).toBe(1400);
    split = reverseSettlement(split, "first", "first-half");
    expect(amountFor("proportional")).toBe(1100);
    expect(amountFor("first")).toBe(0);
    expect(amountFor("last")).toBe(0);
    split = reverseSettlement(split, "first", "first-rest");
    split = reverseSettlement(split, "last", "last-paid");
    split = cancelFinanceEntry(split, "first");
    expect(commissionRelease(split, record)).toMatchObject({ status: "Cancelada", released: 0, pending: 0 });
  });
  it("considera retenções sem transformá-las em recebimento", () => {
    let data = saveBankAccount(demoDatabase(), bank);
    data.orders[0].status = "Finalizada";
    data.orders[0].details = { ...getOrderDetails(data.orders[0]), items: [
      { id: "service", kind: "servico", referenceId: data.services[0].id, name: "Serviço", quantity: 1, price: 10000, discount: 0 },
    ], costs: [], discount: 0, travel: undefined };
    data = billOrders(data, [data.orders[0].id], { Serviços: terms });
    data = saveCommissionSeller(data, seller);
    const invoice = data.finance.invoices[0], entry = data.finance.entries[0];
    data = recordCommission(data, previewCommission(data, invoice.id, invoice.orders[0].orderId, seller.id), true);
    const retention = { calculationId: "a".repeat(64), invoiceAmount: 10000, withheld: 1000, net: 9000,
      irrf: 1000, inss: 0, csll: 0, confirmedAt: new Date().toISOString(), confirmedBy: "admin" };
    data = applyFinanceRetention(data, entry.id, retention, entry);
    const record = data.finance.commissions!.records[0];
    expect(commissionRelease(data, record)).toMatchObject({ collectible: 9000, received: 0, released: 0 });
    data = settleFinanceEntry(data, entry.id, { id: "net-paid", date: localDay(), amount: 4500, accountId: bank.id });
    expect(commissionRelease(data, record)).toMatchObject({ collectible: 9000, received: 4500, released: 500 });
  });
  it("bloqueia apuração sem itens congelados e explicita a limitação de faturamentos pela NF-e", () => {
    const { data: original, invoiceId, orderId } = billedSale();
    const data = saveCommissionSeller(original, seller);
    delete data.finance.invoices[0].orders[0].items;
    expect(() => previewCommission(data, invoiceId, orderId, seller.id)).toThrow(/sem itens congelados.*NF-e/);
    const html = renderToStaticMarkup(<FinancePanel data={data} initialTab="Comissões" commit={() => {}}
      onSuccess={() => {}} onOpenOrder={() => {}} />);
    expect(html).toContain("inclusive alguns gerados pela NF-e");
    expect(html).toContain("Sem itens comissionáveis congelados");
  });
  it("expõe regras, faturamentos e avisos sem fingir pagamento", () => {
    const { data } = recorded();
    const html = renderToStaticMarkup(<FinancePanel data={data} initialTab="Comissões" commit={() => {}}
      onSuccess={() => {}} onOpenOrder={() => {}} />);
    expect(html).toContain("não paga comissões");
    expect(html).toContain("Comissões apuradas");
    expect(html).toContain("Exportar comissões CSV");
    expect(html).toContain("Vendedor teste");
  });
});
