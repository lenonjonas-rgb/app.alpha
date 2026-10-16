import { useState } from "react";
import type { FormEvent } from "react";
import { Empty, Modal } from "./components";
import { currency, displayDate, localDay, makeId } from "./domain";
import type { Database } from "./domain";
import { downloadFile, errorMessage } from "./useDatabase";
import { defaultManagementFilter, financeManagement, managementCsv, managementReport,
  saveCostCenter, saveFinanceCategory, saveOpeningBalance } from "./financeManagement";
import type { ManagementFilter } from "./financeManagement";
import type { CostCenter, FinanceCategory } from "./financeSchema";

type Commit = (update: (current: Database) => Database) => void;
export type ManagementTab = "Painel gerencial" | "Fluxo de caixa" | "Relatórios" | "Cadastros gerenciais";
type Editor = { kind: "category"; item?: FinanceCategory } | { kind: "center"; item?: CostCenter } |
  { kind: "opening"; accountId: string };

export function FinanceManagementPanel({ data, tab, commit, onSuccess }: {
  data: Database; tab: ManagementTab; commit: Commit; onSuccess: (message: string) => void;
}) {
  const [filter, setFilter] = useState<ManagementFilter>(() => defaultManagementFilter());
  const [draft, setDraft] = useState(filter);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const management = financeManagement(data);
  let report: ReturnType<typeof managementReport> | undefined;
  let reportError = "";
  try { report = managementReport(data, filter); }
  catch (cause) { reportError = errorMessage(cause); }
  function act(update: (current: Database) => Database, message: string) {
    commit(update);
    onSuccess(`${message} Aguarde a sincronização quando conectado.`);
  }
  function exportReport() {
    try {
      if (!report) throw new Error(reportError);
      downloadFile(`financeiro-${filter.start}-${filter.end}.csv`, managementCsv(data, report), "text/csv;charset=utf-8");
      setError("");
    } catch (cause) { setError(errorMessage(cause)); }
  }
  const groupName = (id: string, kind: "categories" | "costCenters") => management[kind].find((item) => item.id === id)?.name ??
    (kind === "categories" ? "Sem categoria" : "Sem centro de custo");
  const groupTable = (kind: "categories" | "costCenters") => report && <div className="finance-table"><table>
    <caption>{kind === "categories" ? "Resultado por categoria" : "Resultado por centro de custo"}</caption>
    <thead><tr><th>Classificação</th><th>Recebido</th><th>Pago</th><th>Resultado de caixa</th><th>A receber previsto</th><th>A pagar previsto</th></tr></thead>
    <tbody>{report[kind].map((item) => <tr key={item.id}><td>{groupName(item.id, kind)}</td>
      <td>{currency(item.received)}</td><td>{currency(item.paid)}</td><td>{currency(item.received - item.paid)}</td>
      <td>{currency(item.expectedReceipts)}</td><td>{currency(item.expectedPayments)}</td></tr>)}</tbody>
  </table>{!report[kind].length && <Empty title="Sem movimentos para os filtros selecionados" />}</div>;
  return <section className="finance-management" aria-label={tab}>
    <div><h2>{tab}</h2><p>Gestão interna em regime de caixa. Não substitui extrato bancário, conciliação ou DRE contábil.</p></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {tab !== "Cadastros gerenciais" && <>
      <form className="finance-filters" onSubmit={(event) => {
        event.preventDefault();
        try { managementReport(data, draft); setFilter({ ...draft }); setError(""); }
        catch (cause) { setError(errorMessage(cause)); }
      }}>
        <label className="field">De<input type="date" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
        <label className="field">Até<input type="date" required value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>
        <label className="field">Banco<select value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>
          <option value="">Todos os bancos</option>{data.finance.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}{!item.active && " (inativo)"}</option>)}
        </select></label>
        <label className="field">Categoria<select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>
          <option value="">Todas as categorias</option>{management.categories.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.kind}{!item.active && " (inativa)"}</option>)}
        </select></label>
        <label className="field">Centro de custo<select value={draft.costCenterId} onChange={(event) => setDraft({ ...draft, costCenterId: event.target.value })}>
          <option value="">Todos os centros</option>{management.costCenters.map((item) => <option key={item.id} value={item.id}>{item.name}{!item.active && " (inativo)"}</option>)}
        </select></label>
        <button className="button primary" type="submit">Aplicar filtros</button>
      </form>
      {reportError && <p className="error-message" role="alert">{reportError}</p>}
      {report && <>
        <div className="section-heading"><p>Período aplicado: {displayDate(filter.start)} a {displayDate(filter.end)}</p>
          <button className="button secondary" onClick={exportReport}>Exportar movimentos CSV</button></div>
        <div className="finance-metrics finance-management-metrics">
          <div><small>Recebido no período</small><strong>{currency(report.totals.received)}</strong></div>
          <div><small>Pago no período</small><strong>{currency(report.totals.paid)}</strong></div>
          <div><small>Resultado de caixa realizado</small><strong>{currency(report.totals.received - report.totals.paid)}</strong></div>
          <div><small>A receber previsto até o fim</small><strong>{currency(report.totals.expectedReceipts)}</strong></div>
          <div><small>A pagar previsto até o fim</small><strong>{currency(report.totals.expectedPayments)}</strong></div>
          <div><small>Variação realizada + prevista</small><strong>{currency(report.totals.received - report.totals.paid + report.totals.expectedReceipts - report.totals.expectedPayments)}</strong></div>
        </div>
        <p>Realizado considera a data e o banco de cada baixa, sem estornos nem cancelamentos. Retenções não são recebimentos.
          Previsão usa o saldo líquido ainda aberto; vencidos e vencimentos anteriores ao início são trazidos para hoje ou para o início do período futuro.
          Não há previsão retroativa nem garantia de recebimento.</p>
        <p>Transferências internas no período: entradas {currency(report.transferTotals.incoming)} · saídas {currency(report.transferTotals.outgoing)}.
          São separadas de receitas/despesas e se anulam entre contas no consolidado. Filtros de categoria/centro não incluem transferências.</p>
        {tab === "Painel gerencial" && <>
          <div className="finance-table"><table><caption>Contas em aberto hoje · filtros de banco, categoria e centro · independente do período</caption>
            <thead><tr><th>Vencimento</th><th>A receber líquido</th><th>A pagar</th></tr></thead>
            <tbody>{report.aging.map((item) => <tr key={item.label}><td>{item.label}</td><td>{currency(item.receivable)}</td><td>{currency(item.payable)}</td></tr>)}</tbody>
          </table></div>
          {groupTable("categories")}
        </>}
        {(tab === "Painel gerencial" || tab === "Fluxo de caixa") && <>
          {!filter.categoryId && !filter.costCenterId ? <div className="finance-table"><table>
            <caption>Posição gerencial por banco até {displayDate(filter.end)} · inclui movimentos anteriores ao período</caption>
            <thead><tr><th>Banco</th><th>Base informada</th><th>Saldo registrado</th><th>Saldo com previsão em aberto</th></tr></thead>
            <tbody>{report.positions.map((item) => <tr key={item.accountId}>
              <td>{data.finance.accounts.find((account) => account.id === item.accountId)?.name}</td>
              <td>{item.opening ? `${currency(item.opening.amount)} no início de ${displayDate(item.opening.date)}` : "Não informada: parte de zero e soma baixas e transferências registradas"}</td>
              <td>{item.balance === null ? "Período anterior à base" : currency(item.balance)}</td>
              <td>{item.projected === null ? "Indisponível" : currency(item.projected)}</td>
            </tr>)}</tbody></table>{!report.positions.length && <Empty title="Cadastre uma conta na aba Bancos" />}</div>
            : <p>Saldos bancários não são exibidos com filtros de categoria ou centro de custo; esses recortes representam apenas movimentos.</p>}
          <p>Informe a base em Cadastros gerenciais. O saldo considera baixas e transferências ativas a partir do início da data-base; não é saldo consultado no banco.
            Corrigir a base altera os relatórios. Confira os movimentos na aba Conciliação bancária; os saldos não são certificados pelo banco.
            Registre transferências na aba própria, sem criar receitas/despesas para as mesmas pontas.</p>
        </>}
        {tab === "Fluxo de caixa" && <div className="finance-table"><table><caption>Fluxo diário · somente dias com movimentos</caption>
          <thead><tr><th>Data</th><th>Recebido</th><th>Pago</th><th>Resultado realizado</th><th>Transferências recebidas</th><th>Transferências enviadas</th><th>Previsto receber</th><th>Previsto pagar</th><th>Variação total</th></tr></thead>
          <tbody>{report.daily.map((item) => <tr key={item.date}><td>{displayDate(item.date)}</td>
            <td>{currency(item.received)}</td><td>{currency(item.paid)}</td><td>{currency(item.received - item.paid)}</td>
            <td>{currency(item.transfersIn)}</td><td>{currency(item.transfersOut)}</td>
            <td>{currency(item.expectedReceipts)}</td><td>{currency(item.expectedPayments)}</td>
            <td>{currency(item.received - item.paid + item.transfersIn - item.transfersOut + item.expectedReceipts - item.expectedPayments)}</td></tr>)}</tbody>
        </table>{!report.daily.length && <Empty title="Sem movimentos no período" />}</div>}
        {tab === "Relatórios" && <>
          {groupTable("categories")}{groupTable("costCenters")}
          <div className="finance-table"><table><caption>Movimentos realizados e previstos</caption>
            <thead><tr><th>Data</th><th>Origem / tipo</th><th>Cliente / Favorecido</th><th>Descrição</th><th>Banco</th><th>Categoria / centro</th><th>Valor</th></tr></thead>
            <tbody>{report.movements.map((item) => <tr key={`${item.source}:${item.id}`}><td>{displayDate(item.date)}</td>
              <td>{item.source === "realized" ? "Realizado" : "Previsto"} · {item.kind}</td><td>{item.party}</td><td>{item.description}</td>
              <td>{data.finance.accounts.find((account) => account.id === item.accountId)?.name}</td>
              <td>{groupName(item.categoryId, "categories")}<br />{groupName(item.costCenterId, "costCenters")}</td><td>{currency(item.amount)}
                {item.adjustment && <details><summary>Ajustes da baixa</summary>
                  Principal: {currency(item.adjustment.principal)} · Juros: {currency(item.adjustment.interest)} · Multa: {currency(item.adjustment.fine)} ·
                  Desconto: {currency(item.adjustment.discount)}<p>{item.adjustment.reason}</p>
                </details>}</td>
            </tr>)}</tbody></table>{!report.movements.length && <Empty title="Sem movimentos no período" />}</div>
        </>}
        {tab === "Relatórios" && <div className="finance-table"><table><caption>Transferências internas · separadas do resultado operacional</caption>
          <thead><tr><th>Data</th><th>Descrição</th><th>Banco</th><th>Contrapartida</th><th>Entrada</th><th>Saída</th></tr></thead>
          <tbody>{report.transfers.map((item) => <tr key={`${item.transferId}:${item.accountId}`}>
            <td>{displayDate(item.date)}</td><td>{item.description}</td>
            <td>{data.finance.accounts.find((account) => account.id === item.accountId)?.name}</td>
            <td>{data.finance.accounts.find((account) => account.id === item.counterpartId)?.name}</td>
            <td>{currency(Math.max(0, item.amount))}</td><td>{currency(Math.max(0, -item.amount))}</td>
          </tr>)}</tbody></table>{!report.transfers.length && <Empty title="Sem transferências ativas neste recorte" />}</div>}
      </>}
    </>}
    {tab === "Cadastros gerenciais" && <>
      <p>Categorias separam receitas e despesas. Centros de custo identificam áreas, contratos ou unidades.
        Classifique as contas a pagar/receber, inclusive faturamentos existentes. A classificação não altera o título nem documentos fiscais.
        Inativar um cadastro preserva o histórico; renomear ou reclassificar atualiza os recortes gerenciais.</p>
      <div className="finance-actions">
        <button className="button primary" onClick={() => setEditor({ kind: "category" })}>Nova categoria</button>
        <button className="button secondary" onClick={() => setEditor({ kind: "center" })}>Novo centro de custo</button>
      </div>
      <div className="finance-table"><table><caption>Categorias financeiras</caption>
        <thead><tr><th>Nome</th><th>Tipo</th><th>Situação</th><th>Ação</th></tr></thead>
        <tbody>{management.categories.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.kind === "Receber" ? "Receita" : "Despesa"}</td><td>{item.active ? "Ativa" : "Inativa"}</td>
          <td><button className="text-button" onClick={() => setEditor({ kind: "category", item })}>Editar categoria</button></td></tr>)}</tbody>
      </table>{!management.categories.length && <Empty title="Nenhuma categoria cadastrada" />}</div>
      <div className="finance-table"><table><caption>Centros de custo</caption>
        <thead><tr><th>Nome</th><th>Situação</th><th>Ação</th></tr></thead>
        <tbody>{management.costCenters.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.active ? "Ativo" : "Inativo"}</td>
          <td><button className="text-button" onClick={() => setEditor({ kind: "center", item })}>Editar centro</button></td></tr>)}</tbody>
      </table>{!management.costCenters.length && <Empty title="Nenhum centro de custo cadastrado" />}</div>
      <div className="finance-table"><table><caption>Base inicial dos saldos bancários</caption>
        <thead><tr><th>Banco</th><th>Data-base (início do dia)</th><th>Saldo inicial</th><th>Ação</th></tr></thead>
        <tbody>{data.finance.accounts.map((item) => {
          const opening = management.openingBalances.find((balance) => balance.accountId === item.id);
          return <tr key={item.id}><td>{item.name}</td><td>{opening ? displayDate(opening.date) : "Não informada"}</td>
            <td>{opening ? currency(opening.amount) : "Zero presumido"}</td>
            <td><button className="text-button" disabled={!item.active} onClick={() => setEditor({ kind: "opening", accountId: item.id })}>{opening ? "Corrigir base" : "Informar base"}</button></td></tr>;
        })}</tbody></table>{!data.finance.accounts.length && <Empty title="Cadastre uma conta na aba Bancos" />}</div>
    </>}
    {editor && <ManagementEditor data={data} editor={editor} onClose={() => setEditor(null)} onSave={(update) => {
      act(update, "Cadastro gerencial salvo."); setEditor(null);
    }} />}
  </section>;
}

function ManagementEditor({ data, editor, onSave, onClose }: {
  data: Database; editor: Editor; onSave: Commit; onClose: () => void;
}) {
  const [error, setError] = useState("");
  const opening = editor.kind === "opening" ? financeManagement(data).openingBalances.find((item) => item.accountId === editor.accountId) : undefined;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    try {
      if (editor.kind === "category") {
        const kind = text("kind");
        if (kind !== "Receber" && kind !== "Pagar") throw new Error("Selecione o tipo da categoria.");
        const item: FinanceCategory = { id: editor.item?.id ?? makeId(), name: text("name"), kind, active: form.has("active") };
        onSave((current) => saveFinanceCategory(current, item));
      } else if (editor.kind === "center") {
        const item = { id: editor.item?.id ?? makeId(), name: text("name"), active: form.has("active") };
        onSave((current) => saveCostCenter(current, item));
      } else {
        const amount = Math.round(Number(text("amount")) * 100), date = text("date");
        onSave((current) => saveOpeningBalance(current, { accountId: editor.accountId, date, amount }));
      }
    } catch (cause) { setError(errorMessage(cause)); }
  }
  return <Modal title={editor.kind === "category" ? "Categoria financeira" : editor.kind === "center" ? "Centro de custo" : "Saldo inicial gerencial"} onClose={onClose}>
    <form onSubmit={submit}><div className="modal-body"><div className="form-grid">
      {error && <p className="error-message full" role="alert">{error}</p>}
      {editor.kind === "opening" ? <>
        <p className="full">Informe o saldo no início do dia, antes das baixas dessa data. Baixas anteriores à base não entram na posição bancária.
          Saldo negativo é permitido. Essa informação é manual e não confirma o extrato do banco.</p>
        <label className="field">Data-base<input name="date" type="date" max={localDay()} required defaultValue={opening?.date ?? localDay()} /></label>
        <label className="field">Saldo inicial (R$)<input name="amount" type="number" step="0.01" min="-1000000" max="1000000" required defaultValue={opening ? opening.amount / 100 : 0} /></label>
        <label className="checkbox-field full"><input type="checkbox" required />Revisei a base e entendo que ela altera a posição gerencial, sem movimentar o banco.</label>
      </> : <>
        <label className="field full">Nome<input name="name" required maxLength={1000} defaultValue={editor.item?.name} /></label>
        {editor.kind === "category" && <label className="field">Tipo<select name="kind" defaultValue={editor.item?.kind ?? "Receber"}>
          <option value="Receber">Receita</option><option value="Pagar">Despesa</option>
        </select></label>}
        <label className="checkbox-field"><input type="checkbox" name="active" defaultChecked={editor.item?.active ?? true} />Ativo</label>
      </>}
    </div></div><footer className="modal-actions">
      <button className="button secondary" type="button" onClick={onClose}>Cancelar</button>
      <button className="button primary" type="submit">Salvar cadastro</button>
    </footer></form>
  </Modal>;
}

export function FinanceClassificationFields({ data, kind, entryId }: { data: Database; kind: "Receber" | "Pagar"; entryId?: string }) {
  const management = financeManagement(data), classification = management.classifications.find((item) => item.entryId === entryId);
  return <>
    <label className="field">Categoria<select name="categoryId" defaultValue={classification?.categoryId ?? ""}>
      <option value="">Sem categoria</option>{management.categories.filter((item) => item.kind === kind && (item.active || item.id === classification?.categoryId))
        .map((item) => <option key={item.id} value={item.id}>{item.name}{!item.active && " (inativa)"}</option>)}
    </select></label>
    <label className="field">Centro de custo<select name="costCenterId" defaultValue={classification?.costCenterId ?? ""}>
      <option value="">Sem centro de custo</option>{management.costCenters.filter((item) => item.active || item.id === classification?.costCenterId)
        .map((item) => <option key={item.id} value={item.id}>{item.name}{!item.active && " (inativo)"}</option>)}
    </select></label>
  </>;
}
