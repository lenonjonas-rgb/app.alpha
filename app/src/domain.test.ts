import { describe, expect, it } from "vitest";
import {
  changeOrderStatus,
  appendActivity,
  activityTotals,
  associateQuote,
  getOrderDetails,
  orderPending,
  orderValues,
  updateOrderDetails,
  replicateOrder,
  convertQuote,
  demoDatabase,
  emptyDatabase,
  moveStock,
  shiftDay,
  subtotal,
  total,
  validateDatabase,
} from "./domain";

describe("dados locais", () => {
  it("valida a base de demonstracao", () =>
    expect(validateDatabase(demoDatabase()).version).toBe(1));
  it("cria uma base de empresa vazia para o primeiro acesso cloud", () => {
    const data = emptyDatabase("Empresa de teste", "admin@example.test");
    expect(data).toMatchObject({
      clients: [],
      equipment: [],
      products: [],
      services: [],
      orders: [],
      quotes: [],
      movements: [],
      expenses: [],
      settings: {
        company: "Empresa de teste",
        technician: "admin@example.test",
        kilometerRate: 0,
      },
    });
  });
  it("rejeita referencias de cliente inexistente", () => {
    const data = demoDatabase();
    data.orders[0].clientId = "inexistente";
    expect(() => validateDatabase(data)).toThrow("cliente ou equipamento");
  });
  it("rejeita IDs duplicados em uma importacao", () => {
    const data = demoDatabase();
    data.clients.push(data.clients[0]);
    expect(() => validateDatabase(data)).toThrow("duplicados");
  });
  it("rejeita datas impossiveis", () => {
    const data = demoDatabase();
    data.orders[0].date = "2026-02-30";
    expect(() => validateDatabase(data)).toThrow();
  });
  it("avanca a data entre meses", () =>
    expect(shiftDay("2026-01-31", 1)).toBe("2026-02-01"));
});
describe("mais informacoes da OS", () => {
  it("impede finalizacao manual enquanto a atividade continua aberta", () => {
    const data = demoDatabase();
    const checked = appendActivity(data, data.orders[0].id, {
      id: "checkin",
      kind: "Check-in",
      at: "2026-10-01T09:00:00Z",
      technician: "QA",
      reason: "",
      justification: "",
      origin: "Web local",
    });
    expect(() =>
      changeOrderStatus(checked, data.orders[0].id, "Finalizada"),
    ).toThrow("check-out");
  });
  it("replica orientacoes sem reaproveitar relato, respostas ou execucao", () => {
    const data = demoDatabase();
    data.orders[0].details = {
      ...getOrderDetails(data.orders[0]),
      report: "Relato anterior",
    };
    const result = replicateOrder(
      data,
      data.orders[0].id,
      "2026-10-10",
      "10:00",
    );
    const copy = result.orders.at(-1)!;
    expect(copy.status).toBe("Aberta");
    expect(copy.notes).toBe(data.orders[0].notes);
    expect(getOrderDetails(copy).report).toBe("");
    expect(getOrderDetails(copy).activities).toEqual([]);
  });
  it("abre registros antigos sem detalhes sem perda de dados", () => {
    const data = demoDatabase();
    expect(getOrderDetails(data.orders[0]).attachments).toEqual([]);
    expect(
      validateDatabase(JSON.parse(JSON.stringify(data))).orders[0].notes,
    ).toBe(data.orders[0].notes);
  });
  it("persiste relato independente das orientacoes", () => {
    const data = demoDatabase();
    const updated = updateOrderDetails(
      data,
      data.orders[0].id,
      (details) => ({ ...details, report: "Revisao executada" }),
      "Relato atualizado",
    );
    expect(updated.orders[0].notes).toBe(data.orders[0].notes);
    expect(getOrderDetails(updated.orders[0]).report).toBe("Revisao executada");
  });
  it("identifica perguntas obrigatorias sem resposta e pendencias manuais", () => {
    const order = demoDatabase().orders[0];
    order.details = {
      ...getOrderDetails(order),
      checklists: [
        {
          id: "check",
          title: "Inspecao",
          equipmentId: "",
          questions: [
            {
              id: "question",
              label: "Estado",
              kind: "Texto",
              required: true,
              options: [],
              answer: "",
            },
          ],
        },
      ],
      pending: [{ id: "manual", title: "Aguardar peca", resolved: false }],
    };
    expect(orderPending(order)).toHaveLength(2);
    order.details.checklists[0].questions[0].answer = "Normal";
    order.details.pending[0].resolved = true;
    expect(orderPending(order)).toEqual([]);
  });
  it("calcula custos, descontos de itens e percentual geral em centavos", () => {
    const details = getOrderDetails(demoDatabase().orders[0]);
    details.items = [
      {
        id: "line",
        name: "Peca",
        kind: "produto",
        referenceId: "demo-product-1",
        quantity: 2,
        price: 10000,
        discount: 1000,
      },
    ];
    details.costs = [{ id: "cost", name: "Frete", value: 1000 }];
    details.discountMode = "%";
    details.discount = 10;
    expect(orderValues(details).total).toBe(18000);
  });
  it("bloqueia equipamento de outro cliente", () => {
    const data = demoDatabase();
    expect(() =>
      updateOrderDetails(
        data,
        data.orders[0].id,
        (details) => ({ ...details, equipmentIds: [data.equipment[1].id] }),
        "Associacao",
      ),
    ).toThrow("outro cliente");
  });
  it("calcula deslocamento, pausa e execucao inclusive acima de 24 horas", () => {
    const order = demoDatabase().orders[0];
    const kinds = [
      "Deslocamento",
      "Check-in",
      "Pausa",
      "Retorno",
      "Check-out",
    ] as const;
    const times = [
      "2026-10-01T08:00:00Z",
      "2026-10-01T09:00:00Z",
      "2026-10-01T12:00:00Z",
      "2026-10-01T13:00:00Z",
      "2026-10-02T17:00:00Z",
    ];
    const activities = kinds.map((kind, index) => ({
      id: String(index),
      kind,
      at: times[index],
      technician: order.technician,
      reason: "Almoco",
      justification: "",
      origin: "Web local" as const,
    }));
    expect(activityTotals(activities)).toEqual({
      travel: 3600000,
      pause: 3600000,
      work: 31 * 3600000,
    });
  });
  it("bloqueia check-out sem check-in e pausa sem motivo", () => {
    const data = demoDatabase();
    const activity = {
      id: "activity",
      kind: "Check-out" as const,
      at: "2026-10-01T10:00:00Z",
      technician: "QA",
      reason: "",
      justification: "",
      origin: "Web local" as const,
    };
    expect(() => appendActivity(data, data.orders[0].id, activity)).toThrow(
      "Sequencia",
    );
    const checked = appendActivity(data, data.orders[0].id, {
      ...activity,
      kind: "Check-in",
    });
    expect(() =>
      appendActivity(checked, data.orders[0].id, {
        ...activity,
        id: "pause",
        at: "2026-10-01T11:00:00Z",
        kind: "Pausa",
      }),
    ).toThrow("motivo");
  });
  it("associa orcamento somente a OS do mesmo cliente", () => {
    const data = demoDatabase();
    expect(() =>
      associateQuote(data, data.orders[1].id, data.quotes[0].id),
    ).toThrow("mesmo cliente");
    expect(
      associateQuote(data, data.orders[0].id, data.quotes[0].id).quotes[0]
        .orderId,
    ).toBe(data.orders[0].id);
  });
});
describe("estoque", () => {
  it("registra entrada e saldo sem alterar a base original", () => {
    const data = demoDatabase();
    const result = moveStock(data, data.products[0].id, 3, "Compra");
    expect(result.products[0].stock).toBe(11);
    expect(result.movements[0].balance).toBe(11);
    expect(data.products[0].stock).toBe(8);
  });
  it("bloqueia saida maior que saldo", () => {
    const data = demoDatabase();
    expect(() => moveStock(data, data.products[0].id, -9, "OS")).toThrow(
      "Saldo insuficiente",
    );
  });
  it("exige motivo e quantidade inteira", () => {
    const data = demoDatabase();
    expect(() => moveStock(data, data.products[0].id, 1, "")).toThrow("motivo");
    expect(() => moveStock(data, data.products[0].id, 1.5, "Compra")).toThrow(
      "inteira",
    );
  });
});
describe("orcamentos e OS", () => {
  it("calcula total em centavos com desconto", () => {
    const quote = demoDatabase().quotes[0];
    expect(subtotal(quote.items)).toBe(43500);
    expect(total({ ...quote, discount: 3500 })).toBe(40000);
  });
  it("bloqueia desconto superior ao subtotal", () => {
    const data = demoDatabase();
    data.quotes[0].discount = 50000;
    expect(() => validateDatabase(data)).toThrow();
  });
  it("exige aprovacao para gerar OS e impede duplicacao", () => {
    const data = demoDatabase();
    expect(() => convertQuote(data, data.quotes[0].id)).toThrow("Aprove");
    data.quotes[0].status = "Aprovado";
    const result = convertQuote(data, data.quotes[0].id);
    expect(result.orders).toHaveLength(5);
    expect(result.orders[4].code).toBe("OS-0005");
    expect(() => convertQuote(result, data.quotes[0].id)).toThrow("ja possui");
    expect(result.products[0].stock).toBe(data.products[0].stock);
  });
  it("registra mudanca de status no historico", () => {
    const data = demoDatabase();
    const result = changeOrderStatus(data, data.orders[0].id, "Finalizada");
    expect(result.orders[0].status).toBe("Finalizada");
    expect(result.orders[0].history[0].description).toContain("Finalizada");
  });
});
