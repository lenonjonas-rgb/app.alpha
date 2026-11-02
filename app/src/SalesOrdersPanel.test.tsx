import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, saveSalesOrderDraft } from "./domain";
import { SalesPanel } from "./SalesPanel";
import { SalesOrdersPanel } from "./SalesOrdersPanel";

function salesData() {
  const data = demoDatabase();
  const product = data.products[0];
  return saveSalesOrderDraft(data, {
    clientId: data.clients[0].id,
    date: "2026-10-10",
    expectedOn: "",
    quoteId: "",
    serviceOrderId: "",
    stockLocationId: data.inventory!.defaultLocationId,
    seller: "",
    paymentTerms: "",
    shippingCost: 0,
    otherExpenses: 0,
    discount: 0,
    notes: "",
    internalNotes: "",
    items: [{
      id: "sales-panel-line",
      kind: "produto",
      referenceId: product.id,
      name: product.name,
      quantity: 1,
      price: product.price,
      discountPercent: 0,
    }],
  });
}

describe("pedidos de venda na tela", () => {
  it("integra a aba de pedidos sem remover as abas fiscais", () => {
    const html = renderToStaticMarkup(
      <SalesPanel data={salesData()} commit={() => {}} initialTab="orders"
        onCreateProposal={() => {}} onOpenProposal={() => {}} onEditProposal={() => {}} />,
    );
    expect(html).toContain("Pedidos de venda");
    expect(html).toContain("Notas Fiscais de Saída");
    expect(html).toContain("Notas de Serviço");
    expect(html).toContain("PV-0001");
    expect(html).toContain("Ações do pedido PV-0001");
    for (const action of ["Editar", "Gerar nota fiscal", "Lançar estoque", "Lançar contas", "Gerar nota serviço",
      "Gerar ordem serviço", "Clonar venda", "Imprimir comprovante", "Alterar situação", "Em andamento", "Cancelado"])
      expect(html).toContain(action);
    expect(html).toContain("em breve");
    expect(html).not.toContain("Confirmar PV-0001");
  });

  it("exibe uma lista vazia clara quando não há pedidos", () => {
    const html = renderToStaticMarkup(
      <SalesOrdersPanel data={demoDatabase()} commit={() => {}} />,
    );
    expect(html).toContain("Nenhum pedido de venda encontrado");
    expect(html).toContain("Novo pedido");
  });
});
