import { useState } from "react";
import type { FormEvent } from "react";
import { Plus } from "lucide-react";
import { Empty, Modal } from "./components";
import { currency, displayDate, localDay, makeId } from "./domain";
import type { Database } from "./domain";
import { billOrders, cancelFinanceEntry, entryBalance, entryStatus, pendingBillingOrders, pendingBillingValues, previewBilling, reverseSettlement, saveBankAccount, saveFinanceEntry, settleFinanceEntry } from "./finance";
import type { BankAccount, BillingKind, BillingTerms, FinanceEntry } from "./financeSchema";
import { bankAccountSchema, financeEntrySchema, settlementCashAmount } from "./financeSchema";
import { errorMessage } from "./useDatabase";
import "./FinancePanel.css";
import { FiscalPanel } from "./FiscalPanel";
import { RemittancePanel } from "./RemittancePanel";
import { fiscalConfigured, fiscalRequest } from "./fiscalApi";
import { cloudEnabled } from "./supabase";
import { financeCancellationSchema, financeFiscalLinksSchema } from "./financeFiscalLinks";
import { FinanceFiscalStatus } from "./FinanceFiscalStatus";
import type { z } from "zod";
import { FinanceClassificationFields, FinanceManagementPanel } from "./FinanceManagementPanel";
import type { ManagementTab } from "./FinanceManagementPanel";
import { classifyFinanceEntry, financeManagement } from "./financeManagement";
import { BankReconciliationPanel } from "./BankReconciliationPanel";
import { FinanceTransfersPanel } from "./FinanceTransfersPanel";
import { previewFinanceInstallments, saveFinanceInstallments } from "./financeInstallments";
import { FinanceRecurrencesPanel } from "./FinanceRecurrencesPanel";
import { PurchasingPanel } from "./PurchasingPanel";

type Tab = ManagementTab | "Compras e fornecedores" | "Recorrências" | "Transferências" | "Conciliação bancária" | "A faturar" | "Contas a receber" | "Contas a pagar" | "Bancos" | "Faturamentos" | "Fiscal" | "Remessas";
type Editor = { kind: "bank"; account?: BankAccount } | { kind: "entry"; direction: FinanceEntry["kind"] } |
  { kind: "bill"; ids: string[] } | { kind: "settlement"; entry: FinanceEntry } | { kind: "classification"; entry: FinanceEntry };
type Commit = (update: Database | ((current: Database) => Database)) => void;
const tabs: Tab[] = ["Painel gerencial", "Fluxo de caixa", "A faturar", "Contas a receber", "Contas a pagar", "Compras e fornecedores", "Recorrências", "Bancos", "Transferências", "Conciliação bancária", "Faturamentos", "Relatórios", "Cadastros gerenciais", "Fiscal", "Remessas"];

export function FinancePanel({ data, commit, onSuccess, onOpenOrder, initialTab }: {
  data: Database; commit: Commit; onSuccess: (message: string) => void; onOpenOrder: (id: string) => void; initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "A faturar");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [clientId, setClientId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Todas");
  const [error, setError] = useState("");
  const [fiscalLinks, setFiscalLinks] = useState<z.infer<typeof financeFiscalLinksSchema> | null>(null);
  const [linkedData, setLinkedData] = useState<Database | null>(null);
  const [fiscalBusy, setFiscalBusy] = useState(false);
  const currentLinks = linkedData === data ? fiscalLinks : null;
  const linked = (id: string) => currentLinks?.entries.find((item) => item.entryId === id);
  const available = pendingBillingOrders(data);
  const pending = available.filter((order) => !clientId || order.clientId === clientId);
  const selectedOrders = available.filter((order) => selected.includes(order.id));
  const direction = tab === "Contas a pagar" ? "Pagar" : "Receber";
  const today = localDay();
  const management = financeManagement(data);
  const outstanding = (kind: FinanceEntry["kind"]) => data.finance.entries.filter((item) => item.kind === kind && !item.canceled).reduce((sum, item) => sum + entryBalance(item), 0);
  const entries = data.finance.entries.filter((item) => item.kind === direction &&
    `${item.party} ${item.description} ${item.purchaseId ?? ""} ${item.installment?.planId ?? ""} ${item.recurrence?.id ?? ""} ${item.recurrence?.period ?? ""}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")) &&
    (status === "Todas" || (status === "Em aberto" ? !item.canceled && entryBalance(item) > 0 : entryStatus(item, today) === status)));
  function act(update: (current: Database) => Database, message: string) {
    try { commit(update); setError(""); onSuccess(message); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  function open(next: Editor) { setError(""); setEditor(next); }
  async function refreshLinks() {
    setFiscalBusy(true); setError(""); setFiscalLinks(null);
    try {
      const result = financeFiscalLinksSchema.parse(await (await fiscalRequest("/finance/links")).json());
      setFiscalLinks(result); setLinkedData(data);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setFiscalBusy(false); }
  }
  async function cancel(entry: FinanceEntry) {
    if (!window.confirm("Cancelar internamente esta conta? O backend verificará documentos fiscais e remessas. Isso não cancela nota no fisco nem boleto no banco."))
      return;
    const invoice = data.finance.invoices.find((item) => item.id === entry.invoiceId);
    const requiresBackend = Boolean(entry.invoiceId && (cloudEnabled || fiscalConfigured));
    setFiscalBusy(true); setError("");
    try {
      if (requiresBackend) {
        const response = financeCancellationSchema.parse(await (await fiscalRequest("/finance/cancellations", "POST",
          { expectedEntry: entry, ...(invoice ? { expectedInvoice: invoice } : {}), confirmation: true })).json());
        if (response.entryId !== entry.id || response.invoiceId !== entry.invoiceId)
          throw new Error("Cancelamento retornado para outra conta/faturamento.");
      }
      commit((current) => cancelFinanceEntry(current, entry.id, { entry, invoice }));
      setFiscalLinks(null);
      onSuccess(requiresBackend ? "Cancelamento interno reservado e aplicado. Aguarde Sincronizado; histórico fiscal/bancário preservado." :
        entry.invoiceId ? "Conta cancelada apenas na base demo local, sem consulta fiscal ou bancária." :
          "Conta manual cancelada internamente. Não cancela cobrança externa; aguarde a sincronização quando conectado.");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setFiscalBusy(false); }
  }
  return <section className="finance-panel">
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="finance-metrics">
      <div><small>A faturar</small><strong>{currency(available.reduce((sum, order) => {
        const values = pendingBillingValues(data, order);
        return sum + values.products + values.services;
      }, 0))}</strong></div>
      <div><small>A receber em aberto</small><strong>{currency(outstanding("Receber"))}</strong></div>
      <div><small>A pagar em aberto</small><strong>{currency(outstanding("Pagar"))}</strong></div>
    </div>
    <nav className="finance-tabs" aria-label="Seções do financeiro">{tabs.map((item) =>
      <button key={item} className={`button ${tab === item ? "primary" : "secondary"}`} aria-current={tab === item ? "page" : undefined}
        onClick={() => { setTab(item); setError(""); }}>{item}</button>)}</nav>
    <p>O faturamento prepara contas internas; autorização fiscal é consultada na aba Fiscal. Boleto/Pix não são registrados automaticamente no banco.</p>
    <p>Vínculos fiscais/bancários são consultados no backend, não fazem parte do backup JSON. Atualize após emitir, consultar ou gerar remessa. Homologação não é emissão válida em produção.</p>
    <button className="button secondary" disabled={!fiscalConfigured || fiscalBusy} onClick={() => void refreshLinks()}>Atualizar vínculos fiscais e remessas</button>
    {currentLinks && <p>Consulta do backend: {currentLinks.checkedAt}. Não é consulta em tempo real ao fisco/banco.</p>}
    {!fiscalConfigured && <p>Backend fiscal não conectado. Cancelamentos de contas vinculadas a faturamentos da empresa exigem conexão. Contas manuais sem faturamento e a base demo local mantêm o fluxo interno.</p>}
    {(tab === "Painel gerencial" || tab === "Fluxo de caixa" || tab === "Relatórios" || tab === "Cadastros gerenciais") &&
      <FinanceManagementPanel data={data} tab={tab} commit={commit} onSuccess={onSuccess} />}
    {tab === "Conciliação bancária" && <BankReconciliationPanel data={data} commit={commit} onSuccess={onSuccess} />}
    {tab === "Transferências" && <FinanceTransfersPanel data={data} commit={commit} onSuccess={onSuccess} />}
    {tab === "Recorrências" && <FinanceRecurrencesPanel data={data} commit={commit} onSuccess={onSuccess} />}
    {tab === "Compras e fornecedores" && <PurchasingPanel data={data} commit={commit} onSuccess={onSuccess} />}
    {tab === "Fiscal" && <FiscalPanel data={data} commit={commit} />}
    {tab === "Remessas" && <RemittancePanel data={data} />}
    {tab === "A faturar" && <>
      <div className="section-heading">
        <label className="field">Cliente<select value={clientId} onChange={(event) => { setClientId(event.target.value); setSelected([]); }}>
          <option value="">Todos os clientes</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select></label>
        <button className="button primary" disabled={!selectedOrders.length} onClick={() => open({ kind: "bill", ids: selectedOrders.map((order) => order.id) })}>
          Faturar selecionadas ({selectedOrders.length})
        </button>
      </div>
      <div className="finance-table"><table><thead><tr><th>Selecionar</th><th>OS</th><th>Cliente</th><th>Data</th><th>Produtos</th><th>Serviços</th><th>Total pendente</th></tr></thead>
        <tbody>{pending.map((order) => {
          const values = pendingBillingValues(data, order);
          return <tr key={order.id}>
          <td><input type="checkbox" aria-label={`Faturar ${order.code}`} checked={selected.includes(order.id)}
            disabled={selectedOrders.length > 0 && selectedOrders[0].clientId !== order.clientId}
            onChange={(event) => setSelected(event.target.checked ? [...selected, order.id] : selected.filter((id) => id !== order.id))} /></td>
          <td><button className="text-button" onClick={() => onOpenOrder(order.id)}>{order.code} · {order.title}</button></td>
          <td>{data.clients.find((client) => client.id === order.clientId)?.name}</td><td>{displayDate(order.date)}</td>
          <td>{currency(values.products)}</td><td>{currency(values.services)}</td><td>{currency(values.products + values.services)}</td>
        </tr>; })}</tbody></table></div>
      {!pending.length && <Empty title="Nenhuma OS finalizada aguardando faturamento" />}
    </>}
    {(tab === "Contas a receber" || tab === "Contas a pagar") && <>
      <div className="section-heading">
        <label className="field">Buscar conta<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="field">Situação<select value={status} onChange={(event) => setStatus(event.target.value)}>
          {["Todas", "Em aberto", "Atrasada", "Parcial", "Recebida", "Paga", "Cancelada"].map((item) => <option key={item}>{item}</option>)}
        </select></label>
        <button className="button primary" onClick={() => open({ kind: "entry", direction })}><Plus size={17} />Nova conta a {direction.toLowerCase()}</button>
      </div>
      <div className="finance-table"><table><thead><tr><th>{direction === "Receber" ? "Cliente" : "Favorecido"}</th><th>Descrição</th><th>Banco / pagamento</th><th>Vencimento</th><th>Valor</th><th>Saldo</th><th>Situação</th><th>Ações</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id}>
          <td>{entry.party}</td><td>{entry.description}
            {entry.purchaseId && <small className="finance-classification">Pedido de compra: {entry.purchaseId}</small>}
            {entry.recurrence && <small className="finance-classification">Recorrência: {entry.recurrence.id} · Mês {entry.recurrence.period}</small>}
            {entry.installment && <details><summary>Parcela {entry.installment.number}/{entry.installment.count}</summary>
              <p>Grupo: {entry.installment.planId}<br />Total original: {currency(entry.installment.total)}.
                Cada parcela possui baixa e cancelamento independentes.</p>
            </details>}
            <small className="finance-classification">
            {management.categories.find((item) => item.id === management.classifications.find((item) => item.entryId === entry.id)?.categoryId)?.name ?? "Sem categoria"} ·{" "}
            {management.costCenters.find((item) => item.id === management.classifications.find((item) => item.entryId === entry.id)?.costCenterId)?.name ?? "Sem centro de custo"}
          </small></td>
          <td>{data.finance.accounts.find((account) => account.id === entry.accountId)?.name}<br />{entry.paymentMethod}</td>
          <td>{displayDate(entry.dueOn)}</td><td>{currency(entry.amount)}{entry.retention && <small><br />Retenções: {currency(entry.retention.withheld)}<br />Líquido: {currency(entry.retention.net)}<br />IRRF {currency(entry.retention.irrf)} · INSS {currency(entry.retention.inss)} · CSLL {currency(entry.retention.csll)}</small>}</td><td>{currency(entryBalance(entry))}</td><td>{entryStatus(entry, today)}<FinanceFiscalStatus link={linked(entry.id)} /></td>
          <td><div className="finance-actions">
            <button className="text-button" onClick={() => open({ kind: "classification", entry })}>Classificar</button>
            {!entry.canceled && entryBalance(entry) > 0 && <button className="button secondary" onClick={() => open({ kind: "settlement", entry })}>Dar baixa</button>}
            {!entry.canceled && <button className="text-button" disabled={fiscalBusy || linked(entry.id)?.cancellationAllowed === false}
              onClick={() => void cancel(entry)}>Cancelar</button>}
          </div>
            {!!entry.settlements.length && <details><summary>Baixas ({entry.settlements.length})</summary>{entry.settlements.map((settlement) =>
              <div key={settlement.id}>{displayDate(settlement.date)} · {currency(settlementCashAmount(settlement))} · {data.finance.accounts.find((account) => account.id === settlement.accountId)?.name}
                {settlement.adjustment && <p>Principal liquidado: {currency(settlement.amount)} · Juros: {currency(settlement.adjustment.interest)} ·
                  Multa: {currency(settlement.adjustment.fine)} · Desconto: {currency(settlement.adjustment.discount)}<br />
                  Motivo: {settlement.adjustment.reason} · Confirmado em {settlement.adjustment.confirmedAt}</p>}
                {settlement.reversed ? <span> · Estornada</span> : <button className="text-button" onClick={() => {
                  if (window.confirm("Estornar esta baixa e reabrir o saldo correspondente?")) act((current) => reverseSettlement(current, entry.id, settlement.id), "Baixa estornada.");
                }}>Estornar</button>}
              </div>)}</details>}
          </td>
        </tr>)}</tbody></table></div>
      {!entries.length && <Empty title="Nenhuma conta encontrada" />}
    </>}
    {tab === "Bancos" && <>
      <div className="section-heading"><h2>Bancos de recebimento e pagamento</h2><button className="button primary" onClick={() => open({ kind: "bank" })}><Plus size={17} />Cadastrar banco</button></div>
      <div className="finance-table"><table><thead><tr><th>Nome</th><th>Instituição</th><th>Agência</th><th>Conta</th><th>Tipo</th><th>Situação</th><th>Ações</th></tr></thead>
        <tbody>{data.finance.accounts.map((account) => <tr key={account.id}><td>{account.name}</td><td>{account.bank}</td><td>{account.agency}</td><td>{account.account}</td>
          <td>{account.kind}</td><td>{account.active ? "Ativa" : "Inativa"}</td><td><button className="text-button" onClick={() => open({ kind: "bank", account })}>Editar</button></td></tr>)}</tbody>
      </table></div>
      {!data.finance.accounts.length && <Empty title="Nenhum banco cadastrado" />}
    </>}
    {tab === "Faturamentos" && <>
      <div className="finance-table"><table><thead><tr><th>Cliente</th><th>Cadastro</th><th>Grupo / documento previsto</th><th>OS vinculadas</th><th>Total</th><th>Situação</th></tr></thead>
        <tbody>{data.finance.invoices.map((invoice) => <tr key={invoice.id}><td>{invoice.clientName}</td><td>{displayDate(invoice.createdOn)}</td>
          <td>{invoice.kind === "Legado" ? "Consolidado anterior" : `${invoice.kind} · ${invoice.kind === "Produtos" ? "NF-e" : "NFS-e"}`}</td>
          <td>{invoice.orders.map((order) => <div key={order.orderId}><button className="text-button" onClick={() => onOpenOrder(order.orderId)}>{order.code} · {order.title}</button> · {currency(order.amount)}</div>)}</td>
          <td>{currency(invoice.amount)}</td><td>{invoice.canceled ? "Cancelado internamente" : "Faturamento interno ativo"}
            <FinanceFiscalStatus link={linked(data.finance.entries.find((entry) => entry.invoiceId === invoice.id)?.id ?? "")} /></td></tr>)}</tbody>
      </table></div>
      {!data.finance.invoices.length && <Empty title="Nenhum faturamento gerado" />}
    </>}
    {editor && <FinanceEditor key={editor.kind === "bank" ? editor.account?.id ?? "new-bank" : editor.kind} data={data} editor={editor} onClose={() => setEditor(null)}
      onSave={(update) => { commit(update); setEditor(null); setSelected([]); setError(""); onSuccess("Registro financeiro salvo."); }} />}
  </section>;
}

function FinanceEditor({ data, editor, onClose, onSave }: {
  data: Database; editor: Editor; onClose: () => void; onSave: (update: (current: Database) => Database) => void;
}) {
  const [error, setError] = useState("");
  const [entryId] = useState(makeId);
  const [installmentCount, setInstallmentCount] = useState("1");
  const [installments, setInstallments] = useState<ReturnType<typeof previewFinanceInstallments> | null>(null);
  const [installmentConfirmed, setInstallmentConfirmed] = useState(false);
  const isInstallment = Number(installmentCount) !== 1;
  const [adjustmentEnabled, setAdjustmentEnabled] = useState(false);
  const [adjustmentConfirmed, setAdjustmentConfirmed] = useState(false);
  const [adjustmentConfirmedAt, setAdjustmentConfirmedAt] = useState("");
  const [principalValue, setPrincipalValue] = useState(editor.kind === "settlement" ? String(entryBalance(editor.entry) / 100) : "");
  const [adjustmentValues, setAdjustmentValues] = useState({ interest: "0", fine: "0", discount: "0" });
  const adjustmentAmounts = {
    interest: Math.round(Number(adjustmentValues.interest) * 100),
    fine: Math.round(Number(adjustmentValues.fine) * 100),
    discount: Math.round(Number(adjustmentValues.discount) * 100),
  };
  const effectiveAmount = settlementCashAmount({ amount: Math.round(Number(principalValue) * 100), adjustment: adjustmentAmounts });
  const title = editor.kind === "bank" ? "Conta bancária" : editor.kind === "bill" ? "Faturar OS selecionadas"
    : editor.kind === "settlement" ? "Registrar baixa" : editor.kind === "classification" ? "Classificação gerencial" : `Conta a ${editor.direction.toLowerCase()}`;
  const accounts = data.finance.accounts.filter((account) => account.active);
  let groups: ReturnType<typeof previewBilling> = [];
  let previewError = "";
  if (editor.kind === "bill") {
    try { groups = previewBilling(data, editor.ids); }
    catch (cause) { previewError = errorMessage(cause); }
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const amount = () => Math.round(Number(text("amount")) * 100);
    const classify = (current: Database, entryId: string) => classifyFinanceEntry(current, {
      entryId, ...(text("categoryId") ? { categoryId: text("categoryId") } : {}),
      ...(text("costCenterId") ? { costCenterId: text("costCenterId") } : {}),
    });
    try {
      if (editor.kind === "classification") {
        onSave((current) => classify(current, editor.entry.id));
      } else if (editor.kind === "bank") {
        const account = bankAccountSchema.parse({ id: editor.account?.id ?? makeId(), name: text("name"), bank: text("bank"), agency: text("agency"),
          account: text("account"), kind: text("accountKind"), active: form.get("active") === "on" });
        onSave((current) => saveBankAccount(current, account));
      } else if (editor.kind === "bill") {
        if (previewError) throw new Error(previewError);
        const options: Partial<Record<BillingKind, BillingTerms>> = {};
        for (const group of groups) options[group.kind] = {
          accountId: text(`${group.kind}.accountId`), dueOn: text(`${group.kind}.dueOn`),
          paymentMethod: financeEntrySchema.shape.paymentMethod.parse(text(`${group.kind}.paymentMethod`)),
        };
        onSave((current) => billOrders(current, editor.ids, options, groups));
      } else {
        const accountId = text("accountId");
        if (editor.kind === "settlement") {
          const settlement = { id: makeId(), date: text("date"), amount: amount(), accountId,
            ...(adjustmentEnabled ? { adjustment: { ...adjustmentAmounts, reason: text("adjustmentReason"), confirmedAt: adjustmentConfirmedAt } } : {}) };
          onSave((current) => settleFinanceEntry(current, editor.entry.id, settlement, adjustmentConfirmed));
        } else {
          const method = text("paymentMethod");
          const paymentMethod = (["Pix", "Boleto", "Transferência", "Dinheiro", "Cartão", "Outro"] as const).find((item) => item === method);
          if (!paymentMethod) throw new Error("Selecione a forma de pagamento.");
          const options = { accountId, dueOn: text("dueOn"), paymentMethod };
          const clientId = editor.direction === "Receber" ? text("clientId") : "";
          const client = data.clients.find((item) => item.id === clientId);
          if (editor.direction === "Receber" && !client) throw new Error("Selecione o cliente.");
          const entry = { id: entryId, kind: editor.direction, party: client?.name ?? text("party"), ...(clientId ? { clientId } : {}),
            description: text("description"), amount: amount(), issuedOn: text("issuedOn"), ...options, canceled: false, settlements: [] };
          if (isInstallment) {
            const count = Number(installmentCount);
            const expected = previewFinanceInstallments(entry.amount, count, entry.dueOn);
            if (!installments || installments.length !== expected.length ||
              installments.some((item, index) => item.amount !== expected[index].amount))
              throw new Error("Gere e confira a prévia atualizada antes de salvar.");
            const dates = installments.map((_, index) => text(`installmentDue.${index}`));
            onSave((current) => {
              const updated = saveFinanceInstallments(current, entry, dates, form.get("confirmInstallments") === "on");
              return updated.finance.entries.filter((item) => item.installment?.planId === entry.id)
                .reduce((result, item) => classify(result, item.id), updated);
            });
          } else onSave((current) => classify(saveFinanceEntry(current, entry), entry.id));
        }
      }
    } catch (cause) { setError(errorMessage(cause)); }
  }
  const bank = editor.kind === "bank" ? editor.account : undefined;
  return <Modal title={title} onClose={onClose}><form onSubmit={handleSubmit} onChange={(event) => {
    const target = event.target;
    if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) &&
      target.name !== "confirmAdjustment") setAdjustmentConfirmed(false);
    if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement) && target.name !== "confirmInstallments")
      setInstallmentConfirmed(false);
    if (target instanceof HTMLInputElement && ["amount", "dueOn"].includes(target.name)) setInstallments(null);
  }}>
    <div className="modal-body">
      {(error || previewError) && <p role="alert" className="error-message">{error || previewError}</p>}
      <div className="form-grid">
        {editor.kind === "classification" ? <>
          <p className="full">{editor.entry.party} · {editor.entry.description}. Classificação apenas gerencial, sem alterar valores, baixas ou documentos fiscais.</p>
          <FinanceClassificationFields data={data} kind={editor.entry.kind} entryId={editor.entry.id} />
        </> : editor.kind === "bank" ? <>
          <label className="field">Nome da conta<input name="name" required maxLength={1000} defaultValue={bank?.name} /></label>
          <label className="field">Instituição / banco<input name="bank" required maxLength={1000} defaultValue={bank?.bank} /></label>
          <label className="field">Agência<input name="agency" maxLength={100} defaultValue={bank?.agency} /></label>
          <label className="field">Conta e dígito<input name="account" maxLength={100} defaultValue={bank?.account} /></label>
          <label className="field">Tipo de conta<select name="accountKind" defaultValue={bank?.kind ?? "Corrente"}><option>Corrente</option><option>Poupança</option><option>Caixa</option></select></label>
          <label className="checkbox-field"><input type="checkbox" name="active" defaultChecked={bank?.active ?? true} />Ativa</label>
        </> : editor.kind === "bill" ? <>
          <p className="full">Uma cobrança independente por grupo. Descontos rateados; deslocamento, pedágio e acréscimos nos serviços.</p>
          {!!groups.length && <p className="full">Cliente: <strong>{groups[0].clientName}</strong></p>}
          {groups.map((group) => <fieldset className="finance-billing-group full" key={group.kind}>
            <legend>{group.kind} · {group.kind === "Produtos" ? "NF-e prevista" : "NFS-e prevista"} · {currency(group.amount)}</legend>
            {group.orders.map((order) => <p key={order.orderId}>{order.code} · {currency(order.amount)}</p>)}
            <div className="form-grid">
              <label className="field">Vencimento — {group.kind}<input name={`${group.kind}.dueOn`} type="date" required defaultValue={localDay()} /></label>
              <label className="field">Pagamento — {group.kind}<select name={`${group.kind}.paymentMethod`}><option>Boleto</option><option>Pix</option></select></label>
              <label className="field">Conta bancária — {group.kind}<select name={`${group.kind}.accountId`} required defaultValue="">
                <option value="">Selecione</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select></label>
            </div>
          </fieldset>)}
          <p className="full">Total: <strong>{currency(groups.reduce((sum, group) => sum + group.amount, 0))}</strong></p>
          {!accounts.length && <p role="alert" className="full">Cadastre uma conta bancária ativa na aba Bancos.</p>}
        </> : <>
          {editor.kind === "entry" && <>
            {editor.direction === "Receber" ? <label className="field">Cliente<select name="clientId" required defaultValue=""><option value="">Selecione</option>
              {data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
              : <label className="field">Favorecido / fornecedor<input name="party" required maxLength={1000} /></label>}
            <label className="field">Descrição<input name="description" required maxLength={1000} /></label>
            <label className="field">Emissão<input type="date" name="issuedOn" required defaultValue={localDay()} /></label>
            <FinanceClassificationFields data={data} kind={editor.direction} />
          </>}
          <label className="field">{editor.kind === "settlement" ? adjustmentEnabled ? "Principal da dívida a liquidar (R$)" : "Valor da baixa (R$)" : isInstallment ? "Valor total (R$)" : "Valor (R$)"}
              <input type="number" name="amount" min="0.01" max={editor.kind === "settlement" ? entryBalance(editor.entry) / 100 : 1000000} step="0.01" required
                onChange={(event) => setPrincipalValue(event.target.value)}
                defaultValue={editor.kind === "settlement" ? entryBalance(editor.entry) / 100 : undefined} /></label>
          {editor.kind === "settlement" ? <label className="field">Data da baixa<input name="date" type="date" required max={localDay()} defaultValue={localDay()} /></label>
            : <>
              <label className="field">{isInstallment ? "Primeiro vencimento" : "Vencimento"}<input name="dueOn" type="date" required defaultValue={localDay()} /></label>
              <label className="field">Forma de pagamento<select name="paymentMethod">{["Pix", "Boleto", "Transferência", "Dinheiro", "Cartão", "Outro"].map((item) => <option key={item}>{item}</option>)}</select></label>
            </>}
          <label className="field">Conta bancária<select name="accountId" required defaultValue={editor.kind === "settlement" && accounts.some((item) => item.id === editor.entry.accountId) ? editor.entry.accountId : ""}>
            <option value="">Selecione</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          {editor.kind === "settlement" && !editor.entry.invoiceId && !editor.entry.retention && <>
            <label className="checkbox-field full"><input type="checkbox" name="enableAdjustment" checked={adjustmentEnabled}
              onChange={(event) => { setAdjustmentEnabled(event.target.checked); setAdjustmentConfirmed(false); }} />
              Informar juros, multa ou desconto nesta baixa</label>
            {adjustmentEnabled && <fieldset className="finance-billing-group full"><legend>Ajustes manuais da liquidação</legend>
              <p>Informe valores em reais negociados para esta baixa, não percentuais. Não há cálculo automático por atraso.
                O principal reduz a dívida; somente o valor efetivo movimenta o caixa. O valor original do título é preservado.</p>
              {([["interest", "Juros (R$)"], ["fine", "Multa (R$)"], ["discount", "Desconto (R$)"]] as const).map(([key, label]) =>
                <label className="field" key={key}>{label}<input name={key} type="number" min="0" max="1000000" step="0.01" required
                  value={adjustmentValues[key]} onChange={(event) => setAdjustmentValues({ ...adjustmentValues, [key]: event.target.value })} /></label>)}
              <p><strong>Valor efetivamente {editor.entry.kind === "Receber" ? "recebido" : "pago"}: {Number.isFinite(effectiveAmount) ? currency(effectiveAmount) : "Valor inválido"}</strong>
                <br />Principal + juros + multa − desconto. Deve ser positivo; desconto não pode exceder o principal.
                Perdão/desconto integral sem caixa não é suportado nesta etapa.</p>
              <label className="field">Motivo dos ajustes<textarea name="adjustmentReason" required minLength={5} maxLength={1000} /></label>
              <label className="checkbox-field"><input name="confirmAdjustment" type="checkbox" required checked={adjustmentConfirmed}
                onChange={(event) => { setAdjustmentConfirmed(event.target.checked); setAdjustmentConfirmedAt(event.target.checked ? new Date().toISOString() : ""); }} />
                Conferi o principal, os ajustes e o valor efetivamente recebido/pago.</label>
            </fieldset>}
          </>}
          {editor.kind === "settlement" && (editor.entry.invoiceId || editor.entry.retention) &&
            <p className="full">Juros, multas e descontos não estão habilitados para contas de OS/faturamentos ou retenções.
              Os ajustes fiscais e bancários dessas cobranças exigem uma etapa própria.</p>}
          {editor.kind === "entry" && <>
            <label className="field">Quantidade de parcelas<input name="installmentCount" type="number" min="1" max="120" step="1" required
              value={installmentCount} onChange={(event) => { setInstallmentCount(event.target.value); setInstallments(null); }} /></label>
            {isInstallment && <>
              <p className="full">O valor informado é o total, não o valor de cada parcela. Mensais, até 120 parcelas; centavos restantes nas primeiras.
                Datas no fim do mês são ajustadas ao último dia, preservando o dia original nos meses seguintes.
                Revise e edite os vencimentos abaixo antes de confirmar. Não gera boleto/Pix ou documento fiscal.</p>
              <button type="button" className="button secondary" onClick={(event) => {
                try {
                  const form = event.currentTarget.form;
                  if (!form) throw new Error("Formulário indisponível.");
                  const values = new FormData(form);
                  setInstallments(previewFinanceInstallments(Math.round(Number(values.get("amount")) * 100),
                    Number(installmentCount), String(values.get("dueOn") ?? "")));
                  setInstallmentConfirmed(false);
                  setError("");
                } catch (cause) { setInstallments(null); setError(errorMessage(cause)); }
              }}>Gerar prévia das parcelas</button>
              {installments && <fieldset className="finance-billing-group full"><legend>Revisar parcelamento</legend>
                <p>Total: {currency(installments.reduce((sum, item) => sum + item.amount, 0))}.
                  Vencimentos em ordem crescente e não anteriores à emissão. Cancelar uma parcela não cancela o grupo.</p>
                {installments.map((item, index) => <label className="field" key={index}>
                  Parcela {index + 1}/{installments.length} · {currency(item.amount)}
                  <input type="date" name={`installmentDue.${index}`} required value={item.dueOn}
                    onChange={(event) => setInstallments(installments.map((row, position) => position === index ? { ...row, dueOn: event.target.value } : row))} />
                </label>)}
                <label className="checkbox-field"><input type="checkbox" name="confirmInstallments" required checked={installmentConfirmed}
                  onChange={(event) => setInstallmentConfirmed(event.target.checked)} />
                  Conferi o valor total, a distribuição e os vencimentos de todas as parcelas.</label>
              </fieldset>}
            </>}
          </>}
          {!accounts.length && <p role="alert" className="full">Cadastre uma conta bancária ativa na aba Bancos antes de continuar.</p>}
        </>}
      </div>
    </div>
    <footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary">Salvar</button></footer>
  </form></Modal>;
}
