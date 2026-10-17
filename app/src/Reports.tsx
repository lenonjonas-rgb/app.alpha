import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  ArrowDownToLine,
  BarChart3,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  Gauge,
  MapPin,
  Plus,
  Receipt,
  Search,
  Wrench,
  X,
} from "lucide-react";
import type { Attachment, Database, Expense } from "./domain";
import {
  activityTotals,
  currency,
  displayDate,
  getOrderDetails,
  localDay,
  makeId,
  orderValues,
} from "./domain";
import { downloadFile, errorMessage } from "./useDatabase";
import { Empty, Modal } from "./components";
import { DropdownMenu } from "./DropdownMenu";
import {
  csvContent,
  defaultReportFilters,
  equipmentReportRows,
  filterExpenses,
  filterOrders,
  hoursOrders,
  monitoringRows,
  questionnaireRows,
  summarizeOrders,
  travelCostRows,
} from "./reporting";
import type { ReportFilters } from "./reporting";
import { serviceDistanceText } from "./serviceDistance";
import "./Reports.css";

const reports = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "finance", label: "Financeiro", icon: Receipt },
  { id: "tasks", label: "Tarefas", icon: ClipboardList },
  { id: "questionnaires", label: "Questionários", icon: FileText },
  { id: "kilometers", label: "Km rodado", icon: MapPin },
  { id: "travelCosts", label: "Custos de deslocamento", icon: Receipt },
  { id: "expenses", label: "Despesas", icon: Receipt },
  { id: "satisfaction", label: "Pesquisa de satisfação", icon: Gauge },
  { id: "monitoring", label: "Monitoramento", icon: Activity },
  { id: "hours", label: "Apontamento de horas", icon: Clock3 },
  { id: "equipment", label: "Equipamentos", icon: Wrench },
  { id: "downloads", label: "Central de downloads", icon: Download },
] as const;

type ReportId = (typeof reports)[number]["id"];
const reportGroups: { label: string; ids: ReportId[] }[] = [
  { label: "Operação", ids: ["tasks", "questionnaires", "monitoring", "hours", "equipment"] },
  { label: "Custos e financeiro", ids: ["finance", "kilometers", "travelCosts", "expenses"] },
  { label: "Qualidade e arquivos", ids: ["satisfaction", "downloads"] },
];
type GeneratedFile = { name: string; at: string; content: string };

function isAttachmentMime(value: string): value is Attachment["mime"] {
  return [
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/pdf",
    "text/plain",
  ].includes(value);
}

function duration(value: number): string {
  const minutes = Math.floor(Math.max(0, value) / 60000);
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatKilometers(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(value);
}

function ExpenseForm({
  data,
  commit,
  onClose,
  onSuccess,
  onError,
}: {
  data: Database;
  commit: (update: (current: Database) => Database) => void;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const file = form.get("attachment");
      let attachment: Attachment | null = null;
      if (file instanceof File && file.size > 0) {
        if (!isAttachmentMime(file.type) || file.size > 500_000)
          throw new Error("Use PNG, JPG, WebP, PDF ou TXT de até 500 KB.");
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () =>
            reject(new Error("Não foi possível ler o comprovante."));
          reader.readAsDataURL(file);
        });
        attachment = {
          id: makeId(),
          name: file.name,
          mime: file.type,
          size: file.size,
          data: dataUrl,
          at: new Date().toISOString(),
        };
      }
      const value = Math.round(Number(form.get("value")) * 100);
      const expense: Expense = {
        id: makeId(),
        date: String(form.get("date") ?? ""),
        technician: String(form.get("technician") ?? "").trim(),
        type: String(form.get("type") ?? "").trim(),
        value,
        description: String(form.get("description") ?? "").trim(),
        attachment,
      };
      commit((current) => ({
        ...current,
        expenses: [expense, ...current.expenses],
      }));
      onSuccess("Despesa registrada.");
      onClose();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const technicians = [
    ...new Set([
      data.settings.technician,
      ...data.orders.map((order) => order.technician),
    ]),
  ].filter(Boolean);
  return (
    <Modal title="Adicionar despesa" onClose={onClose} wide>
      <form className="report-expense-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label className="field">
            Data da despesa *
            <input name="date" type="date" defaultValue={localDay()} required />
          </label>
          <label className="field">
            Colaborador *
            <input
              name="technician"
              list="report-expense-technicians"
              defaultValue={data.settings.technician}
              maxLength={100}
              required
            />
            <datalist id="report-expense-technicians">
              {technicians.map((person) => (
                <option key={person} value={person} />
              ))}
            </datalist>
          </label>
          <label className="field">
            Tipo de despesa *
            <input name="type" maxLength={100} required />
          </label>
          <label className="field">
            Valor (R$) *
            <input
              name="value"
              type="number"
              min="0.01"
              max="1000000"
              step="0.01"
              required
            />
          </label>
          <label className="field full">
            Descrição *
            <textarea name="description" maxLength={1000} required />
          </label>
          <label className="field full">
            Comprovante (PNG, JPG, WebP, PDF ou TXT; até 500 KB)
            <input
              name="attachment"
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"
            />
          </label>
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="button primary" disabled={busy} type="submit">
            <Plus size={17} />
            {busy ? "Salvando…" : "Salvar despesa"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function ReportsPanel({
  data,
  commit,
  onOpenOrder,
  onSuccess,
  onError,
}: {
  data: Database;
  commit: (update: (current: Database) => Database) => void;
  onOpenOrder: (id: string) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [report, setReport] = useState<ReportId>("dashboard");
  const [filters, setFilters] = useState(defaultReportFilters);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [finalizedOnly, setFinalizedOnly] = useState(false);
  const [questionnaire, setQuestionnaire] = useState("");
  const [expenseFormOpen, setExpenseFormOpen] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const orderRows = useMemo(
    () => filterOrders(data, filters),
    [data, filters],
  );
  const summary = useMemo(() => summarizeOrders(orderRows), [orderRows]);
  const expenses = useMemo(
    () => filterExpenses(data.expenses, filters),
    [data.expenses, filters],
  );
  const questionnaireOptions = useMemo(
    () =>
      [
        ...new Set(
          questionnaireRows(data, orderRows).map((row) => row.questionnaire),
        ),
      ].sort((left, right) => left.localeCompare(right, "pt-BR")),
    [data, orderRows],
  );
  const answers = useMemo(
    () =>
      questionnaireRows(data, orderRows).filter(
        (row) => !questionnaire || row.questionnaire === questionnaire,
      ),
    [data, orderRows, questionnaire],
  );
  const equipmentRows = useMemo(
    () => equipmentReportRows(data, orderRows),
    [data, orderRows],
  );
  const visibleEquipmentRows = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase("pt-BR");
    return equipmentRows.filter(({ equipment, client, lastVisit }) => {
      return (
        (!filters.clientId || equipment.clientId === filters.clientId) &&
        (!filters.from || (lastVisit && lastVisit >= filters.from)) &&
        (!filters.to || (lastVisit && lastVisit <= filters.to)) &&
        (!query ||
          `${equipment.name} ${equipment.serial} ${client} ${equipment.category}`
            .toLocaleLowerCase("pt-BR")
            .includes(query))
      );
    });
  }, [equipmentRows, filters]);
  const hoursRows = useMemo(
    () => hoursOrders(orderRows, finalizedOnly),
    [orderRows, finalizedOnly],
  );
  const hoursSummary = useMemo(() => summarizeOrders(hoursRows), [hoursRows]);
  const gpsRows = useMemo(() => monitoringRows(data, filters), [data, filters]);
  const travelRows = useMemo(() => travelCostRows(orderRows), [orderRows]);
  const travelTotals = travelRows.reduce((sum, row) => ({
    kilometers: sum.kilometers + row.kilometers, fuel: sum.fuel + row.fuelCost,
    tolls: sum.tolls + row.travel.tolls, cost: sum.cost + row.cost, charge: sum.charge + row.charge,
  }), { kilometers: 0, fuel: 0, tolls: 0, cost: 0, charge: 0 });
  const expenseTotal = expenses.reduce((sum, item) => sum + item.value, 0);
  const kilometersCost = Math.round(
    summary.kilometers * data.settings.kilometerRate,
  );

  function updateFilter(key: keyof ReportFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }
  function selectReport(next: ReportId) {
    setReport(next);
    setFilters((current) => ({ ...current, status: "" }));
  }
  function clientName(id: string) {
    return data.clients.find((client) => client.id === id)?.name ?? "—";
  }
  function generateFile() {
    let name = `relatorio-${report}-${localDay()}.csv`;
    let csv = "";
    switch (report) {
      case "dashboard":
      case "tasks":
      case "finance":
        csv = csvContent(
          ["Data", "OS", "Cliente", "Colaborador", "Situação", "Valor OS", "Km"],
          orderRows.map((order) => [
            order.date,
            order.code,
            clientName(order.clientId),
            order.technician,
            order.status,
            (orderValues(getOrderDetails(order)).total / 100).toFixed(2),
            getOrderDetails(order).distanceKm,
          ]),
        );
        break;
      case "questionnaires":
        csv = csvContent(
          [
            "Data",
            "OS",
            "Cliente",
            "Colaborador",
            "Questionário",
            "Equipamento",
            "Pergunta",
            "Resposta",
            "Obrigatória",
          ],
          answers.map((row) => [
            row.date,
            row.orderCode,
            row.client,
            row.technician,
            row.questionnaire,
            row.equipment,
            row.question,
            row.answer,
            row.required ? "Sim" : "Não",
          ]),
        );
        break;
      case "kilometers":
        csv = csvContent(
          ["Data", "OS", "Cliente", "Colaborador", "Km", "Valor estimado (R$)"],
          orderRows.map((order) => [
            order.date,
            order.code,
            clientName(order.clientId),
            order.technician,
            getOrderDetails(order).distanceKm,
            (
              (getOrderDetails(order).distanceKm * data.settings.kilometerRate) /
              100
            ).toFixed(2),
          ]),
        );
        break;
      case "expenses":
        csv = csvContent(
          ["Data", "Colaborador", "Tipo", "Valor (R$)", "Descrição", "Comprovante"],
          expenses.map((item) => [
            item.date,
            item.technician,
            item.type,
            (item.value / 100).toFixed(2),
            item.description,
            item.attachment?.name ?? "",
          ]),
        );
        break;
      case "travelCosts":
        csv = csvContent(
          ["Data da OS", "OS", "Cliente", "Colaborador", "Cobrança de deslocamento", "Origem", "Destino", "Calculado em", "Km ida", "Km volta", "Km total", "Km/litro", "Combustível R$/litro", "Litros estimados", "Combustível (R$)", "Pedágios totais (R$)", "Custo interno (R$)", "Tarifa R$/km", "Cobrança antes do desconto (R$)", "Saldo do deslocamento (R$)"],
          travelRows.map((row) => [
            row.order.date, row.order.code, clientName(row.order.clientId), row.order.technician,
            row.travel.chargeTravel ? "Sim" : "Não", row.travel.route.origin.address, row.travel.route.destination.address, row.travel.route.calculatedAt,
            row.travel.route.outboundMeters / 1000, row.travel.route.returnMeters / 1000, row.kilometers,
            row.travel.kilometersPerLiter, (row.travel.fuelPrice / 100).toFixed(2), row.liters,
            (row.fuelCost / 100).toFixed(2), (row.travel.tolls / 100).toFixed(2), (row.cost / 100).toFixed(2),
            (row.travel.kilometerRate / 100).toFixed(2), (row.charge / 100).toFixed(2), (row.balance / 100).toFixed(2),
          ]),
        );
        break;
      case "hours":
        csv = csvContent(
          ["Data", "OS", "Cliente", "Colaborador", "Deslocamento", "Pausa", "Trabalho"],
          hoursRows.map((order) => {
            const totals = activityTotals(getOrderDetails(order).activities);
            return [
              order.date,
              order.code,
              clientName(order.clientId),
              order.technician,
              duration(totals.travel),
              duration(totals.pause),
              duration(totals.work),
            ];
          }),
        );
        break;
      case "equipment":
        csv = csvContent(
          ["Equipamento", "Identificador", "Cliente", "Categoria", "Garantia", "OS", "Última visita"],
          equipmentRows.map(({ equipment, client, orderCount, lastVisit }) => [
            equipment.name,
            equipment.serial,
            client,
            equipment.category,
            equipment.warranty,
            orderCount,
            lastVisit,
          ]),
        );
        break;
      case "satisfaction":
        name = `pesquisa-satisfacao-${localDay()}.csv`;
        csv = csvContent(["Data", "Cliente", "OS", "Nota", "Resposta"], []);
        break;
      case "monitoring":
        name = `monitoramento-${localDay()}.csv`;
        csv = csvContent(
          ["OS", "Cliente", "Colaborador", "Atividade", "Data/hora", "Origem", "Latitude GPS", "Longitude GPS", "Precisão GPS (m)", "Distância do atendimento (m)", "Endereço de referência", "Latitude de referência", "Longitude de referência", "Situação"],
          gpsRows.map(({ order, activity }) => [
            order.code, clientName(order.clientId), activity.technician, activity.kind, activity.at, activity.origin,
            activity.location?.latitude ?? "", activity.location?.longitude ?? "", activity.location?.accuracy ?? "",
            activity.serviceDistance?.meters ?? "", activity.serviceDistance?.address ?? "",
            activity.serviceDistance?.latitude ?? "", activity.serviceDistance?.longitude ?? "", serviceDistanceText(activity),
          ]),
        );
        break;
      case "downloads":
        csv = csvContent(
          ["Arquivo", "Data de geração"],
          generatedFiles.map((file) => [file.name, file.at]),
        );
        break;
    }
    try {
      const content = `\uFEFF${csv}`;
      downloadFile(name, content, "text/csv;charset=utf-8");
      setGeneratedFiles((current) => [
        { name, at: new Date().toISOString(), content },
        ...current,
      ]);
      onSuccess("Relatório CSV gerado e baixado.");
      onError("");
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  return (
    <section className="reports-page">
      <nav className="section-menus" aria-label="Relatórios">
        <button className={`button ${report === "dashboard" ? "primary" : "secondary"}`}
          aria-current={report === "dashboard" ? "page" : undefined}
          onClick={() => selectReport("dashboard")}><BarChart3 size={16} />Dashboard</button>
        {reportGroups.map((group) => <DropdownMenu key={group.label}
          label={group.ids.includes(report) ? reports.find((item) => item.id === report)!.label : group.label}
          accessibleLabel={`Relatórios: ${group.label}`} active={group.ids.includes(report)}
          actions={reports.filter((item) => group.ids.includes(item.id)).map((item) => ({
            label: item.label, icon: item.icon, current: report === item.id,
            onSelect: () => selectReport(item.id),
          }))} />)}
      </nav>

      <section className="report-card">
        <div className="report-card-heading">
          <div>
            <h2>{reports.find((item) => item.id === report)?.label}</h2>
            <p>
              Dados calculados dos registros da empresa; período e filtros
              aplicam-se aos relatórios operacionais.
            </p>
          </div>
          <div className="report-actions">
            {report === "expenses" && (
              <button className="button secondary" onClick={() => setExpenseFormOpen(true)}>
                <Plus size={16} />
                Adicionar despesa
              </button>
            )}
            <button className="button secondary" onClick={generateFile}>
              <ArrowDownToLine size={16} />
              Exportar CSV
            </button>
          </div>
        </div>

        <div className="report-filter-heading">
          <button
            className="text-button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            <Search size={16} />
            {filtersOpen ? "Ocultar filtros" : "Filtros"}
          </button>
          <button
            className="text-button"
            onClick={() => {
              setFilters(defaultReportFilters());
              setQuestionnaire("");
            }}
          >
            <X size={15} />
            Limpar
          </button>
        </div>
        {filtersOpen && (
          <div className="report-filters">
            <label className="field">
              De
              <input
                aria-label="Data inicial do relatório"
                type="date"
                value={filters.from}
                onChange={(event) => updateFilter("from", event.target.value)}
              />
            </label>
            <label className="field">
              Até
              <input
                aria-label="Data final do relatório"
                type="date"
                value={filters.to}
                onChange={(event) => updateFilter("to", event.target.value)}
              />
            </label>
            <label className="field">
              Colaborador
              <select
                value={filters.technician}
                onChange={(event) =>
                  updateFilter("technician", event.target.value)
                }
              >
                <option value="">Todos</option>
                {[
                  ...new Set(report === "monitoring"
                    ? data.orders.flatMap((order) => getOrderDetails(order).activities.map((activity) => activity.technician))
                    : data.orders.map((order) => order.technician)),
                ]
                  .filter(Boolean)
                  .sort((left, right) => left.localeCompare(right, "pt-BR"))
                  .map((technician) => (
                    <option key={technician}>{technician}</option>
                  ))}
              </select>
            </label>
            {report !== "expenses" && (
              <label className="field">
                Cliente
                <select
                  value={filters.clientId}
                  onChange={(event) =>
                    updateFilter("clientId", event.target.value)
                  }
                >
                  <option value="">Todos</option>
                  {data.clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(report === "tasks" || report === "dashboard") && (
              <label className="field">
                Situação
                <select
                  value={filters.status}
                  onChange={(event) => updateFilter("status", event.target.value)}
                >
                  <option value="">Todas</option>
                  {["Aberta", "Em atendimento", "Pausada", "Finalizada"].map(
                    (status) => (
                      <option key={status}>{status}</option>
                    ),
                  )}
                </select>
              </label>
            )}
            {report === "expenses" && (
              <label className="field">
                Tipo de despesa
                <select
                  value={filters.status}
                  onChange={(event) => updateFilter("status", event.target.value)}
                >
                  <option value="">Todos</option>
                  {[...new Set(data.expenses.map((item) => item.type))]
                    .sort((left, right) => left.localeCompare(right, "pt-BR"))
                    .map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                </select>
              </label>
            )}
            {report === "questionnaires" && (
              <label className="field">
                Questionário
                <select
                  value={questionnaire}
                  onChange={(event) => setQuestionnaire(event.target.value)}
                >
                  <option value="">Todos</option>
                  {questionnaireOptions.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="field report-search">
              Buscar
              <span>
                <Search size={15} />
                <input
                  type="search"
                  value={filters.query}
                  onChange={(event) => updateFilter("query", event.target.value)}
                  placeholder="Nome, código, descrição…"
                />
              </span>
            </label>
          </div>
        )}

        {report === "travelCosts" && (
          <div className="report-content">
            <h3>Custos internos de deslocamento</h3>
            <p>Estimativas pelas rotas e preços registrados em cada OS, com ou sem cobrança. Período pela data da OS. Pedágios são totais de ida e volta, informados manualmente. Cobrança antes do desconto geral; saldo não é lucro total do atendimento.</p>
            <p>{orderRows.length - travelRows.length} OS sem cálculo de rota não entram nos totais. Este relatório não soma novamente despesas de combustível lançadas manualmente.</p>
            <div className="report-metrics">
              <div className="report-metric"><small>Km ida e volta</small><strong>{formatKilometers(travelTotals.kilometers)}</strong></div>
              <div className="report-metric"><small>Combustível estimado</small><strong>{currency(travelTotals.fuel)}</strong></div>
              <div className="report-metric"><small>Pedágios</small><strong>{currency(travelTotals.tolls)}</strong></div>
              <div className="report-metric"><small>Custo interno total</small><strong>{currency(travelTotals.cost)}</strong></div>
              <div className="report-metric"><small>Deslocamento cobrado</small><strong>{currency(travelTotals.charge)}</strong></div>
              <div className="report-metric"><small>Saldo do deslocamento</small><strong>{currency(travelTotals.charge - travelTotals.cost)}</strong></div>
            </div>
            <div className="table-scroll"><table>
              <thead><tr><th>Data</th><th>OS / cliente</th><th>Colaborador</th><th>Cobrar?</th><th>Km ida + volta</th><th>Consumo estimado</th><th>Combustível</th><th>Pedágios</th><th>Custo interno</th><th>Cobrança</th><th>Saldo</th></tr></thead>
              <tbody>{travelRows.map((row) => <tr key={row.order.id}>
                <td>{displayDate(row.order.date)}</td>
                <td><button className="record-link" onClick={() => onOpenOrder(row.order.id)}>{row.order.code}</button><small>{clientName(row.order.clientId)}</small></td>
                <td>{row.order.technician}</td><td>{row.travel.chargeTravel ? "Sim" : "Não"}</td>
                <td>{formatKilometers(row.kilometers)} km</td><td>{row.liters.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} L</td>
                <td>{currency(row.fuelCost)}</td><td>{currency(row.travel.tolls)}</td><td>{currency(row.cost)}</td><td>{currency(row.charge)}</td><td>{currency(row.balance)}</td>
              </tr>)}</tbody>
            </table>{!travelRows.length && <Empty title="Nenhum cálculo de deslocamento salvo para estes filtros" />}</div>
          </div>
        )}

        {report === "dashboard" && (
          <div className="report-content">
            <div className="report-metrics">
              {[
                ["Tarefas no período", summary.total],
                ["Finalizadas", summary.finished],
                ["Em aberto", summary.open + summary.inProgress + summary.paused],
                ["Com pendências", summary.withPending],
                ["Horas trabalhadas", duration(summary.workMs)],
                ["Km registrados", `${formatKilometers(summary.kilometers)} km`],
              ].map(([label, value]) => (
                <div className="report-metric" key={String(label)}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="report-bars">
              <h3>Situação das tarefas</h3>
              {[
                ["Abertas", summary.open],
                ["Em atendimento", summary.inProgress],
                ["Pausadas", summary.paused],
                ["Finalizadas", summary.finished],
              ].map(([label, value]) => (
                <div className="report-bar-row" key={String(label)}>
                  <span>{label}</span>
                  <div>
                    <i
                      style={{
                        width: `${summary.total ? (Number(value) / summary.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <p className="report-disclaimer">
              Tempo médio de atraso e produtividade não são calculados porque
              os registros locais não contêm os eventos necessários para
              comprovar esses indicadores.
            </p>
          </div>
        )}

        {report === "finance" && (
          <div className="report-content">
            <div className="report-metrics">
              <div className="report-metric">
                <small>Valores registrados em OS</small>
                <strong>{currency(summary.valueCents)}</strong>
              </div>
              <div className="report-metric">
                <small>Despesas registradas</small>
                <strong>{currency(expenseTotal)}</strong>
              </div>
              <div className="report-metric">
                <small>Saldo operacional estimado</small>
                <strong>{currency(summary.valueCents - expenseTotal)}</strong>
              </div>
            </div>
            <p className="report-disclaimer">
              Este resumo não representa faturamento, recebimento, impostos ou
              conciliação bancária. O módulo financeiro do Auvo não estava
              disponível na conta examinada.
            </p>
          </div>
        )}

        {report === "tasks" && (
          <div className="report-content">
            <div className="report-metrics compact">
              <div className="report-metric">
                <small>Total</small>
                <strong>{summary.total}</strong>
              </div>
              <div className="report-metric">
                <small>Finalizadas</small>
                <strong>{summary.finished}</strong>
              </div>
              <div className="report-metric">
                <small>Pendências</small>
                <strong>{summary.withPending}</strong>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tarefa / OS</th>
                    <th>Cliente</th>
                    <th>Colaborador</th>
                    <th>Situação</th>
                    <th>Valores</th>
                    <th>Km</th>
                  </tr>
                </thead>
                <tbody>
                  {orderRows.map((order) => (
                    <tr key={order.id}>
                      <td>{displayDate(order.date)}</td>
                      <td>
                        <button
                          className="record-link"
                          onClick={() => onOpenOrder(order.id)}
                        >
                          <strong>{order.code}</strong>
                          <small>{order.title}</small>
                        </button>
                      </td>
                      <td>{clientName(order.clientId)}</td>
                      <td>{order.technician}</td>
                      <td>{order.status}</td>
                      <td className="amount">
                        {currency(orderValues(getOrderDetails(order)).total)}
                      </td>
                      <td>{formatKilometers(getOrderDetails(order).distanceKm)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!orderRows.length && <Empty title="Nenhuma tarefa no período" />}
            </div>
          </div>
        )}

        {report === "questionnaires" && (
          <div className="report-content table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>OS</th>
                  <th>Cliente</th>
                  <th>Colaborador</th>
                  <th>Questionário</th>
                  <th>Equipamento</th>
                  <th>Pergunta</th>
                  <th>Resposta</th>
                  <th>Obrigatória</th>
                </tr>
              </thead>
              <tbody>
                {answers.map((row, index) => (
                  <tr key={`${row.orderCode}-${row.question}-${index}`}>
                    <td>{displayDate(row.date)}</td>
                    <td>{row.orderCode}</td>
                    <td>{row.client}</td>
                    <td>{row.technician}</td>
                    <td>{row.questionnaire}</td>
                    <td>{row.equipment || "Tarefa"}</td>
                    <td>{row.question}</td>
                    <td>{row.answer || "Sem resposta"}</td>
                    <td>{row.required ? "Sim" : "Não"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!answers.length && <Empty title="Nenhuma resposta de questionário encontrada" />}
          </div>
        )}

        {report === "kilometers" && (
          <div className="report-content">
            <div className="report-metrics compact">
              <div className="report-metric">
                <small>Quilometragem</small>
                <strong>{formatKilometers(summary.kilometers)} km</strong>
              </div>
              <div className="report-metric">
                <small>Valor configurado por km</small>
                <strong>
                  {data.settings.kilometerRate
                    ? currency(data.settings.kilometerRate)
                    : "Não configurado"}
                </strong>
              </div>
              <div className="report-metric">
                <small>Valor estimado</small>
                <strong>
                  {data.settings.kilometerRate
                    ? currency(kilometersCost)
                    : "—"}
                </strong>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>OS</th>
                    <th>Cliente</th>
                    <th>Colaborador</th>
                    <th>Km informado</th>
                    <th>Valor estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {orderRows.map((order) => {
                    const km = getOrderDetails(order).distanceKm;
                    return (
                      <tr key={order.id}>
                        <td>{displayDate(order.date)}</td>
                        <td>{order.code}</td>
                        <td>{clientName(order.clientId)}</td>
                        <td>{order.technician}</td>
                        <td>{formatKilometers(km)} km</td>
                        <td>
                          {data.settings.kilometerRate
                            ? currency(Math.round(km * data.settings.kilometerRate))
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!orderRows.length && <Empty title="Nenhuma quilometragem registrada" />}
            </div>
          </div>
        )}

        {report === "expenses" && (
          <div className="report-content">
            <div className="report-metrics compact">
              <div className="report-metric">
                <small>Despesas encontradas</small>
                <strong>{expenses.length}</strong>
              </div>
              <div className="report-metric">
                <small>Total no período</small>
                <strong>{currency(expenseTotal)}</strong>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Tipo</th>
                    <th>Data</th>
                    <th>Valor</th>
                    <th>Descrição</th>
                    <th>Comprovante</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((item) => (
                    <tr key={item.id}>
                      <td>{item.technician}</td>
                      <td>{item.type}</td>
                      <td>{displayDate(item.date)}</td>
                      <td className="amount">{currency(item.value)}</td>
                      <td>{item.description}</td>
                      <td>
                        {item.attachment ? (
                          <a
                            href={item.attachment.data}
                            download={item.attachment.name}
                          >
                            {item.attachment.name}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!expenses.length && <Empty title="Nenhuma despesa registrada" />}
            </div>
          </div>
        )}

        {report === "satisfaction" && (
          <div className="report-content empty-report">
            <Gauge size={26} />
            <h3>Não há respostas de satisfação</h3>
            <p>
              O sistema ainda não tem respostas associadas a tarefas. O envio
              real da pesquisa por e-mail será habilitado junto ao fluxo de
              convites autenticados.
            </p>
            <button className="button secondary" onClick={generateFile}>
              <ArrowDownToLine size={16} />
              Baixar planilha vazia
            </button>
          </div>
        )}

        {report === "monitoring" && (
          <div className="report-content">
            <h3>Check-ins e check-outs por localização</h3>
            <p>O período considera a data do registro. Distância em linha reta até o ponto confirmado do atendimento, com precisão do GPS separada. Não é distância percorrida, prova de presença ou rastreamento contínuo. Sem dados de bateria ou rede.</p>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>OS / cliente</th><th>Colaborador</th><th>Atividade</th><th>Data/hora</th><th>GPS / precisão</th><th>Distância do atendimento</th><th>Referência registrada</th>
                </tr></thead>
                <tbody>{gpsRows.map(({ order, activity }) => <tr key={`${order.id}-${activity.id}`}>
                  <td><button className="record-link" onClick={() => onOpenOrder(order.id)}>{order.code}</button><small>{clientName(order.clientId)}</small></td>
                  <td>{activity.technician}</td><td>{activity.kind}</td>
                  <td>{new Date(activity.at).toLocaleString("pt-BR")}</td>
                  <td>{activity.location ? <a target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${activity.location.latitude},${activity.location.longitude}`}>
                    {activity.location.latitude.toFixed(5)}, {activity.location.longitude.toFixed(5)} (±{Math.round(activity.location.accuracy)} m)
                  </a> : "Não registrado"}</td>
                  <td>{serviceDistanceText(activity)}</td>
                  <td>{activity.serviceDistance ? <>{activity.serviceDistance.address}<small>{activity.serviceDistance.latitude.toFixed(6)}, {activity.serviceDistance.longitude.toFixed(6)}</small></> : "Não registrada"}</td>
                </tr>)}</tbody>
              </table>
              {!gpsRows.length && <Empty title="Nenhum check-in ou check-out no período e filtros selecionados" />}
            </div>
          </div>
        )}

        {report === "hours" && (
          <div className="report-content">
            <div className="report-metrics">
              <div className="report-metric">
                <small>Em deslocamento</small>
                <strong>{duration(hoursSummary.travelMs)}</strong>
              </div>
              <div className="report-metric">
                <small>Tempo em pausa</small>
                <strong>{duration(hoursSummary.pauseMs)}</strong>
              </div>
              <div className="report-metric">
                <small>Tempo de trabalho</small>
                <strong>{duration(hoursSummary.workMs)}</strong>
              </div>
            </div>
            <label className="report-checkbox">
              <input
                type="checkbox"
                checked={finalizedOnly}
                onChange={(event) => setFinalizedOnly(event.target.checked)}
              />
              Somente tarefas finalizadas com check-out
            </label>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tarefa</th>
                    <th>Cliente</th>
                    <th>Colaborador</th>
                    <th>Deslocamento</th>
                    <th>Pausa</th>
                    <th>Trabalho</th>
                  </tr>
                </thead>
                <tbody>
                  {hoursRows.map((order) => {
                    const totals = activityTotals(
                      getOrderDetails(order).activities,
                    );
                    return (
                      <tr key={order.id}>
                        <td>{displayDate(order.date)}</td>
                        <td>{order.code}</td>
                        <td>{clientName(order.clientId)}</td>
                        <td>{order.technician}</td>
                        <td>{duration(totals.travel)}</td>
                        <td>{duration(totals.pause)}</td>
                        <td>{duration(totals.work)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!hoursRows.length && <Empty title="Nenhuma atividade no período" />}
            </div>
            <p className="report-disclaimer">
              O modo finalizado considera apenas OS com check-out; no modo
              parcial, atividades ainda abertas são calculadas até o momento.
            </p>
          </div>
        )}

        {report === "equipment" && (
          <div className="report-content table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Equipamento</th>
                  <th>Identificador</th>
                  <th>Cliente</th>
                  <th>Categoria</th>
                  <th>Garantia até</th>
                  <th>Situação da garantia</th>
                  <th>Tarefas</th>
                  <th>Última visita</th>
                </tr>
              </thead>
              <tbody>
                {visibleEquipmentRows.map(({ equipment, client, orderCount, lastVisit, warrantyExpired }) => (
                  <tr key={equipment.id}>
                    <td>{equipment.name}</td>
                    <td>{equipment.serial}</td>
                    <td>{client}</td>
                    <td>{equipment.category || "—"}</td>
                    <td>{equipment.warranty ? displayDate(equipment.warranty) : "—"}</td>
                    <td>
                      {!equipment.warranty
                        ? "Sem prazo registrado"
                        : warrantyExpired
                          ? "Vencida"
                          : "Vigente"}
                    </td>
                    <td>{orderCount}</td>
                    <td>{lastVisit ? displayDate(lastVisit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleEquipmentRows.length && (
              <Empty title="Nenhum equipamento encontrado para os filtros" />
            )}
          </div>
        )}

        {report === "downloads" && (
          <div className="report-content">
            <div className="download-notice">
              <Download size={19} />
              Esta versão gera CSV localmente no navegador. Não há fila remota;
              os arquivos gerados ficam disponíveis por meio do download
              realizado e esta lista vale apenas para a sessão atual.
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Solicitação</th>
                    <th>Descrição</th>
                    <th>Data de geração</th>
                    <th>Status</th>
                    <th>Arquivo</th>
                  </tr>
                </thead>
                <tbody>
                  {generatedFiles.map((file, index) => (
                    <tr key={`${file.name}-${file.at}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{file.name}</td>
                      <td>{new Date(file.at).toLocaleString("pt-BR")}</td>
                      <td>Finalizado localmente</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() =>
                            downloadFile(
                              file.name,
                              file.content,
                              "text/csv;charset=utf-8",
                            )
                          }
                        >
                          <ArrowDownToLine size={15} />
                          Gerar novamente
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!generatedFiles.length && <Empty title="Nenhum arquivo gerado nesta sessão" />}
            </div>
          </div>
        )}
      </section>

      {expenseFormOpen && (
        <ExpenseForm
          data={data}
          commit={commit}
          onClose={() => setExpenseFormOpen(false)}
          onSuccess={onSuccess}
          onError={onError}
        />
      )}
    </section>
  );
}
