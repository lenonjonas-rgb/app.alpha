import { describe, expect, it } from "vitest";
import {
  changeOrderStatus,
  changeQuoteStatus,
  appendActivity,
  activityTotals,
  associateQuote,
  getOrderDetails,
  orderPending,
  orderValues,
  orderMargin,
  updateOrderDetails,
  replicateOrder,
  convertQuote,
  demoDatabase,
  emptyDatabase,
  countStock,
  moveStock,
  createStockLocation,
  setDefaultStockLocation,
  stockAvailable,
  stockLocationBalance,
  stockReserved,
  transferStock,
  reversibleConsumptionItems,
  reverseOrderConsumption,
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
  it("mantem os dados consultados pelo CNPJ no perfil da empresa", () => {
    const registration = {
      cnpj: "11222333000181",
      legalName: "Empresa Exemplo LTDA",
      tradeName: "Exemplo",
      registrationStatus: "Ativa",
      openingDate: "2020-01-02",
      address: "Rua das Flores, 10",
      addressDetails: {
        street: "Rua das Flores", number: "10", complement: "", district: "Centro",
        postalCode: "01001000", municipality: "3550308", city: "São Paulo", state: "SP",
      },
      phone: "1133334444",
      email: "contato@example.test",
      stateRegistrations: [{ state: "SC", number: "123456789", active: true }],
      mainCnae: "1234567",
      mainCnaeDescription: "Atividade principal",
      secondaryCnaes: ["7654321 - Atividade secundária"],
      legalNature: "Sociedade Empresária Limitada",
      companySize: "Microempresa",
      simpleNationalOptIn: true,
      meiOptIn: false,
      raw: { cnae_fiscal: 1234567 },
    };
    const data = emptyDatabase(
      registration.tradeName,
      "admin@example.test",
      registration,
    );
    expect(data.settings).toMatchObject({
      cnpj: "11222333000181",
      legalName: "Empresa Exemplo LTDA",
      tradeName: "Exemplo",
      registrationStatus: "Ativa",
      openingDate: "2020-01-02",
      address: "Rua das Flores, 10",
      addressDetails: {
        street: "Rua das Flores", number: "10", complement: "", district: "Centro",
        postalCode: "01001000", municipality: "3550308", city: "São Paulo", state: "SP",
      },
      phone: "1133334444",
      email: "contato@example.test",
      stateRegistrations: [{ state: "SC", number: "123456789", active: true }],
      mainCnae: "1234567",
      mainCnaeDescription: "Atividade principal",
      secondaryCnaes: ["7654321 - Atividade secundária"],
      legalNature: "Sociedade Empresária Limitada",
      companySize: "Microempresa",
      simpleNationalOptIn: true,
      meiOptIn: false,
      registrationData: { cnae_fiscal: 1234567 },
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
  it("registra contagens e ajusta somente a divergência com justificativa", () => {
    const data = demoDatabase(), product = data.products[0], locationId = data.inventory!.defaultLocationId;
    const counted = countStock(data, product.id, locationId, 6, "Duas peças danificadas no estoque.");
    expect(stockLocationBalance(counted, product.id, locationId)).toBe(6);
    expect(counted.products[0].stock).toBe(6);
    expect(counted.inventory!.counts[0]).toMatchObject({
      productId: product.id, locationId, systemQuantity: 8, countedQuantity: 6,
      reason: "Duas peças danificadas no estoque.",
    });
    expect(counted.movements[0]).toMatchObject({
      delta: -2, source: { type: "inventory", referenceId: counted.inventory!.counts[0].id },
      reason: "Inventário físico: sistema 8, contado 6. Justificativa: Duas peças danificadas no estoque.",
      unitCost: 9500, averageCostBefore: 9500, averageCostAfter: 9500,
    });
    expect(validateDatabase(counted)).toEqual(counted);
  });
  it("audita contagem sem divergência e não permite reduzir peças reservadas", () => {
    const data = demoDatabase(), product = data.products[0], locationId = data.inventory!.defaultLocationId;
    const counted = countStock(data, product.id, locationId, 8, "Contagem cíclica de conferência.");
    expect(counted.inventory!.counts).toHaveLength(1);
    expect(counted.movements[0]).toMatchObject({ delta: 0, balance: 8, source: { type: "inventory" } });
    const order = data.orders[0];
    order.details = { ...getOrderDetails(order), items: [{
      id: "reserved-line", kind: "produto", referenceId: product.id, name: product.name,
      quantity: 4, price: 1000, discount: 0,
    }] };
    const reserved = changeOrderStatus(validateDatabase(data), order.id, "Em atendimento");
    expect(() => countStock(reserved, product.id, locationId, 3, "Conferência com divergência."))
      .toThrow("abaixo das peças reservadas");
  });
  it("rejeita justificativa ausente e histórico de contagem divergente", () => {
    const data = demoDatabase(), product = data.products[0], locationId = data.inventory!.defaultLocationId;
    expect(() => countStock(data, product.id, locationId, 9, " ")).toThrow("justificativa");
    const counted = countStock(data, product.id, locationId, 9, "Contagem física conferida.");
    expect(() => validateDatabase({
      ...counted,
      inventory: {
        ...counted.inventory!,
        counts: counted.inventory!.counts.map((item) => ({ ...item, countedQuantity: 10 })),
      },
    })).toThrow("Inventário físico divergente");
  });
  it("reserva peças ao iniciar e baixa somente ao finalizar a OS", () => {
    const data = demoDatabase(), order = data.orders[0], product = data.products[0];
    order.details = { ...getOrderDetails(order), items: [{
      id: "stock-line", kind: "produto", referenceId: product.id, name: product.name,
      quantity: 2, price: 1000, discount: 0,
    }] };
    const start = changeOrderStatus(validateDatabase(data), order.id, "Em atendimento");
    const locationId = start.inventory!.defaultLocationId;
    expect(stockLocationBalance(start, product.id, locationId)).toBe(8);
    expect(stockReserved(start, product.id, locationId)).toBe(2);
    expect(stockAvailable(start, product.id, locationId)).toBe(6);
    const finished = changeOrderStatus(start, order.id, "Finalizada");
    expect(stockLocationBalance(finished, product.id, locationId)).toBe(6);
    expect(stockReserved(finished, product.id, locationId)).toBe(0);
    expect(finished.inventory!.reservations[0].events.at(-1)?.status).toBe("Consumida");
  });
  it("libera reserva ao retornar a Aberta e impede alterar peças reservadas", () => {
    const data = demoDatabase(), order = data.orders[0], product = data.products[0];
    order.details = { ...getOrderDetails(order), items: [{
      id: "stock-line", kind: "produto", referenceId: product.id, name: product.name,
      quantity: 2, price: 1000, discount: 0,
    }] };
    const started = changeOrderStatus(validateDatabase(data), order.id, "Em atendimento");
    expect(() => updateOrderDetails(started, order.id,
      (details) => ({ ...details, items: details.items.map((item) => ({ ...item, quantity: 3 })) }),
      "Editar peças")).toThrow("não podem ser alteradas");
    const reopened = changeOrderStatus(started, order.id, "Aberta");
    const locationId = reopened.inventory!.defaultLocationId;
    expect(stockReserved(reopened, product.id, locationId)).toBe(0);
    expect(reopened.inventory!.reservations[0].events.at(-1)?.status).toBe("Liberada");
    expect(stockLocationBalance(reopened, product.id, locationId)).toBe(8);
  });
  it("impede iniciar com quantidade fracionária ou estoque disponível insuficiente", () => {
    const data = demoDatabase(), order = data.orders[0], product = data.products[0];
    order.details = { ...getOrderDetails(order), items: [{
      id: "stock-line", kind: "produto", referenceId: product.id, name: product.name,
      quantity: 1.5, price: 1000, discount: 0,
    }] };
    expect(() => changeOrderStatus(validateDatabase(data), order.id, "Em atendimento")).toThrow("inteiras");
    order.details = { ...getOrderDetails(order), items: [{
      id: "stock-line", kind: "produto", referenceId: product.id, name: product.name,
      quantity: 9, price: 1000, discount: 0,
    }] };
    expect(() => changeOrderStatus(validateDatabase(data), order.id, "Em atendimento")).toThrow("insuficiente");
  });
  it("transfere entre depósitos e mantém padrão sem ajustar fisicamente os produtos", () => {
    const data = demoDatabase(), product = data.products[0], source = data.inventory!.defaultLocationId;
    const withLocation = createStockLocation(data, "Filial");
    const target = withLocation.inventory!.locations.find((item) => item.name === "Filial")!.id;
    const moved = transferStock(withLocation, product.id, source, target, 3, "Abastecimento da filial");
    expect(stockLocationBalance(moved, product.id, source)).toBe(5);
    expect(stockLocationBalance(moved, product.id, target)).toBe(3);
    expect(moved.products.find((item) => item.id === product.id)?.stock).toBe(8);
    expect(setDefaultStockLocation(moved, target).inventory!.defaultLocationId).toBe(target);
    expect(() => transferStock(moved, product.id, source, target, 6, "Excede saldo")).toThrow("Saldo disponível");
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
  it("registra autor, data e snapshot imutavel ao aprovar orcamento", () => {
    const data = demoDatabase();
    const at = "2026-10-22T14:30:00.000Z";
    const approved = changeQuoteStatus(data, data.quotes[0].id, "Aprovado", {
      userId: "user-admin",
      name: "Administração",
    }, at);
    expect(approved.quotes[0].approval).toMatchObject({
      at,
      approverUserId: "user-admin",
      approverName: "Administração",
      snapshot: {
        clientId: data.quotes[0].clientId,
        date: data.quotes[0].date,
        expires: data.quotes[0].expires,
        items: data.quotes[0].items,
        discount: data.quotes[0].discount,
        notes: data.quotes[0].notes,
        equipmentModels: data.quotes[0].equipmentModels,
      },
    });
    const changedTerms = structuredClone(approved);
    changedTerms.quotes[0].discount += 1;
    expect(() => validateDatabase(changedTerms)).toThrow();
    expect(() =>
      changeQuoteStatus(approved, approved.quotes[0].id, "Recusado", {
        userId: "user-admin",
        name: "Administração",
      }),
    ).toThrow("não pode ter a situação alterada");
  });
  it("nao aprova orcamento vencido", () => {
    const data = demoDatabase();
    data.quotes[0].expires = shiftDay(data.quotes[0].expires, -16);
    expect(() =>
      changeQuoteStatus(data, data.quotes[0].id, "Aprovado", {
        userId: "user-admin",
        name: "Administração",
      }),
    ).toThrow("Orçamento vencido");
  });
  it("registra mudanca de status no historico", () => {
    const data = demoDatabase();
    const result = changeOrderStatus(data, data.orders[0].id, "Finalizada");
    expect(result.orders[0].status).toBe("Finalizada");
    expect(result.orders[0].history[0].description).toContain("Finalizada");
  });
  it("estorna parcialmente consumo de OS finalizada com auditoria, limite e margem líquida", () => {
    const data = demoDatabase(), order = data.orders[0], product = data.products[0];
    order.details = { ...getOrderDetails(order), items: [{
      id: "consumed-line", kind: "produto", referenceId: product.id, name: product.name,
      quantity: 2, price: 15000, discount: 0,
    }] };
    const finalized = changeOrderStatus(validateDatabase(data), order.id, "Finalizada");
    const available = reversibleConsumptionItems(finalized, order.id);
    expect(available).toHaveLength(1);
    expect(available[0]).toMatchObject({ productId: product.id, consumedQuantity: 2, remainingQuantity: 2 });
    expect(() => reverseOrderConsumption(finalized, order.id, { [available[0].id]: 1 }, "Devolução", false))
      .toThrow("Confirme");
    const partial = reverseOrderConsumption(finalized, order.id, { [available[0].id]: 1 },
      "Peça não utilizada na OS.", true);
    expect(partial.orders.find((item) => item.id === order.id)?.status).toBe("Finalizada");
    expect(partial.products.find((item) => item.id === product.id)?.stock).toBe(product.stock - 1);
    expect(partial.inventory!.consumptionReversals).toHaveLength(1);
    expect(partial.movements[0]).toMatchObject({
      delta: 1, reason: "Estorno de consumo da OS OS-0001: Peça não utilizada na OS.",
      source: { type: "consumptionReversal", referenceId: partial.inventory!.consumptionReversals[0].id },
      unitCost: product.cost, averageCostBefore: product.cost, averageCostAfter: product.cost,
    });
    expect(orderMargin(partial, partial.orders.find((item) => item.id === order.id)!)).toMatchObject({
      cost: product.cost, margin: 30000 - product.cost,
    });
    expect(reversibleConsumptionItems(partial, order.id)[0].remainingQuantity).toBe(1);
    expect(() => reverseOrderConsumption(partial, order.id,
      { [available[0].id]: 2 }, "Quantidade excedente.", true)).toThrow("superior");
    const complete = reverseOrderConsumption(partial, order.id,
      { [available[0].id]: 1 }, "Segunda peça não utilizada.", true);
    expect(reversibleConsumptionItems(complete, order.id)).toEqual([]);
    expect(complete.products.find((item) => item.id === product.id)?.stock).toBe(product.stock);
    expect(orderMargin(complete, complete.orders.find((item) => item.id === order.id)!))
      .toMatchObject({ cost: 0, margin: 30000 });
    expect(validateDatabase(JSON.parse(JSON.stringify(complete)))).toEqual(complete);
    const altered = structuredClone(complete);
    altered.inventory!.consumptionReversals[0].items[0].quantity = 2;
    expect(() => validateDatabase(altered)).toThrow("Reposição de peça");
    expect(() => reverseOrderConsumption(finalized, "unknown", { [available[0].id]: 1 }, "Motivo válido", true))
      .toThrow("OS finalizada");
  });
});
