import { useState } from "react";
import { Empty, Modal } from "./components";
import { currency, displayDate, localDay, makeId } from "./domain";
import type { Database } from "./domain";
import { purchaseOrderSchema, supplierSchema } from "./financeSchema";
import type { PurchaseOrder, Supplier } from "./financeSchema";
import { cancelPurchaseOrder, previewPurchaseSchedule, purchaseTotal, purchasing, receivePurchaseOrder, savePurchaseOrder, saveSupplier } from "./purchasing";
import { FinanceClassificationFields } from "./FinanceManagementPanel";
import { entryBalance } from "./finance";
import { errorMessage } from "./useDatabase";

type Commit = (update: (current: Database) => Database) => void;
type Editor = { mode: "supplier"; item?: Supplier } | { mode: "order" } |
  { mode: "receive" | "cancel"; item: PurchaseOrder };
export function PurchasingPanel({ data, commit, onSuccess }: {
  data: Database; commit: Commit; onSuccess: (message: string) => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null), [query, setQuery] = useState(""), [status, setStatus] = useState("Todos");
  const current = purchasing(data);
  const state = (order: PurchaseOrder) => order.cancellation ? "Cancelado" : order.receipt ? "Recebido" : "Aberto";
  const matches = (text: string) => text.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
  const orders = current.orders.filter((order) => (status === "Todos" || status === state(order)) &&
    matches(`${order.id} ${order.supplierName} ${order.supplierDocument} ${order.description} ${order.receipt?.reference ?? ""}`));
  return <section className="finance-management" aria-label="Compras e fornecedores">
    <h2>Compras e fornecedores</h2>
    <p>Pedidos confirmados não criam contas nem alteram a previsão. Após conferir o recebimento integral, confirme para gerar
      as contas a pagar uma única vez, sem movimentar caixa, estoque ou emitir documentos fiscais.</p>
    <p>Itens e condições do pedido são preservados. Para corrigir um pedido aberto, cancele e cadastre outro.
      Recebimentos parciais, devoluções, aprovações por alçada e estoque não estão incluídos nesta etapa.</p>
    <div className="section-heading">
      <label className="field">Buscar compras e fornecedores<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="field">Situação do pedido<select value={status} onChange={(event) => setStatus(event.target.value)}>
        {["Todos", "Aberto", "Recebido", "Cancelado"].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <button className="button secondary" onClick={() => setEditor({ mode: "supplier" })}>Novo fornecedor</button>
      <button className="button primary" onClick={() => setEditor({ mode: "order" })}>Novo pedido de compra</button>
    </div>
    <h3>Pedidos de compra</h3>
    <div className="finance-table"><table><thead><tr><th>Pedido / fornecedor</th><th>Data / descrição</th>
      <th>Total / pagamento</th><th>Situação / histórico</th><th>Ações</th></tr></thead><tbody>
      {orders.map((order) => <tr key={order.id}><td>{order.id}<br />{order.supplierName}<br />{order.supplierDocument}</td>
        <td>{displayDate(order.orderedOn)}<br />{order.description}</td><td>{currency(purchaseTotal(order))}<br />
          {order.schedule.length} pagamento(s) · {order.paymentMethod}<br />
          {data.finance.accounts.find((item) => item.id === order.accountId)?.name}</td>
        <td>{state(order)}<details><summary>Itens, parcelas e histórico</summary>
          <p>Cadastro: {order.createdAt}</p>
          {order.items.map((item, index) => <p key={index}>{item.description} · {item.quantity} × {currency(item.unitCost)} = {currency(item.quantity * item.unitCost)}</p>)}
          {order.schedule.map((row, index) => <p key={index}>Pagamento {index + 1}: {displayDate(row.dueOn)} · {currency(row.amount)}</p>)}
          {order.cancellation && <p>Cancelado em {order.cancellation.at}: {order.cancellation.reason}</p>}
          {order.receipt && <><p>Recebido em {displayDate(order.receipt.date)} · Registro: {order.receipt.at}<br />
            Referência informativa: {order.receipt.reference || "Não informada"}<br />Conferência: {order.receipt.notes}</p>
            {order.receipt.entryIds.map((id) => {
              const entry = data.finance.entries.find((item) => item.id === id)!;
              return <p key={id}>Conta {id}: {entry.canceled ? "Cancelada; não será gerada novamente" : `Saldo ${currency(entryBalance(entry))}`}</p>;
            })}</>}
        </details></td><td>{!order.receipt && !order.cancellation && <div className="finance-actions">
          <button className="button secondary" onClick={() => setEditor({ mode: "receive", item: order })}>Conferir recebimento</button>
          <button className="text-button" onClick={() => setEditor({ mode: "cancel", item: order })}>Cancelar pedido</button>
        </div>}</td></tr>)}
    </tbody></table>{!orders.length && <Empty title="Nenhum pedido encontrado" />}</div>
    <h3>Fornecedores</h3>
    <p>Alterar o cadastro não reescreve o nome/documento preservado nos pedidos. Inativar bloqueia novos pedidos e recebimentos; não altera contas existentes.</p>
    <div className="finance-table"><table><thead><tr><th>Nome / CPF ou CNPJ</th><th>Contatos / endereço</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
      {current.suppliers.filter((item) => matches(`${item.name} ${item.document} ${item.phone} ${item.email}`)).map((item) =>
        <tr key={item.id}><td>{item.name}<br />{item.document || "Sem documento"}</td><td>{item.phone}<br />{item.email}<br />{item.address}</td>
          <td>{item.active ? "Ativo" : "Inativo"}</td><td><button className="text-button" onClick={() => setEditor({ mode: "supplier", item })}>Editar fornecedor</button></td></tr>)}
    </tbody></table></div>
    <p>Referência do recebimento é apenas informativa: não importa XML, valida nota nem impede cadastrar pedidos diferentes para a mesma compra.
      Confira documentos e evite duplicidade entre pedidos. Aplique as migrações antes de publicar e aguarde Sincronizado quando conectado.</p>
    {editor && <PurchaseEditor data={data} editor={editor} onClose={() => setEditor(null)} onSave={(update) => {
      commit(update); setEditor(null); onSuccess("Compra/fornecedor atualizado internamente. Aguarde Sincronizado quando conectado.");
    }} />}
  </section>;
}

function PurchaseEditor({ data, editor, onClose, onSave }: { data: Database; editor: Editor; onClose: () => void; onSave: Commit }) {
  const [id] = useState(makeId), [error, setError] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [items, setItems] = useState([{ description: "", quantity: "1", unitCost: "" }]);
  const [count, setCount] = useState("1"), [firstDueOn, setFirstDueOn] = useState(localDay());
  const [schedule, setSchedule] = useState<PurchaseOrder["schedule"] | null>(null);
  const orderItems = () => items.map((item) => ({ description: item.description, quantity: Number(item.quantity), unitCost: Math.round(Number(item.unitCost) * 100) }));
  const total = purchaseTotal({ items: orderItems() });
  const title = editor.mode === "supplier" ? (editor.item ? "Editar fornecedor" : "Cadastrar fornecedor") :
    editor.mode === "order" ? "Cadastrar pedido de compra" : editor.mode === "receive" ? "Conferir recebimento integral" : "Cancelar pedido de compra";
  return <Modal title={title} onClose={onClose}><form onChange={(event) => {
    if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) &&
      event.target.name !== "confirmed") setConfirmed(false);
  }} onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget), text = (name: string) => String(form.get(name) ?? "").trim();
    try {
      if (editor.mode === "supplier") {
        const item = supplierSchema.parse({ id: editor.item?.id ?? id, name: text("name"), document: text("document").replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
          phone: text("phone"), email: text("email"), address: text("address"), active: text("active") === "true" });
        onSave((current) => saveSupplier(current, item, editor.item));
      } else if (editor.mode === "order") {
        if (!schedule) throw new Error("Gere e confira a prévia dos pagamentos.");
        const supplier = purchasing(data).suppliers.find((item) => item.id === text("supplierId"));
        if (!supplier) throw new Error("Selecione um fornecedor.");
        const order = purchaseOrderSchema.parse({ id, supplierId: supplier.id, supplierName: supplier.name, supplierDocument: supplier.document,
          description: text("description"), orderedOn: text("orderedOn"), createdAt: new Date().toISOString(),
          accountId: text("accountId"), paymentMethod: text("paymentMethod"), items: orderItems(), schedule,
          ...(text("categoryId") ? { categoryId: text("categoryId") } : {}), ...(text("costCenterId") ? { costCenterId: text("costCenterId") } : {}) });
        onSave((current) => savePurchaseOrder(current, order, confirmed));
      } else if (editor.mode === "receive") onSave((current) =>
        receivePurchaseOrder(current, editor.item, { date: text("date"), reference: text("reference"), notes: text("notes") }, confirmed));
      else onSave((current) => cancelPurchaseOrder(current, editor.item, text("reason"), confirmed));
    } catch (cause) { setError(errorMessage(cause)); }
  }}>
    <div className="modal-body"><div className="form-grid">
      {error && <p className="error-message full" role="alert">{error}</p>}
      {editor.mode === "supplier" ? <>
        <label className="field full">Nome / razão social<input name="name" required maxLength={1000} defaultValue={editor.item?.name} /></label>
        <label className="field">CPF ou CNPJ (opcional)<input name="document" maxLength={18} defaultValue={editor.item?.document} /></label>
        <label className="field">Telefone<input name="phone" maxLength={100} defaultValue={editor.item?.phone} /></label>
        <label className="field">Email<input name="email" type="email" maxLength={254} defaultValue={editor.item?.email} /></label>
        <label className="field">Situação do fornecedor<select name="active" defaultValue={String(editor.item?.active ?? true)}>
          <option value="true">Ativo</option><option value="false">Inativo</option></select></label>
        <label className="field full">Endereço<textarea name="address" maxLength={1000} defaultValue={editor.item?.address} /></label>
      </> : editor.mode === "order" ? <>
        <label className="field">Fornecedor<select name="supplierId" required defaultValue=""><option value="">Selecione</option>
          {purchasing(data).suppliers.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field">Data do pedido<input name="orderedOn" type="date" required max={localDay()} defaultValue={localDay()} /></label>
        <label className="field full">Descrição do pedido<input name="description" required maxLength={1000} /></label>
        <div className="full"><h3>Itens comprados</h3>{items.map((item, index) => <div className="form-grid" key={index}>
          <label className="field">Descrição do item {index + 1}<input required maxLength={1000} value={item.description} onChange={(event) => {
            setItems(items.map((row, i) => i === index ? { ...row, description: event.target.value } : row)); setSchedule(null);
          }} /></label>
          <label className="field">Quantidade do item {index + 1}<input type="number" min="1" max="10000" step="1" required value={item.quantity} onChange={(event) => {
            setItems(items.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row)); setSchedule(null);
          }} /></label>
          <label className="field">Custo unitário do item {index + 1}<input type="number" min="0.01" max="1000000" step="0.01" required value={item.unitCost} onChange={(event) => {
            setItems(items.map((row, i) => i === index ? { ...row, unitCost: event.target.value } : row)); setSchedule(null);
          }} /></label>
          <button className="text-button" type="button" disabled={items.length === 1} onClick={() => {
            setItems(items.filter((_, i) => i !== index)); setSchedule(null); setConfirmed(false);
          }}>Remover item {index + 1}</button>
        </div>)}
          <button type="button" className="button secondary" disabled={items.length >= 100} onClick={() => {
            setItems([...items, { description: "", quantity: "1", unitCost: "" }]); setSchedule(null); setConfirmed(false);
          }}>Adicionar item</button>
          <p>Total do pedido: {currency(total)}. Quantidades inteiras; sem frete, impostos ou descontos automáticos.</p>
        </div>
        <label className="field">Banco<select name="accountId" required defaultValue=""><option value="">Selecione</option>
          {data.finance.accounts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field">Forma de pagamento<select name="paymentMethod">
          {["Pix", "Boleto", "Transferência", "Dinheiro", "Cartão", "Outro"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <FinanceClassificationFields data={data} kind="Pagar" />
        <label className="field">Quantidade de pagamentos<input type="number" min="1" max="120" step="1" required value={count} onChange={(event) => {
          setCount(event.target.value); setSchedule(null);
        }} /></label>
        <label className="field">Primeiro vencimento<input type="date" required value={firstDueOn} onChange={(event) => {
          setFirstDueOn(event.target.value); setSchedule(null);
        }} /></label>
        <div className="full"><button type="button" className="button secondary" onClick={() => {
          try { setSchedule(previewPurchaseSchedule(total, Number(count), firstDueOn)); setError(""); setConfirmed(false); }
          catch (cause) { setError(errorMessage(cause)); setSchedule(null); }
        }}>Gerar prévia dos pagamentos</button>
          <p>Valor total dividido em centavos exatos, saldo nas primeiras parcelas; datas mensais editáveis, em ordem crescente e a partir da data do pedido.</p>
          {schedule?.map((row, index) => <label className="field" key={index}>Vencimento do pagamento {index + 1} · {currency(row.amount)}
            <input type="date" name={`due.${index}`} value={row.dueOn} required onChange={(event) =>
              setSchedule(schedule.map((item, i) => i === index ? { ...item, dueOn: event.target.value } : item))} /></label>)}
        </div>
      </> : <>
        <p className="full">{editor.item.supplierName} · {editor.item.description} · {currency(purchaseTotal(editor.item))}</p>
        {editor.mode === "receive" ? <>
          <p className="full">Confirme somente após conferir todos os itens e quantidades. Serão criadas {editor.item.schedule.length} conta(s) a pagar;
            sem baixa, estoque ou documento fiscal. A data de emissão financeira será a data do pedido, preservando os vencimentos acordados.
            Não é possível desfazer o recebimento nesta etapa; eventuais cancelamentos das contas não liberam nova geração.</p>
          {editor.item.schedule.map((row, index) => <p className="full" key={index}>Pagamento {index + 1}: {displayDate(row.dueOn)} · {currency(row.amount)}</p>)}
          <label className="field">Data do recebimento<input type="date" name="date" required min={editor.item.orderedOn} max={localDay()} defaultValue={localDay()} /></label>
          <label className="field">Referência do documento (informativa)<input name="reference" maxLength={200} /></label>
          <label className="field full">Conferência do recebimento<textarea name="notes" required minLength={5} maxLength={1000} /></label>
        </> : <label className="field full">Motivo do cancelamento<textarea name="reason" required minLength={5} maxLength={1000} /></label>}
      </>}
      {editor.mode !== "supplier" && <label className="field full"><span><input name="confirmed" type="checkbox" checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)} /> {editor.mode === "order" ? "Conferi itens, total e vencimentos; este cadastro ainda não gera contas." :
          editor.mode === "receive" ? "Conferi o recebimento integral e autorizo gerar as contas a pagar uma única vez." : "Confirmo o cancelamento definitivo do pedido aberto."}</span></label>}
    </div></div>
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Voltar</button>
      <button className="button primary" type="submit" disabled={editor.mode !== "supplier" && (!confirmed || (editor.mode === "order" && !schedule))}>
        {editor.mode === "supplier" ? "Salvar fornecedor" : editor.mode === "order" ? "Salvar pedido" : editor.mode === "receive" ? "Confirmar recebimento e gerar contas" : "Confirmar cancelamento"}
      </button></div>
  </form></Modal>;
}
