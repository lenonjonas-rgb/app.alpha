import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BadgeCheck, Ban, CheckCircle2, ClipboardList, Copy, Eye, FileCheck2, FileText, Mail, MoreVertical, Pencil, Plus, Printer, Receipt,
  ScrollText, Search, Send, Settings, Trash2, Undo2, Wallet, Wrench,
} from "lucide-react";
import { currency, displayDate } from "./domain";
import type { Database } from "./domain";
import { Modal } from "./components";
import { DropdownMenu } from "./DropdownMenu";
import type { DropdownAction } from "./DropdownMenu";
import { FiscalPanel } from "./FiscalPanel";
import { fiscalConfigured } from "./fiscalApi";
import { NfseEditor } from "./NfseEditor";
import { nfseOperationNatures } from "./serviceInvoiceSchema";
import type { ServiceInvoice } from "./serviceInvoiceSchema";
import {
  blankNfse, cancelNfse, cloneNfse, deleteNfse, nfseAccountsPosted, nfseBillingTarget, nfseBlockingIssues, nfseDraftFromBillingInvoice,
  nfseDraftFromServiceOrder, nfseNumberLabel, nfseTotals, nfseWarnings, postNfseAccounts, registerNfseIssue, reverseNfseAccounts, saveNfse,
} from "./serviceInvoices";
import "./NfeEditor.css";

export type NfseStart = { kind: "invoice" | "serviceOrder"; id: string };
type View = { kind: "list" } | { kind: "edit"; nfse: ServiceInvoice } | { kind: "settings" } | { kind: "backend" };

function soon(label: string, icon: DropdownAction["icon"], separatorBefore = false): DropdownAction {
  return { label, icon, disabled: true, hint: "em breve", separatorBefore, onSelect: () => undefined };
}

function draftFor(data: Database, start?: NfseStart): { view: View; error: string } {
  if (!start) return { view: { kind: "list" }, error: "" };
  const existing = data.serviceInvoices.find((item) => item.status !== "Cancelada" &&
    (start.kind === "invoice" ? item.invoiceId === start.id : item.serviceOrderId === start.id));
  if (existing) return { view: { kind: "edit", nfse: existing }, error: "" };
  try {
    const nfse = start.kind === "invoice" ? nfseDraftFromBillingInvoice(data, start.id) : nfseDraftFromServiceOrder(data, start.id);
    return { view: { kind: "edit", nfse }, error: "" };
  } catch (cause) {
    return { view: { kind: "list" }, error: cause instanceof Error ? cause.message : "Não foi possível gerar a nota de serviço." };
  }
}

const statusTone = { Pendente: "amber", Emitida: "green", Cancelada: "red" } as const;

export function SalesNfsePanel({ data, commit, start, onOpenOrders }: {
  data: Database;
  commit: (update: (current: Database) => Database) => void;
  start?: NfseStart;
  onOpenOrders?: () => void;
}) {
  const [initial] = useState(() => draftFor(data, start));
  const [view, setView] = useState<View>(initial.view);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [month, setMonth] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(initial.error);
  const [validation, setValidation] = useState<{ nfse: ServiceInvoice; issues: string[]; warnings: string[] } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ServiceInvoice | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [modalError, setModalError] = useState("");
  const [issueTarget, setIssueTarget] = useState<ServiceInvoice | null>(null);
  const [issueNumber, setIssueNumber] = useState("");
  const [printTarget, setPrintTarget] = useState<ServiceInvoice | null>(null);

  const rows = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return [...data.serviceInvoices]
      .filter((item) => !status || item.status === status)
      .filter((item) => !month || item.issueDate.startsWith(month))
      .filter((item) => !term || nfseNumberLabel(item).includes(term) || item.nfseNumber.includes(term)
        || item.recipient.name.toLocaleLowerCase("pt-BR").includes(term))
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.rpsNumber - a.rpsNumber);
  }, [data.serviceInvoices, query, status, month]);
  const summary = (["Pendente", "Emitida", "Cancelada"] as const).map((name) => {
    const items = data.serviceInvoices.filter((item) => item.status === name);
    return { name, count: items.length, total: items.reduce((sum, item) => sum + nfseTotals(item).total, 0) };
  });

  function run(operation: (current: Database) => Database, success: string, fallback: string) {
    setError("");
    setNotice("");
    try {
      commit(operation);
      setNotice(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
      return false;
    }
  }
  function save(nfse: ServiceInvoice) {
    let saved: ServiceInvoice | undefined;
    try {
      commit((current) => {
        const next = saveNfse(current, nfse);
        saved = next.serviceInvoices.find((item) => item.id === nfse.id);
        return next;
      });
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Não foi possível salvar a nota de serviço.";
    }
    setView({ kind: "list" });
    setError("");
    setNotice(`Nota de serviço RPS ${saved ? nfseNumberLabel(saved) : ""} salva como Pendente${saved && saved.rpsNumber !== nfse.rpsNumber ? ` (número alterado de ${nfseNumberLabel(nfse)})` : ""}.`);
  }
  function actions(nfse: ServiceInvoice): DropdownAction[] {
    const pending = nfse.status === "Pendente";
    const target = nfseBillingTarget(data, nfse);
    const accounts = target.mode === "linked" || target.mode === "entries";
    const label = nfseNumberLabel(nfse);
    return [
      { label: pending ? "Editar" : "Visualizar", icon: pending ? Pencil : Eye, onSelect: () => setView({ kind: "edit", nfse }) },
      soon("Enviar NFS-e", Send),
      { label: "Validar nota", icon: BadgeCheck, disabled: !pending,
        onSelect: () => setValidation({ nfse, issues: nfseBlockingIssues(nfse), warnings: nfseWarnings(nfse) }) },
      { label: "Informar emissão (nº NFS-e)", icon: FileCheck2, disabled: !pending,
        onSelect: () => { setIssueTarget(nfse); setIssueNumber(""); setModalError(""); } },
      soon("Enviar por e-mail", Mail),
      soon("Emitir boletos", Receipt, true),
      target.mode === "entries" && !nfse.contractChargeId
        ? { label: "Estornar contas", icon: Undo2,
          onSelect: () => run((current) => reverseNfseAccounts(current, nfse.id), `Contas da nota ${label} estornadas.`, "Não foi possível estornar as contas.") }
        : { label: "Lançar contas", icon: Wallet, disabled: !pending || accounts || target.mode === "external",
          hint: accounts ? "já lançadas" : target.mode === "external" ? "pela origem" : undefined,
          onSelect: () => run((current) => postNfseAccounts(current, nfse.id), `Contas da nota ${label} lançadas.`, "Não foi possível lançar as contas.") },
      { label: "Clonar nota", icon: Copy, separatorBefore: true, onSelect: () => {
        setError("");
        setNotice("");
        try { setView({ kind: "edit", nfse: cloneNfse(data, nfse.id) }); } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Não foi possível clonar a nota.");
        }
      } },
      { label: "Imprimir espelho da NFS-e", icon: Printer, onSelect: () => setPrintTarget(nfse) },
      soon("Gerar arquivo TXT/XML", ScrollText),
      { label: "Cancelar nota", icon: Ban, separatorBefore: true, danger: true, disabled: nfse.status === "Cancelada",
        onSelect: () => { setCancelTarget(nfse); setCancelReason(""); setModalError(""); } },
      { label: "Excluir", icon: Trash2, danger: true, disabled: !pending || target.mode === "entries",
        hint: target.mode === "entries" ? "estorne as contas" : undefined,
        onSelect: () => {
          if (window.confirm(`Excluir a nota de serviço RPS ${label}?`))
            run((current) => deleteNfse(current, nfse.id), `Nota de serviço ${label} excluída.`, "Não foi possível excluir a nota.");
        } },
    ];
  }

  if (view.kind === "edit")
    return <NfseEditor key={view.nfse.id} data={data} initial={view.nfse} onSave={save} onCancel={() => setView({ kind: "list" })} />;
  if (view.kind === "settings" || view.kind === "backend")
    return <FiscalPanel data={data} commit={commit} documentKind="nfse" presentation="sales" eyebrow="OPERAÇÃO · VENDAS"
      initialView={view.kind === "settings" ? "settings" : "documents"} onBackToList={() => setView({ kind: "list" })}
      onIncludeDocument={() => setView({ kind: "edit", nfse: blankNfse(data) })} />;

  return <section className="sales-nfe-panel">
    <header className="sales-nfe-heading">
      <div>
        <span className="fiscal-eyebrow">FISCAL · SERVIÇOS</span>
        <h2>Notas de serviço</h2>
        <p>Vendas / NFS-e · Serviços prestados</p>
      </div>
      <div className="nfe-editor-actions">
        {onOpenOrders && <button type="button" className="button secondary" onClick={onOpenOrders}><ClipboardList size={16} />Gerar a partir de pedido</button>}
        <button type="button" className="button primary" onClick={() => { setNotice(""); setError(""); setView({ kind: "edit", nfse: blankNfse(data) }); }}>
          <Plus size={16} />Incluir nota de serviço</button>
      </div>
    </header>
    {notice && <div className="sales-order-notice" role="status"><span>{notice}</span></div>}
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="sales-nfe-layout">
      <div>
        <div className="sales-nfe-toolbar">
          <label className="search-field"><Search size={16} aria-hidden="true" />
            <input aria-label="Pesquisar notas de serviço" placeholder="Pesquise por RPS, NFS-e ou cliente" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <input type="month" aria-label="Mês de emissão" value={month} onChange={(event) => setMonth(event.target.value)} />
          <select aria-label="Situação" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todas as situações</option><option>Pendente</option><option>Emitida</option><option>Cancelada</option>
          </select>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>RPS</th><th>NFS-e</th><th>Data de emissão</th><th>Cliente</th><th>Situação</th><th className="amount">Valor</th><th><span className="sr-only">Indicadores</span></th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>{rows.map((nfse) => {
            const order = nfse.salesOrderId ? data.salesOrders.find((item) => item.id === nfse.salesOrderId) : undefined;
            const serviceOrder = nfse.serviceOrderId ? data.orders.find((item) => item.id === nfse.serviceOrderId) : undefined;
            const accounts = nfseAccountsPosted(data, nfse);
            return <tr key={nfse.id}>
              <td><button type="button" className="record-link" onClick={() => setView({ kind: "edit", nfse })}><strong>{nfseNumberLabel(nfse)}</strong><small>Série {nfse.rpsSeries}</small></button></td>
              <td>{nfse.nfseNumber || "—"}</td>
              <td>{displayDate(nfse.issueDate)}</td>
              <td>{nfse.recipient.name || "—"}</td>
              <td><span className={`badge ${statusTone[nfse.status]}`}>{nfse.status}</span></td>
              <td className="amount">{currency(nfseTotals(nfse).total)}</td>
              <td><span className="sales-nfe-icons">
                {accounts && <Wallet size={15} aria-label="Contas lançadas"><title>Contas lançadas</title></Wallet>}
                {order && <ClipboardList size={15} aria-label={`Pedido ${order.code}`}><title>{`Pedido ${order.code}`}</title></ClipboardList>}
                {serviceOrder && <Wrench size={15} aria-label={`OS ${serviceOrder.code}`}><title>{`OS ${serviceOrder.code}`}</title></Wrench>}
                {nfse.contractChargeId && <FileText size={15} aria-label="Cobrança de contrato"><title>Cobrança de contrato</title></FileText>}
              </span></td>
              <td><DropdownMenu label="Mais ações" accessibleLabel={`Ações da nota de serviço ${nfseNumberLabel(nfse)}`} triggerIcon={MoreVertical} compact actions={actions(nfse)} /></td>
            </tr>;
          })}</tbody>
        </table>
        {!rows.length && <p className="nfe-empty">{data.serviceInvoices.length ? "Nenhuma nota encontrada com esses filtros." : "Nenhuma nota de serviço. Inclua uma nota ou gere a partir de um pedido, ordem de serviço ou cobrança de contrato."}</p>}
        </div>
      </div>
      <aside className="sales-nfe-aside">
        <div className="nfe-section">
          <h3>Resumo</h3>
          {summary.map((item) => <p key={item.name}>{item.name}: {item.count} · <strong>{currency(item.total)}</strong></p>)}
        </div>
        <button type="button" className="button secondary" onClick={() => setView({ kind: "settings" })}><Settings size={16} />Configuração fiscal</button>
        {fiscalConfigured && <button type="button" className="button secondary" onClick={() => setView({ kind: "backend" })}><FileText size={16} />Documentos no backend fiscal</button>}
      </aside>
    </div>

    {validation && <Modal title={`Validar nota de serviço ${nfseNumberLabel(validation.nfse)}`} onClose={() => setValidation(null)}>
      <div className="modal-body">
        {!validation.issues.length && !validation.warnings.length
          ? <p className="nfe-hint"><CheckCircle2 size={16} aria-hidden="true" />Nota de serviço correta, pronta para o envio.</p>
          : <>
            {validation.issues.length > 0 && <><h3>Pendências</h3><ul>{validation.issues.map((text) => <li key={text}>{text}</li>)}</ul></>}
            {validation.warnings.length > 0 && <><h3>Avisos</h3><ul>{validation.warnings.map((text) => <li key={text}>{text}</li>)}</ul></>}
          </>}
      </div>
      <footer className="modal-footer">
        <button type="button" className="button secondary" onClick={() => setValidation(null)}>Fechar</button>
        <button type="button" className="button primary" onClick={() => { const nfse = validation.nfse; setValidation(null); setView({ kind: "edit", nfse }); }}>Editar nota</button>
      </footer>
    </Modal>}

    {issueTarget && <Modal title={`Informar emissão do RPS ${nfseNumberLabel(issueTarget)}`} onClose={() => setIssueTarget(null)}>
      <div className="modal-body">
        {modalError && <div className="error-message" role="alert">{modalError}</div>}
        <p className="nfe-hint">Informe o número da NFS-e gerada no portal da prefeitura. A nota passa para a situação Emitida.</p>
        <label className="field"><span>Número da NFS-e</span>
          <input value={issueNumber} maxLength={30} onChange={(event) => setIssueNumber(event.target.value)} /></label>
      </div>
      <footer className="modal-footer">
        <button type="button" className="button secondary" onClick={() => setIssueTarget(null)}>Voltar</button>
        <button type="button" className="button primary" onClick={() => {
          try {
            commit((current) => registerNfseIssue(current, issueTarget.id, issueNumber));
            setNotice(`RPS ${nfseNumberLabel(issueTarget)} registrado como NFS-e ${issueNumber.trim()}.`);
            setError("");
            setIssueTarget(null);
          } catch (cause) {
            setModalError(cause instanceof Error ? cause.message : "Não foi possível registrar a emissão.");
          }
        }}>Confirmar emissão</button>
      </footer>
    </Modal>}

    {cancelTarget && <Modal title={`Cancelar nota de serviço ${nfseNumberLabel(cancelTarget)}`} onClose={() => setCancelTarget(null)}>
      <div className="modal-body">
        {modalError && <div className="error-message" role="alert">{modalError}</div>}
        <label className="field"><span>Motivo do cancelamento</span>
          <textarea rows={3} maxLength={400} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>
      </div>
      <footer className="modal-footer">
        <button type="button" className="button secondary" onClick={() => setCancelTarget(null)}>Voltar</button>
        <button type="button" className="button primary" onClick={() => {
          try {
            commit((current) => cancelNfse(current, cancelTarget.id, cancelReason));
            setNotice(`Nota de serviço ${nfseNumberLabel(cancelTarget)} cancelada.`);
            setError("");
            setCancelTarget(null);
          } catch (cause) {
            setModalError(cause instanceof Error ? cause.message : "Não foi possível cancelar a nota.");
          }
        }}>Cancelar nota</button>
      </footer>
    </Modal>}

    {printTarget && <NfsePrintModal data={data} nfse={printTarget} onClose={() => setPrintTarget(null)} />}
  </section>;
}

function NfsePrintModal({ data, nfse, onClose }: { data: Database; nfse: ServiceInvoice; onClose: () => void }) {
  const totals = nfseTotals(nfse);
  const nature = nfseOperationNatures.find(([value]) => value === nfse.operationNature)?.[1] ?? nfse.operationNature;
  const address = [nfse.recipient.street, nfse.recipient.number, nfse.recipient.district, nfse.recipient.city, nfse.recipient.state].filter(Boolean).join(", ");
  const retentions = [
    ["INSS", totals.inss], ["PIS", totals.pis], ["COFINS", totals.cofins], ["CSLL", totals.csll], ["IR", totals.ir], ["ISS descontado", totals.issDeducted],
  ].filter(([, value]) => Number(value) > 0) as [string, number][];
  return createPortal(<Modal title={`Espelho da NFS-e · RPS ${nfseNumberLabel(nfse)}`} wide onClose={onClose}>
    <div className="modal-body document-body">
      <div className="document-brand">
        {data.settings.logo
          ? <img className="brand-image compact" src={data.settings.logo} alt={data.settings.company} />
          : <strong>{data.settings.company}</strong>}
        <span>ESPELHO DE NOTA DE SERVIÇO · SEM VALOR FISCAL</span>
      </div>
      <div className="detail-heading"><h2>RPS {nfseNumberLabel(nfse)} · Série {nfse.rpsSeries}{nfse.nfseNumber ? ` · NFS-e ${nfse.nfseNumber}` : ""}</h2><span>{nfse.status}</span></div>
      <div className="detail-grid">
        <div><small>Natureza da operação</small><strong>{nature}</strong></div>
        <div><small>Emissão</small><strong>{displayDate(nfse.issueDate)}</strong></div>
        <div><small>Tomador</small><strong>{nfse.recipient.name}</strong></div>
        <div><small>CPF/CNPJ</small><strong>{nfse.recipient.document || "—"}</strong></div>
        <div><small>Endereço</small><strong>{address || "—"}</strong></div>
        <div><small>Local da prestação</small><strong>{[nfse.recipient.serviceCity, nfse.recipient.serviceState].filter(Boolean).join("/") || "—"}</strong></div>
      </div>
      <h3>Discriminação dos serviços</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{nfse.service.description}</p>
      <div className="document-total">
        <span>Serviços {currency(totals.services)}</span>
        {totals.discount > 0 && <span>Desconto {currency(totals.discount)}</span>}
        <span>Base de cálculo {currency(totals.base)} · ISS {nfse.taxes.issRate.toLocaleString("pt-BR")}% {currency(totals.iss)}{nfse.taxes.retainIss ? " (retido)" : ""}</span>
        {retentions.length > 0 && <span>Retenções: {retentions.map(([name, value]) => `${name} ${currency(value)}`).join(" · ")}</span>}
        <strong>Valor líquido {currency(totals.total)}</strong>
      </div>
      {nfse.complementary && <p>{nfse.complementary}</p>}
    </div>
    <footer className="modal-footer">
      <button type="button" className="button secondary" onClick={onClose}>Fechar</button>
      <button type="button" className="button primary" onClick={() => window.print()}><Printer size={16} />Imprimir</button>
    </footer>
  </Modal>, document.body);
}
