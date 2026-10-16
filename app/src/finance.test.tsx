import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, getOrderDetails, localDay, orderValues, validateDatabase } from "./domain";
import { applyFinanceRetention, clearFinanceRetention, billOrders, billingItemSnapshots, cancelFinanceEntry, entryBalance, entryStatus, pendingBillingOrders, pendingBillingValues, previewBilling, reverseSettlement, saveBankAccount, saveFinanceEntry, settleFinanceEntry, splitBillingValues } from "./finance";
import { FinancePanel } from "./FinancePanel";
import { FiscalInvoiceCalculation } from "./FiscalInvoiceCalculation";
import type { FinanceEntry } from "./financeSchema";
import { fiscalRetentionSchema } from "./fiscalRetentions";

const bank = { id: "bank", name: "Conta principal", bank: "Banco teste", agency: "1234", account: "9999-0", kind: "Corrente" as const, active: true };
const terms = { accountId: bank.id, dueOn: "2026-11-20", paymentMethod: "Pix" as const };
const options = { "Serviços": terms };
function fixture(chargeTravel = true) {
  const data = saveBankAccount(demoDatabase(), bank);
  const order = data.orders[0];
  order.status = "Finalizada";
  order.details = { ...getOrderDetails(order), archived: false, items: [], costs: [], discount: 10, discountMode: "%",
    travel: { route: { provider: "Google Maps", calculatedAt: "2026-10-15T12:00:00Z", origin: { address: "Origem" }, destination: { address: "Destino" },
      outboundMeters: 30000, returnMeters: 40000 }, chargeTravel, fuelPrice: 600, kilometersPerLiter: 10, kilometerRate: 250, tolls: 2000 },
  };
  return data;
}
const manual = (kind: FinanceEntry["kind"]): FinanceEntry => ({
  id: "manual", kind, party: "Fornecedor", description: "Peças", amount: 10001, issuedOn: localDay(), ...terms, canceled: false, settlements: [],
});

describe("conciliação de retenções", () => {
  function retained() {
    const source = fixture();
    const data = billOrders(source, [source.orders[0].id], options);
    const entry = data.finance.entries[0];
    const retention = { calculationId: "a".repeat(64), invoiceAmount: entry.amount, withheld: 1755, net: entry.amount - 1755,
      irrf: 263, inss: 1316, csll: 176, confirmedAt: "2026-10-15T12:00:00Z", confirmedBy: "admin" };
    return { data, entry, retention };
  }
  it("preserva OS, faturamento, bruto e banco e persiste líquido/retido sem baixa na nuvem/backup", () => {
    const { data, entry, retention } = retained();
    const updated = applyFinanceRetention(data, entry.id, retention, entry);
    expect(updated.orders).toEqual(data.orders);
    expect(updated.finance.invoices).toEqual(data.finance.invoices);
    expect(updated.finance.entries[0].amount).toBe(17550);
    expect(entryBalance(updated.finance.entries[0])).toBe(15795);
    expect(updated.finance.entries[0].settlements).toEqual([]);
    expect(entryStatus(updated.finance.entries[0], "2026-10-15")).toBe("Em aberto");
    expect(validateDatabase(JSON.parse(JSON.stringify(updated))).finance.entries[0].retention).toEqual(retention);
    expect(data.finance.entries[0].retention).toBeUndefined();
    const reapplied = applyFinanceRetention(updated, entry.id, retention, updated.finance.entries[0]);
    expect(entryBalance(reapplied.finance.entries[0])).toBe(15795);
  });
  it("oferece remoção explícita com confirmação obrigatória para corrigir os parâmetros", () => {
    const { data, entry, retention } = retained();
    const updated = applyFinanceRetention(data, entry.id, retention, entry);
    const html = renderToStaticMarkup(<FiscalInvoiceCalculation data={updated} catalog={[]} calculations={[]} busy={false}
      commit={() => {}} act={async () => {}} />);
    expect(html).toContain("Remover conciliação para corrigir parâmetros");
    expect(html).toContain("sem apagar a memória fiscal");
    expect(html).toContain("documento fiscal ativo");
    expect(html).toContain('type="checkbox" required=""');
    expect(html).toContain(entry.id);
  });
  it("limita baixas ao líquido e não reconhece retenção como dinheiro recebido", () => {
    const { data, entry, retention } = retained();
    const updated = applyFinanceRetention(data, entry.id, retention, entry);
    expect(() => settleFinanceEntry(updated, entry.id, { id: "bad", date: localDay(), amount: entry.amount, accountId: bank.id })).toThrow("excede o saldo");
    const settled = settleFinanceEntry(updated, entry.id, { id: "net", date: localDay(), amount: retention.net, accountId: bank.id });
    expect(entryBalance(settled.finance.entries[0])).toBe(0);
    expect(entryStatus(settled.finance.entries[0])).toBe("Recebida");
    expect(settled.finance.entries[0].settlements[0].amount).toBe(15795);
    const reversed = reverseSettlement(settled, entry.id, "net");
    expect(entryBalance(reversed.finance.entries[0])).toBe(15795);
    expect(() => applyFinanceRetention(settled, entry.id, retention, settled.finance.entries[0])).toThrow("Estorne");
    expect(() => clearFinanceRetention(settled, entry.id, retention.calculationId, settled.finance.entries[0])).toThrow("Estorne");
    const cleared = clearFinanceRetention(reversed, entry.id, retention.calculationId, reversed.finance.entries[0]);
    expect(entryBalance(cleared.finance.entries[0])).toBe(17550);
    expect(cleared.finance.entries[0]).not.toHaveProperty("retention");
    expect(cleared.finance.entries[0].settlements[0].reversed).toBe(true);
    expect(cleared.finance.invoices).toEqual(data.finance.invoices);
    expect(() => clearFinanceRetention(reversed, entry.id, "b".repeat(64), reversed.finance.entries[0])).toThrow("alterada");
  });
  it("recusa alterações concorrentes, origem incompatível e corrupção dos valores", () => {
    const { data, entry, retention } = retained();
    const changed = structuredClone(data); changed.finance.entries[0].dueOn = "2026-12-01";
    expect(() => applyFinanceRetention(changed, entry.id, retention, entry)).toThrow("alterada");
    for (const update of [{ withheld: 1756 }, { net: 0 }, { csll: 100 }, { calculationId: "not-a-hash" }])
      expect(() => fiscalRetentionSchema.parse({ ...retention, ...update })).toThrow();
    const wrong = structuredClone(data); wrong.finance.invoices[0].kind = "Produtos";
    expect(() => applyFinanceRetention(wrong, entry.id, retention, entry)).toThrow();
    expect(() => saveFinanceEntry(data, { ...manual("Receber"), retention })).toThrow();
    const excessive = applyFinanceRetention(data, entry.id, retention, entry);
    excessive.finance.entries[0].settlements.push({ id: "excess", date: localDay(), amount: entry.amount, accountId: bank.id, reversed: false });
    expect(() => validateDatabase(excessive)).toThrow("baixas inválidas");
  });
});

describe("financeiro", () => {
  it("abre base antiga sem financeiro e preserva o módulo no backup", () => {
    const data = fixture();
    const { finance: _finance, ...old } = data;
    expect(validateDatabase(old).finance).toEqual({ accounts: [], entries: [], invoices: [] });
    const billed = billOrders(data, [data.orders[0].id], options);
    expect(validateDatabase(JSON.parse(JSON.stringify(billed))).finance).toEqual(billed.finance);
  });
  it("somente OS finalizadas não arquivadas e não faturadas entram em A faturar", () => {
    const data = fixture();
    expect(pendingBillingOrders(data).some((item) => item.id === data.orders[0].id)).toBe(true);
    data.orders[0].status = "Em atendimento";
    expect(pendingBillingOrders(data).some((item) => item.id === data.orders[0].id)).toBe(false);
    data.orders[0].status = "Finalizada";
    data.orders[0].details!.archived = true;
    expect(pendingBillingOrders(data).some((item) => item.id === data.orders[0].id)).toBe(false);
  });
  it.each([true, false])("fatura exatamente o valor da OS, sem incluir custo interno (cobrar=%s)", (chargeTravel) => {
    const data = fixture(chargeTravel);
    if (!chargeTravel) { data.orders[0].details!.discountMode = "R$"; data.orders[0].details!.discount = 0; data.orders[0].details!.costs = [{ id: "extra", name: "Serviço adicional", value: 3000 }]; }
    const order = data.orders[0];
    const billed = billOrders(data, [order.id], options);
    const expected = chargeTravel ? 17550 : 3000;
    expect(orderValues(getOrderDetails(order)).total).toBe(expected);
    expect(billed.finance.entries[0].amount).toBe(expected);
    expect(billed.finance.invoices[0].orders[0].amount).toBe(expected);
    expect(pendingBillingOrders(billed).some((item) => item.id === order.id)).toBe(false);
    expect(() => billOrders(billed, [order.id], options)).toThrow("não está mais disponível");
  });
  it("agrupa OS do mesmo cliente e preserva os valores faturados quando a OS muda", () => {
    const data = fixture();
    const second = { ...structuredClone(data.orders[0]), id: "second", code: "OS-10000" };
    data.orders.push(second);
    const billed = billOrders(data, [data.orders[0].id, second.id], options);
    expect(billed.finance.invoices).toHaveLength(1);
    expect(billed.finance.entries).toHaveLength(1);
    expect(billed.finance.entries[0].amount).toBe(35100);
    billed.orders[0].details!.travel!.tolls = 5000;
    expect(validateDatabase(billed).finance.entries[0].amount).toBe(35100);
  });
  it("bloqueia clientes misturados, seleção duplicada, OS ausente, total zero e pedágio pendente", () => {
    const data = fixture();
    const order = data.orders[0];
    expect(() => billOrders(data, [], options)).toThrow("Selecione");
    expect(() => billOrders(data, [order.id, order.id], options)).toThrow("Selecione");
    expect(() => billOrders(data, ["missing"], options)).toThrow("disponível");
    data.orders.push({ ...structuredClone(order), id: "other-client", code: "OS-999", clientId: data.clients.find((item) => item.id !== order.clientId)!.id });
    expect(() => billOrders(data, [order.id, "other-client"], options)).toThrow("mesmo cliente");
    order.details!.travel!.tollsConfirmed = false;
    expect(() => billOrders(data, [order.id], options)).toThrow("pedágios pendentes");
    order.details!.travel = undefined;
    order.details!.discount = 0;
    expect(() => billOrders(data, [order.id], options)).toThrow("maior que zero");
  });
  it("exige banco ativo e permite editar e inativar sem excluir referências", () => {
    const data = fixture();
    expect(() => billOrders(data, [data.orders[0].id], { "Serviços": { ...terms, accountId: "absent" } })).toThrow("ativa");
    const inactive = saveBankAccount(data, { ...bank, active: false });
    expect(() => saveFinanceEntry(inactive, manual("Pagar"))).toThrow("ativa");
    expect(() => saveBankAccount(data, { ...bank, id: "duplicate" })).toThrow("Já existe");
    const billed = billOrders(data, [data.orders[0].id], options);
    expect(saveBankAccount(billed, { ...bank, active: false }).finance.entries).toEqual(billed.finance.entries);
  });
  it.each(["Receber", "Pagar"] as const)("controla baixas parciais, total, estorno e cancelamento (%s)", (kind) => {
    let data = saveFinanceEntry(fixture(), manual(kind));
    const payment = { id: "payment", date: localDay(), amount: 3000, accountId: bank.id };
    data = settleFinanceEntry(data, "manual", payment);
    expect(entryBalance(data.finance.entries[0])).toBe(7001);
    expect(entryStatus(data.finance.entries[0], "2026-01-01")).toBe("Parcial");
    expect(entryStatus(data.finance.entries[0], "2099-01-01")).toBe("Atrasada");
    expect(() => cancelFinanceEntry(data, "manual")).toThrow("Estorne");
    expect(() => settleFinanceEntry(data, "manual", { ...payment, id: "over", amount: 7002 })).toThrow("excede");
    expect(() => settleFinanceEntry(data, "manual", { ...payment, id: "future", date: "2099-01-01" })).toThrow("futuro");
    expect(() => settleFinanceEntry(data, "manual", { ...payment, amount: -1 })).toThrow();
    data = settleFinanceEntry(data, "manual", { ...payment, id: "rest", amount: 7001 });
    expect(entryStatus(data.finance.entries[0])).toBe(kind === "Receber" ? "Recebida" : "Paga");
    expect(entryBalance(data.finance.entries[0])).toBe(0);
    data = reverseSettlement(data, "manual", "rest");
    data = reverseSettlement(data, "manual", "payment");
    expect(data.finance.entries[0].settlements).toHaveLength(2);
    expect(data.finance.entries[0].settlements.every((item) => item.reversed)).toBe(true);
    expect(() => reverseSettlement(data, "manual", "payment")).toThrow("indisponível");
    data = cancelFinanceEntry(data, "manual");
    expect(entryStatus(data.finance.entries[0])).toBe("Cancelada");
    expect(() => settleFinanceEntry(data, "manual", payment)).toThrow("indisponível");
  });
  it("cancelar faturamento sem baixa libera as OS e preserva o histórico cancelado", () => {
    const data = fixture();
    const billed = billOrders(data, [data.orders[0].id], options);
    const canceled = cancelFinanceEntry(billed, billed.finance.entries[0].id);
    expect(canceled.finance.invoices[0].canceled).toBe(true);
    expect(pendingBillingOrders(canceled).map((item) => item.id)).toContain(data.orders[0].id);
    expect(billOrders(canceled, [data.orders[0].id], options).finance.invoices).toHaveLength(2);
  });
  it("não cancela conta ou grupo alterados enquanto o backend verifica os vínculos", () => {
    const source = fixture();
    const billed = billOrders(source, [source.orders[0].id], options);
    const entry = billed.finance.entries[0], invoice = billed.finance.invoices[0];
    const changed = structuredClone(billed); changed.finance.entries[0].dueOn = "2026-12-01";
    expect(() => cancelFinanceEntry(changed, entry.id, { entry, invoice })).toThrow("reservado no backend");
    const invoiceChanged = structuredClone(billed); invoiceChanged.finance.invoices[0].orders[0].title = "Alterada";
    expect(() => cancelFinanceEntry(invoiceChanged, entry.id, { entry, invoice })).toThrow("alterada");
    const canceled = cancelFinanceEntry(billed, entry.id, { entry, invoice });
    expect(canceled.finance.entries[0].canceled).toBe(true);
    expect(canceled.finance.invoices[0].canceled).toBe(true);
    expect(billed.finance.entries[0].canceled).toBe(false);
    expect(validateDatabase(JSON.parse(JSON.stringify(canceled))).finance.entries[0].canceled).toBe(true);
  });
  it("backup inválido não apaga referências nem aceita duplicação de faturamento", () => {
    const data = fixture();
    const billed = billOrders(data, [data.orders[0].id], options);
    expect(() => validateDatabase({ ...billed, finance: { ...billed.finance, accounts: [] } })).toThrow("referências");
    expect(() => validateDatabase({ ...billed, orders: billed.orders.slice(1) })).toThrow("referências");
    expect(() => validateDatabase({ ...billed, finance: { ...billed.finance, entries: [] } })).toThrow("correspondente");
    const duplicate = structuredClone(billed);
    const invoice = { ...duplicate.finance.invoices[0], id: "dup" };
    duplicate.finance.invoices.push(invoice);
    duplicate.finance.entries.push({ ...duplicate.finance.entries[0], id: "dup-entry", invoiceId: "dup" });
    expect(() => validateDatabase(duplicate)).toThrow("outro faturamento");
  });
  it("não permite forjar vínculo de faturamento em conta manual nem cadastrar duas vezes", () => {
    const data = fixture();
    expect(() => saveFinanceEntry(data, { ...manual("Receber"), invoiceId: "fake" })).toThrow("sem faturamento");
    expect(() => saveFinanceEntry(saveFinanceEntry(data, manual("Pagar")), manual("Pagar"))).toThrow("já foi cadastrada");
  });
  it("separa produtos e serviços em dois documentos internos com cobrança, banco e vencimento independentes", () => {
    let data = fixture();
    data = saveBankAccount(data, { ...bank, id: "second-bank", name: "Outra conta" });
    data.orders[0].details!.items = [
      { id: "product", kind: "produto", referenceId: data.products[0].id, name: "Peça", quantity: 1, price: 10000, discount: 1000 },
      { id: "service", kind: "servico", referenceId: data.services[0].id, name: "Manutenção", quantity: 1, price: 5000, discount: 500 },
    ];
    data.orders[0].details!.costs = [{ id: "extra", name: "Adicional", value: 1000 }];
    const id = data.orders[0].id;
    const allocation = splitBillingValues(getOrderDetails(data.orders[0]));
    expect(allocation).toEqual({ products: 8100, services: 22500 });
    const billed = billOrders(data, [id], {
      Produtos: { ...terms, paymentMethod: "Boleto" },
      Serviços: { ...terms, accountId: "second-bank", dueOn: "2026-12-20" },
    });
    expect(billed.finance.invoices.map((invoice) => [invoice.kind, invoice.amount])).toEqual([["Produtos", 8100], ["Serviços", 22500]]);
    expect(billed.finance.entries.map((entry) => [entry.paymentMethod, entry.accountId, entry.dueOn, entry.amount]))
      .toEqual([["Boleto", bank.id, terms.dueOn, 8100], ["Pix", "second-bank", "2026-12-20", 22500]]);
    expect(billed.finance.invoices.every((invoice) => invoice.orders[0].allocation?.products === 8100)).toBe(true);
    expect(billed.finance.entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(orderValues(getOrderDetails(data.orders[0])).total);
    expect(pendingBillingOrders(billed).map((order) => order.id)).not.toContain(id);
    expect(validateDatabase(JSON.parse(JSON.stringify(billed))).finance).toEqual(billed.finance);
  });
  it("rateia descontos fixos/percentuais, frações e desconto total sem perder ou duplicar centavos", () => {
    const details = getOrderDetails(fixture(false).orders[0]);
    details.items = [
      { id: "p", kind: "produto", referenceId: "p", name: "P", quantity: 1.5, price: 101, discount: 1 },
      { id: "s", kind: "servico", referenceId: "s", name: "S", quantity: 1, price: 148, discount: 0 },
    ];
    details.discountMode = "R$";
    for (let discount = 0; discount <= 299; discount++) {
      details.discount = discount;
      const result = splitBillingValues(details);
      expect(result.products + result.services).toBe(orderValues(details).total);
      expect(result.products).toBeGreaterThanOrEqual(0);
      expect(result.services).toBeGreaterThanOrEqual(0);
    }
    details.discount = 1;
    expect(splitBillingValues(details)).toEqual({ products: 150, services: 148 });
    details.discountMode = "%";
    for (const discount of [0, 0.5, 33.33, 50, 99.99, 100]) {
      details.discount = discount;
      const result = splitBillingValues(details);
      expect(result.products + result.services).toBe(orderValues(details).total);
    }
    details.discount = 101;
    expect(() => splitBillingValues(details)).toThrow("descontos");
  });
  it("emite apenas o grupo positivo; custo interno de deslocamento não vira serviço cobrado", () => {
    const data = fixture(false);
    data.orders[0].details!.discount = 0;
    data.orders[0].details!.items = [
      { id: "product", kind: "produto", referenceId: data.products[0].id, name: "Peça", quantity: 1, price: 12345, discount: 0 },
    ];
    const billed = billOrders(data, [data.orders[0].id], { Produtos: { ...terms, paymentMethod: "Boleto" } });
    expect(billed.finance.invoices.map((invoice) => invoice.kind)).toEqual(["Produtos"]);
    expect(billed.finance.entries.map((entry) => entry.amount)).toEqual([12345]);
  });
  it("cancelar produtos não cancela serviços e refaturar não duplica a outra cobrança", () => {
    const data = fixture();
    data.orders[0].details!.items = [
      { id: "product", kind: "produto", referenceId: data.products[0].id, name: "Peça", quantity: 1, price: 10000, discount: 0 },
    ];
    const id = data.orders[0].id;
    let billed = billOrders(data, [id], { Produtos: terms, Serviços: terms });
    const [product, service] = billed.finance.entries;
    billed = cancelFinanceEntry(billed, product.id);
    expect(billed.finance.entries.find((entry) => entry.id === service.id)?.canceled).toBe(false);
    expect(pendingBillingValues(billed, billed.orders[0])).toEqual({ products: 9000, services: 0 });
    expect(previewBilling(billed, [id]).map((group) => group.kind)).toEqual(["Produtos"]);
    expect(() => billOrders(billed, [id], { Produtos: terms, Serviços: terms })).toThrow("separado");
    const rebilled = billOrders(billed, [id], { Produtos: { ...terms, paymentMethod: "Boleto" } });
    expect(rebilled.finance.invoices.filter((invoice) => !invoice.canceled).map((invoice) => invoice.kind)).toEqual(["Serviços", "Produtos"]);
    expect(rebilled.finance.entries.filter((entry) => !entry.canceled).reduce((sum, entry) => sum + entry.amount, 0)).toBe(26550);
    billed.orders[0].details!.items[0].price += 1;
    expect(() => billOrders(billed, [id], { Produtos: terms })).toThrow("mudaram");
  });
  it("bloqueia confirmação desatualizada, pagamentos faltantes/indevidos e salva os grupos atomicamente", () => {
    const data = fixture();
    const id = data.orders[0].id;
    const preview = previewBilling(data, [id]);
    data.orders[0].details!.travel!.tolls += 100;
    expect(() => billOrders(data, [id], options, preview)).toThrow("mudaram");
    expect(() => billOrders(data, [id], {})).toThrow("separado");
    expect(() => billOrders(data, [id], { Serviços: { ...terms, paymentMethod: "Dinheiro" } })).toThrow("Boleto ou Pix");
    data.orders[0].details!.items = [
      { id: "product", kind: "produto", referenceId: data.products[0].id, name: "Peça", quantity: 1, price: 10000, discount: 0 },
    ];
    expect(() => billOrders(data, [id], { Produtos: terms, Serviços: { ...terms, accountId: "missing" } })).toThrow("ativa");
    expect(data.finance.invoices).toHaveLength(0);
    expect(data.finance.entries).toHaveLength(0);
  });
  it("agrupa várias OS por tipo, sem consolidar a cobrança de produtos com serviços", () => {
    const data = fixture(false);
    data.orders[0].details!.discount = 0;
    data.orders[0].details!.items = [
      { id: "p", kind: "produto", referenceId: data.products[0].id, name: "Peça", quantity: 1, price: 10000, discount: 0 },
    ];
    const second = structuredClone(data.orders[0]);
    second.id = "second-mixed";
    second.code = "OS-999";
    second.details!.items = [
      { id: "s", kind: "servico", referenceId: data.services[0].id, name: "Manutenção", quantity: 1, price: 5000, discount: 0 },
    ];
    data.orders.push(second);
    const billed = billOrders(data, [data.orders[0].id, second.id], { Produtos: terms, Serviços: terms });
    expect(billed.finance.invoices.map((invoice) => [invoice.kind, invoice.orders.map((order) => order.code)]))
      .toEqual([["Produtos", [data.orders[0].code]], ["Serviços", [second.code]]]);
    expect(billed.finance.entries.map((entry) => entry.amount)).toEqual([10000, 5000]);
    const invalid = structuredClone(billed);
    invalid.finance.invoices[0].clientId = data.clients.find((client) => client.id !== data.orders[0].clientId)!.id;
    expect(() => validateDatabase(invalid)).toThrow("referências");
  });
  it("preserva faturamento legado de backup e rejeita rateios conflitantes ou sem snapshot", () => {
    const data = fixture();
    const billed = billOrders(data, [data.orders[0].id], options);
    const legacy = JSON.parse(JSON.stringify(billed));
    delete legacy.finance.invoices[0].kind;
    delete legacy.finance.invoices[0].orders[0].allocation;
    delete legacy.finance.invoices[0].orders[0].items;
    expect(validateDatabase(legacy).finance.invoices[0].kind).toBe("Legado");
    expect(pendingBillingOrders(validateDatabase(legacy)).map((order) => order.id)).not.toContain(data.orders[0].id);
    const invalid = structuredClone(billed);
    delete invalid.finance.invoices[0].orders[0].allocation;
    expect(() => validateDatabase(invalid)).toThrow("referências ou total");
    const contradictory = structuredClone(billed);
    const invoice = { ...structuredClone(contradictory.finance.invoices[0]), id: "conflict", kind: "Produtos" as const };
    invoice.orders[0].allocation!.products = 1;
    invoice.orders[0].amount = 1;
    delete invoice.orders[0].items;
    invoice.amount = 1;
    contradictory.finance.invoices.push(invoice);
    contradictory.finance.entries.push({ ...contradictory.finance.entries[0], id: "conflict-entry", invoiceId: invoice.id, amount: 1 });
    expect(() => validateDatabase(contradictory)).toThrow("Rateio divergente");
  });
  it("renderiza aba A faturar com OS, totais e navegação do módulo", () => {
    const data = fixture();
    const html = renderToStaticMarkup(<FinancePanel data={data} commit={() => {}} onSuccess={() => {}} onOpenOrder={() => {}} />);
    for (const text of ["Contas a receber", "Contas a pagar", "Bancos", "Faturamentos", data.orders[0].code, "Faturar selecionadas"])
      expect(html).toContain(text);
    expect(html).not.toContain("Gerar remessa");
  });
  it("congela itens, adicionais e descontos sem perder centavos nem incluir deslocamento interno", () => {
    for (const chargeTravel of [true, false]) {
      const data = fixture(chargeTravel);
      const details = data.orders[0].details!;
      details.costs = [{ id: "additional", name: "Adicional", value: 103 }];
      details.items = [
        { id: "p", kind: "produto", referenceId: data.products[0].id, name: "Produto original", quantity: 1.5, price: 101, discount: 1 },
        { id: "s", kind: "servico", referenceId: data.services[0].id, name: "Serviço original", quantity: 1, price: 199, discount: 2 },
      ];
      const billed = billOrders(data, [data.orders[0].id], { Produtos: terms, Serviços: terms });
      for (const invoice of billed.finance.invoices) {
        const order = invoice.orders[0];
        expect(order.items!.reduce((sum, item) => sum + item.gross - item.itemDiscount - item.orderDiscount, 0)).toBe(order.amount);
      }
      const service = billed.finance.invoices.find((invoice) => invoice.kind === "Serviços")!.orders[0].items!;
      expect(service.some((item) => item.source === "travel")).toBe(chargeTravel);
      expect(service.some((item) => item.source === "toll")).toBe(chargeTravel);
      expect(service.find((item) => item.source === "cost")!.referenceId).toBeUndefined();
      const before = JSON.stringify(billed.finance);
      billed.orders[0].details!.items[0].name = "Renomeado";
      billed.orders[0].details!.items[0].price = 999;
      expect(JSON.stringify(validateDatabase(billed).finance)).toBe(before);
    }
  });
  it("rateia desconto de grupo por item com limites e soma exatos para todos os centavos", () => {
    const details = getOrderDetails(fixture(false).orders[0]);
    details.items = [
      { id: "p1", kind: "produto", referenceId: "p", name: "P", quantity: 1.5, price: 101, discount: 1 },
      { id: "p2", kind: "produto", referenceId: "p", name: "P2", quantity: 1, price: 148, discount: 0 },
    ];
    for (let amount = 0; amount <= 299; amount++) {
      const items = billingItemSnapshots(details, "Produtos", amount);
      expect(items.reduce((sum, item) => sum + item.gross - item.itemDiscount - item.orderDiscount, 0)).toBe(amount);
      expect(items.every((item) => item.orderDiscount >= 0 && item.itemDiscount + item.orderDiscount <= item.gross)).toBe(true);
    }
  });
  it("rejeita snapshot adulterado e mantém compatibilidade com faturamento antigo sem itens", () => {
    const data = fixture();
    const billed = billOrders(data, [data.orders[0].id], options);
    const invalid = structuredClone(billed);
    invalid.finance.invoices[0].orders[0].items![0].orderDiscount++;
    expect(() => validateDatabase(invalid)).toThrow("Snapshot");
    const old = structuredClone(billed);
    delete old.finance.invoices[0].orders[0].items;
    expect(validateDatabase(old).finance.invoices[0].orders[0].items).toBeUndefined();
    const preview = previewBilling(data, [data.orders[0].id]);
    data.orders[0].details!.costs.push({ id: "zero", name: "Zero", value: 0 });
    data.orders[0].details!.travel!.kilometerRate += 1;
    expect(() => billOrders(data, [data.orders[0].id], options, preview)).toThrow("mudaram");
  });
});
