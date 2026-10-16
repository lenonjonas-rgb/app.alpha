import { useRef, useState } from "react";
import { Empty, Modal } from "./components";
import { currency, displayDate } from "./domain";
import type { Database } from "./domain";
import type { BankTransaction } from "./bankingSchema";
import { activeBankMatch, banking, importStatement, matchBankSettlement, previewStatementImport, settleAndMatch,
  settlementCandidates, unmatchBankSettlement, activeTransferMatch, matchBankTransfer, transferCandidates,
  transactionReconciled, unmatchBankTransfer } from "./bankReconciliation";
import { parseBankStatement, statementTemplate } from "./bankStatement";
import type { ParsedStatement } from "./bankStatement";
import { entryBalance } from "./finance";
import { settlementCashAmount } from "./financeSchema";
import { downloadFile, errorMessage } from "./useDatabase";

type Commit = (update: (current: Database) => Database) => void;
export function BankReconciliationPanel({ data, commit, onSuccess }: {
  data: Database; commit: Commit; onSuccess: (message: string) => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [preview, setPreview] = useState<{ statement: ParsedStatement; fileName: string; accountId: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [transactionId, setTransactionId] = useState("");
  const sequence = useRef(0);
  const current = banking(data);
  const activeMatch = (id: string) => current.matches.find((item) => item.transactionId === id && activeBankMatch(data, item));
  const transactions = current.transactions.filter((item) => (!accountId || item.accountId === accountId) && (!pendingOnly || !transactionReconciled(data, item.id)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const transaction = current.transactions.find((item) => item.id === transactionId);
  let summary: ReturnType<typeof previewStatementImport> | undefined;
  let previewError = "";
  if (preview) {
    try { summary = previewStatementImport(data, preview.accountId, preview.statement); }
    catch (cause) { previewError = errorMessage(cause); }
  }
  function act(update: (current: Database) => Database, message: string) {
    try {
      commit(update); setError(""); onSuccess(`${message} Aguarde Sincronizado quando conectado.`);
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
  }
  return <section className="finance-management" aria-label="Conciliação bancária">
    <h2>Conciliação bancária por arquivo</h2>
    <p>Importação local de CSV padronizado ou OFX de conta bancária em BRL. Não conecta ao banco, não registra boleto/Pix e não movimenta dinheiro.
      Cada movimento é conciliado individualmente com uma baixa ou ponta de transferência de mesmo banco, tipo, data e valor.</p>
    <p>Aplique as migrações de proteção do histórico de conciliação e de vínculos de transferência antes de publicar.
      Não use extratos de produção sem conferir conta, moeda e datas.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="finance-filters">
      <label className="field">Banco do extrato<select value={accountId} disabled={busy} onChange={(event) => {
        sequence.current++; setAccountId(event.target.value); setPreview(null); setConfirmed(false); setError("");
      }}>
        <option value="">Selecione para importar / todos para consultar</option>
        {data.finance.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}{!item.active && " (inativo)"}</option>)}
      </select></label>
      <label className="field">Arquivo CSV ou OFX<input type="file" accept=".csv,.ofx" disabled={!accountId || busy}
        onChange={async (event) => {
          const file = event.target.files?.[0], selectedAccount = accountId, request = ++sequence.current;
          event.target.value = ""; setPreview(null); setConfirmed(false); setError("");
          if (!file) return;
          setBusy(true);
          try {
            if (file.size > 2_000_000) throw new Error("Arquivo excede 2 MB.");
            const statement = parseBankStatement(await file.text(), file.name);
            previewStatementImport(data, selectedAccount, statement);
            if (request === sequence.current) setPreview({ statement, fileName: file.name, accountId: selectedAccount });
          } catch (cause) { if (request === sequence.current) setError(errorMessage(cause)); }
          finally { if (request === sequence.current) setBusy(false); }
        }} /></label>
      <button className="button secondary" onClick={() => {
        try { downloadFile("modelo-extrato.csv", statementTemplate, "text/csv;charset=utf-8"); setError(""); }
        catch (cause) { setError(errorMessage(cause)); }
      }}>Baixar modelo CSV</button>
    </div>
    <p>CSV UTF-8: id;data;descricao;valor, data AAAA-MM-DD, valor 100,00 para crédito e -50,00 para débito.
      Use IDs únicos e estáveis do banco. OFX exige FITID, conta única e moeda BRL; cartão/investimentos não são suportados.</p>
    {busy && <p role="status">Lendo e validando extrato…</p>}
    {preview && <div className="finance-billing-group">
      <h3>Revisar antes de importar</h3>
      <p>{preview.fileName} · {preview.statement.format} · Banco selecionado: {data.finance.accounts.find((item) => item.id === preview.accountId)?.name}</p>
      {preview.statement.format === "OFX" && <p>Identificação no arquivo: banco {preview.statement.bank} · conta {preview.statement.account}</p>}
      {previewError && <p className="error-message" role="alert">{previewError}</p>}
      {summary && <p>{summary.fresh.length} novos · {summary.duplicates} já importados (ignorados sem duplicar).</p>}
      <div className="finance-table"><table><thead><tr><th>ID bancário</th><th>Data</th><th>Descrição</th><th>Valor</th></tr></thead>
        <tbody>{preview.statement.lines.slice(0, 50).map((item) => <tr key={item.externalId}><td>{item.externalId}</td><td>{displayDate(item.date)}</td>
          <td>{item.description}</td><td>{currency(item.amount)}</td></tr>)}</tbody></table></div>
      <p>A prévia mostra até 50 linhas; a importação considera todos os {preview.statement.lines.length} movimentos, sem gerar baixas.</p>
      <label className="checkbox-field"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        Conferi que este extrato em reais pertence à conta selecionada e que os IDs identificam os movimentos corretamente.</label>
      <button className="button primary" disabled={!confirmed || !summary?.fresh.length || !!previewError} onClick={() => {
        if (act((latest) => importStatement(latest, preview.accountId, preview.statement, preview.fileName, confirmed), "Extrato importado sem gerar baixas.")) {
          setPreview(null); setConfirmed(false);
        }
      }}>Confirmar importação</button>
    </div>}
    <label className="checkbox-field"><input type="checkbox" checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} />Somente movimentos pendentes</label>
    <div className="finance-table"><table><thead><tr><th>Banco / Data</th><th>Descrição / ID</th><th>Valor</th><th>Situação</th><th>Ações / histórico</th></tr></thead>
      <tbody>{transactions.map((item) => {
        const match = activeMatch(item.id);
        const transferMatch = (current.transferMatches ?? []).find((link) => link.transactionId === item.id && activeTransferMatch(data, link));
        const transferHistory = (current.transferMatches ?? []).filter((link) => link.transactionId === item.id);
        const history = current.matches.filter((link) => link.transactionId === item.id);
        return <tr key={item.id}><td>{data.finance.accounts.find((bank) => bank.id === item.accountId)?.name}<br />{displayDate(item.date)}</td>
          <td>{item.description}<br /><small>{item.externalId} · {item.fileName}</small></td><td>{currency(item.amount)}</td>
          <td>{transferMatch ? `Conciliado · transferência (${transferMatch.leg === "outgoing" ? "saída" : "entrada"})` :
            match ? "Conciliado" : history.length || transferHistory.length ? "Pendente · vínculo desfeito ou operação estornada" : "Pendente"}</td>
          <td>{transferMatch ? <button className="text-button" onClick={() => {
            if (window.confirm("Desfazer somente o vínculo desta ponta com o extrato? A transferência e a conciliação da outra ponta serão preservadas."))
              act((latest) => unmatchBankTransfer(latest, transferMatch.id), "Vínculo desfeito; transferência preservada.");
          }}>Desfazer vínculo</button> : match ? <button className="text-button" onClick={() => {
            if (window.confirm("Desfazer somente o vínculo com o extrato? A baixa continuará registrada e não será estornada."))
              act((latest) => unmatchBankSettlement(latest, match.id), "Vínculo desfeito; baixa preservada.");
          }}>Desfazer vínculo</button> : <button className="button secondary" onClick={() => setTransactionId(item.id)}>Conciliar</button>}
            {!!history.length && <details><summary>Histórico ({history.length})</summary>{history.map((link) => {
              const entry = data.finance.entries.find((entry) => entry.id === link.entryId);
              return <p key={link.id}>{entry?.party} · {entry?.description}<br />{link.createdAt} ·{" "}
                {activeBankMatch(data, link) ? "Ativo" : link.reversed ? "Vínculo desfeito" : "Baixa estornada/cancelada"}</p>;
            })}</details>}
            {!!transferHistory.length && <details><summary>Histórico de transferência ({transferHistory.length})</summary>{transferHistory.map((link) => {
              const transfer = data.finance.transfers?.find((transfer) => transfer.id === link.transferId);
              return <p key={link.id}>{transfer?.description} · {link.leg === "outgoing" ? "Saída" : "Entrada"}<br />
                {link.createdAt} · {activeTransferMatch(data, link) ? "Ativo" : link.reversed ? "Vínculo desfeito" : "Transferência estornada"}</p>;
            })}</details>}
          </td></tr>;
      })}</tbody></table>{!transactions.length && <Empty title="Nenhum movimento para os filtros selecionados" />}</div>
    <p>Desfazer vínculo não estorna baixa. Estornar a baixa em Contas a pagar/receber torna o movimento pendente novamente e mantém o histórico.
      Transferências exigem vínculo separado em cada conta; uma ponta pode ficar pendente até importar o outro extrato.
      Estornar a transferência invalida ambos os vínculos, sem apagar o histórico.
      Divisão/agrupamento de movimentos, datas diferentes entre pontas e tarifas automáticas ainda não são suportados.</p>
    {transaction && <ReconciliationEditor key={transaction.id} data={data} transaction={transaction} onClose={() => setTransactionId("")}
      onSave={(update) => { commit(update); setTransactionId(""); setError(""); onSuccess("Conciliação salva. Aguarde Sincronizado quando conectado."); }} />}
  </section>;
}

function ReconciliationEditor({ data, transaction, onSave, onClose }: {
  data: Database; transaction: BankTransaction; onSave: Commit; onClose: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "settle" | "transfer">("existing");
  const [error, setError] = useState("");
  const candidates = settlementCandidates(data, transaction);
  const transfers = transferCandidates(data, transaction);
  const open = data.finance.entries.filter((item) => !item.canceled && item.kind === (transaction.amount > 0 ? "Receber" : "Pagar") &&
    entryBalance(item) >= Math.abs(transaction.amount));
  return <Modal title="Conciliar movimento bancário" onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        if (form.get("confirm") !== "on") throw new Error("Confirme a conferência do movimento.");
        if (mode === "transfer") {
          const transferId = String(form.get("transferId") ?? "");
          onSave((latest) => matchBankTransfer(latest, transaction.id, transferId, true));
        } else if (mode === "existing") {
          const index = String(form.get("candidate") ?? "");
          const candidate = /^\d+$/.test(index) ? candidates[Number(index)] : undefined;
          if (!candidate) throw new Error("Selecione uma baixa compatível.");
          onSave((latest) => matchBankSettlement(latest, transaction.id, candidate.entry.id, candidate.settlement.id));
        } else {
          const entryId = String(form.get("entryId") ?? "");
          onSave((latest) => settleAndMatch(latest, transaction.id, entryId, true));
        }
      } catch (cause) { setError(errorMessage(cause)); }
    }}>
      <div className="modal-body"><div className="form-grid">
        <p className="full">{displayDate(transaction.date)} · {transaction.description} · {currency(transaction.amount)}</p>
        {error && <p className="error-message full" role="alert">{error}</p>}
        <label className="field full">Operação<select value={mode} onChange={(event) => {
          setMode(event.target.value === "transfer" ? "transfer" : event.target.value === "settle" ? "settle" : "existing"); setError("");
        }}><option value="existing">Vincular baixa já registrada (não duplica pagamento)</option>
          <option value="settle">Registrar nova baixa e conciliar</option>
          <option value="transfer">Vincular transferência interna (sem nova baixa)</option></select></label>
        {mode === "transfer" ? <>
          <label className="field full">Transferência compatível<select name="transferId" required defaultValue=""><option value="">Selecione explicitamente</option>
            {transfers.map((item) => <option key={item.id} value={item.id}>{item.description} ·{" "}
              {data.finance.accounts.find((account) => account.id === item.fromAccountId)?.name} →{" "}
              {data.finance.accounts.find((account) => account.id === item.toAccountId)?.name} · {currency(item.amount)} · {item.id}</option>)}
          </select></label>
          <p className="full">Vincula somente a {transaction.amount < 0 ? "saída da origem" : "entrada no destino"}. Não registra outra transferência nem cria baixa, receita ou despesa.
            Confira a outra ponta no extrato da respectiva conta.</p>
          {!transfers.length && <p className="full">Nenhuma transferência ativa livre com mesma conta, data e valor exatos.
            Registre a operação em Transferências ou confira as divergências; não crie uma baixa fictícia.</p>}
        </> : mode === "existing" ? <>
          <label className="field full">Baixa compatível<select name="candidate" required defaultValue="">
            <option value="">Selecione explicitamente</option>{candidates.map((item, index) =>
              <option key={JSON.stringify([item.entry.id, item.settlement.id])} value={index}>{item.entry.party} · {item.entry.description} · {currency(settlementCashAmount(item.settlement))}
                {item.settlement.adjustment ? ` (principal ${currency(item.settlement.amount)} com ajustes)` : ""}</option>)}
          </select></label>
          {!candidates.length && <p className="full">Não há baixa livre com mesmo banco, tipo, data e valor. Revise os lançamentos; não registre outra baixa se o pagamento já existe.</p>}
        </> : <>
          <label className="field full">Título a baixar<select name="entryId" required defaultValue=""><option value="">Selecione explicitamente</option>
            {open.map((item) => <option key={item.id} value={item.id}>{item.party} · {item.description} · saldo {currency(entryBalance(item))}</option>)}
          </select></label>
          <p className="full">Cria uma baixa de {currency(Math.abs(transaction.amount))} na data e no banco do extrato. Pode ser parcial.
            Não cria título, não ajusta juros/descontos e não envia pagamento ao banco.
            Se houver juros, multa ou desconto, registre primeiro a baixa em Contas a pagar/receber e depois use Vincular baixa existente.
            A conciliação compara o valor efetivo de caixa, não o principal liquidado.</p>
        </>}
        <label className="checkbox-field full"><input type="checkbox" name="confirm" required />Conferi o movimento e o título/baixa; autorizo esta operação interna.</label>
      </div></div>
      <footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
        <button className="button primary">{mode === "transfer" ? "Vincular transferência" : mode === "existing" ? "Vincular baixa existente" : "Dar baixa e conciliar"}</button></footer>
    </form>
  </Modal>;
}
