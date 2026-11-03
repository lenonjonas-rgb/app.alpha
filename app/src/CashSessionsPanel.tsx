import { useState } from "react";
import { Empty, Modal } from "./components";
import { currency, displayDate } from "./domain";
import type { Database } from "./domain";
import { cashMovementKey } from "./cashSessionSchema";
import type { CashSession } from "./cashSessionSchema";
import { cashMovementDetails, cashMovementReversed, cashSessionCandidates, closeCashSession, openCashSession } from "./cashSessions";
import { errorMessage } from "./useDatabase";

type Commit = (update: (current: Database) => Database) => void;
type Editor = { mode: "open" } | { mode: "close"; session: CashSession };

function readCashAmount(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) > 1000000)
    throw new Error("Informe um valor entre R$ 0,00 e R$ 1.000.000,00 com até dois centavos.");
  return Math.round(Number(value) * 100);
}

export function CashSessionsPanel({ data, commit, onSuccess }: { data: Database; commit: Commit; onSuccess: (message: string) => void }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const sessions = [...(data.finance.cashSessions ?? [])].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  return <section className="finance-management" aria-label="Controle de caixa">
    <div className="finance-statements-heading"><div><h2>Controle de caixa</h2>
      <p>Abertura, conferência e fechamento internos por conta do tipo Caixa.</p></div>
      <button type="button" className="button primary" onClick={() => setEditor({ mode: "open" })}>Abrir caixa</button></div>
    <p className="finance-statement-note">A abertura informa o dinheiro contado e não altera o saldo financeiro.
      No fechamento, selecione as baixas e transferências que pertencem à sessão e informe a contagem física.
      Nenhuma movimentação ou pagamento é criado automaticamente.</p>
    <p>As movimentações possuem data, não horário. Confira especialmente lançamentos do dia da abertura e registros retroativos;
      os movimentos não selecionados não entram no fechamento. A forma cadastrada não confirma que a baixa foi em espécie:
      selecione apenas o que realmente compõe a contagem física. Cada movimento só pode ser usado em um fechamento.</p>
    <div className="finance-table"><table><thead><tr><th>Loja / conta</th><th>Abertura</th><th>Troco inicial</th>
      <th>Fechamento</th><th>Esperado / contado</th><th>Diferença</th><th>Ações</th></tr></thead>
      <tbody>{sessions.map((session) => {
        const closure = session.closure;
        const reversed = closure?.movements.filter((movement) => cashMovementReversed(data, movement)).length ?? 0;
        return <tr key={session.id}><td>{session.store}<br /><small>{data.finance.accounts.find((account) => account.id === session.accountId)?.name}</small></td>
          <td>{displayDate(session.openedOn)}<br /><small>{new Date(session.openedAt).toLocaleString("pt-BR")}</small></td><td>{currency(session.openingAmount)}</td>
          <td>{closure ? <>{displayDate(closure.date)}<br /><small>{new Date(closure.at).toLocaleString("pt-BR")}</small></> : "Aberto"}</td>
          <td>{closure ? <>{currency(closure.expected)} / {currency(closure.counted)}<details><summary>Movimentos ({closure.movements.length})</summary>
            {closure.movements.map((movement) => {
              const details = cashMovementDetails(data, movement);
              return <p key={cashMovementKey(movement)}>
                {displayDate(movement.date)} · {details.description} · {details.party} · {details.paymentMethod} · {currency(movement.amount)}
                {cashMovementReversed(data, movement) && " · estornada após o fechamento"}</p>;
            })}
          </details></> : "—"}</td><td>{closure ? currency(closure.difference) : "—"}
            {reversed > 0 && <small className="finance-classification">{reversed} movimento(s) estornado(s) após o fechamento; histórico preservado.</small>}</td>
          <td>{!closure && <button type="button" className="button secondary" onClick={() => setEditor({ mode: "close", session })}>Conferir e fechar</button>}</td>
        </tr>;
      })}</tbody></table></div>
    {!sessions.length && <Empty title="Nenhuma abertura de caixa" />}
    {editor && (editor.mode === "open" ? <CashOpenEditor data={data} onClose={() => setEditor(null)}
      onSave={(update) => { commit(update); setEditor(null); onSuccess("Caixa aberto internamente, sem movimentar dinheiro."); }} /> :
      <CashCloseEditor data={data} session={editor.session} onClose={() => setEditor(null)}
        onSave={(update) => { commit(update); setEditor(null); onSuccess("Fechamento interno registrado. Aguarde Sincronizado quando conectado."); }} />)}
  </section>;
}

function CashOpenEditor({ data, onClose, onSave }: { data: Database; onClose: () => void; onSave: Commit }) {
  const [error, setError] = useState("");
  const accounts = data.finance.accounts.filter((account) => account.active && account.kind === "Caixa" &&
    !data.finance.cashSessions?.some((session) => session.accountId === account.id && !session.closure));
  return <Modal title="Abrir caixa" onClose={onClose}><form onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const input = { accountId: String(form.get("accountId") ?? ""), store: String(form.get("store") ?? "").trim(),
        openingAmount: readCashAmount(String(form.get("openingAmount") ?? "")) };
      onSave((current) => openCashSession(current, input, form.get("confirmed") === "on"));
    } catch (cause) { setError(errorMessage(cause)); }
  }}><div className="modal-body"><div className="form-grid">
    {error && <p className="error-message full" role="alert">{error}</p>}
    <label className="field">Loja / local<input name="store" required maxLength={160} /></label>
    <label className="field">Conta financeira do tipo Caixa<select name="accountId" required defaultValue=""><option value="">Selecione</option>
      {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
    <label className="field">Troco inicial contado (R$)<input type="number" name="openingAmount" min="0" max="1000000" step="0.01" required defaultValue="0" /></label>
    {!accounts.length && <p className="full">Cadastre ou ative uma conta do tipo Caixa sem sessão aberta em Bancos.</p>}
    <label className="checkbox-field full"><input type="checkbox" name="confirmed" required />Conferi a conta e o troco contado. Não será criada movimentação financeira.</label>
  </div></div><footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Voltar</button>
    <button className="button primary" disabled={!accounts.length}>Confirmar abertura</button></footer></form></Modal>;
}

function CashCloseEditor({ data, session, onClose, onSave }: { data: Database; session: CashSession; onClose: () => void; onSave: Commit }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [counted, setCounted] = useState("");
  const [error, setError] = useState("");
  let choices: ReturnType<typeof cashSessionCandidates> = [];
  let choicesError = "";
  try { choices = cashSessionCandidates(data, session); }
  catch (cause) { choicesError = errorMessage(cause); }
  const expected = session.openingAmount + choices.filter((item) => selected.includes(cashMovementKey(item.movement)))
    .reduce((sum, item) => sum + item.movement.amount, 0);
  return <Modal title="Conferir e fechar caixa" onClose={onClose} wide><form onSubmit={(event) => {
    event.preventDefault();
    try {
      if (choicesError) throw new Error(choicesError);
      const actual = readCashAmount(counted);
      onSave((current) => closeCashSession(current, session, choices, selected, actual, confirmed));
    } catch (cause) { setError(errorMessage(cause)); }
  }}><div className="modal-body"><div className="form-grid">
    {(error || choicesError) && <p className="error-message full" role="alert">{error || choicesError}</p>}
    <p className="full">Selecione somente os movimentos desta sessão que compõem a contagem em espécie. A forma cadastrada não confirma a forma efetiva da baixa.
      A data não identifica a hora: confira lançamentos do dia da abertura e os que foram registrados retroativamente.</p>
    <div className="finance-table full"><table><thead><tr><th>Selecionar</th><th>Data</th><th>Histórico</th><th>Cliente / conta</th><th>Forma cadastrada</th><th>Valor</th></tr></thead>
      <tbody>{choices.map(({ movement, description, party, paymentMethod }) => {
        const key = cashMovementKey(movement);
        return <tr key={key}><td><input type="checkbox" aria-label={`Selecionar ${description} de ${displayDate(movement.date)}`}
          checked={selected.includes(key)} onChange={(event) => { setSelected(event.target.checked ? [...selected, key] : selected.filter((item) => item !== key)); setConfirmed(false); }} /></td>
          <td>{displayDate(movement.date)}</td><td>{description}<br /><small>{movement.source === "settlement" ? "Baixa" : "Transferência"}</small></td>
          <td>{party}</td><td>{paymentMethod}</td><td>{currency(movement.amount)}</td></tr>;
      })}</tbody></table></div>
    {!choices.length && !choicesError && <p className="full">Nenhuma movimentação disponível para selecionar no período.</p>}
    <p className="full">Troco inicial: {currency(session.openingAmount)} · Saldo esperado com os movimentos selecionados: <strong>{currency(expected)}</strong></p>
    <label className="field">Dinheiro contado no fechamento (R$)<input type="number" min="0" max="1000000" step="0.01" required
      value={counted} onChange={(event) => { setCounted(event.target.value); setConfirmed(false); }} /></label>
    <label className="checkbox-field full"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
      Conferi os movimentos selecionados e a contagem física. O fechamento preserva a diferença e não altera contas ou pagamentos.</label>
  </div></div><footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Voltar</button>
    <button className="button primary" disabled={Boolean(choicesError)}>Confirmar fechamento</button></footer></form></Modal>;
}
