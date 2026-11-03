import { useState } from "react";
import { Empty } from "./components";
import { currency, displayDate } from "./domain";
import type { Database } from "./domain";
import { entryBalance, entryStatus } from "./finance";
import { defaultManagementFilter, financeManagement } from "./financeManagement";
import { cashStatement, cashStatementCsv, customerStatement, customerStatementCsv, statementPeriodSchema } from "./financeStatements";
import { downloadFile, errorMessage } from "./useDatabase";

type Navigate = (tab: "Bancos" | "Transferências" | "Conciliação bancária" | "Cadastros gerenciais" | "Relatórios") => void;

export function FinanceCashStatementPanel({ data, onNavigate, onCreateEntry, onCreateBank }: {
  data: Database;
  onNavigate: Navigate;
  onCreateEntry: (kind: "Receber" | "Pagar") => void;
  onCreateBank: () => void;
}) {
  const [draft, setDraft] = useState(() => {
    const filter = defaultManagementFilter();
    return { start: filter.start, end: filter.end, accountId: "" };
  });
  const [filter, setFilter] = useState(draft);
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("Todas");
  const [reconciliation, setReconciliation] = useState("Todas");
  const [error, setError] = useState("");
  const management = financeManagement(data);
  let report: ReturnType<typeof cashStatement> | undefined;
  let reportError = "";
  try { report = cashStatement(data, filter); }
  catch (cause) { reportError = errorMessage(cause); }
  const visible = report?.movements.filter((item) =>
    (direction === "Todas" || (direction === "Entradas" ? item.amount > 0 : item.amount < 0)) &&
    (reconciliation === "Todas" || (reconciliation === "Conciliadas" ? item.reconciled : !item.reconciled)) &&
    `${item.description} ${item.party}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"))) ?? [];

  function exportStatement() {
    try {
      if (!report) throw new Error(reportError);
      downloadFile(`extrato-${filter.start}-${filter.end}.csv`, cashStatementCsv(data, visible), "text/csv;charset=utf-8");
      setError("");
    } catch (cause) { setError(errorMessage(cause)); }
  }
  return <section className="finance-statements" aria-label="Caixas e bancos">
    <header className="finance-statements-heading">
      <div><h2>Caixas e bancos</h2><p>Movimentações internas registradas por baixas e transferências.</p></div>
      <div className="finance-statement-actions">
        <button type="button" className="button secondary" onClick={onCreateBank}>Cadastrar conta</button>
        <button type="button" className="button secondary" onClick={() => onNavigate("Transferências")}>Transferir entre contas</button>
        <button type="button" className="button primary" onClick={() => onCreateEntry("Receber")}>Nova entrada</button>
        <button type="button" className="button secondary" onClick={() => onCreateEntry("Pagar")}>Nova saída</button>
      </div>
    </header>
    <p className="finance-statement-note">Entrada e saída criam contas internas. Registre a baixa para que apareçam no extrato.
      Este saldo é gerencial: não envia dinheiro, não consulta o banco e pode diferir do extrato bancário.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    <form className="finance-filters" onSubmit={(event) => {
      event.preventDefault();
      try { cashStatement(data, draft); setFilter({ ...draft }); setError(""); }
      catch (cause) { setError(errorMessage(cause)); }
    }}>
      <label className="field">Conta financeira<select value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>
        <option value="">Todas as contas</option>{data.finance.accounts.map((account) =>
          <option key={account.id} value={account.id}>{account.name}{!account.active && " (inativa)"}</option>)}
      </select></label>
      <label className="field">De<input type="date" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
      <label className="field">Até<input type="date" required value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>
      <button className="button primary" type="submit">Aplicar período</button>
    </form>
    {reportError && <p className="error-message" role="alert">{reportError}</p>}
    {report && <>
      <div className="finance-statement-metrics">
        <div><small>Saldo inicial gerencial</small><strong>{report.initialBalance === null ? "Indisponível" : currency(report.initialBalance)}</strong></div>
        <div><small>Entradas no período</small><strong>{currency(report.incoming)}</strong></div>
        <div><small>Saídas no período</small><strong>{currency(report.outgoing)}</strong></div>
        <div><small>Saldo final gerencial</small><strong>{report.finalBalance === null ? "Indisponível" : currency(report.finalBalance)}</strong></div>
      </div>
      <p>Período: {displayDate(filter.start)} a {displayDate(filter.end)}. As transferências aparecem nas entradas e saídas;
        os filtros da listagem não alteram os saldos acima.</p>
      {report.missingOpening && <p>Contas sem saldo inicial informado partem de zero. Configure a base em Cadastros gerenciais.</p>}
      {report.startsBeforeBase && <p>O período começa antes de uma data-base cadastrada; o saldo inicial não pode ser reconstruído.
        Movimentos anteriores à data-base são listados, mas não compõem o saldo final dessa conta.</p>}
      <div className="finance-statement-toolbar">
        <label className="field">Buscar por nome ou histórico<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="field">Movimentações<select value={direction} onChange={(event) => setDirection(event.target.value)}>
          <option>Todas</option><option>Entradas</option><option>Saídas</option>
        </select></label>
        <label className="field">Conciliação<select value={reconciliation} onChange={(event) => setReconciliation(event.target.value)}>
          <option>Todas</option><option>Conciliadas</option><option>Pendentes</option>
        </select></label>
        <button type="button" className="button secondary" onClick={exportStatement}>Exportar extrato CSV</button>
      </div>
      <div className="finance-table"><table>
        <thead><tr><th>Data</th><th>Conta</th><th>Categoria</th><th>Histórico</th><th>Cliente / favorecido</th><th>Conciliação</th><th>Valor</th></tr></thead>
        <tbody>{visible.map((item) => <tr key={item.id}>
          <td>{displayDate(item.date)}</td><td>{data.finance.accounts.find((account) => account.id === item.accountId)?.name}</td>
          <td>{item.source === "Transferência" ? "Transferência interna" : management.categories.find((category) => category.id === item.categoryId)?.name ?? "Sem categoria"}</td>
          <td>{item.description}</td><td>{item.party}</td><td>{item.reconciled ? "Conciliado" : "Pendente"}</td><td>{currency(item.amount)}</td>
        </tr>)}</tbody>
      </table></div>
      {!visible.length && <Empty title="Nenhuma movimentação encontrada" />}
      <div className="finance-statement-links">
        <button type="button" className="text-button" onClick={() => onNavigate("Bancos")}>Gerenciar contas financeiras</button>
        <button type="button" className="text-button" onClick={() => onNavigate("Cadastros gerenciais")}>Categorias e saldos iniciais</button>
        <button type="button" className="text-button" onClick={() => onNavigate("Conciliação bancária")}>Importar extrato e conciliar</button>
        <button type="button" className="text-button" onClick={() => onNavigate("Relatórios")}>Ver relatórios financeiros</button>
      </div>
    </>}
  </section>;
}

export function FinanceCustomerStatementPanel({ data }: { data: Database }) {
  const [draft, setDraft] = useState(() => {
    const filter = defaultManagementFilter();
    return { start: filter.start, end: filter.end, clientId: "" };
  });
  const [filter, setFilter] = useState(draft);
  const [error, setError] = useState("");
  let report: ReturnType<typeof customerStatement> | undefined;
  let reportError = "";
  if (filter.clientId) {
    try { report = customerStatement(data, filter.clientId, filter); }
    catch (cause) { reportError = errorMessage(cause); }
  }
  function exportStatement() {
    try {
      if (!report) throw new Error(reportError || "Selecione um cliente.");
      downloadFile(`ficha-financeira-${filter.start}-${filter.end}.csv`,
        customerStatementCsv(data, filter.clientId, filter), "text/csv;charset=utf-8");
      setError("");
    } catch (cause) { setError(errorMessage(cause)); }
  }
  return <section className="finance-statements" aria-label="Ficha financeira">
    <header className="finance-statements-heading">
      <div><h2>Ficha financeira</h2><p>Consulte as contas a receber de um cliente pelo vencimento.</p></div>
      <button type="button" className="button secondary" disabled={!report} onClick={exportStatement}>Exportar ficha CSV</button>
    </header>
    {error && <p className="error-message" role="alert">{error}</p>}
    <form className="finance-filters" onSubmit={(event) => {
      event.preventDefault();
      try { statementPeriodSchema.parse(draft); customerStatement(data, draft.clientId, draft); setFilter({ ...draft }); setError(""); }
      catch (cause) { setError(errorMessage(cause)); }
    }}>
      <label className="field">Cliente<select required value={draft.clientId} onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}>
        <option value="">Selecione um cliente</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select></label>
      <label className="field">Vencimento de<input type="date" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
      <label className="field">Vencimento até<input type="date" required value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>
      <button type="submit" className="button primary">Consultar ficha</button>
    </form>
    {reportError && <p className="error-message" role="alert">{reportError}</p>}
    {!filter.clientId && <Empty title="Selecione um cliente para consultar" />}
    {report && <>
      <div className="finance-statement-metrics">
        <div><small>Contas no período</small><strong>{report.entries.length}</strong></div>
        <div><small>Recebido nessas contas</small><strong>{currency(report.received)}</strong></div>
        <div><small>Saldo em aberto</small><strong>{currency(report.outstanding)}</strong></div>
        <div><small>Saldo vencido</small><strong>{currency(report.overdue)}</strong></div>
      </div>
      <p>A ficha inclui somente contas vinculadas ao cadastro do cliente. Registros antigos sem vínculo não são identificados apenas pelo nome.
        Valores recebidos consideram baixas ativas, inclusive em datas fora do período de vencimento.</p>
      <div className="finance-table"><table>
        <thead><tr><th>Emissão</th><th>Vencimento</th><th>Histórico</th><th>Conta / pagamento</th><th>Valor original</th><th>Saldo</th><th>Situação</th></tr></thead>
        <tbody>{report.entries.map((entry) => <tr key={entry.id}>
          <td>{displayDate(entry.issuedOn)}</td><td>{displayDate(entry.dueOn)}</td><td>{entry.description}</td>
          <td>{data.finance.accounts.find((account) => account.id === entry.accountId)?.name}<br />{entry.paymentMethod}</td>
          <td>{currency(entry.amount)}</td><td>{entry.canceled ? "—" : currency(entryBalance(entry))}</td><td>{entryStatus(entry)}</td>
        </tr>)}</tbody>
      </table></div>
      {!report.entries.length && <Empty title="Nenhuma conta para o cliente no período" />}
    </>}
  </section>;
}
