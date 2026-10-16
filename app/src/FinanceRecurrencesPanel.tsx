import { useState } from "react";
import { Empty, Modal } from "./components";
import { currency, displayDate, localDay, makeId } from "./domain";
import type { Database } from "./domain";
import { financeRecurrenceSchema } from "./financeSchema";
import type { FinanceRecurrence } from "./financeSchema";
import { changeRecurrenceStatus, generateRecurringEntries, previewRecurringEntries, recurrenceStatus, saveFinanceRecurrence } from "./financeRecurrences";
import { FinanceClassificationFields } from "./FinanceManagementPanel";
import { errorMessage } from "./useDatabase";

type Commit = (update: (current: Database) => Database) => void;
type Editor = { mode: "new" } | { mode: "generate"; item: FinanceRecurrence } |
  { mode: "status"; item: FinanceRecurrence; status: "Ativa" | "Suspensa" | "Cancelada" };
export function FinanceRecurrencesPanel({ data, commit, onSuccess }: {
  data: Database; commit: Commit; onSuccess: (message: string) => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Todas");
  const items = (data.finance.recurrences ?? []).filter((item) =>
    (status === "Todas" || recurrenceStatus(item) === status) &&
    `${item.description} ${item.party} ${item.id}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  return <section className="finance-management" aria-label="Recorrências financeiras">
    <h2>Recorrências financeiras mensais</h2>
    <p>Geração manual por prévia, sem execução automática, notas, boletos/Pix ou OS. O valor é mensal, não um parcelamento de dívida.
      Somente contas geradas entram no saldo aberto e na previsão; cadastrar uma recorrência não movimenta caixa.</p>
    <p>Banco, dados, valor e vigência ficam preservados. Para alterar condições, cancele e cadastre outra, sem sobrepor meses já cobrados.
      Suspender/cancelar bloqueia novas gerações e não cancela contas existentes. Reativar permite gerar meses pendentes da vigência,
      inclusive meses passados durante a suspensão: confira a prévia. Cancelamento é definitivo.</p>
    <div className="section-heading">
      <label className="field">Buscar recorrência<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="field">Situação da recorrência<select value={status} onChange={(event) => setStatus(event.target.value)}>
        {["Todas", "Ativa", "Suspensa", "Cancelada"].map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <button className="button primary" onClick={() => setEditor({ mode: "new" })}>Nova recorrência</button>
    </div>
    <div className="finance-table"><table><thead><tr><th>Cliente / Favorecido</th><th>Descrição / tipo</th><th>Valor mensal</th>
      <th>Vigência / banco</th><th>Situação / histórico</th><th>Ações</th></tr></thead><tbody>{items.map((item) => {
      const current = recurrenceStatus(item), generated = data.finance.entries.filter((entry) => entry.recurrence?.id === item.id);
      return <tr key={item.id}><td>{item.party}</td><td>{item.description}<br />{item.kind}<br /><small>{item.id}</small></td>
        <td>{currency(item.amount)}</td><td>{displayDate(item.firstDueOn)} até {displayDate(item.endsOn)}<br />
          {data.finance.accounts.find((account) => account.id === item.accountId)?.name} · {item.paymentMethod}</td>
        <td>{current}<details><summary>Histórico e contas ({generated.length})</summary>
          <p>Cadastro: {item.createdAt}</p>{item.events.map((event, index) => <p key={index}>{event.at} · {event.status} · {event.reason}</p>)}
          {generated.map((entry) => <p key={entry.id}>{entry.recurrence?.period} · {currency(entry.amount)} ·
            {entry.canceled ? "Cancelada; mês permanece reservado" : "Gerada"} · {entry.id}</p>)}
        </details></td><td>{current !== "Cancelada" && <div className="finance-actions">
          {current === "Ativa" && <button className="button secondary" onClick={() => setEditor({ mode: "generate", item })}>Gerar contas</button>}
          <button className="text-button" onClick={() => setEditor({ mode: "status", item, status: current === "Ativa" ? "Suspensa" : "Ativa" })}>
            {current === "Ativa" ? "Suspender" : "Reativar"}</button>
          <button className="text-button" onClick={() => setEditor({ mode: "status", item, status: "Cancelada" })}>Cancelar recorrência</button>
        </div>}</td></tr>;
    })}</tbody></table>{!items.length && <Empty title="Nenhuma recorrência encontrada" />}</div>
    <p>Um mês só gera uma conta por recorrência, mesmo após cancelamento da conta. Não recrie a recorrência para contornar divergências.
      Aplique as migrações de proteção antes de publicar e aguarde Sincronizado ao operar conectado.</p>
    {editor && <RecurrenceEditor data={data} editor={editor} onClose={() => setEditor(null)} onSave={(update) => {
      commit(update); setEditor(null); onSuccess("Recorrência atualizada internamente. Aguarde Sincronizado quando conectado.");
    }} />}
  </section>;
}

function RecurrenceEditor({ data, editor, onClose, onSave }: { data: Database; editor: Editor; onClose: () => void; onSave: Commit }) {
  const [id] = useState(makeId);
  const [kind, setKind] = useState<"Receber" | "Pagar">("Receber");
  const [error, setError] = useState("");
  const [from, setFrom] = useState(localDay().slice(0, 7));
  const [through, setThrough] = useState(localDay().slice(0, 7));
  const [preview, setPreview] = useState<ReturnType<typeof previewRecurringEntries> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const title = editor.mode === "new" ? "Cadastrar recorrência mensal" : editor.mode === "generate" ? "Gerar contas recorrentes" : "Alterar situação da recorrência";
  return <Modal title={title} onClose={onClose}><form onChange={(event) => {
    if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) &&
      event.target.name !== "confirmed") setConfirmed(false);
  }} onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget), text = (key: string) => String(form.get(key) ?? "").trim();
    try {
      if (editor.mode === "new") {
        const client = kind === "Receber" ? data.clients.find((item) => item.id === text("clientId")) : undefined;
        if (kind === "Receber" && !client) throw new Error("Selecione um cliente.");
        const item = financeRecurrenceSchema.parse({ id, kind, party: client?.name ?? text("party"), ...(client ? { clientId: client.id } : {}),
          description: text("description"), amount: Math.round(Number(text("amount")) * 100), accountId: text("accountId"),
          paymentMethod: text("paymentMethod"), firstDueOn: text("firstDueOn"), endsOn: text("endsOn"),
          ...(text("categoryId") ? { categoryId: text("categoryId") } : {}), ...(text("costCenterId") ? { costCenterId: text("costCenterId") } : {}),
          createdAt: new Date().toISOString(), events: [] });
        onSave((current) => saveFinanceRecurrence(current, item, confirmed));
      } else if (editor.mode === "generate") {
        if (!preview) throw new Error("Gere e confira a prévia antes de confirmar.");
        onSave((current) => generateRecurringEntries(current, editor.item, from, through, preview, confirmed));
      } else onSave((current) => changeRecurrenceStatus(current, editor.item, editor.status, text("reason"), confirmed));
    } catch (cause) { setError(errorMessage(cause)); }
  }}>
    <div className="modal-body"><div className="form-grid">
      {error && <p className="error-message full" role="alert">{error}</p>}
      {editor.mode === "new" ? <>
        <label className="field">Tipo de recorrência<select name="kind" value={kind} onChange={(event) => setKind(event.target.value === "Pagar" ? "Pagar" : "Receber")}>
          <option>Receber</option><option>Pagar</option></select></label>
        {kind === "Receber" ? <label className="field">Cliente<select name="clientId" required defaultValue=""><option value="">Selecione</option>
          {data.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> :
          <label className="field">Favorecido / fornecedor<input name="party" required maxLength={1000} /></label>}
        <label className="field">Descrição<input name="description" required maxLength={1000} /></label>
        <label className="field">Valor mensal (R$)<input name="amount" type="number" min="0.01" max="1000000" step="0.01" required /></label>
        <label className="field">Primeiro vencimento<input name="firstDueOn" type="date" required defaultValue={localDay()} /></label>
        <label className="field">Fim da vigência<input name="endsOn" type="date" required /></label>
        <label className="field">Conta bancária<select name="accountId" required defaultValue=""><option value="">Selecione</option>
          {data.finance.accounts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field">Forma de pagamento<select name="paymentMethod">
          {["Pix", "Boleto", "Transferência", "Dinheiro", "Cartão", "Outro"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <FinanceClassificationFields key={kind} data={data} kind={kind} />
        <p className="full">Mensal no dia do primeiro vencimento, ajustado ao último dia nos meses curtos, sem perder o dia original.
          Somente vencimentos até o fim da vigência. Não gera contas neste cadastro; valor e condições não são editáveis depois.</p>
      </> : editor.mode === "generate" ? <>
        <p className="full">{editor.item.party} · {editor.item.description} · {currency(editor.item.amount)} por mês.
          Até 24 meses por lote, inclusive meses passados/futuros, dentro da vigência. Não presume prestação de serviço ou pagamento.</p>
        <label className="field">Do mês<input name="from" type="month" required value={from}
          onChange={(event) => { setFrom(event.target.value); setPreview(null); }} /></label>
        <label className="field">Até o mês<input name="through" type="month" required value={through}
          onChange={(event) => { setThrough(event.target.value); setPreview(null); }} /></label>
        <button type="button" className="button secondary" onClick={() => {
          try { setPreview(previewRecurringEntries(data, editor.item.id, from, through)); setConfirmed(false); setError(""); }
          catch (cause) { setPreview(null); setError(errorMessage(cause)); }
        }}>Gerar prévia</button>
        {preview && <div className="finance-billing-group full">
          <p>{preview.filter((row) => !row.existingId).length} novas contas · Total novo: {currency(preview.filter((row) => !row.existingId).reduce((sum, row) => sum + row.amount, 0))}</p>
          <table><thead><tr><th>Mês</th><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead><tbody>{preview.map((row) =>
            <tr key={row.period}><td>{row.period}</td><td>{displayDate(row.dueOn)}</td><td>{currency(row.amount)}</td>
              <td>{row.existingId ? row.canceled ? "Já gerada e cancelada; não repetir" : "Já gerada; ignorada" : "Nova conta"}</td></tr>)}</tbody></table>
          {!preview.length && <p>Nenhum vencimento na vigência para este período.</p>}
        </div>}
      </> : <><p className="full">{editor.item.description} · Nova situação: <strong>{editor.status}</strong>.
        Contas já geradas serão preservadas. {editor.status === "Cancelada" ? "Cancelamento definitivo, sem reativação." :
          editor.status === "Ativa" ? "Meses pendentes da vigência poderão ser gerados, inclusive durante a suspensão; revise a prévia." : "Nenhuma nova geração enquanto suspensa."}</p>
        <label className="field full">Motivo<textarea name="reason" required minLength={5} maxLength={1000} /></label></>}
      <label className="checkbox-field full"><input name="confirmed" type="checkbox" required checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)} />
        {editor.mode === "new" ? "Conferi valor mensal, dados e vigência; entendo que não gera cobrança externa." :
          editor.mode === "generate" ? "Conferi meses, vencimentos e total das novas contas; autorizo a geração interna." : "Confirmo a mudança de situação e a preservação das contas existentes."}</label>
    </div></div>
    <footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Voltar</button>
      <button className="button primary" disabled={editor.mode === "generate" && !preview?.some((row) => !row.existingId)}>
        {editor.mode === "new" ? "Cadastrar recorrência" : editor.mode === "generate" ? "Confirmar geração" : "Confirmar situação"}</button></footer>
  </form></Modal>;
}
