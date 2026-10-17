import { useState } from "react";
import { Empty, Modal } from "./components";
import { availablePurchaseReturnItems, createStockLocation, currency, displayDate, localDay, makeId, setDefaultStockLocation, stockAvailable, stockLocationBalance, stockReserved, transferStock } from "./domain";
import type { Database } from "./domain";
import { purchaseOrderSchema, supplierSchema } from "./financeSchema";
import type { PurchaseOrder, Supplier } from "./financeSchema";
import { cancelPurchaseOrder, previewPurchaseSchedule, purchaseTotal, purchasing, receivePurchaseOrder, returnPurchaseStock, savePurchaseOrder, saveSupplier } from "./purchasing";
import { FinanceClassificationFields } from "./FinanceManagementPanel";
import { entryBalance } from "./finance";
import { errorMessage } from "./useDatabase";
import type { CompanyRole } from "./userAccess";

type Commit = (update: (current: Database) => Database) => void;
type Editor = { mode: "supplier"; item?: Supplier } | { mode: "order" } | { mode: "location" } |
  { mode: "default"; locationId: string } | { mode: "transfer" } |
  { mode: "receive" | "cancel" | "return"; item: PurchaseOrder };
function purchaseReceiptsFor(data: Database, order: PurchaseOrder) {
  return data.inventory!.purchaseReceipts.filter((receipt) => receipt.orderId === order.id);
}
function receivedPurchaseQuantity(data: Database, order: PurchaseOrder, lineId: string) {
  const received = purchaseReceiptsFor(data, order).flatMap((receipt) => receipt.items)
    .filter((item) => item.lineId === lineId).reduce((sum, item) => sum + item.quantity, 0);
  return received || (order.receipt ? order.items.find((item) => item.id === lineId)?.quantity ?? 0 : 0);
}
export function PurchasingPanel({ data, commit, onSuccess, approvalActor }: {
  data: Database; commit: Commit; onSuccess: (message: string) => void;
  approvalActor?: { userId: string | null; name: string; role: CompanyRole | null };
}) {
  const [editor, setEditor] = useState<Editor | null>(null), [query, setQuery] = useState(""), [status, setStatus] = useState("Todos");
  const current = purchasing(data);
  const state = (order: PurchaseOrder) => order.cancellation ? "Cancelado" : order.receipt ? "Recebido" :
    order.items.some((item) => receivedPurchaseQuantity(data, order, item.id!) > 0) ? "Parcial" : "Aberto";
  const matches = (text: string) => text.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
  const orders = current.orders.filter((order) => (status === "Todos" || status === state(order)) &&
    matches(`${order.id} ${order.supplierName} ${order.supplierDocument} ${order.description} ${order.receipt?.reference ?? ""} ${purchaseReceiptsFor(data, order).map((receipt) => receipt.reference).join(" ")}`));
  return <section className="finance-management" aria-label="Compras e fornecedores">
    <h2>Compras e fornecedores</h2>
    <p>Pedidos confirmados não criam contas nem alteram a previsão. Cada entrega recebida atualiza o estoque pelo custo unitário aprovado.
      As contas a pagar e o cronograma integral são gerados uma única vez somente quando todas as quantidades forem recebidas.</p>
    <p>Itens e condições do pedido são preservados. Um pedido com entrega parcial pode ser cancelado quanto ao saldo não recebido;
      o valor efetivamente recebido gera contas a pagar rateadas pelas parcelas aprovadas.
      A devolução também abate contas a pagar em aberto da compra; o excedente vira crédito a receber do fornecedor.
      Baixas já realizadas e o pedido de compra não são alterados.</p>
    <div className="section-heading">
      <label className="field">Buscar compras e fornecedores<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="field">Situação do pedido<select value={status} onChange={(event) => setStatus(event.target.value)}>
        {["Todos", "Aberto", "Parcial", "Recebido", "Cancelado"].map((value) => <option key={value}>{value}</option>)}
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
          {order.items.map((item, index) => {
            const productId = item.productId ?? order.receipt?.stockItems?.find((stockItem) => stockItem.lineId === item.id)?.productId ??
              purchaseReceiptsFor(data, order).flatMap((receipt) => receipt.items).find((stockItem) => stockItem.lineId === item.id)?.productId;
            const received = receivedPurchaseQuantity(data, order, item.id!);
            return <p key={index}>{item.description} · {item.quantity} × {currency(item.unitCost)} = {currency(item.quantity * item.unitCost)}
              {" · Recebido: "}{received}{order.cancellation ? " · Cancelado sem recebimento: " : " · Pendente: "}
              {item.quantity - received}
              {productId ? ` · Estoque: ${data.products.find((product) => product.id === productId)?.name ?? productId}` : ""}</p>;
          })}
          {order.schedule.map((row, index) => <p key={index}>Pagamento {index + 1}: {displayDate(row.dueOn)} · {currency(row.amount)}</p>)}
          {order.procurement && <>
            <p>Mapa de cotações · selecionada: {order.procurement.quotes.find((quote) =>
              quote.id === order.procurement!.selectedQuoteId)?.supplierName}</p>
            {order.procurement.quotes.map((quote) => <p key={quote.id}>
              {quote.supplierName} · {currency(quote.amount)} · {displayDate(quote.quotedOn)} ·
              {" "}{quote.reference || quote.terms || "Sem referência/condições registradas"}
            </p>)}
            {order.procurement.quoteExceptionReason && <p>Exceção ao mínimo de 3 cotações: {order.procurement.quoteExceptionReason}</p>}
            <p>Aprovado por {order.procurement.approval.approverName} · {displayDate(order.procurement.approval.at.slice(0, 10))}:
              {" "}{order.procurement.approval.reason}</p>
          </>}
          {order.cancellation && <p>Cancelado em {order.cancellation.at}: {order.cancellation.reason}
            {order.cancellation.receivedAmount ? ` · Contas geradas pelo recebido: ${currency(order.cancellation.receivedAmount)}` : ""}</p>}
          {order.cancellation?.payableEntryIds?.map((id) => {
            const entry = data.finance.entries.find((item) => item.id === id)!;
            return <p key={id}>Conta proporcional {id}: {entry.canceled ? "Cancelada" : `Saldo ${currency(entryBalance(entry))}`}</p>;
          })}
          {purchaseReceiptsFor(data, order).map((receipt) => <div key={receipt.id}><p>Entrega em {displayDate(receipt.date)} · Depósito: {data.inventory!.locations.find((item) => item.id === receipt.locationId)?.name ?? receipt.locationId}<br />
            Referência: {receipt.reference || "Não informada"} · {receipt.notes}</p>
            {receipt.items.map((item) => <p key={item.lineId}>Item {order.items.find((line) => line.id === item.lineId)?.description}: {item.quantity}</p>)}
          </div>)}
          {data.inventory!.purchaseReturns.filter((item) => item.orderId === order.id).map((purchaseReturn) => <div key={purchaseReturn.id}>
            <p>Devolução em {displayDate(purchaseReturn.date)} · {purchaseReturn.reference || "Sem referência"} · {purchaseReturn.reason}</p>
            {purchaseReturn.items.map((item) => <p key={item.lineId}>Item {order.items.find((line) => line.id === item.lineId)?.description}:
              {item.quantity} · Depósito: {data.inventory!.locations.find((location) => location.id === item.locationId)?.name ?? item.locationId}</p>)}
            {purchaseReturn.financial && <p>Valor original devolvido: {currency(purchaseReturn.financial.amount)}.
              {purchaseReturn.financial.payableOffsets.map((offset) => <span key={offset.entryId}>
                {" "}Abatido da conta {offset.entryId}: {currency(offset.amount)}.
              </span>)}
              {purchaseReturn.financial.creditEntryId && <>Crédito a receber do fornecedor: {purchaseReturn.financial.creditEntryId} ·
                saldo {currency(entryBalance(data.finance.entries.find((entry) => entry.id === purchaseReturn.financial!.creditEntryId)!))}.</>}
            </p>}
          </div>)}
          {order.receipt && <><p>Recebido em {displayDate(order.receipt.date)} · Depósito: {data.inventory!.locations.find((item) => item.id === order.receipt!.locationId)?.name ?? order.receipt.locationId}<br />Registro: {order.receipt.at}<br />
            Referência informativa: {order.receipt.reference || "Não informada"}<br />Conferência: {order.receipt.notes}</p>
            {order.receipt.entryIds.map((id) => {
              const entry = data.finance.entries.find((item) => item.id === id)!;
              return <p key={id}>Conta {id}: {entry.canceled ? "Cancelada; não será gerada novamente" : `Saldo ${currency(entryBalance(entry))}`}</p>;
            })}</>}
        </details></td><td><div className="finance-actions">
          {!order.receipt && !order.cancellation && <button className="button secondary" onClick={() => setEditor({ mode: "receive", item: order })}>Conferir recebimento</button>}
          {(order.receipt || purchaseReceiptsFor(data, order).length > 0) &&
            <button className="button secondary" onClick={() => setEditor({ mode: "return", item: order })}>Devolver ao fornecedor</button>}
          {!order.receipt && !order.cancellation && <button className="text-button" onClick={() => setEditor({ mode: "cancel", item: order })}>Cancelar pedido</button>}
        </div></td></tr>)}
    </tbody></table>{!orders.length && <Empty title="Nenhum pedido encontrado" />}</div>
    <h3>Fornecedores</h3>
    <p>Alterar o cadastro não reescreve o nome/documento preservado nos pedidos. Inativar bloqueia novos pedidos e recebimentos; não altera contas existentes.</p>
    <div className="finance-table"><table><thead><tr><th>Nome / CPF ou CNPJ</th><th>Contatos / endereço</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
      {current.suppliers.filter((item) => matches(`${item.name} ${item.document} ${item.phone} ${item.email}`)).map((item) =>
        <tr key={item.id}><td>{item.name}<br />{item.document || "Sem documento"}</td><td>{item.phone}<br />{item.email}<br />{item.address}</td>
          <td>{item.active ? "Ativo" : "Inativo"}</td><td><button className="text-button" onClick={() => setEditor({ mode: "supplier", item })}>Editar fornecedor</button></td></tr>)}
    </tbody></table></div>
    <h3>Depósitos e saldos</h3>
    <p>As compras recebidas e o consumo de peças de OS usam sempre o depósito padrão. Para abastecer outro depósito, registre uma transferência de estoque.</p>
    <div className="section-heading"><button className="button secondary" onClick={() => setEditor({ mode: "location" })}>Novo depósito</button>
      <button className="button secondary" onClick={() => setEditor({ mode: "transfer" })}>Transferir estoque</button>
      <strong>Depósito padrão: {data.inventory!.locations.find((item) => item.id === data.inventory!.defaultLocationId)?.name}</strong></div>
    <div className="finance-table"><table><thead><tr><th>Depósito</th><th>Produto</th><th>Físico</th><th>Reservado</th><th>Disponível</th><th>Padrão</th></tr></thead><tbody>
      {data.inventory!.locations.map((location) => data.products.map((product) => <tr key={`${location.id}:${product.id}`}>
        <td>{location.name}</td><td>{product.name} · {product.code}</td><td>{stockLocationBalance(data, product.id, location.id)}</td>
        <td>{stockReserved(data, product.id, location.id)}</td><td>{stockAvailable(data, product.id, location.id)}</td>
        <td>{location.id === data.inventory!.defaultLocationId ? "Sim" : <button className="text-button"
          onClick={() => setEditor({ mode: "default", locationId: location.id })}>Definir padrão</button>}</td>
      </tr>))}</tbody></table></div>
    <p>Referência do recebimento é apenas informativa: não importa XML, valida nota nem impede cadastrar pedidos diferentes para a mesma compra.
      Confira documentos e evite duplicidade entre pedidos. Aguarde Sincronizado quando conectado.</p>
    {editor && <PurchaseEditor data={data} editor={editor} approvalActor={approvalActor}
      onClose={() => setEditor(null)} onSave={(update) => {
      commit(update); setEditor(null); onSuccess("Estoque/compra atualizado internamente. Aguarde Sincronizado quando conectado.");
    }} />}
  </section>;
}

function PurchaseEditor({ data, editor, approvalActor, onClose, onSave }: {
  data: Database; editor: Editor; approvalActor?: { userId: string | null; name: string; role: CompanyRole | null };
  onClose: () => void; onSave: Commit;
}) {
  const [id] = useState(makeId), [error, setError] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [returnLocationId, setReturnLocationId] = useState(data.inventory!.defaultLocationId);
  const [items, setItems] = useState(() => [{ id: makeId(), description: "", code: "", productId: "", quantity: "1", unitCost: "" }]);
  const [count, setCount] = useState("1"), [firstDueOn, setFirstDueOn] = useState(localDay());
  const [schedule, setSchedule] = useState<PurchaseOrder["schedule"] | null>(null);
  const [quotes, setQuotes] = useState(() => Array.from({ length: 3 }, () => ({
    id: makeId(), supplierId: "", amount: "", quotedOn: localDay(), reference: "", terms: "",
  })));
  const returnableItems = editor.mode === "return"
    ? availablePurchaseReturnItems(data, editor.item.id, returnLocationId) : [];
  const orderItems = () => items.map((item) => ({ id: item.id, description: item.description,
    ...(item.code.trim() ? { code: item.code.trim() } : {}),
    ...(item.productId ? { productId: item.productId } : {}),
    quantity: Number(item.quantity), unitCost: Math.round(Number(item.unitCost) * 100) }));
  const total = purchaseTotal({ items: orderItems() });
  const title = editor.mode === "supplier" ? (editor.item ? "Editar fornecedor" : "Cadastrar fornecedor") :
    editor.mode === "order" ? "Cadastrar pedido de compra" : editor.mode === "receive" ? "Conferir entrega" :
      editor.mode === "return" ? "Devolver itens ao fornecedor" : "Cancelar pedido de compra";
  const expandedTitle = editor.mode === "location" ? "Cadastrar depósito" : editor.mode === "default" ? "Definir depósito padrão" :
    editor.mode === "transfer" ? "Transferir estoque entre depósitos" : title;
  return <Modal title={expandedTitle} onClose={onClose}><form onChange={(event) => {
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
      } else if (editor.mode === "location") {
        onSave((current) => createStockLocation(current, text("name")));
      } else if (editor.mode === "default") {
        onSave((current) => setDefaultStockLocation(current, editor.locationId));
      } else if (editor.mode === "transfer") {
        onSave((current) => transferStock(current, text("productId"), text("fromLocationId"), text("toLocationId"),
          Number(text("quantity")), text("reason")));
      } else if (editor.mode === "order") {
        if (!schedule) throw new Error("Gere e confira a prévia dos pagamentos.");
        const supplier = purchasing(data).suppliers.find((item) => item.id === text("supplierId"));
        if (!supplier) throw new Error("Selecione um fornecedor.");
        if (approvalActor?.role && approvalActor.role !== "owner" && approvalActor.role !== "admin")
          throw new Error("Somente owner/admin pode aprovar uma compra.");
        if (approvalActor?.role && !approvalActor.userId)
          throw new Error("Não foi possível identificar o usuário autenticado que aprova a compra.");
        const quoteRows = quotes.map((quote) => {
          const quoteSupplier = purchasing(data).suppliers.find((item) => item.id === quote.supplierId);
          if (!quoteSupplier) throw new Error("Selecione um fornecedor para cada cotação.");
          return {
            id: quote.id, supplierId: quoteSupplier.id, supplierName: quoteSupplier.name,
            amount: Math.round(Number(quote.amount) * 100), quotedOn: quote.quotedOn,
            reference: quote.reference.trim(), terms: quote.terms.trim(),
          };
        });
        const order = purchaseOrderSchema.parse({ id, supplierId: supplier.id, supplierName: supplier.name, supplierDocument: supplier.document,
          description: text("description"), orderedOn: text("orderedOn"), createdAt: new Date().toISOString(),
          accountId: text("accountId"), paymentMethod: text("paymentMethod"), items: orderItems(), schedule,
          procurement: {
            quotes: quoteRows,
            selectedQuoteId: quoteRows.find((quote) => quote.supplierId === supplier.id)?.id ?? "",
            ...(quoteRows.length < 3 ? { quoteExceptionReason: text("quoteExceptionReason") } : {}),
            approval: {
              at: new Date().toISOString(), approverUserId: approvalActor?.userId ?? "local-owner",
              approverName: approvalActor?.name || "Operador local",
              approverRole: approvalActor?.role === "owner" || approvalActor?.role === "admin" ? approvalActor.role : "local",
              reason: text("approvalReason"),
            },
          },
          ...(text("categoryId") ? { categoryId: text("categoryId") } : {}), ...(text("costCenterId") ? { costCenterId: text("costCenterId") } : {}) });
        onSave((current) => savePurchaseOrder(current, order, confirmed));
      } else if (editor.mode === "receive") onSave((current) =>
        receivePurchaseOrder(current, editor.item, {
          date: text("date"), reference: text("reference"), notes: text("notes"),
          quantities: Object.fromEntries(editor.item.items.map((item) =>
            [item.id!, Number(text(`receiveQuantity.${item.id}`))])),
        }, confirmed));
      else if (editor.mode === "return") onSave((current) => returnPurchaseStock(current, editor.item.id, text("locationId"),
        Object.fromEntries(editor.item.items.flatMap((item) => {
          const quantity = Number(text(`returnQuantity.${item.id}`));
          return quantity > 0 ? [[item.id!, quantity]] : [];
        })),
        { date: text("date"), reference: text("reference"), reason: text("reason") }, confirmed));
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
      </> : editor.mode === "location" ? <>
        <label className="field full">Nome do depósito<input name="name" required maxLength={1000} /></label>
        <p className="full">O depósito será criado sem estoque. Transfira quantidades do depósito atual para o abastecer.</p>
      </> : editor.mode === "default" ? <>
        <p className="full">As próximas compras recebidas e reservas/consumos de OS passarão a usar {data.inventory!.locations.find((item) => item.id === editor.locationId)?.name}.
          O estoque existente não será movido. Transfira saldo entre depósitos antes de trocar o padrão.</p>
      </> : editor.mode === "transfer" ? <>
        <label className="field">Produto<select name="productId" required defaultValue=""><option value="">Selecione</option>
          {data.products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label>
        <label className="field">Quantidade<input name="quantity" type="number" min="1" step="1" required /></label>
        <label className="field">Depósito de origem<select name="fromLocationId" required defaultValue={data.inventory!.defaultLocationId}>
          {data.inventory!.locations.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field">Depósito de destino<select name="toLocationId" required defaultValue="">
          <option value="">Selecione</option>{data.inventory!.locations.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field full">Motivo da transferência<input name="reason" required minLength={5} maxLength={1000} /></label>
        <p className="full">Transferência interna sem contas a pagar/receber; não permite saldo físico ou disponível negativo.</p>
      </> : editor.mode === "order" ? <>
        <label className="field">Fornecedor<select name="supplierId" required defaultValue=""><option value="">Selecione</option>
          {purchasing(data).suppliers.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field">Data do pedido<input name="orderedOn" type="date" required max={localDay()} defaultValue={localDay()} /></label>
        <label className="field full">Descrição do pedido<input name="description" required maxLength={1000} /></label>
        <div className="full"><h3>Itens comprados</h3>{items.map((item, index) => <div className="form-grid" key={index}>
          <label className="field">Descrição do item {index + 1}<input required maxLength={1000} value={item.description} onChange={(event) => {
            setItems(items.map((row, i) => i === index ? { ...row, description: event.target.value } : row)); setSchedule(null);
          }} /></label>
          <label className="field">Código do produto (opcional)<input maxLength={100} value={item.code ?? ""} onChange={(event) => {
            setItems(items.map((row, i) => i === index ? { ...row, code: event.target.value } : row)); setSchedule(null);
          }} /></label>
          <label className="field">Produto do estoque (opcional)<select value={item.productId} onChange={(event) =>
            setItems(items.map((row, i) => i === index ? { ...row, productId: event.target.value } : row))}>
            <option value="">Vincular automaticamente por código/nome; se novo, criar no recebimento</option>
            {data.products.map((product) => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}
          </select></label>
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
            setItems([...items, { id: makeId(), description: "", code: "", productId: "", quantity: "1", unitCost: "" }]); setSchedule(null); setConfirmed(false);
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
        <div className="full">
          <h3>Cotações de fornecedores</h3>
          <p>Registre pelo menos 3 propostas de fornecedores diferentes. A cotação escolhida deve corresponder ao fornecedor e ao total deste pedido.</p>
          {quotes.map((quote, index) => <div className="form-grid" key={quote.id}>
            <label className="field">Fornecedor cotado {index + 1}<select required value={quote.supplierId}
              onChange={(event) => setQuotes(quotes.map((item, i) => i === index ? { ...item, supplierId: event.target.value } : item))}>
              <option value="">Selecione</option>
              {purchasing(data).suppliers.filter((supplier) => supplier.active).map((supplier) =>
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select></label>
            <label className="field">Valor total cotado<input type="number" min="0.01" max="1000000" step="0.01" required
              value={quote.amount} onChange={(event) => setQuotes(quotes.map((item, i) =>
                i === index ? { ...item, amount: event.target.value } : item))} /></label>
            <label className="field">Data da cotação<input type="date" required max={localDay()} value={quote.quotedOn}
              onChange={(event) => setQuotes(quotes.map((item, i) =>
                i === index ? { ...item, quotedOn: event.target.value } : item))} /></label>
            <label className="field">Referência / documento<input maxLength={200} value={quote.reference}
              onChange={(event) => setQuotes(quotes.map((item, i) =>
                i === index ? { ...item, reference: event.target.value } : item))} /></label>
            <label className="field full">Condições comerciais<textarea maxLength={1000} value={quote.terms}
              onChange={(event) => setQuotes(quotes.map((item, i) =>
                i === index ? { ...item, terms: event.target.value } : item))} /></label>
            {quotes.length > 1 && <button type="button" className="text-button" onClick={() => {
              setQuotes(quotes.filter((_, i) => i !== index)); setConfirmed(false);
            }}>Remover cotação {index + 1}</button>}
          </div>)}
          <button type="button" className="button secondary" disabled={quotes.length >= 20} onClick={() => {
            setQuotes([...quotes, { id: makeId(), supplierId: "", amount: "", quotedOn: localDay(), reference: "", terms: "" }]);
            setConfirmed(false);
          }}>Adicionar cotação</button>
          {quotes.length < 3 && <label className="field full">Justificativa para menos de 3 cotações
            <textarea name="quoteExceptionReason" required minLength={5} maxLength={1000} /></label>}
          <label className="field full">Justificativa da seleção e aprovação
            <textarea name="approvalReason" required minLength={5} maxLength={1000} /></label>
          <p>A aprovação será registrada em nome do usuário autenticado e protegida pelo banco da empresa.</p>
        </div>
      </> : <>
        <p className="full">{editor.item.supplierName} · {editor.item.description} · {currency(purchaseTotal(editor.item))}</p>
        {editor.mode === "receive" ? <>
          <p className="full">Informe apenas as quantidades desta entrega. O estoque será atualizado por entrega; contas a pagar serão geradas
            somente quando todas as linhas estiverem completas. Não é possível desfazer uma entrega registrada.</p>
          {editor.item.items.map((item) => {
            const received = receivedPurchaseQuantity(data, editor.item, item.id!), pending = item.quantity - received;
            return <label className="field" key={item.id}>Quantidade recebida · {item.description} · pendente: {pending}
              <input type="number" name={`receiveQuantity.${item.id}`} min="0" max={pending} step="1" required defaultValue={pending} /></label>;
          })}
          {editor.item.schedule.map((row, index) => <p className="full" key={index}>Pagamento após recebimento completo {index + 1}: {displayDate(row.dueOn)} · {currency(row.amount)}</p>)}
          <label className="field">Data da entrega<input type="date" name="date" required
            min={purchaseReceiptsFor(data, editor.item).at(-1)?.date ?? editor.item.orderedOn} max={localDay()} defaultValue={localDay()} /></label>
          <label className="field">Referência do documento (informativa)<input name="reference" maxLength={200} /></label>
          <label className="field full">Conferência do recebimento<textarea name="notes" required minLength={5} maxLength={1000} /></label>
        </> : editor.mode === "return" ? <>
          <p className="full">Registre itens recebidos e disponíveis, descontadas reservas de OS. O valor usa o custo unitário original:
            reduz primeiro contas a pagar em aberto e registra o excedente como crédito a receber do fornecedor. Pagamentos anteriores não são reescritos.</p>
          <label className="field">Depósito<select name="locationId" required value={returnLocationId}
            onChange={(event) => { setReturnLocationId(event.target.value); setConfirmed(false); }}>
            {data.inventory!.locations.filter((location) => location.active).map((location) =>
              <option key={location.id} value={location.id}>{location.name}</option>)}
          </select></label>
          {returnableItems.map((item) => <label className="field" key={item.lineId}>
            Quantidade a devolver · {item.description} · recebido: {item.receivedQuantity} · já devolvido: {item.returnedQuantity} · máximo livre neste depósito: {item.returnableQuantity}
            <input type="number" name={`returnQuantity.${item.lineId}`} min="0" max={item.returnableQuantity} step="1" defaultValue="0" required />
          </label>)}
          {!returnableItems.length &&
            <p className="full">Não há itens recebidos com saldo disponível para devolução neste depósito.</p>}
          <label className="field">Data da devolução<input type="date" name="date" required
            min={(() => {
              const receipts = purchaseReceiptsFor(data, editor.item);
              return receipts.length ? receipts.reduce((date, receipt) => receipt.date < date ? receipt.date : date, receipts[0].date) :
                editor.item.receipt?.date ?? editor.item.orderedOn;
            })()} max={localDay()} defaultValue={localDay()} /></label>
          <label className="field">Referência do documento<input name="reference" maxLength={200} /></label>
          <label className="field full">Motivo da devolução<textarea name="reason" required minLength={5} maxLength={1000} /></label>
        </> : <>
          {purchaseReceiptsFor(data, editor.item).length > 0 && <p className="full">
            O saldo ainda não recebido será cancelado. As quantidades já conferidas permanecem no estoque e geram contas a pagar
            rateadas proporcionalmente pelas parcelas aprovadas; nenhuma conta ou baixa existente será reescrita.
          </p>}
          <label className="field full">Motivo do cancelamento<textarea name="reason" required minLength={5} maxLength={1000} /></label>
        </>}
      </>}
      {editor.mode !== "supplier" && <label className="field full"><span><input name="confirmed" type="checkbox" checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)} /> {editor.mode === "order" ? "Conferi itens, total e vencimentos; este cadastro ainda não gera contas." :
          editor.mode === "receive" ? "Conferi as quantidades desta entrega; autorizo atualizar o estoque e gerar contas apenas se o pedido for concluído." :
            editor.mode === "return" ? "Confirmo a saída do estoque e o abatimento financeiro da devolução; baixas já realizadas serão preservadas." :
            editor.mode === "cancel" ? "Confirmo o cancelamento do saldo pendente e a geração de contas somente pelo valor já recebido." :
              editor.mode === "transfer" ? "Conferi produto, quantidade e depósitos da transferência." :
                editor.mode === "default" ? "Confirmo que a mudança do depósito padrão não move o estoque existente." :
                  "Confirmo o cadastro deste depósito."}</span></label>}
    </div></div>
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Voltar</button>
      <button className="button primary" type="submit" disabled={editor.mode !== "supplier" &&
        (!confirmed || (editor.mode === "order" && !schedule) || (editor.mode === "return" && !returnableItems.length))}>
        {editor.mode === "supplier" ? "Salvar fornecedor" : editor.mode === "order" ? "Salvar pedido" :
          editor.mode === "receive" ? "Confirmar entrega e estoque" : editor.mode === "return" ? "Registrar devolução" : editor.mode === "cancel" ? "Confirmar cancelamento" :
            editor.mode === "transfer" ? "Confirmar transferência" : editor.mode === "default" ? "Definir depósito padrão" : "Cadastrar depósito"}
      </button></div>
  </form></Modal>;
}
