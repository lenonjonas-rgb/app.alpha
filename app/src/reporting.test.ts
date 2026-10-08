import { describe, expect, it } from "vitest";
import {
  demoDatabase,
  orderDetailsSchema,
  validateDatabase,
} from "./domain";
import {
  csvContent,
  filterExpenses,
  filterOrders,
  hoursOrders,
  questionnaireRows,
  summarizeOrders,
} from "./reporting";

describe("report calculations", () => {
  it("filters tasks by date, client, technician, status, and query", () => {
    const data = demoDatabase();
    const order = data.orders[0]!;
    const target = {
      ...order,
      date: "2026-10-07",
      technician: "Técnico A",
      status: "Finalizada" as const,
    };
    const filters = {
      from: "2026-10-01",
      to: "2026-10-31",
      clientId: order.clientId,
      technician: "Técnico A",
      status: "Finalizada",
      query: order.code,
    };

    expect(filterOrders({ ...data, orders: [target] }, filters)).toEqual([
      target,
    ]);
    expect(filterOrders({ ...data, orders: [target] }, { ...filters, from: "2026-10-08" })).toEqual([]);
  });

  it("includes duration only after a completed checkout in finalized mode", () => {
    const data = demoDatabase();
    const order = data.orders[0]!;
    const withCheckOut = {
      ...order,
      status: "Finalizada" as const,
      details: orderDetailsSchema.parse({
        activities: [
          {
            id: "activity-1",
            kind: "Check-in",
            at: "2026-10-07T10:00:00.000Z",
            technician: order.technician,
            reason: "",
            justification: "",
            origin: "Web local",
          },
          {
            id: "activity-2",
            kind: "Pausa",
            at: "2026-10-07T10:30:00.000Z",
            technician: order.technician,
            reason: "Almoço",
            justification: "",
            origin: "Web local",
          },
          {
            id: "activity-3",
            kind: "Retorno",
            at: "2026-10-07T11:00:00.000Z",
            technician: order.technician,
            reason: "",
            justification: "",
            origin: "Web local",
          },
          {
            id: "activity-4",
            kind: "Check-out",
            at: "2026-10-07T11:30:00.000Z",
            technician: order.technician,
            reason: "",
            justification: "",
            origin: "Web local",
          },
        ],
      }),
    };
    const incomplete = {
      ...withCheckOut,
      id: `${withCheckOut.id}-partial`,
      details: orderDetailsSchema.parse({
        activities: withCheckOut.details?.activities.slice(0, 2),
      }),
    };
    const selected = hoursOrders([withCheckOut, incomplete], true);
    expect(selected).toEqual([withCheckOut]);
    expect(summarizeOrders(selected, Date.parse("2026-10-07T12:00:00.000Z"))).toMatchObject({
      finished: 1,
      workMs: 60 * 60 * 1000,
      pauseMs: 30 * 60 * 1000,
    });
  });

  it("flattens questionnaire answers without losing task context", () => {
    const data = demoDatabase();
    const order = data.orders[0]!;
    const populated = {
      ...order,
      details: orderDetailsSchema.parse({
        checklists: [
          {
            id: "checklist-1",
            title: "Inspeção",
            questions: [
              {
                id: "question-1",
                label: "Equipamento funcionando?",
                kind: "Check",
                required: true,
                answer: "Sim",
              },
            ],
          },
        ],
      }),
    };
    expect(questionnaireRows(data, [populated])).toEqual([
      expect.objectContaining({
        orderCode: order.code,
        questionnaire: "Inspeção",
        question: "Equipamento funcionando?",
        answer: "Sim",
        required: true,
      }),
    ]);
  });

  it("exports semicolon CSV with quoted and escaped cells", () => {
    expect(csvContent(["Nome", "Nota"], [['Cliente "A"', "Linha 1\nLinha 2"]])).toBe(
      '"Nome";"Nota"\r\n"Cliente ""A""";"Linha 1\nLinha 2"',
    );
  });

  it("filters expenses by date, collaborator, category, and description", () => {
    const expense = {
      id: "expense-1",
      date: "2026-10-07",
      technician: "Técnico A",
      type: "Combustível",
      value: 2500,
      description: "Visita preventiva",
      attachment: null,
    };
    const filters = {
      from: "2026-10-01",
      to: "2026-10-31",
      clientId: "",
      technician: "Técnico A",
      status: "Combustível",
      query: "preventiva",
    };

    expect(filterExpenses([expense], filters)).toEqual([expense]);
    expect(filterExpenses([expense], { ...filters, technician: "Técnico B" })).toEqual([]);
  });

  it("supplies defaults for report fields when loading an older backup", () => {
    const current = demoDatabase();
    const legacy = {
      ...current,
      expenses: undefined,
      settings: { ...current.settings, kilometerRate: undefined },
    };

    expect(validateDatabase(legacy)).toMatchObject({
      expenses: [],
      settings: { kilometerRate: 0 },
    });
  });
});
