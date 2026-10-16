import { useState } from "react";
import { Empty, Modal } from "./components";
import { currency, displayDate, localDay, makeId } from "./domain";
import type { Database } from "./domain";
import type { FinanceTransfer } from "./financeSchema";
import { recordFinanceTransfer, reverseFinanceTransfer } from "./financeTransfers";
import { errorMessage } from "./useDatabase";
import { activeTransferMatch, banking } from "./bankReconciliation";

type Commit = (update: (current: Database) => Database) => void;
export function FinanceTransfersPanel({ data, commit, onSuccess }: {
  data: Database; commit: Commit; onSuccess: (message: string) => void;
}) {
  const [editor, setEditor] = useState<{ kind: "new" } | { kind: "reverse"; transfer: FinanceTransfer } | null>(null);
  const [accountId, setAccountId] = useState("");
  const [status, setStatus] = useState("Todas");
  const name = (id: string) => data.finance.accounts.find((item) => item.id === id)?.name;
  const reconciled = (transferId: string, leg: "outgoing" | "incoming") => (banking(data).transferMatches ?? [])
    .some((item) => item.transferId === transferId && item.leg === leg && activeTransferMatch(data, item));
  const transfers = (data.finance.transfers ?? []).filter((item) =>
    (!accountId || item.fromAccountId === accountId || item.toAccountId === accountId) &&
    (status === "Todas" || (status === "Ativas" ? !item.reversal : !!item.reversal)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return <section className="finance-management" aria-label="Transferências internas">
    <h2>Transferências internas entre contas</h2>
    <p>Registre apenas transferências já efetuadas no banco. A saída e a entrada são gravadas juntas, sem receita/despesa, contas a pagar/receber ou nota fiscal.
      Este registro não envia dinheiro, não consulta limite bancário e não comprova conciliação.</p>
    <p>Taxas devem ser registradas separadamente como despesa. Saldos gerenciais negativos são permitidos; confira o extrato antes de confirmar.</p>
    <div className="section-heading">
      <label className="field">Conta envolvida<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
        <option value="">Todas as contas</option>{data.finance.accounts.map((item) =>
          <option key={item.id} value={item.id}>{item.name}{!item.active && " (inativa)"}</option>)}
      </select></label>
      <label className="field">Situação<select value={status} onChange={(event) => setStatus(event.target.value)}>
        {["Todas", "Ativas", "Estornadas"].map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <button className="button primary" onClick={() => setEditor({ kind: "new" })}>Registrar transferência</button>
    </div>
    <div className="finance-table"><table><thead><tr><th>Data</th><th>Origem (saída)</th><th>Destino (entrada)</th><th>Descrição</th><th>Valor</th><th>Situação / histórico</th><th>Ação</th></tr></thead>
      <tbody>{transfers.map((item) => <tr key={item.id}><td>{displayDate(item.date)}</td>
        <td>{name(item.fromAccountId)}<br /><small>{reconciled(item.id, "outgoing") ? "Saída conciliada" : "Saída não conciliada"}</small></td>
        <td>{name(item.toAccountId)}<br /><small>{reconciled(item.id, "incoming") ? "Entrada conciliada" : "Entrada não conciliada"}</small></td>
        <td>{item.description}</td><td>{currency(item.amount)}</td><td>{item.reversal ? "Estornada internamente" : "Registro interno ativo"}
          <details><summary>Histórico</summary><p>Registrada: {item.createdAt}<br />ID: {item.id}</p>
            {item.reversal && <p>Estorno: {item.reversal.at}<br />Motivo: {item.reversal.reason}</p>}</details>
        </td><td>{!item.reversal && <button className="text-button" onClick={() => setEditor({ kind: "reverse", transfer: item })}>Estornar duas pontas</button>}</td>
      </tr>)}</tbody></table>{!transfers.length && <Empty title="Nenhuma transferência encontrada" />}</div>
    <p>Estorno remove as duas pontas dos cálculos, inclusive nos períodos anteriores, sem apagar o registro.
      Não desfaz transferência bancária. Não registre as mesmas pontas como receitas/despesas, para não duplicar saldos.
      Concilie cada ponta na aba Conciliação bancária. Uma ponta conciliada não comprova a outra; estornar a transferência invalida os dois vínculos,
      sem apagar os extratos ou o histórico.</p>
    {editor && <TransferEditor key={editor.kind === "new" ? "new" : editor.transfer.id} data={data}
      transfer={editor.kind === "reverse" ? editor.transfer : undefined} onClose={() => setEditor(null)}
      onSave={(update) => {
        commit(update); setEditor(null); onSuccess("Transferência atualizada internamente. Aguarde Sincronizado quando conectado.");
      }} />}
  </section>;
}

function TransferEditor({ data, transfer, onSave, onClose }: {
  data: Database; transfer?: FinanceTransfer; onSave: Commit; onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [id] = useState(makeId);
  const accounts = data.finance.accounts.filter((item) => item.active);
  return <Modal title={transfer ? "Estornar transferência interna" : "Registrar transferência interna"} onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const text = (key: string) => String(form.get(key) ?? "").trim();
      const confirmed = form.get("confirmed") === "on";
      try {
        if (transfer) onSave((current) => reverseFinanceTransfer(current, transfer, text("reason"), confirmed));
        else {
          const input: FinanceTransfer = { id, fromAccountId: text("fromAccountId"), toAccountId: text("toAccountId"), date: text("date"),
            amount: Math.round(Number(text("amount")) * 100), description: text("description"), createdAt: new Date().toISOString() };
          onSave((current) => recordFinanceTransfer(current, input, confirmed));
        }
      } catch (cause) { setError(errorMessage(cause)); }
    }}>
      <div className="modal-body"><div className="form-grid">
        {error && <p className="error-message full" role="alert">{error}</p>}
        {transfer ? <>
          <p className="full">{displayDate(transfer.date)} · {transfer.description} · {currency(transfer.amount)}.
            Origem: {data.finance.accounts.find((item) => item.id === transfer.fromAccountId)?.name} → destino:{" "}
            {data.finance.accounts.find((item) => item.id === transfer.toAccountId)?.name}.</p>
          <p className="full">Este estorno também invalidará os vínculos ativos com extratos das duas contas.
            Os movimentos voltarão a ficar pendentes para nova conferência.</p>
          <label className="field full">Motivo do estorno<textarea name="reason" required minLength={5} maxLength={1000} /></label>
        </> : <>
          <label className="field">Conta de origem (saída)<select name="fromAccountId" required defaultValue=""><option value="">Selecione</option>
            {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field">Conta de destino (entrada)<select name="toAccountId" required defaultValue=""><option value="">Selecione</option>
            {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field">Data efetiva<input type="date" name="date" required max={localDay()} defaultValue={localDay()} /></label>
          <label className="field">Valor transferido (R$)<input type="number" name="amount" required min="0.01" max="1000000" step="0.01" /></label>
          <label className="field full">Descrição<input name="description" required maxLength={1000} /></label>
          {accounts.length < 2 && <p role="alert" className="full">Cadastre pelo menos duas contas ativas na aba Bancos.</p>}
        </>}
        <label className="checkbox-field full"><input type="checkbox" name="confirmed" required />
          {transfer ? "Confirmo o estorno interno das duas pontas e entendo que não cancela a operação no banco." :
            "Conferi a transferência já efetuada e confirmo o registro interno único das duas pontas, sem enviar dinheiro."}</label>
      </div></div>
      <footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={!transfer && accounts.length < 2}>{transfer ? "Confirmar estorno interno" : "Salvar transferência"}</button></footer>
    </form>
  </Modal>;
}
