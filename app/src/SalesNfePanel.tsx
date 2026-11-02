import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BadgeCheck, Ban, CheckCircle2, ClipboardList, Code2, Copy, CopyPlus, Eye, FilePlus2, FileText, Mail, MessageCircle, MoreVertical,
  PackageMinus, PackagePlus, Pencil, Plus, Printer, Receipt, Search, Send, Settings, Tag, Trash2, Undo2, Wallet,
} from "lucide-react";
import { currency, displayDate } from "./domain";
import type { Database } from "./domain";
import { Modal } from "./components";
import { DropdownMenu } from "./DropdownMenu";
import type { DropdownAction } from "./DropdownMenu";
import { FiscalPanel } from "./FiscalPanel";
import { fiscalConfigured } from "./fiscalApi";
import { NfeEditor } from "./NfeEditor";
import {
  blankNfe, cancelNfe, cloneNfe, deleteNfe, itemGross, nfeAccountsPosted, nfeBlockingIssues, nfeDraftFromSalesOrder, nfeDraftFromServiceOrder, nfeNumberLabel,
  nfeStockPosted, nfeTotals, nfeWarnings, postNfeAccounts, postNfeStock, reverseNfeAccounts, reverseNfeStock, saveNfe,
} from "./outgoingInvoices";
import type { OutgoingInvoice } from "./outgoingInvoiceSchema";
import { nfeDraftFromQuote } from "./quoteInvoices";
import "./NfeEditor.css";

type View = { kind: "list" } | { kind: "edit"; nfe: OutgoingInvoice } | { kind: "settings" } | { kind: "backend" };

function soon(label: string, icon: DropdownAction["icon"], separatorBefore = false): DropdownAction {
  return { label, icon, disabled: true, hint: "em breve", separatorBefore, onSelect: () => undefined };
}

function draftFor(data: Database, orderId?: string, serviceOrderId?: string, quoteId?: string) {
  if (quoteId) return nfeDraftFromQuote(data, quoteId);
  return serviceOrderId ? nfeDraftFromServiceOrder(data, serviceOrderId) : nfeDraftFromSalesOrder(data, orderId!);
}

function initialView(data: Database, orderId?: string, serviceOrderId?: string, quoteId?: string): View {
  if (!orderId && !serviceOrderId && !quoteId) return { kind: "list" };
  const existing = orderId ? data.outgoingInvoices.find((item) => item.salesOrderId === orderId && item.status === "Pendente") : undefined;
  if (existing) return { kind: "edit", nfe: existing };
  try {
    return { kind: "edit", nfe: draftFor(data, orderId, serviceOrderId, quoteId) };
  } catch {
    return { kind: "list" };
  }
}

export function SalesNfePanel({ data, commit, initialOrderId, initialServiceOrderId, initialQuoteId, onOpenOrders }: {
  data: Database;
  commit: (update: (current: Database) => Database) => void;
  initialOrderId?: string;
  initialServiceOrderId?: string;
  initialQuoteId?: string;
  onOpenOrders?: () => void;
}) {
  const [view, setView] = useState<View>(() => initialView(data, initialOrderId, initialServiceOrderId, initialQuoteId));
  const [startError] = useState(() => {
    if ((!initialOrderId && !initialServiceOrderId && !initialQuoteId) ||
      initialView(data, initialOrderId, initialServiceOrderId, initialQuoteId).kind === "edit") return "";
    try { draftFor(data, initialOrderId, initialServiceOrderId, initialQuoteId); return ""; } catch (cause) {
      return cause instanceof Error ? cause.message : "Não foi possível gerar a nota.";
    }
  });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(startError);
  const [validation, setValidation] = useState<{ nfe: OutgoingInvoice; issues: string[]; warnings: string[] } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OutgoingInvoice | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [printTarget, setPrintTarget] = useState<OutgoingInvoice | null>(null);

  const rows = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return [...data.outgoingInvoices]
      .filter((item) => !status || item.status === status)
      .filter((item) => !term || nfeNumberLabel(item).includes(term) || item.recipient.name.toLocaleLowerCase("pt-BR").includes(term))
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number - a.number);
  }, [data.outgoingInvoices, query, status]);
  const active = data.outgoingInvoices.filter((item) => item.status !== "Cancelada");
  const activeTotal = active.reduce((sum, item) => sum + nfeTotals(item).total, 0);

  function run(operation: (current: Database) => Database, success: string, fallback: string) {
    setError("");
    setNotice("");
    try {
      commit(operation);
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    }
  }
  function save(nfe: OutgoingInvoice) {
    let saved: OutgoingInvoice | undefined;
    try {
      commit((current) => {
        const next = saveNfe(current, nfe);
        saved = next.outgoingInvoices.find((item) => item.id === nfe.id);
        return next;
      });
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Não foi possível salvar a nota fiscal.";
    }
    setView({ kind: "list" });
    setError("");
    setNotice(`Nota fiscal ${saved ? nfeNumberLabel(saved) : ""} salva como Pendente${saved && saved.number !== nfe.number ? ` (número alterado de ${nfeNumberLabel(nfe)})` : ""}.`);
  }
  function actions(nfe: OutgoingInvoice): DropdownAction[] {
    const pending = nfe.status === "Pendente";
    const accounts = nfeAccountsPosted(data, nfe);
    const stock = nfeStockPosted(data, nfe);
    const label = nfeNumberLabel(nfe);
    return [
      { label: pending ? "Editar" : "Visualizar", icon: pending ? Pencil : Eye, onSelect: () => setView({ kind: "edit", nfe }) },
      soon("Enviar nota fiscal", Send),
      { label: "Validar nota fiscal", icon: BadgeCheck, disabled: !pending,
        onSelect: () => setValidation({ nfe, issues: nfeBlockingIssues(nfe), warnings: nfeWarnings(nfe) }) },
      soon("Ver XML", Code2),
      soon("Enviar por e-mail", Mail),
      soon("Enviar por WhatsApp", MessageCircle),
      soon("Gerar NF-e complementar", FilePlus2, true),
      soon("Gerar boletos", Receipt),
      accounts
        ? { label: "Estornar contas", icon: Undo2, separatorBefore: true,
          onSelect: () => run((current) => reverseNfeAccounts(current, nfe.id), `Contas da nota ${label} estornadas.`, "Não foi possível estornar as contas.") }
        : { label: "Lançar contas", icon: Wallet, separatorBefore: true, disabled: !pending,
          onSelect: () => run((current) => postNfeAccounts(current, nfe.id), `Contas da nota ${label} lançadas.`, "Não foi possível lançar as contas.") },
      stock
        ? { label: "Estornar estoque", icon: PackageMinus,
          onSelect: () => run((current) => reverseNfeStock(current, nfe.id), `Estoque da nota ${label} estornado.`, "Não foi possível estornar o estoque.") }
        : { label: "Lançar estoque", icon: PackagePlus, disabled: !pending || !nfe.salesOrderId, hint: nfe.salesOrderId ? undefined : "somente com pedido",
          onSelect: () => run((current) => postNfeStock(current, nfe.id), `Estoque da nota ${label} lançado.`, "Não foi possível lançar o estoque.") },
      { label: "Clonar nota fiscal", icon: Copy, separatorBefore: true, onSelect: () => {
        setError("");
        setNotice("");
        try { setView({ kind: "edit", nfe: cloneNfe(data, nfe.id) }); } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Não foi possível clonar a nota.");
        }
      } },
      soon("Clonar para nota de entrada", CopyPlus),
      { label: "Imprimir espelho da NF", icon: Printer, separatorBefore: true, onSelect: () => setPrintTarget(nfe) },
      soon("Imprimir DANFE", FileText),
      soon("Imprimir etiquetas", Tag),
      { label: "Cancelar nota fiscal", icon: Ban, separatorBefore: true, danger: true, disabled: !pending,
        onSelect: () => { setCancelTarget(nfe); setCancelReason(""); setCancelError(""); } },
      { label: "Excluir", icon: Trash2, danger: true, disabled: !pending || accounts, hint: accounts ? "estorne as contas" : undefined,
        onSelect: () => {
          if (window.confirm(`Excluir a nota fiscal ${label}?`))
            run((current) => deleteNfe(current, nfe.id), `Nota fiscal ${label} excluída.`, "Não foi possível excluir a nota.");
        } },
    ];
  }

  if (view.kind === "edit")
    return <NfeEditor key={view.nfe.id} data={data} initial={view.nfe} onSave={save} onCancel={() => setView({ kind: "list" })} />;
  if (view.kind === "settings" || view.kind === "backend")
    return <FiscalPanel data={data} commit={commit} documentKind="nfe" presentation="sales" eyebrow="OPERAÇÃO · VENDAS"
      initialView={view.kind === "settings" ? "settings" : "documents"} onBackToList={() => setView({ kind: "list" })}
      onIncludeDocument={() => setView({ kind: "edit", nfe: blankNfe(data) })} />;

  return <section className="sales-nfe-panel">
    <header className="sales-nfe-heading">
      <div>
        <span className="fiscal-eyebrow">FISCAL · SAÍDAS</span>
        <h2>Notas fiscais de saída</h2>
        <p>Vendas / NF-e · Produtos</p>
      </div>
      <div className="nfe-editor-actions">
        {onOpenOrders && <button type="button" className="button secondary" onClick={onOpenOrders}><ClipboardList size={16} />Gerar a partir de pedido</button>}
        <button type="button" className="button primary" onClick={() => { setNotice(""); setError(""); setView({ kind: "edit", nfe: blankNfe(data) }); }}>
          <Plus size={16} />Incluir nota fiscal</button>
      </div>
    </header>
    {notice && <div className="sales-order-notice" role="status"><span>{notice}</span></div>}
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="sales-nfe-layout">
      <div>
        <div className="sales-nfe-toolbar">
          <label className="search-field"><Search size={16} aria-hidden="true" />
            <input aria-label="Pesquisar notas fiscais" placeholder="Pesquise por número ou destinatário" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <select aria-label="Situação" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todas as situações</option><option>Pendente</option><option>Cancelada</option>
          </select>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>Número</th><th>Data de emissão</th><th>Nome</th><th>Situação</th><th className="amount">Valor</th><th><span className="sr-only">Indicadores</span></th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>{rows.map((nfe) => {
            const order = nfe.salesOrderId ? data.salesOrders.find((item) => item.id === nfe.salesOrderId) : undefined;
            const accounts = nfeAccountsPosted(data, nfe);
            return <tr key={nfe.id}>
              <td><button type="button" className="record-link" onClick={() => setView({ kind: "edit", nfe })}><strong>{nfeNumberLabel(nfe)}</strong><small>Série {nfe.series}</small></button></td>
              <td>{displayDate(nfe.issueDate)}</td>
              <td>{nfe.recipient.name || "—"}</td>
              <td><span className={`badge ${nfe.status === "Pendente" ? "amber" : "red"}`}>{nfe.status}</span></td>
              <td className="amount">{currency(nfeTotals(nfe).total)}</td>
              <td><span className="sales-nfe-icons">
                {accounts && <Wallet size={15} aria-label="Contas lançadas"><title>Contas lançadas</title></Wallet>}
                {order && <ClipboardList size={15} aria-label={`Pedido ${order.code}`}><title>{`Pedido ${order.code}`}</title></ClipboardList>}
              </span></td>
              <td><DropdownMenu label="Mais ações" accessibleLabel={`Ações da nota ${nfeNumberLabel(nfe)}`} triggerIcon={MoreVertical} compact actions={actions(nfe)} /></td>
            </tr>;
          })}</tbody>
        </table>
        {!rows.length && <p className="nfe-empty">{data.outgoingInvoices.length ? "Nenhuma nota encontrada com esses filtros." : "Nenhuma nota fiscal de saída. Inclua uma nota ou gere a partir de um pedido de venda."}</p>}
        </div>
      </div>
      <aside className="sales-nfe-aside">
        <div className="nfe-section">
          <h3>Resumo</h3>
          <p>{active.length} nota{active.length === 1 ? "" : "s"} pendente{active.length === 1 ? "" : "s"}</p>
          <p><strong>{currency(activeTotal)}</strong></p>
        </div>
        <button type="button" className="button secondary" onClick={() => setView({ kind: "settings" })}><Settings size={16} />Configuração fiscal</button>
        {fiscalConfigured && <button type="button" className="button secondary" onClick={() => setView({ kind: "backend" })}><FileText size={16} />Documentos no backend fiscal</button>}
      </aside>
    </div>

    {validation && <Modal title={`Validar nota fiscal ${nfeNumberLabel(validation.nfe)}`} onClose={() => setValidation(null)}>
      <div className="modal-body">
        {!validation.issues.length && !validation.warnings.length
          ? <p className="nfe-hint"><CheckCircle2 size={16} aria-hidden="true" />Nota fiscal correta, pronta para o envio.</p>
          : <>
            {validation.issues.length > 0 && <><h3>Pendências</h3><ul>{validation.issues.map((text) => <li key={text}>{text}</li>)}</ul></>}
            {validation.warnings.length > 0 && <><h3>Avisos</h3><ul>{validation.warnings.map((text) => <li key={text}>{text}</li>)}</ul></>}
          </>}
      </div>
      <footer className="modal-footer">
        <button type="button" className="button secondary" onClick={() => setValidation(null)}>Fechar</button>
        {validation.nfe.status === "Pendente" && <button type="button" className="button primary"
          onClick={() => { const nfe = validation.nfe; setValidation(null); setView({ kind: "edit", nfe }); }}>Editar nota</button>}
      </footer>
    </Modal>}

    {cancelTarget && <Modal title={`Cancelar nota fiscal ${nfeNumberLabel(cancelTarget)}`} onClose={() => setCancelTarget(null)}>
      <div className="modal-body">
        {cancelError && <div className="error-message" role="alert">{cancelError}</div>}
        <label className="field"><span>Motivo do cancelamento</span>
          <textarea rows={3} maxLength={400} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>
      </div>
      <footer className="modal-footer">
        <button type="button" className="button secondary" onClick={() => setCancelTarget(null)}>Voltar</button>
        <button type="button" className="button primary" onClick={() => {
          try {
            commit((current) => cancelNfe(current, cancelTarget.id, cancelReason));
            setNotice(`Nota fiscal ${nfeNumberLabel(cancelTarget)} cancelada.`);
            setError("");
            setCancelTarget(null);
          } catch (cause) {
            setCancelError(cause instanceof Error ? cause.message : "Não foi possível cancelar a nota.");
          }
        }}>Cancelar nota</button>
      </footer>
    </Modal>}

    {printTarget && <NfePrintModal data={data} nfe={printTarget} onClose={() => setPrintTarget(null)} />}
  </section>;
}

function NfePrintModal({ data, nfe, onClose }: { data: Database; nfe: OutgoingInvoice; onClose: () => void }) {
  const totals = nfeTotals(nfe);
  const address = [nfe.recipient.street, nfe.recipient.number, nfe.recipient.district, nfe.recipient.city, nfe.recipient.state].filter(Boolean).join(", ");
  return createPortal(<Modal title={`Espelho da NF ${nfeNumberLabel(nfe)}`} wide onClose={onClose}>
    <div className="modal-body document-body">
      <div className="document-brand">
        {data.settings.logo
          ? <img className="brand-image compact" src={data.settings.logo} alt={data.settings.company} />
          : <strong>{data.settings.company}</strong>}
        <span>ESPELHO DE NOTA FISCAL · SEM VALOR FISCAL</span>
      </div>
      <div className="detail-heading"><h2>NF-e {nfeNumberLabel(nfe)} · Série {nfe.series}</h2><span>{nfe.status}</span></div>
      <div className="detail-grid">
        <div><small>Natureza da operação</small><strong>{nfe.operationNature}</strong></div>
        <div><small>Emissão</small><strong>{displayDate(nfe.issueDate)}</strong></div>
        <div><small>Destinatário</small><strong>{nfe.recipient.name}</strong></div>
        <div><small>CPF/CNPJ</small><strong>{nfe.recipient.document || "—"}</strong></div>
        <div><small>Endereço</small><strong>{address || "—"}</strong></div>
      </div>
      <table className="document-table">
        <thead><tr><th>Código</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th>UN</th><th>Qtde</th><th>Valor un</th><th>Total</th></tr></thead>
        <tbody>{nfe.items.map((item) => <tr key={item.id}>
          <td>{item.code || "—"}</td><td>{item.name}</td><td>{item.fields["data.ncm"] || "—"}</td><td>{item.fields["data.cfop"] || "—"}</td>
          <td>{item.unit}</td><td>{item.quantity}</td><td>{currency(item.price)}</td><td>{currency(itemGross(item))}</td>
        </tr>)}</tbody>
      </table>
      <div className="document-total">
        <span>Produtos {currency(totals.products)}</span>
        {totals.discount > 0 && <span>Desconto {currency(totals.discount)}</span>}
        {totals.freight > 0 && <span>Frete {currency(totals.freight)}</span>}
        <span>ICMS {currency(totals.icms)} · IPI {currency(totals.ipi)} · IBS {currency(totals.ibs)} · CBS {currency(totals.cbs)}</span>
        <strong>Total da nota {currency(totals.total)}</strong>
      </div>
      {nfe.payment.installments.length > 0 && <p>Parcelas: {nfe.payment.installments.map((item) => `${displayDate(item.dueOn)} ${currency(item.amount)} (${item.method})`).join(" · ")}</p>}
      {nfe.additional.complementary && <p>{nfe.additional.complementary}</p>}
      {nfe.additional.natureComplementary && <p>{nfe.additional.natureComplementary}</p>}
    </div>
    <footer className="modal-footer">
      <button type="button" className="button secondary" onClick={onClose}>Fechar</button>
      <button type="button" className="button primary" onClick={() => window.print()}><Printer size={16} />Imprimir</button>
    </footer>
  </Modal>, document.body);
}
