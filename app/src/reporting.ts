import {
  activityTotals,
  getOrderDetails,
  orderPending,
  orderValues,
} from "./domain";
import type { Database, Expense, Order } from "./domain";

export type ReportFilters = {
  from: string;
  to: string;
  clientId: string;
  technician: string;
  status: string;
  query: string;
};

export type QuestionnaireReportRow = {
  date: string;
  orderCode: string;
  client: string;
  technician: string;
  questionnaire: string;
  question: string;
  answer: string;
  required: boolean;
};

export const defaultReportFilters = (): ReportFilters => ({
  from: "",
  to: "",
  clientId: "",
  technician: "",
  status: "",
  query: "",
});

export function filterOrders(data: Database, filters: ReportFilters): Order[] {
  const query = filters.query.trim().toLocaleLowerCase("pt-BR");
  return data.orders
    .filter((order) => {
      const client = data.clients.find((item) => item.id === order.clientId);
      const terms = [
        order.code,
        order.title,
        order.technician,
        client?.name ?? "",
        client?.document ?? "",
      ];
      return (
        (!filters.from || order.date >= filters.from) &&
        (!filters.to || order.date <= filters.to) &&
        (!filters.clientId || order.clientId === filters.clientId) &&
        (!filters.technician || order.technician === filters.technician) &&
        (!filters.status || order.status === filters.status) &&
        (!query ||
          terms.some((term) =>
            term.toLocaleLowerCase("pt-BR").includes(query),
          ))
      );
    })
    .sort((left, right) =>
      `${right.date}T${right.time}`.localeCompare(
        `${left.date}T${left.time}`,
      ),
    );
}

export function summarizeOrders(orders: Order[], now = Date.now()) {
  const summary = {
    total: orders.length,
    open: 0,
    inProgress: 0,
    paused: 0,
    finished: 0,
    withPending: 0,
    valueCents: 0,
    workMs: 0,
    travelMs: 0,
    pauseMs: 0,
    kilometers: 0,
  };
  for (const order of orders) {
    const details = getOrderDetails(order);
    if (order.status === "Aberta") summary.open += 1;
    if (order.status === "Em atendimento") summary.inProgress += 1;
    if (order.status === "Pausada") summary.paused += 1;
    if (order.status === "Finalizada") summary.finished += 1;
    if (orderPending(order).length) summary.withPending += 1;
    summary.valueCents += orderValues(details).total;
    summary.kilometers += details.distanceKm;
    const totals = activityTotals(details.activities, now);
    summary.workMs += totals.work;
    summary.travelMs += totals.travel;
    summary.pauseMs += totals.pause;
  }
  return summary;
}

export function questionnaireRows(
  data: Database,
  orders: Order[],
): QuestionnaireReportRow[] {
  return orders.flatMap((order) => {
    const client =
      data.clients.find((item) => item.id === order.clientId)?.name ?? "";
    return getOrderDetails(order).checklists.flatMap((checklist) =>
      checklist.questions.map((question) => ({
        date: order.date,
        orderCode: order.code,
        client,
        technician: order.technician,
        questionnaire: checklist.title,
        question: question.label,
        answer: Array.isArray(question.answer)
          ? question.answer.join("; ")
          : question.answer,
        required: question.required,
      })),
    );
  });
}

export function hoursOrders(orders: Order[], finalizedOnly: boolean): Order[] {
  return orders.filter((order) => {
    if (!finalizedOnly) return true;
    const lastActivity = getOrderDetails(order).activities.at(-1);
    return order.status === "Finalizada" && lastActivity?.kind === "Check-out";
  });
}

export function filterExpenses(
  expenses: Expense[],
  filters: ReportFilters,
): Expense[] {
  const query = filters.query.trim().toLocaleLowerCase("pt-BR");
  return expenses
    .filter(
      (expense) =>
        (!filters.from || expense.date >= filters.from) &&
        (!filters.to || expense.date <= filters.to) &&
        (!filters.technician || expense.technician === filters.technician) &&
        (!filters.status || expense.type === filters.status) &&
        (!query ||
          `${expense.technician} ${expense.type} ${expense.description}`
            .toLocaleLowerCase("pt-BR")
            .includes(query)),
    )
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function equipmentReportRows(data: Database, orders: Order[]) {
  return data.equipment.map((equipment) => {
    const related = orders.filter((order) => {
      const details = getOrderDetails(order);
      return (
        order.equipmentId === equipment.id ||
        details.equipmentIds.includes(equipment.id)
      );
    });
    const lastOrder = related[0];
    return {
      equipment,
      client:
        data.clients.find((client) => client.id === equipment.clientId)?.name ??
        "Cliente não encontrado",
      orderCount: related.length,
      lastVisit: lastOrder?.date ?? "",
      warrantyExpired:
        !!equipment.warranty && equipment.warranty < new Date().toISOString().slice(0, 10),
    };
  });
}

export function csvContent(headers: string[], rows: unknown[][]): string {
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [headers, ...rows]
    .map((row) => row.map(escape).join(";"))
    .join("\r\n");
}
