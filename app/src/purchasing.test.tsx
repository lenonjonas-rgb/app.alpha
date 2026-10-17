import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { availablePurchaseReturnItems, changeOrderStatus, createStockLocation, demoDatabase, getOrderDetails,
  localDay, orderMargin, stockLocationBalance, transferStock, validateDatabase } from "./domain";
import { saveBankAccount, cancelFinanceEntry, entryBalance, settleFinanceEntry, reverseSettlement, saveFinanceEntry } from "./finance";
import { saveFinanceInstallments } from "./financeInstallments";
import { classifyFinanceEntry, managementCsv, managementReport, saveFinanceCategory, saveCostCenter } from "./financeManagement";
import { cancelPurchaseOrder, previewPurchaseSchedule, purchaseTotal, purchasing, receivePurchaseOrder,
  returnPurchaseStock, savePurchaseOrder, saveSupplier } from "./purchasing";
import type { PurchaseOrder, Supplier } from "./financeSchema";
import { FinancePanel } from "./FinancePanel";
import { importStatement, matchBankSettlement } from "./bankReconciliation";

const supplier: Supplier = { id: "supplier", name: "Fornecedor", document: "11222333000181",
  phone: "11999999999", email: "compras@example.test", address: "Rua A, 10", active: true };
const order: PurchaseOrder = { id: "purchase", supplierId: supplier.id, supplierName: supplier.name, supplierDocument: supplier.document,
  description: "Compra de peças", orderedOn: "2026-01-01", createdAt: "2026-01-01T12:00:00Z",
  accountId: "bank", paymentMethod: "Pix", items: [{ description: "Peça", quantity: 1, unitCost: 10000 }],
  schedule: previewPurchaseSchedule(10000, 3, "2026-01-31"), categoryId: "category", costCenterId: "center" };
function fixture() {
  let data = saveBankAccount(demoDatabase(), { id: "bank", name: "Banco", bank: "Teste", agency: "", account: "", kind: "Corrente", active: true });
  data = saveFinanceCategory(data, { id: "category", name: "Compras", kind: "Pagar", active: true });
  data = saveCostCenter(data, { id: "center", name: "Operação", active: true });
  return saveSupplier(data, supplier);
}
function withProcurement(input: PurchaseOrder): PurchaseOrder {
  const quoteId = `${input.id}-quote`;
  return {
    ...input,
    procurement: {
      quotes: [{ id: quoteId, supplierId: input.supplierId, supplierName: input.supplierName,
        amount: purchaseTotal(input), quotedOn: input.orderedOn, reference: "Cotação registrada", terms: "" }],
      selectedQuoteId: quoteId,
      quoteExceptionReason: "Somente um fornecedor disponível para esta compra.",
      approval: { at: input.createdAt, approverUserId: "local-owner", approverName: "Operador local",
        approverRole: "local", reason: "Compra aprovada conforme necessidade operacional." },
    },
  };
}
function placed() { return savePurchaseOrder(fixture(), withProcurement(order), true); }
const receipt = { date: localDay(), reference: "NF informativa 123", notes: "Todos os itens conferidos" };
function received(data = placed(), expected = purchasing(data).orders[0]) { return receivePurchaseOrder(data, expected, receipt, true); }
const filter = { start: "2026-01-01", end: "2099-12-31", accountId: "", categoryId: "", costCenterId: "" };

describe("compras e fornecedores", () => {
  it("mantém compatibilidade, cadastro/pedido sem conta, previsão e documento fiscal até receber", () => {
    expect(validateDatabase(demoDatabase()).finance.purchasing).toBeUndefined();
    const data = placed();
    expect(data.finance.entries).toEqual([]);
    expect(data.finance.invoices).toEqual([]);
    expect(data.products).toEqual(demoDatabase().products);
    expect(managementReport(data, filter).movements).toEqual([]);
    expect(purchasing(data).orders[0]).toMatchObject(order);
  });
  it("vincula por código exato ou nome normalizado único e exige seleção quando o nome é ambíguo", () => {
    const data = fixture(), product = data.products[0];
    const coded = savePurchaseOrder(data, withProcurement({ ...order, id: "coded", schedule: previewPurchaseSchedule(100, 1, "2026-01-31"),
      items: [{ code: product.code.toLowerCase(), description: "Peça diferente", quantity: 1, unitCost: 100 }] }), true);
    expect(purchasing(coded).orders[0].items[0].productId).toBe(product.id);
    const named = savePurchaseOrder(data, withProcurement({ ...order, id: "named", schedule: previewPurchaseSchedule(100, 1, "2026-01-31"),
      items: [{ description: `  ${product.name.toLocaleUpperCase("pt-BR")}  `, quantity: 1, unitCost: 100 }] }), true);
    expect(purchasing(named).orders[0].items[0].productId).toBe(product.id);
    const ambiguous = { ...data, products: [...data.products, {
      ...product, id: "duplicate-product", code: "PC-0099", stock: 0,
    }] };
    expect(() => savePurchaseOrder(ambiguous, withProcurement({ ...order, schedule: previewPurchaseSchedule(100, 1, "2026-01-31"),
      items: [{ description: product.name, quantity: 1, unitCost: 100 }] }), true)).toThrow("ambíguo");
  });
  it("valida documentos, contatos e duplicidades e protege edição concorrente de fornecedor", () => {
    const data = fixture();
    for (const document of ["1", "00000000000", "11222333000182", "112223330001810"])
      expect(() => saveSupplier(data, { ...supplier, id: "other", document })).toThrow();
    expect(() => saveSupplier(data, { ...supplier, id: "other" })).toThrow("duplicados");
    expect(() => saveSupplier(data, { ...supplier, email: "inválido" }, supplier)).toThrow();
    expect(() => saveSupplier(data, supplier)).toThrow("alterado");
    const updated = saveSupplier(data, { ...supplier, name: "Novo nome", active: false }, supplier);
    expect(() => saveSupplier(updated, supplier, supplier)).toThrow("alterado");
    expect(() => saveSupplier(data, { ...supplier, id: "cpf", document: "52998224725" })).not.toThrow();
    expect(() => saveSupplier(data, { ...supplier, id: "alpha", document: "ABCDEF12345680" })).not.toThrow();
    expect(() => saveSupplier(data, { ...supplier, id: "blank", document: "" })).not.toThrow();
  });
  it("divide centavos e preserva calendário mensal com datas editáveis e pagamento único", () => {
    expect(order.schedule).toEqual([{ amount: 3334, dueOn: "2026-01-31" }, { amount: 3333, dueOn: "2026-02-28" }, { amount: 3333, dueOn: "2026-03-31" }]);
    expect(previewPurchaseSchedule(1, 1, "2028-02-29")).toEqual([{ amount: 1, dueOn: "2028-02-29" }]);
    expect(previewPurchaseSchedule(120, 120, "2026-01-31")).toHaveLength(120);
    for (const [amount, count] of [[0, 1], [100, 0], [100, 1.5], [100, 121], [2, 3], [100000001, 1]])
      expect(() => previewPurchaseSchedule(amount, count, "2026-01-31")).toThrow();
    expect(() => previewPurchaseSchedule(100, 1, "2026-02-30")).toThrow();
    const edited = { ...order, schedule: order.schedule.map((row, i) => i === 1 ? { ...row, dueOn: "2026-03-01" } : row) };
    expect(() => savePurchaseOrder(fixture(), withProcurement(edited), true)).not.toThrow();
  });
  it("exige confirmação e valida itens, limites, datas e fornecedor atual sem gravação parcial", () => {
    const data = fixture(), before = structuredClone(data);
    expect(() => savePurchaseOrder(data, order, false)).toThrow("Confirme");
    expect(() => savePurchaseOrder(data, order, true)).toThrow("cotações e a aprovação");
    const invalid: PurchaseOrder[] = [
      { ...order, supplierName: "Outro" }, { ...order, orderedOn: "2099-01-01" },
      { ...order, items: [] }, { ...order, items: [{ description: "Peça", quantity: 1.5, unitCost: 10000 }] },
      { ...order, items: [{ description: "Peça", quantity: 10000, unitCost: 100000000 }] },
      { ...order, schedule: [{ dueOn: "2026-01-01", amount: 9999 }] },
      { ...order, schedule: order.schedule.map((row) => ({ ...row, dueOn: "2026-01-31" })) },
      { ...order, schedule: order.schedule.map((row, i) => i === 0 ? { ...row, dueOn: "2025-12-31" } : row) },
      { ...order, receipt: { ...receipt, at: new Date().toISOString(), locationId: "location", entryIds: ["fake"] } },
    ];
    for (const input of invalid) expect(() => savePurchaseOrder(data, withProcurement(input), true)).toThrow();
    expect(() => savePurchaseOrder(placed(), withProcurement(order), true)).toThrow("novo pedido");
    expect(data).toEqual(before);
  });
  it("exige mapa de cotações, justificativa de exceção e aprovação coerente com a proposta", () => {
    const data = fixture();
    const approved = withProcurement({ ...order, id: "approved-purchase" });
    approved.procurement!.quotes[0].quotedOn = "2025-12-31";
    expect(() => savePurchaseOrder(data, approved, true)).not.toThrow();

    const noExceptionReason = structuredClone(approved);
    delete noExceptionReason.procurement!.quoteExceptionReason;
    expect(() => savePurchaseOrder(data, noExceptionReason, true)).toThrow();

    const wrongTotal = structuredClone(approved);
    wrongTotal.procurement!.quotes[0].amount += 1;
    expect(() => savePurchaseOrder(data, wrongTotal, true)).toThrow();

    const futureQuote = structuredClone(approved);
    futureQuote.procurement!.quotes[0].quotedOn = "2026-01-02";
    expect(() => savePurchaseOrder(data, futureQuote, true)).toThrow();

    const futureApproval = structuredClone(approved);
    futureApproval.procurement!.approval.at = "2099-01-01T00:00:00.000Z";
    expect(() => savePurchaseOrder(data, futureApproval, true)).toThrow();
  });
  it("recebe integralmente e gera somente parcelas exatas com vínculo e classificação, preservando histórico no backup", () => {
    const data = placed(), result = received(data), saved = purchasing(result).orders[0];
    expect(data.finance.entries).toEqual([]);
    expect(result.finance.entries.map((entry) => entry.amount)).toEqual([3334, 3333, 3333]);
    expect(result.finance.entries.every((entry) => entry.kind === "Pagar" && entry.purchaseId === order.id && !entry.settlements.length && !entry.invoiceId)).toBe(true);
    expect(result.finance.entries.map((entry) => entry.id)).toEqual(saved.receipt!.entryIds);
    expect(result.finance.entries.map((entry) => entry.installment?.number)).toEqual([1, 2, 3]);
    expect(result.finance.management!.classifications).toHaveLength(3);
    expect(result.finance.management!.classifications.every((item) => item.categoryId === "category" && item.costCenterId === "center")).toBe(true);
    expect(purchaseTotal(saved)).toBe(10000);
    expect(result.products).toHaveLength(data.products.length + 1);
    expect(result.products.at(-1)).toMatchObject({ name: "Peça", stock: 1, cost: 10000 });
    expect(saved.receipt!.stockItems).toEqual([{ lineId: saved.items[0].id, productId: result.products.at(-1)!.id }]);
    expect(saved.items[0].productId).toBeUndefined();
    expect(result.finance.invoices).toEqual([]);
    expect(validateDatabase(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(managementReport(result, filter).totals).toMatchObject({ paid: 0, expectedPayments: 10000 });
    expect(managementCsv(result, managementReport(result, filter))).toContain("Compra purchase");
  });
  it("registra entregas parciais e finaliza por conclusão ou cancelamento pelo valor recebido", () => {
    const data = fixture();
    const product = data.products[0];
    const partialOrder = {
      ...order,
      id: "partial-purchase",
      items: [{ description: product.name, productId: product.id, code: product.code, quantity: 3, unitCost: 12000 }],
      schedule: previewPurchaseSchedule(36000, 3, "2026-01-31"),
    };
    const saved = savePurchaseOrder(data, withProcurement(partialOrder), true);
    const savedOrder = purchasing(saved).orders[0], lineId = savedOrder.items[0].id!;
    const partial = receivePurchaseOrder(saved, savedOrder, {
      ...receipt, quantities: { [lineId]: 1 },
    }, true);
    expect(partial.finance.entries).toEqual([]);
    expect(partial.finance.purchasing!.orders[0].receipt).toBeUndefined();
    expect(partial.inventory!.purchaseReceipts).toHaveLength(1);
    expect(partial.inventory!.purchaseReceipts[0].items).toEqual([{ lineId, productId: product.id, quantity: 1 }]);
    expect(partial.movements[0].source).toMatchObject({ type: "purchase", referenceId: savedOrder.id });
    expect(partial.movements[0].unitCost).toBe(12000);
    expect(partial.products.find((item) => item.id === product.id)!.stock).toBe(product.stock + 1);
    const canceledPartial = cancelPurchaseOrder(partial, purchasing(partial).orders[0], "Fornecedor cancelou o saldo", true);
    const canceledOrder = purchasing(canceledPartial).orders[0];
    expect(canceledOrder.cancellation).toMatchObject({ receivedAmount: 12000, payableEntryIds: expect.any(Array) });
    expect(canceledPartial.finance.entries.map((entry) => entry.amount)).toEqual([4000, 4000, 4000]);
    expect(canceledPartial.finance.entries.every((entry) => entry.purchaseId === canceledOrder.id && !entry.installment)).toBe(true);
    expect(canceledPartial.inventory!.purchaseReceipts).toEqual(partial.inventory!.purchaseReceipts);
    expect(canceledPartial.movements).toEqual(partial.movements);
    expect(validateDatabase(JSON.parse(JSON.stringify(canceledPartial)))).toEqual(canceledPartial);
    const tamperedCancellation = structuredClone(canceledPartial);
    const cancellation = tamperedCancellation.finance.purchasing!.orders[0].cancellation!;
    cancellation.receivedAmount = (cancellation.receivedAmount ?? 0) + 1;
    expect(() => validateDatabase(tamperedCancellation)).toThrow("rateio aprovado no cancelamento");
    const returnableAfterCancel = availablePurchaseReturnItems(
      canceledPartial, canceledOrder.id, canceledPartial.inventory!.defaultLocationId)[0];
    const returnedAfterCancel = returnPurchaseStock(canceledPartial, canceledOrder.id,
      canceledPartial.inventory!.defaultLocationId, { [returnableAfterCancel.lineId]: 1 },
      { date: localDay(), reference: "DEV-CANCEL", reason: "Fornecedor aceitou a peça." }, true);
    expect(returnedAfterCancel.inventory!.purchaseReturns[0].financial?.payableOffsets)
      .toHaveLength(canceledOrder.cancellation!.payableEntryIds!.length);
    expect(returnedAfterCancel.finance.entries.filter((entry) => entry.purchaseId === canceledOrder.id)
      .every((entry) => entryBalance(entry) === 0)).toBe(true);
    expect(() => receivePurchaseOrder(canceledPartial, canceledOrder, {
      ...receipt, quantities: { [lineId]: 1 },
    }, true)).toThrow("recebido ou cancelado");

    const nextOrder = purchasing(partial).orders[0];
    expect(() => receivePurchaseOrder(partial, nextOrder, {
      ...receipt, quantities: { [lineId]: 3 },
    }, true)).toThrow("pendente: 2");
    const completed = receivePurchaseOrder(partial, nextOrder, {
      ...receipt, quantities: { [lineId]: 2 },
    }, true);
    const completedOrder = purchasing(completed).orders[0];
    expect(completed.inventory!.purchaseReceipts).toHaveLength(2);
    expect(completed.products.find((item) => item.id === product.id)!.stock).toBe(product.stock + 3);
    expect(completed.finance.entries.map((entry) => entry.amount)).toEqual([12000, 12000, 12000]);
    expect(completed.finance.entries.map((entry) => entry.id)).toEqual(completedOrder.receipt!.entryIds);
    expect(completedOrder.receipt!.stockItems).toEqual([{ lineId, productId: product.id }]);
    expect(validateDatabase(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
    const altered = structuredClone(partial);
    altered.inventory!.purchaseReceipts[0].items[0].quantity = 2;
    expect(() => validateDatabase(altered)).toThrow("item recebido");
    const tooEarly = structuredClone(partial);
    tooEarly.finance.purchasing!.orders[0].receipt = {
      at: new Date().toISOString(), date: localDay(), locationId: data.inventory!.defaultLocationId,
      reference: "", notes: "Recebimento forçado", entryIds: ["fake"], stockItems: [{ lineId, productId: product.id }],
    };
    expect(() => validateDatabase(tooEarly)).toThrow();
  });
  it("devolve estoque recebido sem alterar contas, limita ao disponível e preserva o custo médio", () => {
    const data = fixture(), product = data.products[0];
    const purchaseOrder = {
      ...order,
      id: "returnable-purchase",
      description: "Compra para devolução",
      items: [{ description: product.name, productId: product.id, code: product.code, quantity: 2, unitCost: 12000 }],
      schedule: previewPurchaseSchedule(24000, 1, "2026-01-31"),
    };
    const receivedData = received(savePurchaseOrder(data, withProcurement(purchaseOrder), true));
    const orderRecord = purchasing(receivedData).orders[0];
    const locationId = receivedData.inventory!.defaultLocationId;
    const returnable = availablePurchaseReturnItems(receivedData, orderRecord.id, locationId)[0];
    expect(returnable).toMatchObject({ receivedQuantity: 2, returnedQuantity: 0, returnableQuantity: 2 });
    const financeBefore = structuredClone(receivedData.finance);
    const costBefore = receivedData.products.find((item) => item.id === product.id)!.cost;
    const returned = returnPurchaseStock(receivedData, orderRecord.id, locationId,
      { [returnable.lineId]: 1 }, { date: localDay(), reference: "DEV-123", reason: "Peça não utilizada." }, true);
    expect(returned.finance.entries[0].purchaseReturnOffsets).toEqual([
      { returnId: returned.inventory!.purchaseReturns[0].id, amount: 12000 },
    ]);
    expect(entryBalance(returned.finance.entries.find((entry) => entry.purchaseId === orderRecord.id)!)).toBe(12000);
    expect(returned.finance.entries.filter((entry) => entry.purchaseReturnCreditId)).toHaveLength(0);
    expect(returned.finance.accounts).toEqual(financeBefore.accounts);
    expect(returned.products.find((item) => item.id === product.id)?.stock).toBe(product.stock + 1);
    expect(returned.products.find((item) => item.id === product.id)?.cost).toBe(costBefore);
    expect(returned.movements[0]).toMatchObject({
      delta: -1, unitCost: costBefore, averageCostBefore: costBefore, averageCostAfter: costBefore,
      source: { type: "purchaseReturn", referenceId: returned.inventory!.purchaseReturns[0].id },
    });
    expect(availablePurchaseReturnItems(returned, orderRecord.id, locationId)[0].returnableQuantity).toBe(1);
    const partlyPaid = settleFinanceEntry(returned, orderRecord.receipt!.entryIds[0], {
      id: "paid-before-next-return", date: localDay(), amount: 10000, accountId: "bank",
    });
    const fullyReturned = returnPurchaseStock(partlyPaid, orderRecord.id, locationId,
      { [returnable.lineId]: 1 }, { date: localDay(), reference: "DEV-124", reason: "Saldo devolvido." }, true);
    const payable = fullyReturned.finance.entries.find((entry) => entry.purchaseId === orderRecord.id)!;
    const supplierCredit = fullyReturned.finance.entries.find((entry) => entry.purchaseReturnCreditId)!;
    expect(entryBalance(payable)).toBe(0);
    expect(payable.purchaseReturnOffsets?.reduce((sum, offset) => sum + offset.amount, 0)).toBe(14000);
    expect(supplierCredit).toMatchObject({
      kind: "Receber", party: supplier.name, amount: 10000, purchaseReturnCreditId: fullyReturned.inventory!.purchaseReturns.at(-1)!.id,
    });
    expect(entryBalance(supplierCredit)).toBe(10000);
    expect(fullyReturned.finance.entries.find((entry) => entry.id === payable.id)?.settlements).toHaveLength(1);
    expect(fullyReturned.finance.entries.find((entry) => entry.id === payable.id)?.settlements).toEqual(
      partlyPaid.finance.entries.find((entry) => entry.id === payable.id)?.settlements);
    expect(() => returnPurchaseStock(returned, orderRecord.id, locationId,
      { [returnable.lineId]: 1 }, { date: localDay(), reference: "", reason: "Sem estoque livre." }, false))
      .toThrow("Confirme");
    const reservedOrder = receivedData.orders[0];
    reservedOrder.details = { ...getOrderDetails(reservedOrder), items: [{
      id: "reserve-return-line", kind: "produto", referenceId: product.id, name: product.name,
      quantity: 10, price: 1000, discount: 0,
    }] };
    const reservedData = changeOrderStatus(validateDatabase(receivedData), reservedOrder.id, "Em atendimento");
    const reservedReturnable = availablePurchaseReturnItems(receivedData, orderRecord.id, locationId)[0];
    expect(() => returnPurchaseStock(reservedData, orderRecord.id, locationId,
      { [reservedReturnable.lineId]: 1 },
      { date: localDay(), reference: "", reason: "Estoque reservado." }, true)).toThrow("disponível");
    const secondLocationData = createStockLocation(receivedData, "Depósito secundário");
    const secondLocationId = secondLocationData.inventory!.locations.at(-1)!.id;
    const transferredData = transferStock(secondLocationData, product.id, locationId, secondLocationId, 1, "Teste de localidade");
    const crossLocationReturn = structuredClone(returned);
    crossLocationReturn.inventory!.locations = transferredData.inventory!.locations;
    crossLocationReturn.inventory!.purchaseReturns[0].items[0].locationId = secondLocationId;
    const returnMovement = crossLocationReturn.movements.find((item) => item.source?.type === "purchaseReturn")!;
    returnMovement.locationId = secondLocationId;
    returnMovement.balance = stockLocationBalance(transferredData, product.id, secondLocationId) - 1;
    crossLocationReturn.movements = [returnMovement, ...transferredData.movements];
    expect(() => validateDatabase(crossLocationReturn)).toThrow();
    const altered = structuredClone(returned);
    altered.inventory!.purchaseReturns[0].items[0].quantity = 3;
    const alteredMovement = altered.movements.find((item) => item.source?.type === "purchaseReturn")!;
    alteredMovement.delta = -3;
    alteredMovement.balance -= 2;
    altered.products.find((item) => item.id === product.id)!.stock -= 2;
    expect(() => validateDatabase(altered)).toThrow();
    const backdated = structuredClone(returned);
    backdated.inventory!.purchaseReturns[0].date = "1900-01-01";
    expect(() => validateDatabase(backdated)).toThrow("Devolução de compra");
  });
  it("calcula custo médio móvel e mantém a margem da OS pelo custo no momento do consumo", () => {
    const data = fixture(), product = data.products[0];
    const purchase = {
      ...order,
      id: "weighted-purchase",
      description: "Reposição de correias",
      items: [{ description: product.name, productId: product.id, code: product.code, quantity: 2, unitCost: 12000 }],
      schedule: previewPurchaseSchedule(24000, 1, "2026-01-31"),
    };
    const placedPurchase = savePurchaseOrder(data, withProcurement(purchase), true);
    const receivedPurchase = receivePurchaseOrder(placedPurchase, purchasing(placedPurchase).orders[0], receipt, true);
    expect(receivedPurchase.products[0]).toMatchObject({ stock: 10, cost: 10000 });
    expect(receivedPurchase.movements[0]).toMatchObject({
      unitCost: 12000, averageCostBefore: 9500, averageCostAfter: 10000,
    });

    const orderRecord = receivedPurchase.orders[0];
    orderRecord.details = {
      ...getOrderDetails(orderRecord),
      items: [{ id: "sold-line", kind: "produto", referenceId: product.id,
        name: product.name, quantity: 2, price: 15000, discount: 0 }],
    };
    const started = changeOrderStatus(validateDatabase(receivedPurchase), orderRecord.id, "Em atendimento");
    const finished = changeOrderStatus(started, orderRecord.id, "Finalizada");
    const consumption = finished.movements.find((item) => item.source?.type === "consumption")!;
    expect(consumption).toMatchObject({ unitCost: 10000, averageCostBefore: 10000, averageCostAfter: 10000 });
    const originalMargin = orderMargin(finished, finished.orders.find((item) => item.id === orderRecord.id)!);
    expect(originalMargin).toMatchObject({ cost: 20000, margin: 10000 });
    expect(originalMargin?.percentage).toBeCloseTo(100 / 3);

    const replenishment = {
      ...purchase,
      id: "weighted-replenishment",
      items: [{ description: product.name, productId: product.id, code: product.code, quantity: 10, unitCost: 20000 }],
      schedule: previewPurchaseSchedule(200000, 1, "2026-01-31"),
    };
    const placedAgain = savePurchaseOrder(finished, withProcurement(replenishment), true);
    const receivedAgain = receivePurchaseOrder(placedAgain, purchasing(placedAgain).orders.at(-1)!, receipt, true);
    expect(receivedAgain.products[0].cost).toBe(15556);
    expect(orderMargin(receivedAgain, receivedAgain.orders.find((item) => item.id === orderRecord.id)!))
      .toMatchObject({ cost: 20000, margin: 10000 });
  });
  it("recebe pagamento único de um centavo e limite monetário sem parcela artificial", () => {
    for (const amount of [1, 100000000]) {
      const single = { ...order, items: [{ description: "Único", quantity: 1, unitCost: amount }], schedule: previewPurchaseSchedule(amount, 1, "2026-01-31") };
      const data = received(savePurchaseOrder(fixture(), withProcurement(single), true));
      expect(data.finance.entries).toHaveLength(1);
      expect(data.finance.entries[0].amount).toBe(amount);
      expect(data.finance.entries[0].installment).toBeUndefined();
    }
  });
  it("não recebe/cancela duas vezes, nem após cancelamento de contas, e recusa snapshot obsoleto", () => {
    let data = received();
    expect(() => received(data)).toThrow("recebido ou cancelado");
    const saved = purchasing(data).orders[0];
    expect(() => received(data, saved)).toThrow("recebido ou cancelado");
    expect(() => cancelPurchaseOrder(data, saved, "Compra recebida", true)).toThrow("recebido ou cancelado");
    data = cancelFinanceEntry(data, data.finance.entries[0].id);
    expect(() => received(data, saved)).toThrow("recebido ou cancelado");
    expect(data.finance.entries).toHaveLength(3);
    expect(() => receivePurchaseOrder(placed(), order, receipt, false)).toThrow("Confirme");
    for (const input of [{ ...receipt, date: "2025-12-31" }, { ...receipt, date: "2099-01-01" }, { ...receipt, notes: "" }])
      expect(() => receivePurchaseOrder(placed(), order, input, true)).toThrow();
    expect(() => received(placed(), { ...order, description: "Alterado" })).toThrow("alterado");
  });
  it("cancela somente pedido aberto com motivo, sem efeitos financeiros e cancelamento definitivo", () => {
    const source = placed(), data = cancelPurchaseOrder(source, purchasing(source).orders[0], "Fornecedor não entregou", true);
    expect(data.finance.entries).toEqual([]);
    expect(purchasing(data).orders[0].cancellation?.reason).toBe("Fornecedor não entregou");
    expect(() => received(data, purchasing(data).orders[0])).toThrow("recebido ou cancelado");
    expect(() => cancelPurchaseOrder(placed(), order, "", true)).toThrow();
    expect(() => cancelPurchaseOrder(placed(), order, "Não entregue", false)).toThrow("Confirme");
  });
  it("rateia por centavos o valor parcialmente recebido e preserva o cronograma aprovado", () => {
    const data = fixture(), item = data.products[0];
    const partialOrder = {
      ...order, id: "partial-cancel-rounding",
      items: [{ description: item.name, productId: item.id, quantity: 10, unitCost: 100 }],
      schedule: previewPurchaseSchedule(1000, 3, "2026-01-31"),
    };
    const saved = savePurchaseOrder(data, withProcurement(partialOrder), true), savedOrder = purchasing(saved).orders[0];
    const partial = receivePurchaseOrder(saved, savedOrder, {
      ...receipt, quantities: { [savedOrder.items[0].id!]: 2 },
    }, true);
    const canceled = cancelPurchaseOrder(partial, purchasing(partial).orders[0], "Saldo indisponível", true);
    expect(canceled.finance.entries.map((entry) => [entry.amount, entry.dueOn])).toEqual([
      [67, "2026-01-31"], [67, "2026-02-28"], [66, "2026-03-31"],
    ]);
    expect(canceled.finance.entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(200);
  });
  it("preserva snapshot do fornecedor e histórico mesmo inativado; bloqueia novas operações inativas", () => {
    let data = saveSupplier(placed(), { ...supplier, name: "Nome atualizado" }, supplier);
    expect(purchasing(data).orders[0].supplierName).toBe(supplier.name);
    data = received(data);
    expect(data.finance.entries[0].party).toBe(supplier.name);
    for (const dimension of ["supplier", "bank", "category", "center"]) {
      const inactive = placed();
      if (dimension === "supplier") inactive.finance.purchasing!.suppliers[0].active = false;
      if (dimension === "bank") inactive.finance.accounts[0].active = false;
      if (dimension === "category") inactive.finance.management!.categories[0].active = false;
      if (dimension === "center") inactive.finance.management!.costCenters[0].active = false;
      expect(() => validateDatabase(inactive)).not.toThrow();
      expect(() => received(inactive)).toThrow("ativos");
      expect(() => savePurchaseOrder(inactive, withProcurement({ ...order, id: "new" }), true)).toThrow("ativos");
      expect(() => cancelPurchaseOrder(inactive, purchasing(inactive).orders[0], "Referência inativa", true)).not.toThrow();
    }
  });
  it("rejeita referências, vínculos incompletos ou misturados, parcelas alteradas e contas antes do recebimento", () => {
    const valid = received();
    const corruptions = [
      (data: typeof valid) => { delete data.finance.purchasing; },
      (data: typeof valid) => { delete data.finance.purchasing!.orders[0].receipt; },
      (data: typeof valid) => { data.finance.entries.pop(); },
      (data: typeof valid) => { data.finance.entries[0].purchaseId = "unknown"; },
      (data: typeof valid) => { data.finance.entries[0].kind = "Receber"; },
      (data: typeof valid) => { data.finance.entries[0].accountId = "unknown"; },
      (data: typeof valid) => { data.finance.entries[0].dueOn = "2026-02-01"; },
      (data: typeof valid) => { data.finance.entries[0].recurrence = { id: "unknown", period: "2026-01" }; },
      (data: typeof valid) => { data.finance.purchasing!.orders[0].receipt!.entryIds[1] = data.finance.entries[0].id; },
      (data: typeof valid) => { data.finance.purchasing!.orders[0].cancellation = { at: new Date().toISOString(), reason: "Cancelado" }; },
    ];
    for (const mutate of corruptions) { const data = structuredClone(valid); mutate(data); expect(() => validateDatabase(data)).toThrow(); }
    expect(() => saveFinanceEntry(fixture(), valid.finance.entries[0])).toThrow();
    expect(() => saveFinanceInstallments(fixture(), valid.finance.entries[0], ["2026-01-31", "2026-02-28"], true)).toThrow();
  });
  it("baixas, ajustes, estornos, reclassificação e conciliação usam contas recebidas sem duplicar compra", () => {
    let data = received();
    const id = data.finance.entries[0].id;
    data = classifyFinanceEntry(data, { entryId: id });
    data = settleFinanceEntry(data, id, { id: "settlement", date: localDay(), amount: 1000, accountId: "bank",
      adjustment: { interest: 0, fine: 0, discount: 100, reason: "Desconto negociado", confirmedAt: new Date().toISOString() } }, true);
    expect(entryBalance(data.finance.entries[0])).toBe(2334);
    expect(managementReport(data, filter).totals).toMatchObject({ paid: 900, expectedPayments: 9000 });
    data = importStatement(data, "bank", { format: "CSV", bank: "", account: "",
      lines: [{ externalId: "movement", date: localDay(), amount: -900, description: "Pagamento" }] }, "teste.csv", true);
    data = matchBankSettlement(data, data.finance.banking!.transactions[0].id, id, "settlement");
    expect(data.finance.banking!.matches).toHaveLength(1);
    data = reverseSettlement(data, id, "settlement");
    expect(entryBalance(data.finance.entries[0])).toBe(3334);
    expect(purchasing(data).orders).toHaveLength(1);
  });
  it("expõe aba, ações, limites e vínculo nos títulos pela interface existente", () => {
    const data = received();
    const html = renderToStaticMarkup(<FinancePanel data={data} commit={() => {}} onSuccess={() => {}} onOpenOrder={() => {}} initialTab="Compras e fornecedores" />);
    for (const text of ["Novo fornecedor", "Novo pedido de compra", "Recebido", "Itens, parcelas e histórico", "Pendente:", "entrega",
      "Devolver ao fornecedor", "abate contas a pagar em aberto"])
      expect(html).toContain(text);
    const accounts = renderToStaticMarkup(<FinancePanel data={data} commit={() => {}} onSuccess={() => {}} onOpenOrder={() => {}} initialTab="Contas a pagar" />);
    expect(accounts).toContain("Pedido de compra: ");
    expect(accounts).toContain("purchase");
  });
});
