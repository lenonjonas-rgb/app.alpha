import { useState } from "react";
import type { FormEvent } from "react";
import {
  Ban, CircleDot, ClipboardList, Copy, FileText, Mail, MessageCircle, MoreVertical, PackageCheck, PackageMinus,
  Pencil, Plus, Printer, Receipt, RotateCcw, Search, Tag, Trash2, Undo2, Wallet, Wrench, X,
} from "lucide-react";
import {
  cancelSalesOrder,
  changeSalesOrderStatus,
  createServiceOrderFromSalesOrder,
  currency,
  displayDate,
  localDay,
  makeId,
  postSalesOrderStock,
  reverseSalesOrderStock,
  salesOrderEditable,
  salesOrderStatuses,
  salesOrderStockPosted,
  stockAvailable,
  salesOrderSubtotal,
  salesOrderTotal,
  saveSalesOrderDraft,
} from "./domain";
import type { Database, SalesOrder, SalesOrderDraftInput, SalesOrderItem, SalesOrderStatus } from "./domain";
import { billSalesOrder, previewSalesOrderBilling, reverseSalesOrderBilling, salesOrderInvoices } from "./finance";
import type { BillingKind, BillingTerms } from "./financeSchema";
import { Empty, Modal } from "./components";
import { DropdownMenu } from "./DropdownMenu";
import type { DropdownAction } from "./DropdownMenu";
import { SalesOrderPrintModal } from "./SalesOrderPrint";
import type { SalesOrderPrintVariant } from "./SalesOrderPrint";

type FiscalKind = "nfe" | "nfse";
type BillingDialog = {
  order: SalesOrder;
  preview: ReturnType<typeof previewSalesOrderBilling>;
  terms: Partial<Record<BillingKind, BillingTerms>>;
  next?: FiscalKind;
};

const statusTone: Record<SalesOrderStatus, string> = {
  "Em aberto": "amber",
  "Em andamento": "blue",
  Atendido: "green",
  Cancelado: "red",
};

export function SalesOrderStatusBadge({ status }: { status: SalesOrderStatus }) {
  return <span className={`badge ${statusTone[status]}`}><span />{status}</span>;
}

const errorText = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

function blankItem(): SalesOrderItem {
  return { id: makeId(), kind: "produto", referenceId: "", name: "", quantity: 1, price: 0, discountPercent: 0 };
}

function blankDraft(data: Database): SalesOrderDraftInput {
  return {
    clientId: "",
    date: localDay(),
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
    items: [blankItem()],
  };
}

function draftFromOrder(order: SalesOrder): SalesOrderDraftInput {
  return {
    clientId: order.clientId,
    date: order.date,
    expectedOn: order.expectedOn,
    quoteId: order.quoteId,
    serviceOrderId: order.serviceOrderId,
    stockLocationId: order.stockLocationId,
    seller: order.seller,
    paymentTerms: order.paymentTerms,
    shippingCost: order.shippingCost,
    otherExpenses: order.otherExpenses,
    discount: order.discount,
    notes: order.notes,
    internalNotes: order.internalNotes,
    items: order.items.map((item) => ({ ...item })),
  };
}

function amountInput(value: number) {
  return String(value / 100);
}

export function SalesOrdersPanel({ data, commit, onIssueFiscal, onCreateNfe, onOpenServiceOrder }: {
  data: Database;
  commit: (update: (current: Database) => Database) => void;
  onIssueFiscal?: (kind: FiscalKind, invoiceId: string) => void;
  onCreateNfe?: (orderId: string) => void;
  onOpenServiceOrder?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<SalesOrderDraftInput>(() => blankDraft(data));
  const [formOpen, setFormOpen] = useState(false);
  const [clonedFrom, setClonedFrom] = useState("");
  const [cancelOrder, setCancelOrder] = useState<SalesOrder | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [billing, setBilling] = useState<BillingDialog | null>(null);
  const [printing, setPrinting] = useState<{ order: SalesOrder; variant: SalesOrderPrintVariant } | null>(null);
  const [createdServiceOrderId, setCreatedServiceOrderId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const activeLocations = data.inventory!.locations.filter((location) => location.active);
  const eligibleQuotes = data.quotes.filter((quote) =>
    quote.status === "Aprovado" && !quote.salesOrderId);
  const orders = data.salesOrders
    .filter((order) => statusFilter === "Todos" || order.status === statusFilter)
    .filter((order) => {
      const client = data.clients.find((item) => item.id === order.clientId)?.name ?? "";
      return `${order.code} ${client} ${order.items.map((item) => item.name).join(" ")}`
        .toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"));
    })
    .toSorted((first, second) => second.date.localeCompare(first.date) || second.code.localeCompare(first.code));

  function openNew() {
    setEditingId("");
    setDraft(blankDraft(data));
    setClonedFrom("");
    setError("");
    setFormOpen(true);
  }

  function openOrder(order: SalesOrder) {
    setEditingId(order.id);
    setDraft(draftFromOrder(order));
    setClonedFrom("");
    setError("");
    setFormOpen(true);
  }

  function cloneOrder(order: SalesOrder) {
    setEditingId("");
    setDraft({
      ...draftFromOrder(order),
      quoteId: "",
      serviceOrderId: "",
      date: localDay(),
      expectedOn: "",
      items: order.items.map((item) => ({ ...item, id: makeId() })),
    });
    setClonedFrom(order.code);
    setError("");
    setFormOpen(true);
  }

  function chooseQuote(quoteId: string) {
    const quote = data.quotes.find((item) => item.id === quoteId);
    if (!quote) {
      setDraft((current) => ({ ...current, quoteId: "" }));
      return;
    }
    setDraft((current) => ({
      ...current,
      quoteId,
      clientId: quote.clientId,
      date: localDay(),
      discount: quote.discount,
      notes: quote.notes,
      items: quote.items.map((item) => ({ ...item, discountPercent: 0 })),
    }));
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      commit((current) => saveSalesOrderDraft(current, draft, editingId || undefined));
      setFormOpen(false);
      setCreatedServiceOrderId("");
      setNotice(editingId ? "Pedido atualizado." : clonedFrom ? `Venda clonada de ${clonedFrom}.` : "Pedido de venda criado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o pedido.");
    } finally {
      setSaving(false);
    }
  }

  function run(operation: (current: Database) => Database, success: string, fallback: string) {
    setError("");
    setNotice("");
    setCreatedServiceOrderId("");
    try {
      commit(operation);
      setNotice(success);
      return true;
    } catch (cause) {
      setError(errorText(cause, fallback));
      return false;
    }
  }

  function defaultTerms(): BillingTerms {
    return {
      accountId: data.finance.accounts.find((account) => account.active)?.id ?? "",
      dueOn: localDay(),
      paymentMethod: "Pix",
    };
  }

  function openBilling(order: SalesOrder, next?: FiscalKind) {
    setError("");
    setNotice("");
    setCreatedServiceOrderId("");
    try {
      const preview = previewSalesOrderBilling(data, order.id);
      if (!preview.length) throw new Error("Não há valores pendentes para lançar contas neste pedido.");
      setBilling({ order, preview, next, terms: Object.fromEntries(preview.map((group) => [group.kind, defaultTerms()])) });
    } catch (cause) {
      setError(errorText(cause, "Não foi possível preparar o lançamento de contas."));
    }
  }

  function confirmBilling() {
    if (!billing) return;
    setError("");
    const outcome: { data?: Database } = {};
    try {
      commit((current) => {
        outcome.data = billSalesOrder(current, billing.order.id, billing.terms, billing.preview);
        return outcome.data;
      });
    } catch (cause) {
      setError(errorText(cause, "Não foi possível lançar as contas."));
      return;
    }
    const next = billing.next;
    setBilling(null);
    setNotice(`Contas lançadas para ${billing.order.code}. Confira em Financeiro › Contas a receber.`);
    if (next && outcome.data) issueFiscal(outcome.data, billing.order, next);
  }

  function issueFiscal(source: Database, order: SalesOrder, kind: FiscalKind) {
    const invoice = salesOrderInvoices(source, order.id).find((item) => item.kind === (kind === "nfe" ? "Produtos" : "Serviços"));
    if (!invoice) {
      const kindLabel = kind === "nfe" ? "Produtos" : "Serviços";
      try {
        if (!previewSalesOrderBilling(source, order.id).some((group) => group.kind === kindLabel))
          throw new Error(`O pedido não possui valor de ${kindLabel.toLocaleLowerCase("pt-BR")} para gerar a nota.`);
      } catch (cause) {
        setError(errorText(cause, "Não foi possível preparar a nota."));
        return;
      }
      openBilling(order, kind);
      return;
    }
    if (onIssueFiscal) onIssueFiscal(kind, invoice.id);
    else setNotice(`Faturamento pronto. Abra ${kind === "nfe" ? "Notas Fiscais de Saída" : "Notas de Serviço"} para incluir a nota.`);
  }

  function generateServiceOrder(order: SalesOrder) {
    let created = "";
    const ok = run((current) => {
      const result = createServiceOrderFromSalesOrder(current, order.id);
      created = result.salesOrders.find((item) => item.id === order.id)?.serviceOrderId ?? "";
      return result;
    }, `Ordem de serviço criada a partir de ${order.code}.`, "Não foi possível gerar a ordem de serviço.");
    setCreatedServiceOrderId(ok ? created : "");
  }

  function cancel() {
    if (!cancelOrder) return;
    setError("");
    try {
      commit((current) => cancelSalesOrder(current, cancelOrder.id, cancelReason));
      setCreatedServiceOrderId("");
      setNotice(`${cancelOrder.code} cancelado${salesOrderStockPosted(cancelOrder) ? "; estoque estornado." : "."}`);
      setCancelOrder(null);
      setCancelReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível cancelar o pedido.");
    }
  }

  function orderActions(order: SalesOrder): DropdownAction[] {
    const cancelled = order.status === "Cancelado";
    const stockPosted = salesOrderStockPosted(order);
    const invoices = salesOrderInvoices(data, order.id);
    const hasProducts = order.items.some((item) => item.kind === "produto");
    const hasServices = order.items.some((item) => item.kind === "servico") || order.shippingCost + order.otherExpenses > 0;
    const soon = (label: string, icon: DropdownAction["icon"], extra: Partial<DropdownAction> = {}): DropdownAction =>
      ({ label, icon, disabled: true, hint: "em breve", onSelect: () => {}, ...extra });
    const statusActions = salesOrderStatuses.filter((status) => status !== order.status).map((status, index): DropdownAction => ({
      label: status,
      icon: status === "Cancelado" ? Ban : CircleDot,
      danger: status === "Cancelado",
      section: index === 0 ? "Alterar situação" : undefined,
      disabled: cancelled || (status === "Cancelado" && invoices.length > 0),
      hint: status === "Cancelado" && invoices.length > 0 && !cancelled ? "estorne as contas" : undefined,
      onSelect: status === "Cancelado"
        ? () => { setCancelOrder(order); setCancelReason(""); setError(""); }
        : () => run((current) => changeSalesOrderStatus(current, order.id, status),
          `${order.code} alterado para ${status}.`, "Não foi possível alterar a situação."),
    }));
    return [
      { label: salesOrderEditable(data, order) ? "Editar" : "Visualizar", icon: Pencil, onSelect: () => openOrder(order) },
      { label: "Gerar nota fiscal", icon: FileText, disabled: cancelled || !hasProducts, separatorBefore: true,
        onSelect: () => onCreateNfe ? onCreateNfe(order.id) : issueFiscal(data, order, "nfe") },
      soon("Gerar nota fiscal parcial", FileText),
      stockPosted
        ? { label: "Estornar estoque", icon: PackageMinus, disabled: cancelled,
          onSelect: () => run((current) => reverseSalesOrderStock(current, order.id), `Estoque de ${order.code} estornado.`, "Não foi possível estornar o estoque.") }
        : { label: "Lançar estoque", icon: PackageCheck, disabled: cancelled || !hasProducts,
          onSelect: () => run((current) => postSalesOrderStock(current, order.id), `Estoque de ${order.code} lançado.`, "Não foi possível lançar o estoque.") },
      invoices.length
        ? { label: "Estornar contas", icon: Undo2,
          onSelect: () => {
            if (!window.confirm(`Estornar as contas a receber de ${order.code}? Os faturamentos serão cancelados internamente.`)) return;
            run((current) => reverseSalesOrderBilling(current, order.id), `Contas de ${order.code} estornadas.`, "Não foi possível estornar as contas.");
          } }
        : { label: "Lançar contas", icon: Wallet, disabled: cancelled, onSelect: () => openBilling(order) },
      soon("Gerar NFC-e", Receipt),
      { label: "Gerar nota serviço", icon: Receipt, disabled: cancelled || !hasServices, onSelect: () => issueFiscal(data, order, "nfse") },
      { label: "Gerar ordem serviço", icon: Wrench, disabled: cancelled || !!order.serviceOrderId,
        hint: order.serviceOrderId ? "OS vinculada" : undefined, onSelect: () => generateServiceOrder(order) },
      { label: "Clonar venda", icon: Copy, onSelect: () => cloneOrder(order) },
      soon("Gerar reversão", RotateCcw),
      { label: "Imprimir", icon: Printer, separatorBefore: true, onSelect: () => setPrinting({ order, variant: "simple" }) },
      { label: "Imprimir comprovante", icon: Printer, onSelect: () => setPrinting({ order, variant: "receipt" }) },
      { label: "Imprimir c/ detalhes", icon: Printer, onSelect: () => setPrinting({ order, variant: "detailed" }) },
      soon("Imprimir etiqueta de envio", Tag),
      soon("Imprimir carnê", Printer),
      soon("Relatório de produção", ClipboardList),
      soon("Enviar por e-mail", Mail, { separatorBefore: true }),
      soon("Enviar por WhatsApp", MessageCircle),
      soon("Emitir boletos", Wallet),
      ...statusActions,
    ];
  }

  const currentOrder = editingId ? data.salesOrders.find((item) => item.id === editingId) : undefined;
  const editable = !currentOrder || salesOrderEditable(data, currentOrder);
  const amountField = (label: string, value: number, update: (amount: number) => void) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" min="0" step="0.01" disabled={!editable} value={amountInput(value)}
        onChange={(event) => update(Math.max(0, Math.round(Number(event.target.value || 0) * 100)))} />
    </label>
  );

  return <section className="sales-order-panel">
    <div className="sales-order-heading">
      <div>
        <span className="fiscal-eyebrow">OPERAÇÃO · VENDAS</span>
        <h2>Pedidos de venda</h2>
        <p>Use o menu <MoreVertical size={13} aria-hidden="true" /> de cada pedido para lançar estoque, lançar contas, gerar notas, imprimir ou alterar a situação.</p>
      </div>
      <button className="button primary" onClick={openNew}><Plus size={17} />Novo pedido</button>
    </div>
    {notice && <div className="sales-order-notice" role="status"><span>{notice}{createdServiceOrderId && onOpenServiceOrder && <> <button type="button" className="text-button" onClick={() => onOpenServiceOrder(createdServiceOrderId)}>Abrir {data.orders.find((item) => item.id === createdServiceOrderId)?.code ?? "OS"}</button></>}</span><button className="icon-button" aria-label="Fechar aviso" onClick={() => { setNotice(""); setCreatedServiceOrderId(""); }}><X size={15} /></button></div>}
    {error && !formOpen && !cancelOrder && !billing && <div className="error-message" role="alert">{error}<button className="icon-button" aria-label="Fechar erro" onClick={() => setError("")}><X size={15} /></button></div>}
    <div className="sales-order-toolbar">
      <label className="search-field"><Search size={16} /><input type="search" aria-label="Buscar pedidos de venda" placeholder="Buscar número, cliente ou item" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select aria-label="Filtrar situação do pedido" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        <option>Todos</option>{salesOrderStatuses.map((status) => <option key={status}>{status}</option>)}
      </select>
    </div>
    <div className="table-scroll">
      <table>
        <thead><tr><th>Pedido</th><th>Cliente</th><th>Venda</th><th>Entrega prevista</th><th>Total</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{orders.map((order) => {
          const stockPosted = salesOrderStockPosted(order);
          const billed = salesOrderInvoices(data, order.id).length > 0;
          return <tr key={order.id}>
            <td><button className="record-link" onClick={() => openOrder(order)}><strong>{order.code}</strong><small>{order.items.length} itens{order.quoteId ? " · orçamento" : ""}{order.serviceOrderId ? " · OS vinculada" : ""}</small></button>
              {(stockPosted || billed) && <span className="sales-order-flags">
                {stockPosted && <span title={order.stockEvents.at(-1)?.reason}>Estoque lançado</span>}
                {billed && <span title="Contas a receber lançadas">Contas lançadas</span>}
              </span>}</td>
            <td>{data.clients.find((item) => item.id === order.clientId)?.name ?? "Cliente removido"}{order.seller && <small>Vendedor: {order.seller}</small>}</td>
            <td>{displayDate(order.date)}</td><td>{order.expectedOn ? displayDate(order.expectedOn) : "—"}</td>
            <td className="amount">{currency(salesOrderTotal(order))}</td><td><SalesOrderStatusBadge status={order.status} /></td>
            <td><div className="sales-order-actions">
              <DropdownMenu label="Mais ações" accessibleLabel={`Ações do pedido ${order.code}`} triggerIcon={MoreVertical} compact actions={orderActions(order)} />
            </div></td>
          </tr>;
        })}</tbody>
      </table>
      {!orders.length && <Empty title="Nenhum pedido de venda encontrado" />}
    </div>
    {formOpen && <Modal title={editingId ? `${editable ? "Editar" : "Visualizar"} pedido ${currentOrder?.code ?? ""}` : "Novo pedido de venda"} onClose={() => setFormOpen(false)} wide>
      <form className="sales-order-form" onSubmit={save}>
        {error && <div className="error-message" role="alert">{error}</div>}
        {clonedFrom && <p className="sales-order-note" role="status">Venda clonada de {clonedFrom}. Revise os dados e salve para criar o novo pedido.</p>}
        {!editable && <p className="sales-order-note">{currentOrder?.status === "Cancelado" || currentOrder?.status === "Atendido"
          ? `Pedido ${currentOrder.status.toLocaleLowerCase("pt-BR")}: os dados comerciais estão bloqueados.`
          : "Estorne o estoque e as contas do pedido para editar os dados comerciais."}</p>}
        <div className="form-grid">
          <label className="field"><span>Cliente</span><select required disabled={!editable} value={draft.clientId} onChange={(event) => setDraft((current) => ({ ...current, clientId: event.target.value, serviceOrderId: "" }))}>
            <option value="">Selecione</option>{data.clients.filter((client) => client.active).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select></label>
          <label className="field"><span>Orçamento aprovado (opcional)</span><select disabled={!editable || !!currentOrder?.quoteId} value={draft.quoteId} onChange={(event) => chooseQuote(event.target.value)}>
            <option value="">Sem orçamento de origem</option>{eligibleQuotes.map((quote) => <option key={quote.id} value={quote.id}>{quote.code} · {data.clients.find((item) => item.id === quote.clientId)?.name}</option>)}
            {draft.quoteId && !eligibleQuotes.some((quote) => quote.id === draft.quoteId) && <option value={draft.quoteId}>{data.quotes.find((quote) => quote.id === draft.quoteId)?.code ?? "Orçamento vinculado"}</option>}
          </select></label>
          <label className="field"><span>Data da venda</span><input type="date" required disabled={!editable} value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /></label>
          <label className="field"><span>Previsão de entrega</span><input type="date" disabled={!editable} min={draft.date} value={draft.expectedOn} onChange={(event) => setDraft((current) => ({ ...current, expectedOn: event.target.value }))} /></label>
          <label className="field"><span>Vendedor</span><input list="commission-sellers" maxLength={160} disabled={!editable} value={draft.seller} onChange={(event) => setDraft((current) => ({ ...current, seller: event.target.value }))} />
            <datalist id="commission-sellers">{data.finance.commissions?.sellers.filter((seller) => seller.active)
              .map((seller) => <option key={seller.id} value={seller.name} />)}</datalist></label>
          <label className="field"><span>Condição de pagamento</span><input maxLength={500} placeholder="Informação comercial; não gera cobrança" disabled={!editable} value={draft.paymentTerms} onChange={(event) => setDraft((current) => ({ ...current, paymentTerms: event.target.value }))} /></label>
          <label className="field"><span>Vincular a OS (opcional)</span><select disabled={!editable || !draft.clientId} value={draft.serviceOrderId} onChange={(event) => setDraft((current) => ({ ...current, serviceOrderId: event.target.value }))}>
            <option value="">Sem OS vinculada</option>{data.orders.filter((order) => order.clientId === draft.clientId).map((order) => <option key={order.id} value={order.id}>{order.code} · {order.title}</option>)}
          </select></label>
          <label className="field"><span>Depósito para baixa</span><select required disabled={!editable} value={draft.stockLocationId} onChange={(event) => setDraft((current) => ({ ...current, stockLocationId: event.target.value }))}>
            {activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select></label>
        </div>
        <div className="sales-order-items-heading"><h3>Itens do pedido</h3>{editable && <button type="button" className="button secondary" onClick={() => setDraft((current) => ({ ...current, items: [...current.items, blankItem()] }))}><Plus size={15} />Adicionar item</button>}</div>
        <div className="table-scroll">
          <table className="sales-order-items"><thead><tr><th>Produto ou serviço</th><th>Qtd.</th><th>Preço unitário</th><th>Desc. %</th><th>Total</th><th /></tr></thead>
            <tbody>{draft.items.map((item, index) => {
              const reference = item.kind === "produto" ? data.products.find((product) => product.id === item.referenceId) : data.services.find((service) => service.id === item.referenceId);
              const lineTotal = Math.round(Math.round(item.quantity * item.price) * (10000 - item.discountPercent) / 10000);
              return <tr key={item.id}>
                <td><select required disabled={!editable} aria-label={`Item ${index + 1}`} value={reference ? `${item.kind}:${item.referenceId}` : ""} onChange={(event) => {
                  const [kind, id] = event.target.value.split(":");
                  const product = kind === "produto" ? data.products.find((entry) => entry.id === id) : undefined;
                  const service = kind === "servico" ? data.services.find((entry) => entry.id === id) : undefined;
                  const selected = product ?? service;
                  if (!selected) return;
                  setDraft((current) => ({ ...current, items: current.items.map((line, lineIndex) => lineIndex === index
                    ? { ...line, kind: product ? "produto" : "servico", referenceId: selected.id, name: selected.name, price: selected.price }
                    : line) }));
                }}><option value="">Selecione produto/serviço</option><optgroup label="Produtos">{data.products.map((product) => <option key={product.id} value={`produto:${product.id}`}>{product.name} · disponível {stockAvailable(data, product.id, draft.stockLocationId)}</option>)}</optgroup><optgroup label="Serviços">{data.services.map((service) => <option key={service.id} value={`servico:${service.id}`}>{service.name}</option>)}</optgroup></select></td>
                <td><input aria-label={`Quantidade do item ${index + 1}`} type="number" min={item.kind === "produto" ? 1 : 0.01} step={item.kind === "produto" ? 1 : 0.01} required disabled={!editable} value={item.quantity} onChange={(event) => setDraft((current) => ({ ...current, items: current.items.map((line, lineIndex) => lineIndex === index ? { ...line, quantity: Number(event.target.value) } : line) }))} /></td>
                <td><input aria-label={`Preço do item ${index + 1}`} type="number" min="0" step="0.01" required disabled={!editable} value={amountInput(item.price)} onChange={(event) => setDraft((current) => ({ ...current, items: current.items.map((line, lineIndex) => lineIndex === index ? { ...line, price: Math.max(0, Math.round(Number(event.target.value || 0) * 100)) } : line) }))} /></td>
                <td><input aria-label={`Desconto percentual do item ${index + 1}`} type="number" min="0" max="100" step="0.01" disabled={!editable} value={item.discountPercent / 100} onChange={(event) => setDraft((current) => ({ ...current, items: current.items.map((line, lineIndex) => lineIndex === index ? { ...line, discountPercent: Math.min(10000, Math.max(0, Math.round(Number(event.target.value || 0) * 100))) } : line) }))} /></td>
                <td className="amount">{currency(lineTotal)}</td><td>{editable && draft.items.length > 1 && <button type="button" className="icon-button danger" title="Remover item" aria-label={`Remover item ${index + 1}`} onClick={() => setDraft((current) => ({ ...current, items: current.items.filter((_, lineIndex) => lineIndex !== index) }))}><Trash2 size={15} /></button>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="sales-order-costs">
          <label className="field"><span>Desconto geral</span><input type="number" min="0" step="0.01" disabled={!editable} value={amountInput(draft.discount)} onChange={(event) => setDraft((current) => ({ ...current, discount: Math.max(0, Math.round(Number(event.target.value || 0) * 100)) }))} /></label>
          {amountField("Frete", draft.shippingCost, (amount) => setDraft((current) => ({ ...current, shippingCost: amount })))}
          {amountField("Outras despesas", draft.otherExpenses, (amount) => setDraft((current) => ({ ...current, otherExpenses: amount })))}
          <div className="sales-order-total"><span>Subtotal dos itens: {currency(salesOrderSubtotal(draft.items))}</span><strong>Total do pedido: {currency(salesOrderTotal(draft))}</strong></div>
        </div>
        <div className="form-grid">
          <label className="field"><span>Observações</span><textarea rows={3} maxLength={5000} disabled={!editable} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
          <label className="field"><span>Observações internas</span><textarea rows={3} maxLength={5000} disabled={!editable} value={draft.internalNotes} onChange={(event) => setDraft((current) => ({ ...current, internalNotes: event.target.value }))} /></label>
        </div>
        {currentOrder && <div className="sales-order-history"><h3>Histórico</h3>{[
          ...currentOrder.events.map((event) => ({ at: event.at, label: <SalesOrderStatusBadge status={event.status} />, reason: event.reason })),
          ...currentOrder.stockEvents.map((event) => ({ at: event.at, label: <span className="badge neutral"><span />{event.type === "lancamento" ? "Estoque lançado" : "Estoque estornado"}</span>, reason: event.reason })),
        ].toSorted((first, second) => first.at.localeCompare(second.at)).map((event, index) => <p key={`${event.at}:${index}`}>{event.label} {new Date(event.at).toLocaleString("pt-BR")} · {event.reason}</p>)}</div>}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={() => setFormOpen(false)}>Fechar</button>
          {editable && <button type="submit" className="button primary" disabled={saving}>{saving ? "Salvando..." : "Salvar pedido"}</button>}
        </div>
      </form>
    </Modal>}
    {billing && <Modal title={`Lançar contas · ${billing.order.code}`} onClose={() => setBilling(null)}>
      {error && <div className="error-message" role="alert">{error}</div>}
      <div className="sales-order-billing">
        <p>Cria o faturamento interno e uma conta a receber para cada grupo. Produtos seguem para NF-e e serviços (inclui frete e outras despesas) para NFS-e.</p>
        {!data.finance.accounts.some((account) => account.active) && <p role="alert">Cadastre uma conta bancária ativa em Financeiro antes de lançar contas.</p>}
        {billing.preview.map((group) => {
          const terms = billing.terms[group.kind] ?? defaultTerms();
          const update = (change: Partial<BillingTerms>) => setBilling((current) => current && ({
            ...current, terms: { ...current.terms, [group.kind]: { ...terms, ...change } },
          }));
          return <fieldset key={group.kind} className="sales-order-billing-group">
            <legend>{group.kind} · {currency(group.amount)} <small>{group.kind === "Produtos" ? "NF-e" : "NFS-e"}</small></legend>
            <div className="form-grid">
              <label className="field"><span>Conta bancária</span><select required value={terms.accountId} aria-label={`Conta bancária de ${group.kind}`} onChange={(event) => update({ accountId: event.target.value })}>
                <option value="">Selecione</option>{data.finance.accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select></label>
              <label className="field"><span>Vencimento</span><input type="date" required value={terms.dueOn} aria-label={`Vencimento de ${group.kind}`} onChange={(event) => update({ dueOn: event.target.value })} /></label>
              <label className="field"><span>Forma de pagamento</span><select value={terms.paymentMethod} aria-label={`Forma de pagamento de ${group.kind}`} onChange={(event) => update({ paymentMethod: event.target.value as BillingTerms["paymentMethod"] })}>
                <option>Pix</option><option>Boleto</option>
              </select></label>
            </div>
          </fieldset>;
        })}
        <p className="sales-order-grand-total">Total: <strong>{currency(billing.preview.reduce((sum, group) => sum + group.amount, 0))}</strong></p>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={() => setBilling(null)}>Voltar</button>
        <button className="button primary" onClick={confirmBilling}
          disabled={billing.preview.some((group) => !billing.terms[group.kind]?.accountId || !billing.terms[group.kind]?.dueOn)}>
          {billing.next ? "Lançar contas e gerar nota" : "Lançar contas"}
        </button>
      </div>
    </Modal>}
    {printing && <SalesOrderPrintModal data={data} order={data.salesOrders.find((item) => item.id === printing.order.id) ?? printing.order}
      variant={printing.variant} onClose={() => setPrinting(null)} />}
    {cancelOrder && <Modal title={`Cancelar ${cancelOrder.code}`} onClose={() => setCancelOrder(null)}>
      {error && <div className="error-message" role="alert">{error}</div>}
      <div className="sales-order-cancel">
        <p>{salesOrderStockPosted(cancelOrder) ? "O cancelamento estornará o estoque lançado de cada produto." : "O pedido será encerrado sem movimentar o estoque."} Pedidos cancelados não podem mudar de situação.</p>
        <label className="field"><span>Motivo do cancelamento</span><textarea rows={3} minLength={5} maxLength={1000} required value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>
      </div>
      <div className="modal-footer"><button className="button secondary" onClick={() => setCancelOrder(null)}>Voltar</button><button className="button primary" onClick={cancel} disabled={cancelReason.trim().length < 5}>Confirmar cancelamento</button></div>
    </Modal>}
  </section>;
}
