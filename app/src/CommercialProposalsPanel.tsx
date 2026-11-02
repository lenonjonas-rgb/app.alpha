import { useState } from "react";
import { Plus, Search } from "lucide-react";
import type { Database } from "./domain";
import { QuoteTable } from "./QuoteTable";

export function CommercialProposalsPanel({ data, onCreate, onOpen, onEdit, onGenerateInvoice }: {
  data: Database;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onGenerateInvoice?: (kind: "nfe" | "nfse", id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Todos");
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const quotes = data.quotes
    .filter((quote) => status === "Todos" || quote.status === status)
    .filter((quote) => {
      const client = data.clients.find((item) => item.id === quote.clientId);
      return [quote.code, client?.name ?? "", client?.document ?? "", client?.email ?? "",
        ...quote.items.map((item) => item.name)]
        .join(" ").toLocaleLowerCase("pt-BR").includes(search);
    })
    .toSorted((first, second) => second.date.localeCompare(first.date) || second.code.localeCompare(first.code));

  return <section className="commercial-proposals-panel">
    <div className="commercial-proposals-heading">
      <div>
        <span className="fiscal-eyebrow">OPERAÇÃO · VENDAS</span>
        <h2>Propostas comerciais</h2>
        <p>Propostas e orçamentos são os mesmos registros. A criação não movimenta estoque nem gera cobrança.</p>
      </div>
      <button type="button" className="button primary" onClick={onCreate}><Plus size={17} />Nova proposta</button>
    </div>
    <div className="commercial-proposals-toolbar">
      <label className="search-field"><Search size={16} /><input type="search" aria-label="Buscar propostas comerciais"
        placeholder="Buscar número, cliente ou item" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select aria-label="Filtrar situação da proposta" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option>Todos</option><option>Rascunho</option><option>Enviado</option><option>Aprovado</option><option>Recusado</option>
      </select>
    </div>
    <QuoteTable data={data} quotes={quotes} presentation="proposal" onOpen={onOpen} onEdit={onEdit} onGenerateInvoice={onGenerateInvoice} />
  </section>;
}
