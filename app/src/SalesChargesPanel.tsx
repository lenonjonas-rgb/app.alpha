import { useMemo, useState } from "react";
import { CalendarPlus, FileText, Receipt, Search, Trash2, Wrench } from "lucide-react";
import { currency, displayDate, localDay } from "./domain";
import type { Database } from "./domain";
import { Modal } from "./components";
import { addMonths, contractChargeRows, contractLabel, deleteContractCharges, generateChargeInvoices, generateContractCharges, monthLabel } from "./contractCharges";
import { nfseNumberLabel } from "./serviceInvoices";
import "./NfeEditor.css";

type Confirm = { kind: "invoices"; ids: string[] } | { kind: "delete"; ids: string[] } | null;

export function SalesChargesPanel({ data, commit, onOpenContracts, onOpenNfse }: {
  data: Database;
  commit: (update: (current: Database) => Database) => void;
  onOpenContracts?: () => void;
  onOpenNfse?: () => void;
}) {
  const [period, setPeriod] = useState(localDay().slice(0, 7));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"client" | "due" | "amount">("client");
  const [accounts, setAccounts] = useState<"" | "paid" | "open">("");
  const [invoices, setInvoices] = useState<"" | "with" | "without">("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [aware, setAware] = useState(false);
  const [modalError, setModalError] = useState("");

  const all = useMemo(() => contractChargeRows(data, period), [data, period]);
  const rows = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return all
      .filter((row) => !term || `${row.clientName} ${row.contract ? contractLabel(row.contract) : ""}`.toLocaleLowerCase("pt-BR").includes(term))
      .filter((row) => !accounts || (accounts === "paid" ? row.status === "Recebida" : row.balance > 0))
      .filter((row) => !invoices || (invoices === "with" ? Boolean(row.nfse) : !row.nfse))
      .sort((a, b) => sort === "due" ? a.charge.dueOn.localeCompare(b.charge.dueOn)
        : sort === "amount" ? b.charge.amount - a.charge.amount : a.clientName.localeCompare(b.clientName, "pt-BR"));
  }, [all, query, accounts, invoices, sort]);
  const total = rows.reduce((sum, row) => sum + row.charge.amount, 0);
  const open = rows.reduce((sum, row) => sum + row.balance, 0);
  const withoutInvoice = rows.filter((row) => !row.nfse && row.status !== "Cancelada").map((row) => row.charge.id);

  function generateMonth() {
    setError("");
    setNotice("");
    let summary = { created: 0, skipped: [] as string[] };
    try {
      commit((current) => {
        const result = generateContractCharges(current, { from: period, through: period });
        summary = { created: result.created, skipped: result.skipped };
        return result.data;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível gerar as cobranças.");
      return;
    }
    setNotice(summary.created
      ? `${summary.created} cobrança${summary.created === 1 ? " gerada" : "s geradas"} para ${monthLabel(period)}.`
      : `Nenhuma cobrança nova para ${monthLabel(period)}.${summary.skipped.length ? ` ${summary.skipped.join(" ")}` : ""}`);
  }
  function confirmAction() {
    if (!confirm) return;
    setModalError("");
    let created = 0;
    try {
      if (confirm.kind === "invoices")
        commit((current) => { const result = generateChargeInvoices(current, confirm.ids); created = result.created; return result.data; });
      else commit((current) => deleteContractCharges(current, confirm.ids, aware));
    } catch (cause) {
      setModalError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação.");
      return;
    }
    setNotice(confirm.kind === "invoices"
      ? `${created} nota${created === 1 ? " de serviço gerada" : "s de serviço geradas"} como Pendente.`
      : `Cobranças de ${monthLabel(period)} excluídas; contas canceladas e notas pendentes removidas.`);
    setError("");
    setConfirm(null);
  }

  return <section className="sales-nfe-panel">
    <header className="sales-nfe-heading">
      <div>
        <span className="fiscal-eyebrow">VENDAS · SERVIÇOS</span>
        <h2>Cobranças</h2>
        <p>Cobranças dos contratos por cliente e mês</p>
      </div>
      <div className="nfe-editor-actions">
        {onOpenContracts && <button type="button" className="button secondary" onClick={onOpenContracts}><FileText size={16} />Contratos</button>}
        <button type="button" className="button primary" onClick={generateMonth}><CalendarPlus size={16} />Gerar cobranças do mês</button>
      </div>
    </header>
    {notice && <div className="sales-order-notice" role="status"><span>{notice}</span></div>}
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="sales-nfe-layout">
      <div>
        <div className="sales-nfe-toolbar">
          <button type="button" className="button secondary" aria-label="Mês anterior" onClick={() => setPeriod(addMonths(period, -1))}>‹</button>
          <input type="month" aria-label="Mês das cobranças" value={period} onChange={(event) => event.target.value && setPeriod(event.target.value)} />
          <button type="button" className="button secondary" aria-label="Próximo mês" onClick={() => setPeriod(addMonths(period, 1))}>›</button>
          <label className="search-field"><Search size={16} aria-hidden="true" />
            <input aria-label="Pesquisar cobranças" placeholder="Pesquise por cliente ou contrato" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <select aria-label="Ordenação" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="client">Ordenar por cliente</option><option value="due">Ordenar por vencimento</option><option value="amount">Ordenar por valor</option>
          </select>
          <select aria-label="Contas" value={accounts} onChange={(event) => setAccounts(event.target.value as typeof accounts)}>
            <option value="">Todas as contas</option><option value="paid">Contas pagas</option><option value="open">Contas em aberto</option>
          </select>
          <select aria-label="Notas" value={invoices} onChange={(event) => setInvoices(event.target.value as typeof invoices)}>
            <option value="">Com e sem NFS-e</option><option value="with">Com NFS-e</option><option value="without">Sem NFS-e</option>
          </select>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>Cliente</th><th>Contrato</th><th>Vencimento</th><th className="amount">Valor</th><th>Conta</th><th>NFS-e</th><th>OS</th></tr></thead>
          <tbody>{rows.map((row) => {
            const order = row.charge.serviceOrderId ? data.orders.find((item) => item.id === row.charge.serviceOrderId) : undefined;
            return <tr key={row.charge.id}>
              <td>{row.clientName}</td>
              <td>{row.contract ? contractLabel(row.contract) : "—"}</td>
              <td>{displayDate(row.charge.dueOn)}</td>
              <td className="amount">{currency(row.charge.amount)}{row.charge.discount > 0 && <small>Desconto {currency(row.charge.discount)}</small>}</td>
              <td><span className={`badge ${row.status === "Recebida" ? "green" : row.status === "Atrasada" || row.status === "Cancelada" ? "red" : "amber"}`}>{row.status}</span></td>
              <td>{row.nfse ? <span><Receipt size={14} aria-hidden="true" /> RPS {nfseNumberLabel(row.nfse)} · {row.nfse.status}</span> : "—"}</td>
              <td>{order ? <span><Wrench size={14} aria-hidden="true" /> {order.code}</span> : "—"}</td>
            </tr>;
          })}</tbody>
        </table>
        {!rows.length && <p className="nfe-empty">{all.length ? "Nenhuma cobrança encontrada com esses filtros." : `Nenhuma cobrança em ${monthLabel(period)}. Use "Gerar cobranças do mês" ou gere pelos contratos.`}</p>}
        </div>
      </div>
      <aside className="sales-nfe-aside">
        <div className="nfe-section">
          <h3>{monthLabel(period)}</h3>
          <p>{rows.length} cobrança{rows.length === 1 ? "" : "s"} · <strong>{currency(total)}</strong></p>
          <p>Em aberto: <strong>{currency(open)}</strong></p>
          <p>Recebido: <strong>{currency(rows.filter((row) => row.status !== "Cancelada").reduce((sum, row) => sum + row.charge.amount - row.balance, 0))}</strong></p>
        </div>
        <button type="button" className="button secondary" disabled={!withoutInvoice.length}
          onClick={() => { setModalError(""); setConfirm({ kind: "invoices", ids: withoutInvoice }); }}><Receipt size={16} />Gerar notas neste filtro</button>
        {onOpenNfse && <button type="button" className="button secondary" onClick={onOpenNfse}><FileText size={16} />Ver notas de serviço</button>}
        <button type="button" className="button secondary danger" disabled={!all.length}
          onClick={() => { setAware(false); setModalError(""); setConfirm({ kind: "delete", ids: all.map((row) => row.charge.id) }); }}><Trash2 size={16} />Excluir cobranças do mês</button>
      </aside>
    </div>

    {confirm && <Modal title={confirm.kind === "invoices" ? "Gerar notas neste filtro" : `Excluir cobranças de ${monthLabel(period)}`} onClose={() => setConfirm(null)}>
      <div className="modal-body">
        {modalError && <div className="error-message" role="alert">{modalError}</div>}
        {confirm.kind === "invoices"
          ? <p>Serão geradas {confirm.ids.length} nota{confirm.ids.length === 1 ? "" : "s"} de serviço como Pendente, uma para cada cobrança sem NFS-e deste filtro.</p>
          : <>
            <p>As {confirm.ids.length} cobranças do mês serão excluídas. As contas a receber serão canceladas e as notas de serviço pendentes geradas por elas serão removidas. Cobranças com recebimento ou NFS-e emitida impedem a exclusão.</p>
            <label className="checkbox-field"><input type="checkbox" checked={aware} onChange={(event) => setAware(event.target.checked)} />Estou ciente</label>
          </>}
      </div>
      <footer className="modal-footer">
        <button type="button" className="button secondary" onClick={() => setConfirm(null)}>Voltar</button>
        <button type="button" className="button primary" disabled={confirm.kind === "delete" && !aware} onClick={confirmAction}>
          {confirm.kind === "invoices" ? "Gerar notas" : "Excluir cobranças"}</button>
      </footer>
    </Modal>}
  </section>;
}
