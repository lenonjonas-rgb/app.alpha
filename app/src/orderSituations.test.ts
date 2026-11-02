import { describe, expect, it } from "vitest";
import {
  changeOrderSituation, changeOrderStatus, demoDatabase, getOrderDetails, orderSituation, orderSituationStatus, validateDatabase,
} from "./domain";
import { nfeBillingTarget, nfeDraftFromServiceOrder, saveNfe } from "./outgoingInvoices";

function fixture(items: "none" | "products" = "none") {
  const data = demoDatabase(), order = data.orders[0], product = data.products[0];
  order.status = "Aberta";
  order.details = {
    ...getOrderDetails(order), activities: [], discount: 0, costs: [],
    items: items === "products" ? [
      { id: "line-1", kind: "produto", referenceId: product.id, name: product.name, quantity: 2, price: 1000, discount: 100 },
      { id: "line-2", kind: "servico", referenceId: data.services[0].id, name: "Mão de obra", quantity: 1, price: 5000, discount: 0 },
    ] : [],
  };
  return { data: validateDatabase(data), id: order.id };
}

describe("situações da OS (padrão Bling)", () => {
  it("mapeia as 9 situações para os 4 status gravados", () => {
    expect(orderSituationStatus("Orçada")).toBe("Aberta");
    expect(orderSituationStatus("Não aprovada")).toBe("Aberta");
    expect(orderSituationStatus("Serviço concluído")).toBe("Em atendimento");
    expect(orderSituationStatus("Aguardando componentes")).toBe("Pausada");
    expect(orderSituationStatus("Finalizada sem conserto")).toBe("Finalizada");
  });

  it("grava a situação, registra no histórico e troca o status quando muda de grupo", () => {
    const { data, id } = fixture();
    const order = () => result.orders.find((item) => item.id === id)!;
    let result = changeOrderSituation(data, id, "Orçada");
    expect(order().status).toBe("Aberta");
    expect(orderSituation(order())).toBe("Orçada");
    expect(order().history.at(-1)?.description).toBe("Situação: Em aberto -> Orçada");
    result = changeOrderSituation(result, id, "Aguardando componentes");
    expect(order().status).toBe("Pausada");
    expect(orderSituation(order())).toBe("Aguardando componentes");
    expect(changeOrderSituation(result, id, "Aguardando componentes")).toBe(result);
  });

  it("volta à situação padrão quando o status muda por fora (app do técnico)", () => {
    const { data, id } = fixture();
    const quoted = changeOrderSituation(data, id, "Aprovada");
    const started = changeOrderStatus(quoted, id, "Em atendimento");
    const order = started.orders.find((item) => item.id === id)!;
    expect(order.details?.situation).toBeUndefined();
    expect(orderSituation(order)).toBe("Em andamento");
    expect(orderSituation({ status: "Finalizada", details: { ...getOrderDetails(order), situation: "Orçada" } })).toBe("Finalizada");
  });
});

describe("gerar nota fiscal a partir da OS", () => {
  it("monta a NF-e só com as peças e deixa as contas para o faturamento da OS", () => {
    const { data, id } = fixture("products");
    const nfe = nfeDraftFromServiceOrder(data, id);
    expect(nfe.serviceOrderId).toBe(id);
    expect(nfe.items).toHaveLength(1);
    expect(nfe.items[0]).toMatchObject({ quantity: 2, price: 1000, discount: 100 });
    expect(nfeBillingTarget(data, nfe).mode).toBe("external");
    const classified = { ...nfe, items: nfe.items.map((item) => ({ ...item, fields: { ...item.fields,
      "ibs.classification": "000001", "cbs.classification": "000001" } })) };
    const saved = saveNfe(data, { ...classified, recipient: { ...nfe.recipient, document: nfe.recipient.document || "12345678909" } });
    expect(saved.finance.entries).toHaveLength(data.finance.entries.length);
    expect(nfeDraftFromServiceOrder(saved, id).id).toBe(nfe.id);
  });

  it("recusa OS sem produtos", () => {
    const { data, id } = fixture();
    expect(() => nfeDraftFromServiceOrder(data, id)).toThrow("não possui produtos");
  });
});
