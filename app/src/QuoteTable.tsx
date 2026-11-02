import { MoreVertical, Pencil } from "lucide-react";
import { currency, displayDate, localDay, total } from "./domain";
import type { Database, Quote } from "./domain";
import { Badge, Empty } from "./components";
import { DropdownMenu } from "./DropdownMenu";
import { quoteInvoiceActions } from "./quoteInvoiceActions";

export function QuoteTable({ data, quotes, presentation = "quote", onOpen, onEdit, onGenerateInvoice }: {
  data: Database;
  quotes: Quote[];
  presentation?: "quote" | "proposal";
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onGenerateInvoice?: (kind: "nfe" | "nfse", id: string) => void;
}) {
  const label = presentation === "proposal" ? "Proposta" : "Orçamento";
  const today = localDay();
  return <div className="table-scroll">
    <table>
      <thead><tr>
        <th>{label}</th><th>Cliente</th><th>Emissão</th><th>Validade</th><th>Total</th><th>Situação</th>
        <th><span className="sr-only">Ações</span></th>
      </tr></thead>
      <tbody>{quotes.map((quote) => (
        <tr key={quote.id}>
          <td><button className="record-link" onClick={() => onOpen(quote.id)}>
            <strong>{quote.code}</strong>
            <small>{quote.items.length} itens{quote.orderId ? " · OS gerada" : ""}{quote.salesOrderId ? " · pedido gerado" : ""}</small>
          </button></td>
          <td>{data.clients.find((client) => client.id === quote.clientId)?.name ?? "Cliente não encontrado"}</td>
          <td>{displayDate(quote.date)}</td>
          <td className={quote.expires < today && quote.status !== "Aprovado" ? "overdue" : ""}>{displayDate(quote.expires)}</td>
          <td className="amount">{currency(total(quote))}</td>
          <td><Badge value={quote.status} /></td>
          <td><div className="sales-order-actions"><button
            className="icon-button"
            title={quote.orderId || quote.salesOrderId ? `${label} ${presentation === "proposal" ? "vinculada" : "vinculado"} a um documento`
              : quote.status === "Aprovado" ? `${label} ${presentation === "proposal" ? "aprovada" : "aprovado"}: termos comerciais bloqueados`
                : `Editar ${label.toLocaleLowerCase("pt-BR")}`}
            disabled={!!quote.orderId || !!quote.salesOrderId || quote.status === "Aprovado"}
            aria-label={`Editar ${quote.code}`}
            onClick={() => onEdit(quote.id)}
          ><Pencil size={16} /></button>
          {onGenerateInvoice && <DropdownMenu label="Mais ações" accessibleLabel={`Mais ações de ${quote.code}`} triggerIcon={MoreVertical}
            compact actions={quoteInvoiceActions(data, quote, onGenerateInvoice)} />}</div></td>
        </tr>
      ))}</tbody>
    </table>
    {!quotes.length && <Empty title={presentation === "proposal" ? "Nenhuma proposta comercial encontrada" : "Nenhum orçamento encontrado"} />}
  </div>;
}
