import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { currency, displayDate, salesOrderLineTotal, salesOrderSubtotal, salesOrderTotal } from "./domain";
import type { Database, SalesOrder } from "./domain";
import { Modal } from "./components";

export type SalesOrderPrintVariant = "simple" | "receipt" | "detailed";

const titles: Record<SalesOrderPrintVariant, string> = {
  simple: "Imprimir pedido",
  receipt: "Imprimir comprovante",
  detailed: "Imprimir pedido com detalhes",
};

export function SalesOrderPrintModal({ data, order, variant, onClose }: {
  data: Database;
  order: SalesOrder;
  variant: SalesOrderPrintVariant;
  onClose: () => void;
}) {
  const client = data.clients.find((item) => item.id === order.clientId);
  const location = data.inventory!.locations.find((item) => item.id === order.stockLocationId);
  const detailed = variant === "detailed";
  const receipt = variant === "receipt";
  const itemDiscount = order.items.reduce((sum, item) => sum + Math.round(item.quantity * item.price) - salesOrderLineTotal(item), 0);
  return createPortal(<Modal title={`${titles[variant]} ${order.code}`} wide={!receipt} onClose={onClose}>
    <div className={`modal-body document-body sales-order-print${receipt ? " receipt" : ""}`}>
      <div className="document-brand">
        {data.settings.logo
          ? <img className="brand-image compact" src={data.settings.logo} alt={data.settings.company} />
          : <strong>{data.settings.company}</strong>}
        <span>{receipt ? "COMPROVANTE DE VENDA" : "PEDIDO DE VENDA"}</span>
      </div>
      <div className="detail-heading"><h2>Pedido {order.code}</h2><span>{order.status}</span></div>
      <div className="detail-grid">
        <div><small>Cliente</small><strong>{client?.name ?? "Cliente removido"}</strong></div>
        <div><small>Data da venda</small><strong>{displayDate(order.date)}</strong></div>
        {!receipt && <div><small>Entrega prevista</small><strong>{order.expectedOn ? displayDate(order.expectedOn) : "—"}</strong></div>}
        {order.seller && <div><small>Vendedor</small><strong>{order.seller}</strong></div>}
        {detailed && client?.document && <div><small>CPF/CNPJ</small><strong>{client.document}</strong></div>}
        {detailed && <div><small>Depósito</small><strong>{location?.name ?? "—"}</strong></div>}
      </div>
      <div className="table-scroll">
        <table className="document-table">
          <thead><tr><th>Descrição</th><th>Qtd.</th>{!receipt && <th>Unitário</th>}{detailed && <th>Desc. %</th>}<th>Total</th></tr></thead>
          <tbody>{order.items.map((item) => <tr key={item.id}>
            <td>{item.name}{detailed && <small> · {item.kind === "produto" ? "Produto" : "Serviço"}</small>}</td>
            <td>{item.quantity}</td>
            {!receipt && <td>{currency(item.price)}</td>}
            {detailed && <td>{(item.discountPercent / 100).toLocaleString("pt-BR")}%</td>}
            <td>{currency(salesOrderLineTotal(item))}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="document-total">
        <span>Subtotal <b>{currency(salesOrderSubtotal(order.items))}</b></span>
        {detailed && itemDiscount > 0 && <span>Descontos nos itens (já aplicados) <b>{currency(itemDiscount)}</b></span>}
        {order.discount > 0 && <span>Desconto <b>{currency(order.discount)}</b></span>}
        {order.shippingCost > 0 && <span>Frete <b>{currency(order.shippingCost)}</b></span>}
        {order.otherExpenses > 0 && <span>Outras despesas <b>{currency(order.otherExpenses)}</b></span>}
        <strong>Total <b>{currency(salesOrderTotal(order))}</b></strong>
      </div>
      {order.paymentTerms && <p><strong>Condição de pagamento:</strong> {order.paymentTerms}</p>}
      {!receipt && order.notes && <><h3>Observações</h3><p className="preserve-lines">{order.notes}</p></>}
      {detailed && order.internalNotes && <><h3>Observações internas</h3><p className="preserve-lines">{order.internalNotes}</p></>}
      {detailed && <div className="sales-order-print-history">
        <h3>Histórico</h3>
        {order.events.map((event, index) => <p key={`status:${index}`}>{new Date(event.at).toLocaleString("pt-BR")} · {event.status} · {event.reason}</p>)}
        {order.stockEvents.map((event, index) => <p key={`stock:${index}`}>{new Date(event.at).toLocaleString("pt-BR")} · {event.type === "lancamento" ? "Estoque lançado" : "Estoque estornado"} · {event.reason}</p>)}
      </div>}
      {receipt && <div className="sales-order-signature"><span />Assinatura do cliente</div>}
    </div>
    <footer className="modal-footer document-controls">
      <button type="button" className="button secondary" onClick={onClose}>Fechar</button>
      <button type="button" className="button primary" onClick={() => window.print()}><Printer size={16} />Imprimir</button>
    </footer>
  </Modal>, document.body);
}
