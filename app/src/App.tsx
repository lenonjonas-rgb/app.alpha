import { lazy, Suspense, useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import ptBrLocale from "@fullcalendar/core/locales/pt-br";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowRightLeft,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  FileText,
  LayoutList,
  Menu,
  Package,
  Pencil,
  Plus,
  Printer,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Upload,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Database, Order, OrderStatus, Quote } from "./domain";
import {
  changeOrderStatus,
  convertQuote,
  currency,
  demoDatabase,
  displayDate,
  getOrderDetails,
  initials,
  localDay,
  moveStock,
  STORAGE_KEY,
  subtotal,
  total,
  validateDatabase,
} from "./domain";
import { downloadFile, errorMessage, useDatabase } from "./useDatabase";
import { Badge, Empty, Modal } from "./components";
import { EditorModal, MovementModal } from "./Forms";
import type { Editor, FormKind } from "./Forms";
import { CloudAccess } from "./CloudAccess";
import { OrderWorkspace } from "./OrderWorkspace";
import { TechnicianSettings } from "./TechnicianSettings";
import "./App.css";

const ReportsPanel = lazy(() =>
  import("./Reports").then((module) => ({ default: module.ReportsPanel })),
);

type View =
  | "agenda"
  | "orders"
  | "clients"
  | "equipment"
  | "stock"
  | "quotes"
  | "reports"
  | "settings";
const navigation: {
  id: View;
  label: string;
  icon: LucideIcon;
  group: string;
}[] = [
  { id: "agenda", label: "Agenda", icon: CalendarDays, group: "OPERAÇÃO" },
  {
    id: "orders",
    label: "Ordens de serviço",
    icon: FileText,
    group: "OPERAÇÃO",
  },
  { id: "quotes", label: "Orçamentos", icon: LayoutList, group: "OPERAÇÃO" },
  { id: "reports", label: "Relatórios", icon: BarChart3, group: "GESTÃO" },
  { id: "clients", label: "Clientes", icon: Users, group: "CADASTROS" },
  { id: "equipment", label: "Equipamentos", icon: Wrench, group: "CADASTROS" },
  {
    id: "stock",
    label: "Estoque e serviços",
    icon: Package,
    group: "CADASTROS",
  },
  { id: "settings", label: "Configurações", icon: Settings, group: "SISTEMA" },
];
const statuses: OrderStatus[] = [
  "Aberta",
  "Em atendimento",
  "Pausada",
  "Finalizada",
];
const viewFromHash = () =>
  navigation.find((item) => item.id === location.hash.slice(1).split("/")[0])
    ?.id ?? "agenda";
const orderFromHash = () => {
  if (!location.hash.startsWith("#orders/")) return null;
  try {
    return decodeURIComponent(location.hash.slice(8));
  } catch {
    return null;
  }
};

function Brand({
  data,
  compact = false,
}: {
  data: Database;
  compact?: boolean;
}) {
  return data.settings.logo ? (
    <img
      className={`brand-image ${compact ? "compact" : ""}`}
      src={data.settings.logo}
      alt={data.settings.company}
    />
  ) : (
    <div className={`brand-wordmark ${compact ? "compact" : ""}`}>
      <div className="brand-symbol">
        <Wrench size={23} strokeWidth={1.6} />
      </div>
      <div>
        <strong>
          ALPHA<span>TEC</span>
          <i />
        </strong>
        <small>PEÇAS E ACESSÓRIOS</small>
      </div>
    </div>
  );
}

function Recovery({
  error,
  onRestore,
}: {
  error: string;
  onRestore: (data: Database) => void;
}) {
  const [message, setMessage] = useState(error);
  return (
    <main className="recovery">
      <ShieldCheck size={38} />
      <h1>Dados locais indisponíveis</h1>
      <p role="alert">{message}</p>
      <div className="recovery-actions">
        <button
          className="button secondary"
          onClick={() => {
            try {
              downloadFile(
                "alpha-tec-dados-originais.json",
                localStorage.getItem(STORAGE_KEY) ?? "{}",
              );
            } catch (cause) {
              setMessage(errorMessage(cause));
            }
          }}
        >
          <ArrowDownToLine size={17} />
          Exportar dados originais
        </button>
        <label className="button secondary">
          <Upload size={17} />
          Restaurar backup
          <input
            type="file"
            accept=".json,application/json"
            className="file-input"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 5_000_000)
                  throw new Error("O arquivo deve ter até 5 MB.");
                onRestore(validateDatabase(JSON.parse(await file.text())));
              } catch (cause) {
                setMessage(errorMessage(cause));
              }
            }}
          />
        </label>
        <button
          className="button primary"
          onClick={() => {
            if (
              confirm(
                "Substituir os dados locais pela demonstração? Exporte os dados originais antes.",
              )
            ) {
              try {
                onRestore(demoDatabase());
              } catch (cause) {
                setMessage(errorMessage(cause));
              }
            }
          }}
        >
          Reiniciar demonstração
        </button>
      </div>
    </main>
  );
}

export default function App() {
  const {
    data,
    error: loadError,
    loading,
    commit,
    cloud,
  } = useDatabase();
  const [view, setView] = useState<View>(viewFromHash);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(
    orderFromHash,
  );
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [clientFilter, setClientFilter] = useState("");
  const [agendaMode, setAgendaMode] = useState("calendar");
  const [stockTab, setStockTab] = useState("products");
  const [calendarView, setCalendarView] = useState("dayGridMonth");
  const [calendarTitle, setCalendarTitle] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [detail, setDetail] = useState<{
    kind: "order" | "quote";
    id: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const calendar = useRef<FullCalendar>(null);
  useEffect(() => {
    function route() {
      setView(viewFromHash());
      setExpandedOrderId(orderFromHash());
      setQuery("");
      setStatusFilter("Todos");
      setClientFilter("");
      setNavOpen(false);
    }
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);
  useEffect(() => {
    document.title = `${data?.settings.company ?? "Alpha Tec"} | ${navigation.find((item) => item.id === view)?.label}`;
  }, [view, data?.settings.company]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);
  if (cloud.enabled && cloud.mode !== "loading") {
    return (
      <CloudAccess
        mode={cloud.mode}
        email={cloud.email}
        error={cloud.error}
        busy={cloud.busy}
        onLogin={(email, password) => void cloud.signIn(email, password)}
        onCreateCompany={(name) => void cloud.createCompany(name)}
        onRetry={cloud.retry}
        onSignOut={() => void cloud.signOut()}
      />
    );
  }
  if (loading || (cloud.enabled && cloud.mode === "loading" && !data))
    return (
      <main className="cloud-screen">
        <div className="cloud-card" role="status">
          Conectando ao banco seguro da empresa…
        </div>
      </main>
    );
  if (!data)
    return <Recovery error={loadError || cloud.error} onRestore={commit} />;
  const database = data;
  const today = localDay();
  const todayDate = new Date(today + "T12:00:00");
  const title = navigation.find((item) => item.id === view)!.label;
  const clientName = (id: string) =>
    database.clients.find((item) => item.id === id)?.name ??
    "Cliente não encontrado";
  const matches = (...values: string[]) =>
    values
      .join(" ")
      .toLocaleLowerCase("pt-BR")
      .includes(query.toLocaleLowerCase("pt-BR").trim());
  const orders = database.orders
    .filter(
      (item) =>
        (statusFilter === "Arquivadas"
          ? getOrderDetails(item).archived
          : !getOrderDetails(item).archived) &&
        matches(
          item.code,
          item.title,
          clientName(item.clientId),
          item.technician,
        ) &&
        (statusFilter === "Todos" ||
          statusFilter === "Arquivadas" ||
          item.status === statusFilter) &&
        (!clientFilter || item.clientId === clientFilter),
    )
    .sort((first, second) =>
      `${first.date}T${first.time}`.localeCompare(
        `${second.date}T${second.time}`,
      ),
    );
  const clients = database.clients.filter((item) =>
    matches(item.name, item.phone, item.document, item.address),
  );
  const equipment = database.equipment.filter(
    (item) =>
      matches(item.name, item.serial, clientName(item.clientId)) &&
      (!clientFilter || item.clientId === clientFilter),
  );
  const products = database.products.filter(
    (item) =>
      matches(item.name, item.code) &&
      (statusFilter !== "Baixo estoque" || item.stock <= item.minimum),
  );
  const quotes = database.quotes.filter(
    (item) =>
      matches(item.code, clientName(item.clientId)) &&
      (statusFilter === "Todos" || item.status === statusFilter),
  );
  const activeOrders = database.orders.filter(
    (item) => item.status !== "Finalizada" && !getOrderDetails(item).archived,
  );
  const todayOrders = activeOrders.filter((item) => item.date === today);
  const lowStock = database.products.filter(
    (item) => item.stock <= item.minimum,
  );
  const metricItems = [
    {
      label: "Atendimentos hoje",
      value: todayOrders.length,
      icon: CalendarDays,
      color: "red",
      destination: "agenda" as View,
    },
    {
      label: "Em atendimento",
      value: activeOrders.filter((item) => item.status === "Em atendimento")
        .length,
      icon: Clock3,
      color: "blue",
      destination: "orders" as View,
    },
    {
      label: "Orçamentos em aberto",
      value: database.quotes.filter((item) =>
        ["Rascunho", "Enviado"].includes(item.status),
      ).length,
      icon: FileText,
      color: "amber",
      destination: "quotes" as View,
    },
    {
      label: "Peças com estoque baixo",
      value: lowStock.length,
      icon: Package,
      color: "green",
      destination: "stock" as View,
    },
  ];
  function navigate(next: View) {
    location.hash = next;
    setView(next);
    setExpandedOrderId(null);
    setQuery("");
    setStatusFilter("Todos");
    setClientFilter("");
    setNavOpen(false);
  }
  function act(
    update: (current: Database) => Database,
    success: string,
  ): boolean {
    try {
      commit(update);
      setNotice(success);
      setError("");
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  }
  function openEditor(kind: FormKind, id?: string) {
    setEditor({ kind, id });
    setDetail(null);
  }
  function quoteStatus(id: string, next: Quote["status"]) {
    act((current) => {
      const quote = current.quotes.find((item) => item.id === id)!;
      if (quote.orderId) throw new Error("Este orçamento já gerou uma OS.");
      if (next === "Aprovado" && quote.expires < localDay())
        throw new Error(
          "Orçamento vencido. Atualize a validade antes de aprovar.",
        );
      return {
        ...current,
        quotes: current.quotes.map((item) =>
          item.id === id ? { ...item, status: next } : item,
        ),
      };
    }, "Situação do orçamento atualizada.");
  }
  function orderStatus(id: string, next: OrderStatus) {
    act(
      (current) => changeOrderStatus(current, id, next),
      "Situação da OS atualizada.",
    );
  }
  const newKind: FormKind =
    view === "clients"
      ? "client"
      : view === "equipment"
        ? "equipment"
        : view === "quotes"
          ? "quote"
          : view === "stock"
            ? stockTab === "services"
              ? "service"
              : "product"
            : "order";
  const newLabel =
    view === "clients"
      ? "Novo cliente"
      : view === "equipment"
        ? "Novo equipamento"
        : view === "quotes"
          ? "Novo orçamento"
          : view === "stock"
            ? stockTab === "services"
              ? "Novo serviço"
              : "Novo produto"
            : "Nova OS";
  const activeOrder =
    detail?.kind === "order"
      ? database.orders.find((item) => item.id === detail.id)
      : undefined;
  const activeQuote =
    detail?.kind === "quote"
      ? database.quotes.find((item) => item.id === detail.id)
      : undefined;

  function openFullOrder(id: string) {
    setDetail(null);
    setExpandedOrderId(id);
    setView("orders");
    location.hash = `orders/${encodeURIComponent(id)}`;
  }
  if (expandedOrderId) {
    const expanded = database.orders.find(
      (item) => item.id === expandedOrderId,
    );
    return (
      <div className="app-shell">
        {expanded ? (
          <OrderWorkspace
            key={expanded.id}
            order={expanded}
            data={database}
            commit={commit}
            onBack={() => navigate("orders")}
            onOpen={openFullOrder}
          />
        ) : (
          <main className="recovery">
            <Empty title="OS não encontrada" />
            <button
              className="button secondary"
              onClick={() => navigate("orders")}
            >
              Voltar às ordens
            </button>
          </main>
        )}
      </div>
    );
  }

  const orderTable = (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Ordem de serviço</th>
            <th>Cliente</th>
            <th>Agendamento</th>
            <th>Técnico</th>
            <th>Prioridade</th>
            <th>Situação</th>
            <th>
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((item) => (
            <tr key={item.id}>
              <td>
                <button
                  className="record-link"
                  onClick={() => setDetail({ kind: "order", id: item.id })}
                >
                  {item.code}
                  <strong>{item.title}</strong>
                </button>
              </td>
              <td>
                {clientName(item.clientId)}
                <small>{item.type}</small>
              </td>
              <td
                className={
                  item.date < today && item.status !== "Finalizada"
                    ? "overdue"
                    : ""
                }
              >
                {displayDate(item.date)}
                <small>
                  {item.time} · {item.duration} min
                </small>
              </td>
              <td>
                <span className="technician-avatar">
                  {initials(item.technician)}
                </span>
                {item.technician}
              </td>
              <td>
                <Badge value={item.priority} />
              </td>
              <td>
                <Badge value={item.status} />
              </td>
              <td>
                <button
                  className="icon-button"
                  title="Editar OS"
                  aria-label={`Editar ${item.code}`}
                  onClick={() => openEditor("order", item.id)}
                >
                  <Pencil size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!orders.length && <Empty title="Nenhuma OS encontrada" />}
    </div>
  );

  return (
    <div className="app-shell">
      {navOpen && (
        <button
          className="nav-backdrop"
          aria-label="Fechar menu"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <button
          className="brand-button"
          aria-label="Alpha Tec, abrir agenda"
          onClick={() => navigate("agenda")}
        >
          <Brand data={database} />
        </button>
        <div className="workspace-name">
          <span className="workspace-dot" />
          {database.settings.company}
          <small>Assistência técnica</small>
        </div>
        <nav aria-label="Navegação principal">
          {navigation.map((item, index) => (
            <div key={item.id}>
              {index === 0 || navigation[index - 1].group !== item.group ? (
                <span className="nav-group">{item.group}</span>
              ) : null}
              <button
                className={`nav-item ${view === item.id ? "active" : ""}`}
                aria-current={view === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <item.icon size={19} strokeWidth={1.7} />
                <span>{item.label}</span>
                {item.id === "orders" && <b>{activeOrders.length}</b>}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span />
            {cloud.enabled
              ? cloud.syncState === "saving"
                ? "Salvando na nuvem"
                : cloud.syncState === "synced"
                  ? "Nuvem sincronizada"
                  : "Supabase seguro"
              : "Ambiente local"}{" "}
            <b>{cloud.enabled ? "beta" : "v0.3"}</b>
          </div>
          <button
            className="user-profile"
            onClick={() =>
              cloud.enabled ? void cloud.signOut() : navigate("settings")
            }
          >
            <span className="profile-avatar">AT</span>
            <span>
              <strong>
                {cloud.enabled ? cloud.email : database.settings.company}
              </strong>
              <small>{cloud.enabled ? "Sair da conta" : "Minha empresa"}</small>
            </span>
            {cloud.enabled ? <X size={16} /> : <Settings size={16} />}
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-menu"
              title="Abrir menu"
              aria-label="Abrir menu"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>Gestão de serviços</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span />
              {cloud.enabled
                ? cloud.syncState === "saving"
                  ? "Salvando…"
                  : cloud.syncState === "synced"
                    ? "Sincronizado"
                    : "Supabase"
                : "Dados locais"}
            </span>
            <span className="topbar-date">
              {todayDate.toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
            <span className="profile-avatar small">AT</span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                ALPHA TEC /{" "}
                {view === "settings"
                  ? "EMPRESA"
                  : view === "reports"
                    ? "GESTÃO / RELATÓRIOS"
                    : "PAINEL OPERACIONAL"}
              </div>
              <h1>{title}</h1>
              <p>
                {view === "agenda"
                  ? todayDate.toLocaleDateString("pt-BR", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })
                  : view === "orders"
                    ? `${activeOrders.length} atendimentos em aberto`
                    : view === "clients"
                      ? `${database.clients.length} clientes cadastrados`
                      : view === "equipment"
                        ? `${database.equipment.length} equipamentos cadastrados`
                        : view === "stock"
                          ? `${database.products.length} produtos · ${database.services.length} serviços`
                          : view === "quotes"
                            ? `${database.quotes.length} propostas registradas`
                            : view === "reports"
                              ? "Indicadores operacionais e exportação de dados"
                              : database.settings.company}
              </p>
            </div>
            {view !== "settings" && view !== "reports" && (
              <button
                className="button primary"
                onClick={() => openEditor(newKind)}
              >
                <Plus size={18} />
                {newLabel}
              </button>
            )}
          </div>
          {error && (
            <div className="error-message global-error" role="alert">
              <TriangleAlert size={19} />
              <span>{error}</span>
              <button
                className="icon-button"
                title="Fechar aviso"
                aria-label="Fechar aviso"
                onClick={() => setError("")}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {(view === "agenda" || view === "orders") && (
            <section className="metric-strip" aria-label="Resumo operacional">
              {metricItems.map((item) => (
                <button
                  className="metric"
                  key={item.label}
                  onClick={() => navigate(item.destination)}
                >
                  <span className={`metric-icon ${item.color}`}>
                    <item.icon size={20} strokeWidth={1.7} />
                  </span>
                  <span>
                    <small>{item.label}</small>
                    <strong>{String(item.value).padStart(2, "0")}</strong>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            </section>
          )}
          {view !== "settings" && view !== "reports" && (
            <section className="module-section">
              <div className="module-toolbar">
                <label className="search-field">
                  <Search size={17} />
                  <input
                    aria-label={`Buscar em ${title}`}
                    type="search"
                    placeholder="Buscar..."
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <div className="toolbar-filters">
                  {(view === "orders" || view === "agenda") && (
                    <label className="select-filter">
                      <SlidersHorizontal size={15} />
                      <select
                        aria-label="Filtrar situação da OS"
                        value={statusFilter}
                        onChange={(event) =>
                          setStatusFilter(event.target.value)
                        }
                      >
                        <option value="Todos">Todas as situações</option>
                        {statuses.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                        {view === "orders" && <option>Arquivadas</option>}
                      </select>
                    </label>
                  )}
                  {(view === "equipment" ||
                    view === "agenda" ||
                    view === "orders") && (
                    <select
                      aria-label="Filtrar cliente"
                      className="client-filter"
                      value={clientFilter}
                      onChange={(event) => setClientFilter(event.target.value)}
                    >
                      <option value="">Todos os clientes</option>
                      {database.clients.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {view === "quotes" && (
                    <select
                      aria-label="Filtrar situação do orçamento"
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                    >
                      <option value="Todos">Todas as situações</option>
                      {["Rascunho", "Enviado", "Aprovado", "Recusado"].map(
                        (value) => (
                          <option key={value}>{value}</option>
                        ),
                      )}
                    </select>
                  )}
                  {view === "agenda" && (
                    <div
                      className="segments"
                      aria-label="Visualização da agenda"
                    >
                      <button
                        className={agendaMode === "calendar" ? "selected" : ""}
                        aria-pressed={agendaMode === "calendar"}
                        onClick={() => setAgendaMode("calendar")}
                        title="Calendário"
                      >
                        <CalendarDays size={16} />
                        Calendário
                      </button>
                      <button
                        className={agendaMode === "list" ? "selected" : ""}
                        aria-pressed={agendaMode === "list"}
                        onClick={() => setAgendaMode("list")}
                        title="Lista"
                      >
                        <LayoutList size={16} />
                        Lista
                      </button>
                    </div>
                  )}
                  {view === "stock" && stockTab === "products" && (
                    <label className="select-filter">
                      <SlidersHorizontal size={15} />
                      <select
                        aria-label="Filtrar estoque"
                        value={statusFilter}
                        onChange={(event) =>
                          setStatusFilter(event.target.value)
                        }
                      >
                        <option>Todos</option>
                        <option>Baixo estoque</option>
                      </select>
                    </label>
                  )}
                </div>
              </div>
              {view === "agenda" && agendaMode === "calendar" && (
                <>
                  <div className="calendar-toolbar">
                    <div>
                      <div className="calendar-navigation">
                        <button
                          className="icon-button"
                          title="Período anterior"
                          aria-label="Período anterior"
                          onClick={() => calendar.current?.getApi().prev()}
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <button
                          className="icon-button"
                          title="Próximo período"
                          aria-label="Próximo período"
                          onClick={() => calendar.current?.getApi().next()}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                      <h2>{calendarTitle}</h2>
                      <button
                        className="button today-button"
                        onClick={() => calendar.current?.getApi().today()}
                      >
                        Hoje
                      </button>
                    </div>
                    <div className="segments">
                      <button
                        className={
                          calendarView === "dayGridMonth" ? "selected" : ""
                        }
                        onClick={() => {
                          calendar.current?.getApi().changeView("dayGridMonth");
                          setCalendarView("dayGridMonth");
                        }}
                      >
                        Mês
                      </button>
                      <button
                        className={
                          calendarView === "timeGridWeek" ? "selected" : ""
                        }
                        onClick={() => {
                          calendar.current?.getApi().changeView("timeGridWeek");
                          setCalendarView("timeGridWeek");
                        }}
                      >
                        Semana
                      </button>
                      <button
                        className={
                          calendarView === "timeGridDay" ? "selected" : ""
                        }
                        onClick={() => {
                          calendar.current?.getApi().changeView("timeGridDay");
                          setCalendarView("timeGridDay");
                        }}
                      >
                        Dia
                      </button>
                    </div>
                  </div>
                  <div className="calendar-surface">
                    <FullCalendar
                      ref={calendar}
                      plugins={[
                        dayGridPlugin,
                        timeGridPlugin,
                        interactionPlugin,
                      ]}
                      locale={ptBrLocale}
                      initialView={calendarView}
                      headerToolbar={false}
                      firstDay={1}
                      height="auto"
                      dayMaxEvents={3}
                      fixedWeekCount={false}
                      allDaySlot={false}
                      slotMinTime="06:00:00"
                      slotMaxTime="22:00:00"
                      nowIndicator
                      eventTimeFormat={{
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      }}
                      datesSet={(event) => setCalendarTitle(event.view.title)}
                      events={orders.map((item) => ({
                        id: item.id,
                        title: item.title,
                        start: `${item.date}T${item.time}`,
                        end: new Date(
                          new Date(`${item.date}T${item.time}`).getTime() +
                            item.duration * 60000,
                        ),
                        classNames: [
                          `event-${item.status === "Finalizada" ? "done" : item.status === "Em atendimento" ? "active" : item.priority === "Alta" ? "urgent" : "open"}`,
                        ],
                      }))}
                      dateClick={(event) => {
                        const time = event.dateStr.includes("T")
                          ? event.dateStr.slice(11, 16)
                          : "09:00";
                        setEditor({
                          kind: "order",
                          date: event.dateStr.slice(0, 10),
                          time,
                        });
                      }}
                      eventClick={(event) =>
                        setDetail({ kind: "order", id: event.event.id })
                      }
                      eventContent={(event) => (
                        <div className="calendar-event-content">
                          <span>{event.timeText}</span>
                          <strong>{event.event.title}</strong>
                        </div>
                      )}
                    />
                  </div>
                  <div className="calendar-footer">
                    <div className="legend">
                      <span>
                        <i className="legend-red" />
                        Aberta
                      </span>
                      <span>
                        <i className="legend-blue" />
                        Em atendimento
                      </span>
                      <span>
                        <i className="legend-green" />
                        Finalizada
                      </span>
                    </div>
                    <span>{orders.length} ordens no filtro</span>
                  </div>
                </>
              )}
              {(view === "orders" ||
                (view === "agenda" && agendaMode === "list")) &&
                orderTable}
              {view === "clients" && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>Contato</th>
                        <th>Endereço</th>
                        <th>Grupo</th>
                        <th>Situação</th>
                        <th>
                          <span className="sr-only">Ações</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <div className="client-cell">
                              <span className="client-avatar">
                                {initials(item.name)}
                              </span>
                              <button
                                className="record-link"
                                onClick={() => openEditor("client", item.id)}
                              >
                                <strong>{item.name}</strong>
                                <small>
                                  {item.document || "CPF/CNPJ não informado"}
                                </small>
                              </button>
                            </div>
                          </td>
                          <td>
                            {item.phone || "—"}
                            <small>{item.email}</small>
                          </td>
                          <td>{item.address || "—"}</td>
                          <td>
                            <span className="tag">{item.group}</span>
                          </td>
                          <td>
                            <Badge value={item.active ? "Ativo" : "Inativo"} />
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              title="Editar cliente"
                              aria-label={`Editar ${item.name}`}
                              onClick={() => openEditor("client", item.id)}
                            >
                              <Pencil size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!clients.length && (
                    <Empty title="Nenhum cliente encontrado">
                      <button
                        className="button secondary"
                        onClick={() => openEditor("client")}
                      >
                        <Plus size={16} />
                        Novo cliente
                      </button>
                    </Empty>
                  )}
                </div>
              )}
              {view === "equipment" && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Equipamento</th>
                        <th>Identificador</th>
                        <th>Cliente</th>
                        <th>Categoria</th>
                        <th>Garantia</th>
                        <th>Atendimentos</th>
                        <th>
                          <span className="sr-only">Ações</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {equipment.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <div className="client-cell">
                              <span className="equipment-avatar">
                                <Wrench size={20} />
                              </span>
                              <button
                                className="record-link"
                                onClick={() => openEditor("equipment", item.id)}
                              >
                                <strong>{item.name}</strong>
                              </button>
                            </div>
                          </td>
                          <td className="mono">{item.serial}</td>
                          <td>{clientName(item.clientId)}</td>
                          <td>
                            <span className="tag">{item.category}</span>
                          </td>
                          <td>
                            {item.warranty ? (
                              <>
                                <span
                                  className={
                                    item.warranty < today ? "overdue" : ""
                                  }
                                >
                                  {displayDate(item.warranty)}
                                </span>
                                <small>
                                  {item.warranty < today
                                    ? "Expirada"
                                    : "Vigente"}
                                </small>
                              </>
                            ) : (
                              "Não informada"
                            )}
                          </td>
                          <td>
                            {
                              database.orders.filter(
                                (order) => order.equipmentId === item.id,
                              ).length
                            }{" "}
                            OS
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              title="Editar equipamento"
                              aria-label={`Editar ${item.serial}`}
                              onClick={() => openEditor("equipment", item.id)}
                            >
                              <Pencil size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!equipment.length && (
                    <Empty title="Nenhum equipamento encontrado" />
                  )}
                </div>
              )}
              {view === "stock" && (
                <>
                  <div
                    className="module-tabs"
                    role="tablist"
                    aria-label="Estoque"
                  >
                    <button
                      role="tab"
                      aria-selected={stockTab === "products"}
                      className={stockTab === "products" ? "active" : ""}
                      onClick={() => {
                        setStockTab("products");
                        setQuery("");
                        setStatusFilter("Todos");
                      }}
                    >
                      Produtos <span>{database.products.length}</span>
                    </button>
                    <button
                      role="tab"
                      aria-selected={stockTab === "services"}
                      className={stockTab === "services" ? "active" : ""}
                      onClick={() => {
                        setStockTab("services");
                        setQuery("");
                      }}
                    >
                      Serviços <span>{database.services.length}</span>
                    </button>
                    <button
                      role="tab"
                      aria-selected={stockTab === "movements"}
                      className={stockTab === "movements" ? "active" : ""}
                      onClick={() => {
                        setStockTab("movements");
                        setQuery("");
                      }}
                    >
                      Movimentações <span>{database.movements.length}</span>
                    </button>
                  </div>
                  {stockTab === "products" && (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Produto</th>
                            <th>Código</th>
                            <th>Preço</th>
                            <th>Custo</th>
                            <th>Saldo</th>
                            <th>Mínimo</th>
                            <th>Situação</th>
                            <th>
                              <span className="sr-only">Ações</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {products.map((item) => (
                            <tr key={item.id}>
                              <td>
                                <button
                                  className="record-link"
                                  onClick={() => openEditor("product", item.id)}
                                >
                                  <strong>{item.name}</strong>
                                </button>
                              </td>
                              <td className="mono">{item.code}</td>
                              <td>{currency(item.price)}</td>
                              <td>{currency(item.cost)}</td>
                              <td>
                                <b
                                  className={`stock-number ${item.stock <= item.minimum ? "overdue" : ""}`}
                                >
                                  {item.stock}
                                </b>
                              </td>
                              <td>{item.minimum}</td>
                              <td>
                                <Badge
                                  value={
                                    item.stock === 0
                                      ? "Sem estoque"
                                      : item.stock <= item.minimum
                                        ? "Estoque baixo"
                                        : "Disponível"
                                  }
                                />
                              </td>
                              <td>
                                <div className="row-actions">
                                  <button
                                    className="icon-button"
                                    aria-label={`Movimentar ${item.name}`}
                                    title="Movimentar estoque"
                                    onClick={() =>
                                      setEditor({
                                        kind: "movement",
                                        id: item.id,
                                      })
                                    }
                                  >
                                    <ArrowRightLeft size={17} />
                                  </button>
                                  <button
                                    className="icon-button"
                                    aria-label={`Editar ${item.code}`}
                                    title="Editar produto"
                                    onClick={() =>
                                      openEditor("product", item.id)
                                    }
                                  >
                                    <Pencil size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!products.length && (
                        <Empty title="Nenhum produto encontrado" />
                      )}
                    </div>
                  )}
                  {stockTab === "services" && (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Serviço</th>
                            <th>Valor</th>
                            <th>
                              <span className="sr-only">Ações</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {database.services
                            .filter((item) => matches(item.name))
                            .map((item) => (
                              <tr key={item.id}>
                                <td>
                                  <button
                                    className="record-link"
                                    onClick={() =>
                                      openEditor("service", item.id)
                                    }
                                  >
                                    <strong>{item.name}</strong>
                                  </button>
                                </td>
                                <td>{currency(item.price)}</td>
                                <td>
                                  <button
                                    className="icon-button"
                                    title="Editar serviço"
                                    aria-label={`Editar ${item.name}`}
                                    onClick={() =>
                                      openEditor("service", item.id)
                                    }
                                  >
                                    <Pencil size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {!database.services.filter((item) => matches(item.name))
                        .length && <Empty title="Nenhum serviço encontrado" />}
                    </div>
                  )}
                  {stockTab === "movements" && (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Data</th>
                            <th>Produto</th>
                            <th>Tipo</th>
                            <th>Quantidade</th>
                            <th>Saldo após</th>
                            <th>Motivo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {database.movements
                            .filter((item) =>
                              matches(
                                database.products.find(
                                  (product) => product.id === item.productId,
                                )?.name ?? "",
                                item.reason,
                              ),
                            )
                            .map((item) => (
                              <tr key={item.id}>
                                <td>
                                  {new Date(item.at).toLocaleString("pt-BR")}
                                </td>
                                <td>
                                  {
                                    database.products.find(
                                      (product) =>
                                        product.id === item.productId,
                                    )?.name
                                  }
                                </td>
                                <td>
                                  <Badge
                                    value={item.delta > 0 ? "Entrada" : "Saída"}
                                  />
                                </td>
                                <td
                                  className={
                                    item.delta < 0 ? "overdue" : "positive"
                                  }
                                >
                                  {item.delta > 0 ? "+" : ""}
                                  {item.delta}
                                </td>
                                <td>{item.balance}</td>
                                <td>{item.reason}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {!database.movements.filter((item) =>
                        matches(
                          database.products.find(
                            (product) => product.id === item.productId,
                          )?.name ?? "",
                          item.reason,
                        ),
                      ).length && (
                        <Empty title="Nenhuma movimentação encontrada" />
                      )}
                    </div>
                  )}
                </>
              )}
              {view === "quotes" && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Orçamento</th>
                        <th>Cliente</th>
                        <th>Emissão</th>
                        <th>Validade</th>
                        <th>Total</th>
                        <th>Situação</th>
                        <th>
                          <span className="sr-only">Ações</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <button
                              className="record-link"
                              onClick={() =>
                                setDetail({ kind: "quote", id: item.id })
                              }
                            >
                              <strong>{item.code}</strong>
                              <small>
                                {item.items.length} itens
                                {item.orderId ? " · OS gerada" : ""}
                              </small>
                            </button>
                          </td>
                          <td>{clientName(item.clientId)}</td>
                          <td>{displayDate(item.date)}</td>
                          <td
                            className={
                              item.expires < today && item.status !== "Aprovado"
                                ? "overdue"
                                : ""
                            }
                          >
                            {displayDate(item.expires)}
                          </td>
                          <td className="amount">{currency(total(item))}</td>
                          <td>
                            <Badge value={item.status} />
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              title={
                                item.orderId
                                  ? "Orçamento vinculado à OS"
                                  : "Editar orçamento"
                              }
                              disabled={!!item.orderId}
                              aria-label={`Editar ${item.code}`}
                              onClick={() => openEditor("quote", item.id)}
                            >
                              <Pencil size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!quotes.length && (
                    <Empty title="Nenhum orçamento encontrado" />
                  )}
                </div>
              )}
              {(view !== "agenda" || agendaMode === "list") && (
                <div className="table-footer">
                  <span>
                    {view === "clients"
                      ? clients.length
                      : view === "equipment"
                        ? equipment.length
                        : view === "quotes"
                          ? quotes.length
                          : view === "stock"
                            ? stockTab === "products"
                              ? products.length
                              : stockTab === "services"
                                ? database.services.filter((item) =>
                                    matches(item.name),
                                  ).length
                                : database.movements.filter((item) =>
                                    matches(
                                      database.products.find(
                                        (product) =>
                                          product.id === item.productId,
                                      )?.name ?? "",
                                      item.reason,
                                    ),
                                  ).length
                            : orders.length}{" "}
                    registros
                  </span>
                  <span>Alpha Tec</span>
                </div>
              )}
            </section>
          )}
          {view === "agenda" && (
            <section className="agenda-bottom">
              <div className="today-agenda">
                <div className="section-heading">
                  <h2>
                    Atendimentos de hoje <span>{todayOrders.length}</span>
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => navigate("orders")}
                  >
                    Ver ordens <ArrowRight size={15} />
                  </button>
                </div>
                {todayOrders.length ? (
                  todayOrders
                    .sort((first, second) =>
                      first.time.localeCompare(second.time),
                    )
                    .map((item) => (
                      <button
                        className="today-order"
                        key={item.id}
                        onClick={() =>
                          setDetail({ kind: "order", id: item.id })
                        }
                      >
                        <span className="appointment-time">{item.time}</span>
                        <span className="appointment-line" />
                        <span className="appointment-info">
                          <strong>{item.title}</strong>
                          <small>{clientName(item.clientId)}</small>
                        </span>
                        <Badge value={item.status} />
                        <ChevronRight size={16} />
                      </button>
                    ))
                ) : (
                  <Empty title="Nenhum atendimento em aberto hoje" />
                )}
              </div>
              <div className="stock-attention">
                <div className="section-heading">
                  <h2>
                    <TriangleAlert size={17} />
                    Reposição de peças
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => navigate("stock")}
                    title="Ver estoque"
                    aria-label="Ver estoque"
                  >
                    <ArrowRight size={17} />
                  </button>
                </div>
                {lowStock.length ? (
                  lowStock.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      className="stock-alert-row"
                      onClick={() =>
                        setEditor({ kind: "movement", id: item.id })
                      }
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>Mínimo: {item.minimum} un.</small>
                      </span>
                      <b>
                        {item.stock}
                        <small>un.</small>
                      </b>
                    </button>
                  ))
                ) : (
                  <div className="stock-ok">
                    <CircleCheck size={24} />
                    <span>Estoque acima do mínimo</span>
                  </div>
                )}
              </div>
            </section>
          )}
          {view === "reports" && (
            <Suspense fallback={<div className="report-loading">Carregando relatórios…</div>}>
              <ReportsPanel
                data={database}
                commit={commit}
                onOpenOrder={openFullOrder}
                onSuccess={setNotice}
                onError={setError}
              />
            </Suspense>
          )}
          {view === "settings" && (
            <SettingsPanel
              data={database}
              commit={commit}
              onSuccess={setNotice}
              onError={setError}
              cloud={cloud.enabled}
            />
          )}
        </main>
        <footer className="workspace-footer">
          <span>ALPHA TEC</span>
          <span>Gestão de assistência técnica</span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CircleCheck size={19} />
          {notice}
          <button
            className="icon-button"
            title="Fechar confirmação"
            aria-label="Fechar confirmação"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {editor &&
        (editor.kind === "movement" ? (
          <MovementModal
            data={database}
            productId={editor.id!}
            onClose={() => setEditor(null)}
            onSave={(delta, reason) => {
              commit((current) =>
                moveStock(current, editor.id!, delta, reason),
              );
              setNotice("Movimentação registrada.");
            }}
          />
        ) : (
          <EditorModal
            key={`${editor.kind}-${editor.id ?? editor.date ?? "new"}`}
            editor={editor}
            data={database}
            commit={commit}
            onClose={() => setEditor(null)}
            onSuccess={setNotice}
          />
        ))}
      {activeOrder && (
        <OrderDetail
          order={activeOrder}
          data={database}
          error={error}
          onClose={() => setDetail(null)}
          onEdit={() => openEditor("order", activeOrder.id)}
          onStatus={(next) => orderStatus(activeOrder.id, next)}
          onMore={() => openFullOrder(activeOrder.id)}
        />
      )}
      {activeQuote && (
        <QuoteDetail
          quote={activeQuote}
          data={database}
          error={error}
          onClose={() => setDetail(null)}
          onEdit={() => openEditor("quote", activeQuote.id)}
          onStatus={(next) => quoteStatus(activeQuote.id, next)}
          onConvert={() => {
            let generated = "";
            if (
              act(
                (current) => {
                  const converted = convertQuote(current, activeQuote.id);
                  generated = converted.quotes.find((quote) => quote.id === activeQuote.id)?.orderId ?? "";
                  return converted;
                },
                "OS gerada. Selecione o técnico e ajuste o agendamento antes do atendimento.",
              )
            ) {
              setDetail(null);
              navigate("orders");
              if (generated) openEditor("order", generated);
            }
          }}
          onOpenOrder={() =>
            setDetail({ kind: "order", id: activeQuote.orderId })
          }
        />
      )}
    </div>
  );
}

function OrderDetail({
  order,
  data,
  error,
  onClose,
  onEdit,
  onStatus,
  onMore,
}: {
  order: Order;
  data: Database;
  error: string;
  onClose: () => void;
  onEdit: () => void;
  onStatus: (next: OrderStatus) => void;
  onMore: () => void;
}) {
  const client = data.clients.find((item) => item.id === order.clientId)!;
  const equipment = data.equipment.find(
    (item) => item.id === order.equipmentId,
  );
  return (
    <Modal title={order.code} onClose={onClose} wide>
      <div className="modal-body document-body">
        {error && (
          <div role="alert" className="error-message document-controls">
            {error}
          </div>
        )}
        <div className="document-brand">
          <Brand data={data} compact />
          <span>ORDEM DE SERVIÇO</span>
        </div>
        <div className="detail-heading">
          <h2>{order.title}</h2>
          <Badge value={order.status} />
        </div>
        <div className="detail-grid">
          <div>
            <small>Cliente</small>
            <strong>{client.name}</strong>
            <span>{client.address}</span>
            <span>{client.phone}</span>
          </div>
          <div>
            <small>Agendamento</small>
            <strong>
              {displayDate(order.date)} às {order.time}
            </strong>
            <span>
              {order.duration} minutos · {order.technician}
            </span>
          </div>
          <div>
            <small>Equipamento</small>
            <strong>{equipment?.name ?? "Não informado"}</strong>
            <span>{equipment?.serial}</span>
          </div>
          <div>
            <small>Atendimento</small>
            <strong>{order.type}</strong>
            <span>Prioridade {order.priority.toLowerCase()}</span>
          </div>
        </div>
        <h3>Orientações e relato</h3>
        <p className="preserve-lines">
          {order.notes || "Nenhuma observação registrada."}
        </p>
        <div className="document-controls">
          <label className="field">
            Situação
            <select
              value={order.status}
              onChange={(event) => onStatus(event.target.value as OrderStatus)}
            >
              {statuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          {order.status === "Aberta" && (
            <button
              className="button primary"
              onClick={() => onStatus("Em atendimento")}
            >
              <Wrench size={17} />
              Iniciar atendimento
            </button>
          )}
          {order.status === "Em atendimento" && (
            <button
              className="button primary"
              onClick={() => onStatus("Finalizada")}
            >
              <Check size={17} />
              Finalizar OS
            </button>
          )}
        </div>
        <div className="history">
          <h3>Histórico</h3>
          {order.history.length ? (
            [...order.history].reverse().map((item) => (
              <div key={item.id}>
                <span className="history-dot" />
                <span>
                  <strong>{item.description}</strong>
                  <small>{new Date(item.at).toLocaleString("pt-BR")}</small>
                </span>
              </div>
            ))
          ) : (
            <p>Sem eventos registrados.</p>
          )}
        </div>
      </div>
      <footer className="modal-footer document-controls">
        <button className="button secondary" onClick={onMore}>
          <FileText size={17} />
          Mais informações
        </button>
        <button className="button secondary" onClick={() => window.print()}>
          <Printer size={17} />
          Imprimir
        </button>
        <button className="button primary" onClick={onEdit}>
          <Pencil size={17} />
          Editar OS
        </button>
      </footer>
    </Modal>
  );
}

function QuoteDetail({
  quote,
  data,
  error,
  onClose,
  onEdit,
  onStatus,
  onConvert,
  onOpenOrder,
}: {
  quote: Quote;
  data: Database;
  error: string;
  onClose: () => void;
  onEdit: () => void;
  onStatus: (next: Quote["status"]) => void;
  onConvert: () => void;
  onOpenOrder: () => void;
}) {
  const client = data.clients.find((item) => item.id === quote.clientId)!;
  return (
    <Modal title={quote.code} wide onClose={onClose}>
      <div className="modal-body document-body">
        {error && (
          <div role="alert" className="error-message document-controls">
            {error}
          </div>
        )}
        <div className="document-brand">
          <Brand data={data} compact />
          <span>ORÇAMENTO</span>
        </div>
        <div className="detail-heading">
          <h2>{client.name}</h2>
          <Badge value={quote.status} />
        </div>
        <div className="detail-grid">
          <div>
            <small>Emissão</small>
            <strong>{displayDate(quote.date)}</strong>
          </div>
          <div>
            <small>Validade</small>
            <strong>{displayDate(quote.expires)}</strong>
          </div>
        </div>
        <div className="table-scroll">
          <table className="document-table">
            <thead>
              <tr>
                <th>Descrição</th>
                <th>Qtd.</th>
                <th>Unitário</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.quantity}</td>
                  <td>{currency(item.price)}</td>
                  <td>{currency(Math.round(item.quantity * item.price))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="document-total">
          <span>
            Subtotal <b>{currency(subtotal(quote.items))}</b>
          </span>
          <span>
            Desconto <b>{currency(quote.discount)}</b>
          </span>
          <strong>
            Total <b>{currency(total(quote))}</b>
          </strong>
        </div>
        <h3>Condições e observações</h3>
        <p className="preserve-lines">{quote.notes || "Não informadas."}</p>
        {!quote.orderId && (
          <div className="document-controls">
            <label className="field">
              Situação
              <select
                value={quote.status}
                onChange={(event) =>
                  onStatus(event.target.value as Quote["status"])
                }
              >
                {["Rascunho", "Enviado", "Aprovado", "Recusado"].map(
                  (status) => (
                    <option key={status}>{status}</option>
                  ),
                )}
              </select>
            </label>
          </div>
        )}
      </div>
      <footer className="modal-footer document-controls">
        <button className="button secondary" onClick={() => window.print()}>
          <Printer size={17} />
          Imprimir
        </button>
        {!quote.orderId && (
          <button className="button secondary" onClick={onEdit}>
            <Pencil size={17} />
            Editar
          </button>
        )}
        {quote.orderId ? (
          <button className="button primary" onClick={onOpenOrder}>
            <FileText size={17} />
            Abrir OS
          </button>
        ) : (
          quote.status === "Aprovado" && (
            <button className="button primary" onClick={onConvert}>
              <Plus size={17} />
              Gerar OS
            </button>
          )
        )}
      </footer>
    </Modal>
  );
}

function SettingsPanel({
  data,
  commit,
  onSuccess,
  onError,
  cloud = false,
}: {
  data: Database;
  commit: (update: Database | ((data: Database) => Database)) => void;
  onSuccess: (text: string) => void;
  onError: (text: string) => void;
  cloud?: boolean;
}) {
  const [logo, setLogo] = useState(data.settings.logo);
  const [logoLoading, setLogoLoading] = useState(false);
  async function importBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("O backup deve ter até 5 MB.");
      const restored = validateDatabase(JSON.parse(await file.text()));
      if (
        !confirm(
          `Substituir a base local por este backup? ${restored.clients.length} clientes, ${restored.orders.length} OS. Esta operação substitui os dados atuais.`,
        )
      )
        return;
      commit(restored);
      setLogo(restored.settings.logo);
      onSuccess("Backup restaurado.");
      onError("");
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }
  return (
    <div className="settings-page">
      {cloud && <TechnicianSettings />}
      <section className="settings-section">
        <div className="section-heading">
          <h2>Identidade da empresa</h2>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            try {
              commit((current) => ({
                ...current,
                settings: {
                  ...current.settings,
                  company: String(form.get("company")).trim(),
                  technician: String(form.get("technician")).trim(),
                  kilometerRate: Math.round(
                    Number(form.get("kilometerRate")) * 100,
                  ),
                  logo,
                },
              }));
              onSuccess("Configurações salvas.");
              onError("");
            } catch (cause) {
              onError(errorMessage(cause));
            }
          }}
        >
          <div className="brand-settings">
            <div className="logo-preview">
              {logo ? (
                <img src={logo} alt="Logo da empresa" />
              ) : (
                <Brand data={data} />
              )}
            </div>
            <div className="logo-actions">
              <label className="button secondary">
                <Upload size={17} />
                Carregar logo
                <input
                  aria-label="Carregar logo da empresa"
                  className="file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setLogoLoading(true);
                    try {
                      if (
                        !["image/png", "image/jpeg", "image/webp"].includes(
                          file.type,
                        ) ||
                        file.size > 1_000_000
                      )
                        throw new Error("Use PNG, JPG ou WebP de até 1 MB.");
                      const result = await new Promise<string>(
                        (resolve, reject) => {
                          const reader = new FileReader();
                          reader.onload = () => resolve(String(reader.result));
                          reader.onerror = () =>
                            reject(new Error("Não foi possível ler a imagem."));
                          reader.readAsDataURL(file);
                        },
                      );
                      const image = new Image();
                      image.src = result;
                      await image.decode();
                      setLogo(result);
                      onError("");
                    } catch (cause) {
                      onError(errorMessage(cause));
                    } finally {
                      setLogoLoading(false);
                    }
                  }}
                />
              </label>
              {logo && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setLogo("")}
                >
                  Remover imagem
                </button>
              )}
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              Nome da empresa *
              <input
                name="company"
                defaultValue={data.settings.company}
                key={data.settings.company}
                required
                maxLength={100}
                readOnly={cloud}
              />
              {cloud && (
                <small>Nome definido ao provisionar a empresa; edição remota ainda não está habilitada.</small>
              )}
            </label>
            <label className="field">
              Técnico padrão *
              <input
                name="technician"
                defaultValue={data.settings.technician}
                key={data.settings.technician}
                required
                maxLength={100}
              />
            </label>
            <label className="field">
              Valor por quilômetro (R$)
              <input
                name="kilometerRate"
                type="number"
                min="0"
                step="0.01"
                defaultValue={(data.settings.kilometerRate / 100).toFixed(2)}
                key={data.settings.kilometerRate}
              />
            </label>
            {[
              ["CNPJ", data.settings.cnpj],
              ["Razão social", data.settings.legalName],
              ["Nome fantasia", data.settings.tradeName],
              ["Situação cadastral", data.settings.registrationStatus],
              ["Data de abertura", data.settings.openingDate],
              ["Endereço cadastral", data.settings.address],
              ["Telefone cadastral", data.settings.phone],
              ["E-mail cadastral", data.settings.email],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <label className="field" key={label}>
                  {label}
                  <input value={value} readOnly />
                </label>
              ))}
          </div>
          <button
            disabled={logoLoading}
            className="button primary"
            type="submit"
          >
            <Check size={17} />
            Salvar configurações
          </button>
        </form>
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <h2>{cloud ? "Exportação da base" : "Backup e restauração"}</h2>
          <span className="tag">
            {cloud ? "Dados compartilhados na nuvem" : "Armazenamento local"}
          </span>
        </div>
        <div className="backup-summary">
          <div>
            <strong>{data.clients.length}</strong>
            <small>Clientes</small>
          </div>
          <div>
            <strong>{data.orders.length}</strong>
            <small>Ordens de serviço</small>
          </div>
          <div>
            <strong>{data.products.length}</strong>
            <small>Produtos</small>
          </div>
          <div>
            <strong>{data.quotes.length}</strong>
            <small>Orçamentos</small>
          </div>
          <div>
            <strong>{data.expenses.length}</strong>
            <small>Despesas</small>
          </div>
        </div>
        <div className="settings-actions">
          <button
            className="button secondary"
            onClick={() =>
              downloadFile(
                `alpha-tec-backup-${localDay()}.json`,
                JSON.stringify(data, null, 2),
              )
            }
          >
            <ArrowDownToLine size={17} />
            {cloud ? "Exportar dados" : "Exportar backup"}
          </button>
          {!cloud && (
            <label className="button secondary">
              <Upload size={17} />
              Restaurar backup
              <input
                aria-label="Restaurar backup"
                className="file-input"
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  void importBackup(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </section>
      {!cloud && <section className="settings-section">
        <div className="section-heading">
          <h2>Base de dados</h2>
        </div>
        <div className="settings-actions">
          <button
            className="button secondary"
            onClick={() => {
              if (
                !confirm(
                  "Apagar TODOS os dados locais e iniciar uma base vazia? Exporte um backup antes.",
                )
              )
                return;
              try {
                commit({
                  version: 1,
                  clients: [],
                  equipment: [],
                  products: [],
                  services: [],
                  orders: [],
                  quotes: [],
                  movements: [],
                  expenses: [],
                  settings: data.settings,
                });
                onSuccess("Base vazia criada.");
                onError("");
              } catch (cause) {
                onError(errorMessage(cause));
              }
            }}
          >
            Iniciar base vazia
          </button>
          <button
            className="button secondary danger"
            onClick={() => {
              if (
                !confirm(
                  "Substituir TODOS os dados locais pelos exemplos de demonstração? Exporte um backup antes.",
                )
              )
                return;
              try {
                const demo = demoDatabase();
                commit({ ...demo, settings: data.settings });
                onSuccess("Demonstração restaurada.");
                onError("");
              } catch (cause) {
                onError(errorMessage(cause));
              }
            }}
          >
            Restaurar demonstração
          </button>
        </div>
      </section>}
    </div>
  );
}
