import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, saveSalesOrderDraft } from "./domain";
import { NfeEditor } from "./NfeEditor";
import { SalesNfePanel } from "./SalesNfePanel";
import { blankNfeItem, nfeDraftFromSalesOrder } from "./outgoingInvoices";

function withOrder() {
  const data = demoDatabase();
  const product = data.products[0];
  const result = saveSalesOrderDraft(data, {
    clientId: data.clients[0].id, date: "2026-10-10", expectedOn: "", quoteId: "", serviceOrderId: "",
    stockLocationId: data.inventory!.defaultLocationId, seller: "", paymentTerms: "30 60", shippingCost: 0, otherExpenses: 0,
    discount: 0, notes: "", internalNotes: "",
    items: [{ id: "line-1", kind: "produto", referenceId: product.id, name: product.name, quantity: 1, price: 4701, discountPercent: 0 }],
  });
  return { data: result, orderId: result.salesOrders[0].id };
}

describe("tela de NF-e de saída", () => {
  it("lista notas com menu de ações e acesso à configuração fiscal", () => {
    const { data, orderId } = withOrder();
    const nfe = { ...nfeDraftFromSalesOrder(data, orderId), status: "Pendente" as const };
    const html = renderToStaticMarkup(<SalesNfePanel data={{ ...data, outgoingInvoices: [nfe] }} commit={() => {}} />);
    expect(html).toContain("<h2>Notas fiscais de saída</h2>");
    expect(html).toContain("000001");
    expect(html).toContain(data.clients[0].name);
    expect(html).toContain(`aria-label="Ações da nota 000001"`);
    expect(html).toContain("Configuração fiscal");
    expect(html).toContain("Incluir nota fiscal");
    expect(html).toContain("o lançamento de várias parcelas para notas de pedidos ainda não é suportado");
    expect(html).toContain("use Contas a receber no Financeiro");
  });

  it("abre o editor a partir do pedido com destinatário travado, itens, totais e parcelas", () => {
    const { data, orderId } = withOrder();
    const html = renderToStaticMarkup(<SalesNfePanel data={data} commit={() => {}} initialOrderId={orderId} />);
    expect(html).toContain("Gerada a partir do pedido PV-0001");
    for (const section of ["Dados da nota", "Destinatário", "Itens da nota fiscal", "Cálculo de imposto", "Retenções",
      "Transportador / Volumes", "Pagamento", "Pessoas autorizadas a acessar o XML", "Informações adicionais"])
      expect(html).toContain(section);
    expect(html).toContain("Algumas informações podem causar a rejeição dessa nota");
    expect(html).toContain("Item 1: CST e/ou Classificação Tributária (IBS/CBS) não informados.");
    expect(html).toContain("Cálculo automático ligado");
    expect(html).toContain('aria-label="Valor da parcela 2"');
    expect(html).toContain("o faturamento de pedido com múltiplas parcelas ainda não é compatível");
    expect(html).not.toContain("Ao salvar, as contas a receber serão lançadas.");
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*><option value="">Selecione o cliente/);
  });

  it("mostra a nota cancelada somente para visualização", () => {
    const { data, orderId } = withOrder();
    const nfe = { ...nfeDraftFromSalesOrder(data, orderId), status: "Cancelada" as const,
      items: [{ ...blankNfeItem(), name: "Peça" }] };
    const html = renderToStaticMarkup(<NfeEditor data={data} initial={nfe} onSave={() => {}} onCancel={() => {}} />);
    expect(html).toContain('<fieldset class="nfe-fieldset" disabled="">');
    expect(html).toContain("Situação: Cancelada");
    expect(html).not.toContain(">Salvar<");
  });
});
