import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CalendarDays, FileDown, Filter, List, MoreVertical, Plus, Printer, RefreshCw, Search, Send, Settings2, SlidersHorizontal, X } from "lucide-react";
import { currency, localDay } from "./domain";
import type { Client } from "./domain";
import type { Invoice } from "./financeSchema";
import { Empty, Modal } from "./components";
import {
  filterFiscalDocuments,
  fiscalDocumentNumber,
  fiscalDocumentStatusLabel,
  fiscalSelection,
  type FiscalDocumentFilters,
  type FiscalDocumentRecord,
} from "./fiscalDocuments";

function dateLabel(value: string) {
  const date = new Date(value.slice(0, 10));
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function statusClass(status: FiscalDocumentRecord["status"]) {
  if (status === "autorizado") return "authorized";
  if (status === "rejeitado" || status === "cancelado") return "rejected";
  if (status === "incerto" || status === "enviando" || status === "processando") return "attention";
  return "draft";
}

const emptyFilters: FiscalDocumentFilters = {
  query: "",
  status: "",
  kind: "",
  environment: "",
  from: "",
  to: "",
  dateField: "issuedAt",
  product: "",
  destinationState: "",
};

function initialFilters(kind?: "nfe" | "nfse"): FiscalDocumentFilters {
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { ...emptyFilters, kind: kind ?? "", from: localDay(from), to: localDay() };
}

const states = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

export function FiscalOutgoingDocuments({
  documents,
  invoices,
  clients,
  busy,
  loading,
  renderActions,
  onInclude,
  onConfigure,
  onRefresh,
  fixedKind,
  onTransmit,
  onExport,
}: {
  fixedKind?: "nfe" | "nfse";
  documents: FiscalDocumentRecord[];
  invoices: Invoice[];
  clients: Pick<Client, "id" | "document">[];
  busy: boolean;
  loading: boolean;
  renderActions: (document: FiscalDocumentRecord) => ReactNode;
  onInclude: () => void;
  onConfigure?: () => void;
  onRefresh: () => void;
  onTransmit: (documents: FiscalDocumentRecord[]) => void;
  onExport: (ids: string[], format: "xml" | "pdf" | "print") => void;
}) {
  const [filters, setFilters] = useState<FiscalDocumentFilters>(() => initialFilters(fixedKind));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ field: "number" | "date" | "name" | "status" | "amount"; ascending: boolean }>({ field: "date", ascending: false });
  const [confirmation, setConfirmation] = useState<FiscalDocumentRecord[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState("");
  const invoiceById = useMemo(() => new Map(invoices.map((invoice) => [invoice.id, invoice])), [invoices]);
  const filtered = useMemo(
    () => filterFiscalDocuments(documents, invoices, { ...filters, kind: fixedKind ?? filters.kind }, clients)
      .sort((first, second) => {
        const value = (item: FiscalDocumentRecord) => {
          const invoice = invoiceById.get(item.invoiceId);
          if (sort.field === "number") return Number(item.number ?? fiscalDocumentNumber(item));
          if (sort.field === "date") return item[filters.dateField ?? "issuedAt"] ?? "";
          if (sort.field === "name") return item.recipientName ?? invoice?.clientName ?? "";
          if (sort.field === "status") return fiscalDocumentStatusLabel(item);
          return item.amount ?? invoice?.amount ?? 0;
        };
        const a = value(first), b = value(second);
        const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "pt-BR");
        return (sort.ascending ? result : -result) || first.id.localeCompare(second.id);
      }),
    [documents, invoices, filters, clients, fixedKind, invoiceById, sort],
  );
  const { selected: selectedDocuments, drafts, authorized } = fiscalSelection(filtered, selectedIds);
  const scopedDocuments = documents.filter((item) => !fixedKind || item.kind === fixedKind);
  const detail = scopedDocuments.find((item) => item.id === detailId);
  const invoice = detail ? invoiceById.get(detail.invoiceId) : undefined;
  const lastPage = Math.max(0, Math.ceil(filtered.length / 25) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  const total = filtered.reduce((sum, item) => sum + (item.amount ?? invoiceById.get(item.invoiceId)?.amount ?? 0), 0);
  const missingAmounts = filtered.some((item) => item.amount === undefined && !invoiceById.has(item.invoiceId));
  const pending = filtered.filter((item) => item.status === "rascunho");
  const modelLabel = fixedKind === "nfse" ? "NFS-es" : "NF-es";
  const dateLabelText = filters.dateField === "createdAt" ? "Data de criação" : "Data emissão";

  function update<K extends keyof FiscalDocumentFilters>(key: K, value: FiscalDocumentFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
  }
  function clearFilters() {
    setFilters({ ...emptyFilters, kind: fixedKind ?? "" });
    setPage(0);
  }
  function sortBy(field: typeof sort.field) {
    setSort((current) => ({ field, ascending: current.field === field ? !current.ascending : true }));
    setPage(0);
  }
  function exportSelection(format: "xml" | "pdf" | "print") {
    onExport(selectedDocuments.map((item) => item.id), format);
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }

  const allVisibleSelected = visible.length > 0 && visible.every((item) => selectedIds.includes(item.id));
  const invalidPeriod = Boolean(filters.from && filters.to && filters.from > filters.to);
  const canExport = !busy && !loading && selectedDocuments.length > 0 && selectedDocuments.length <= 50;
  const canPdf = canExport && authorized.length === selectedDocuments.length;
  const canTransmit = canExport && drafts.length === selectedDocuments.length;

  return <section className="fiscal-outgoing-page">
    <header className="fiscal-outgoing-heading">
      <div>
        <span className="fiscal-eyebrow">FISCAL · SAÍDAS</span>
        <h2>{fixedKind === "nfse" ? "Notas de serviço" : "Notas fiscais de saída"}</h2>
        <p>Vendas / {fixedKind === "nfse" ? "NFS-e · Serviços" : fixedKind === "nfe" ? "NF-e · Produtos" : "Documentos fiscais"}</p>
      </div>
      <button type="button" className="button primary" onClick={onInclude}>
        <Plus size={17} /> Incluir nota fiscal
      </button>
    </header>

    <div className={`fiscal-outgoing-layout${filtersOpen ? " filters-open" : ""}`}>
      {filtersOpen && <aside id="fiscal-list-filters" className="fiscal-outgoing-filters" aria-label="Filtros de notas fiscais">
        <div className="fiscal-outgoing-filter-heading">
          <h3>Filtrar</h3>
          <button type="button" className="icon-button" aria-label="Minimizar filtros" onClick={() => setFiltersOpen(false)}><X size={16} /></button>
        </div>
        <label className="field">Situação
          <select value={filters.status} onChange={(event) => update("status", event.target.value as FiscalDocumentFilters["status"])}>
            <option value="">Todas</option>
            {[
              ["rascunho", "Rascunho"],
              ["enviando", "Enviando"],
              ["incerto", "Situação incerta"],
              ["processando", "Processando"],
              ["autorizado", "Autorizada"],
              ["rejeitado", "Rejeitada"],
              ["cancelado", "Cancelada / descartada"],
            ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">Produto
          <input value={filters.product ?? ""} placeholder="Nome do produto ou serviço"
            onChange={(event) => update("product", event.target.value)} />
        </label>
        <label className="field">UF
          <select value={filters.destinationState ?? ""} onChange={(event) => update("destinationState", event.target.value)}>
            <option value="">Todas</option>{states.map((state) => <option key={state}>{state}</option>)}
          </select>
        </label>
        {!fixedKind && <label className="field">Modelo fiscal
          <select value={filters.kind} onChange={(event) => update("kind", event.target.value as FiscalDocumentFilters["kind"])}>
            <option value="">Todos</option><option value="nfe">NF-e · Produtos</option><option value="nfse">NFS-e · Serviços</option>
          </select>
        </label>}
        <label className="field">Ambiente
          <select value={filters.environment} onChange={(event) => update("environment", event.target.value as FiscalDocumentFilters["environment"])}>
            <option value="">Todos</option><option value="producao">Produção</option><option value="homologacao">Homologação</option>
          </select>
        </label>
        <p className="fiscal-filter-note">UF e emissão são consultadas no XML, sem substituir pelo cadastro atual do cliente. Notas sem esses dados não entram nos respectivos filtros.</p>
        <button type="button" className="text-button" onClick={clearFilters}>Limpar filtros</button>
      </aside>}

      <main className="fiscal-outgoing-results">
        <div className="fiscal-outgoing-toolbar">
          <button type="button" className="icon-button fiscal-filter-toggle" aria-label="Filtrar notas fiscais"
            aria-expanded={filtersOpen} aria-controls="fiscal-list-filters" onClick={() => setFiltersOpen(!filtersOpen)}><Filter size={18} /></button>
          <label className="fiscal-search">
            <Search size={17} aria-hidden="true" />
            <input type="search" value={filters.query}
              placeholder="Pesquisar por nome, CPF/CNPJ ou n° da nota"
              aria-label="Pesquisar notas fiscais"
              onChange={(event) => update("query", event.target.value)} />
          </label>
          <details className="fiscal-period">
            <summary><CalendarDays size={17} />{!filters.from && !filters.to ? "Todo o período" :
              `${filters.from ? dateLabel(filters.from) : "Início"} até ${filters.to ? dateLabel(filters.to) : "Sem limite"}`}</summary>
            <div className="fiscal-period-fields">
              <label className="field">Filtrar por<select value={filters.dateField} onChange={(event) => update("dateField", event.target.value === "createdAt" ? "createdAt" : "issuedAt")}>
                <option value="issuedAt">Data de emissão</option><option value="createdAt">Data de criação</option>
              </select></label>
              <label className="field">De<input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => update("from", event.target.value)} /></label>
              <label className="field">Até<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => update("to", event.target.value)} /></label>
              <button type="button" className="text-button" onClick={() => { setFilters((current) => ({ ...current, from: initialFilters().from, to: localDay() })); setPage(0); }}>Últimos 30 dias</button>
              <button type="button" className="text-button" onClick={() => { setFilters((current) => ({ ...current, from: "", to: "" })); setPage(0); }}>Todo o período</button>
            </div>
          </details>
        </div>
        <div className="fiscal-active-filters">
          <span>{filtered.length} nota(s)</span>
          {filters.status && <span>Situação: {fiscalDocumentStatusLabel({ status: filters.status })}</span>}
          {filters.product && <span>Produto: {filters.product}</span>}
          {filters.destinationState && <span>UF: {filters.destinationState}</span>}
          <button type="button" className="text-button" onClick={clearFilters}>Limpar</button>
        </div>
        {invalidPeriod && <p role="alert" className="error-message">A data inicial não pode ser posterior à data final.</p>}
        {scopedDocuments.some((item) => !item.issuedAt) && <p role="alert" className="fiscal-filter-note">Há documentos sem metadados de emissão. Atualize o backend fiscal para filtrar por emissão; use Data de criação para consultar registros antigos.</p>}
        <div className="fiscal-list-controls">
          <label><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedIds((current) => allVisibleSelected
            ? current.filter((id) => !visible.some((item) => item.id === id))
            : [...new Set([...current, ...visible.map((item) => item.id)])])} /> Selecionar todos desta página</label>
          <button type="button" className="icon-button" title="Atualizar listagem" aria-label="Atualizar listagem"
            disabled={busy || loading} onClick={onRefresh}><RefreshCw size={17} /></button>
          <span className="fiscal-control-spacer" />
          <button type="button" className="icon-button" title="Visualizar listagem padrão" aria-label="Visualizar listagem padrão" aria-pressed={!detailed} onClick={() => setDetailed(false)}><List size={18} /></button>
          <button type="button" className="icon-button" title="Visualizar listagem detalhada" aria-label="Visualizar listagem detalhada" aria-pressed={detailed} onClick={() => setDetailed(true)}><SlidersHorizontal size={18} /></button>
        </div>
        {selectedDocuments.length > 0 && <div className="fiscal-selection-bar">
          <span>{selectedDocuments.length} selecionada(s)</span>
          <button type="button" className="text-button" onClick={() => setSelectedIds([])}>Limpar seleção</button>
        </div>}
        <div className="fiscal-outgoing-table">
          {loading ? <p className="fiscal-list-loading" role="status">Carregando documentos fiscais…</p> : filtered.length ? (
            <table>
              <thead><tr>
                <th><input type="checkbox" aria-label="Selecionar todos os documentos visíveis" checked={allVisibleSelected}
                  onChange={() => setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !visible.some((item) => item.id === id)) : [...new Set([...current, ...visible.map((item) => item.id)])])} /></th>
                {([["number", "Número"], ["date", dateLabelText], ["name", "Nome"], ["status", "Situação"], ["amount", "Valor (R$)"]] as const).map(([field, label]) =>
                  <th key={field} aria-sort={sort.field === field ? sort.ascending ? "ascending" : "descending" : undefined}>
                    <button type="button" onClick={() => sortBy(field)}>{label}{sort.field === field ? sort.ascending ? " ↑" : " ↓" : ""}</button>
                  </th>)}
                <th aria-label="Origem" /><th aria-label="Ações" />
              </tr></thead>
              <tbody>{visible.map((item) => {
                const rowInvoice = invoiceById.get(item.invoiceId);
                const number = fiscalDocumentNumber(item);
                return <tr key={item.id} className={selectedIds.includes(item.id) ? "selected" : ""}>
                  <td><input type="checkbox" aria-label={`Selecionar documento ${number || item.kind.toUpperCase()}`}
                    checked={selectedIds.includes(item.id)} onChange={() => toggleSelection(item.id)} /></td>
                  <td><button type="button" className="fiscal-document-number" onClick={() => setDetailId(item.id)}>
                    {number || (item.kind === "nfse" ? "DPS" : "Sem número")}{detailed && <small>{item.accessKey ?? item.key}</small>}
                  </button></td>
                  <td>{item[filters.dateField ?? "issuedAt"] ? dateLabel(item[filters.dateField ?? "issuedAt"]!) : "—"}</td>
                  <td>{item.recipientName ?? (rowInvoice ? <>{rowInvoice.clientName}</> :
                    <small>Faturamento {item.invoiceId} · dados não sincronizados</small>)}
                    {detailed && rowInvoice && <small>OS: {rowInvoice.orders.map((order) => order.code).join(", ")}</small>}
                    {detailed && <small>{item.environment === "producao" ? "Produção" : "Homologação"} · Série {item.series ?? "—"}</small>}
                  </td>
                  <td><span className={`fiscal-status-pill ${statusClass(item.status)}`}>{fiscalDocumentStatusLabel(item)}</span>
                    {item.environment === "homologacao" && <small>Homologação · Sem valor fiscal</small>}
                    {detailed && item.message && <small className="fiscal-row-message">{item.message}</small>}</td>
                  <td className="fiscal-amount">{item.amount !== undefined ? currency(item.amount) : rowInvoice ? currency(rowInvoice.amount) : "—"}</td>
                  <td>{rowInvoice && <span className="fiscal-origin" title={`Ordem(ns) de serviço: ${rowInvoice.orders.map((order) => order.code).join(", ")}`}>OS</span>}</td>
                  <td><button type="button" className="fiscal-open-detail" aria-label={`Ações da nota ${number || item.kind.toUpperCase()}`}
                    onClick={() => setDetailId(item.id)}><MoreVertical size={17} /></button></td>
                </tr>;
              })}</tbody>
            </table>
          ) : <Empty title={scopedDocuments.length ? "Nenhum documento corresponde aos filtros" : fixedKind === "nfse" ? "Nenhuma nota de serviço" : "Nenhuma nota fiscal de saída"}>
            {!scopedDocuments.length && <p>Fature uma OS e prepare o documento fiscal para ele aparecer nesta listagem.</p>}
          </Empty>}
        </div>
        <div className="fiscal-pagination">
          <span>{filtered.length ? currentPage * 25 + 1 : 0}–{Math.min((currentPage + 1) * 25, filtered.length)} de {filtered.length}</span>
          <button type="button" className="text-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
          <button type="button" className="text-button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Próxima</button>
        </div>
      </main>

      <aside className="fiscal-outgoing-actions" aria-label="Ações da listagem">
        <h3>Ações</h3>
        <button type="button" className="fiscal-side-action" onClick={onInclude}><Plus size={17} />Incluir nota fiscal</button>
        {onConfigure && <button type="button" className="fiscal-side-action" onClick={onConfigure}><Settings2 size={17} />Configuração fiscal</button>}
        <div className="fiscal-side-divider" />
        <button type="button" className="fiscal-side-action" disabled={!canTransmit} onClick={() => setConfirmation(drafts)}><Send size={17} />Enviar {modelLabel} selecionadas</button>
        <button type="button" className="fiscal-side-action" disabled={!canPdf} onClick={() => exportSelection("print")}><Printer size={17} />Imprimir {modelLabel} selecionadas</button>
        <button type="button" className="fiscal-side-action" disabled={busy || loading || !pending.length || pending.length > 50} onClick={() => setConfirmation(pending)}><CalendarDays size={17} />Enviar notas pendentes</button>
        <button type="button" className="fiscal-side-action" disabled={!canPdf} onClick={() => exportSelection("pdf")}><FileDown size={17} />Gerar PDF {fixedKind === "nfse" ? "DANFSe" : "DANFE"}</button>
        <button type="button" className="fiscal-side-action" disabled={!canExport} onClick={() => exportSelection("xml")}><FileDown size={17} />Exportar XML</button>
        <p>Selecione até 50 notas. PDF e impressão exigem autorização. Enviar pendentes considera somente os rascunhos dos filtros atuais, sem reenvio de notas incertas.</p>
        {selectedDocuments.length > 50 && <p role="alert">Selecione no máximo 50 notas por operação.</p>}
        <div className="fiscal-side-divider" />
        {selectedDocuments.length === 1 ? <>
          <p>Documento selecionado</p>
          <strong>{fiscalDocumentNumber(selectedDocuments[0]!) || selectedDocuments[0]!.kind.toUpperCase()}</strong>
          <div className="fiscal-side-document-actions">{renderActions(selectedDocuments[0]!)}</div>
          <button type="button" className="text-button" onClick={() => setDetailId(selectedDocuments[0]!.id)}>Ver detalhes</button>
        </> : <p>{selectedDocuments.length > 1
          ? `${selectedDocuments.length} notas selecionadas. Use as ações acima ou abra uma nota para consultar e cancelar.`
          : "Selecione uma nota na lista para ver as ações disponíveis."}</p>}
        <div className="fiscal-list-information">
          <h3>Informações</h3><small>Quantidade de notas</small><strong>{filtered.length}</strong>
          <small>Valor total</small><strong>{currency(total)}</strong>
          {missingAmounts && <small>Total parcial: há notas sem valor sincronizado.</small>}
          {selectedDocuments.length > 0 && <small>{selectedDocuments.length} selecionada(s)</small>}
        </div>
      </aside>
    </div>

    {confirmation && <Modal title="Confirmar envio de notas fiscais" wide onClose={() => setConfirmation(null)}>
      <form className="modal-body fiscal-transmit-confirmation" onSubmit={(event) => {
        event.preventDefault();
        const batch = confirmation;
        setConfirmation(null);
        onTransmit(batch);
      }}>
        <p>Você está prestes a assinar e transmitir {confirmation.length} documento(s). Esta ação não é apenas um envio por e-mail.</p>
        {confirmation.some((item) => item.environment === "producao") && <p role="alert" className="error-message">ATENÇÃO: a seleção contém notas de PRODUÇÃO, com validade fiscal. A liberação do servidor e as regras fiscais continuam obrigatórias.</p>}
        <ul>{confirmation.map((item) => <li key={item.id}>{fiscalDocumentNumber(item) || item.key} · {item.recipientName ?? invoiceById.get(item.invoiceId)?.clientName ?? "Cliente não sincronizado"} · {item.environment === "producao" ? "PRODUÇÃO" : "Homologação"}</li>)}</ul>
        <p>O envio será sequencial e interrompido se houver rejeição, processamento ou falha. Notas já autorizadas não serão desfeitas.</p>
        <label className="checkbox-field"><input type="checkbox" name="reviewed" required />Conferi as notas, os ambientes e os valores.</label>
        <label className="field">Digite TRANSMITIR para confirmar<input name="confirmation" required pattern="TRANSMITIR" autoComplete="off" /></label>
        <div className="finance-actions">
          <button type="button" className="button secondary" onClick={() => setConfirmation(null)}>Voltar</button>
          <button type="submit" className="button primary" disabled={busy}>Assinar e transmitir {confirmation.length} nota(s)</button>
        </div>
      </form>
    </Modal>}
    {detail && <Modal title={`${detail.kind.toUpperCase()} ${fiscalDocumentNumber(detail) || ""}`} wide onClose={() => setDetailId("")}>
      <div className="modal-body fiscal-document-detail">
        <div className="fiscal-detail-summary">
          <div><small>Situação fiscal</small><span className={`fiscal-status-pill ${statusClass(detail.status)}`}>{fiscalDocumentStatusLabel(detail)}</span></div>
          <div><small>Ambiente</small><strong>{detail.environment === "homologacao" ? "Homologação" : "Produção"}</strong></div>
          <div><small>Criada em</small><strong>{dateLabel(detail.createdAt)}</strong></div>
          <div><small>Data de emissão (XML)</small><strong>{detail.issuedAt ? dateLabel(detail.issuedAt) : "Não disponível"}</strong></div>
          <div><small>Faturamento</small><strong>{invoice?.id ?? detail.invoiceId}</strong></div>
          <div><small>Cliente</small><strong>{detail.recipientName ?? invoice?.clientName ?? "Dados não sincronizados"}</strong></div>
          <div><small>Valor</small><strong>{detail.amount !== undefined ? currency(detail.amount) : invoice ? currency(invoice.amount) : "—"}</strong></div>
          <div><small>Protocolo</small><strong>{detail.protocol ?? "—"}</strong></div>
          <div><small>Documento vinculado</small><strong>{invoice?.kind === "Produtos" ? "NF-e" : invoice?.kind === "Serviços" ? "NFS-e" : detail.kind.toUpperCase()}</strong></div>
        </div>
        <div className="fiscal-detail-key"><small>Chave / identificador</small><code>{detail.accessKey ?? detail.key}</code></div>
        {detail.message && <div className="fiscal-detail-message"><small>Retorno mais recente</small><p>{detail.message}</p></div>}
        <h3>Origem do faturamento</h3>
        {invoice ? <div className="fiscal-detail-orders">{invoice.orders.map((order) => <article key={order.orderId}>
          <strong>{order.code} · {order.title}</strong><span>{currency(order.amount)}</span>
          {order.items?.length ? <div className="fiscal-detail-items">
            {order.items.map((item) => <div key={item.id}><span>{item.quantity} × {item.name}</span><span>{currency(item.gross - item.itemDiscount - item.orderDiscount)}</span></div>)}
          </div> : <small>Itens detalhados não estavam disponíveis no snapshot do faturamento.</small>}
        </article>)}</div> : <p>Atualize a conexão fiscal e financeira para carregar os dados comerciais vinculados.</p>}
        <p className="fiscal-detail-disclaimer">A data de criação do registro não é a data fiscal de emissão. Consulte o XML autorizado para os dados fiscais oficiais.</p>
        <h3>Ações deste documento</h3>
        <div className="fiscal-detail-actions">{renderActions(detail)}</div>
      </div>
    </Modal>}
  </section>;
}
