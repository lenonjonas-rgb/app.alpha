import type { Invoice } from "./financeSchema";

export type FiscalDocumentStatus = "rascunho" | "enviando" | "incerto" | "processando" | "autorizado" | "rejeitado" | "cancelado";
export type FiscalDocumentRecord = {
  id: string;
  invoiceId: string;
  kind: "nfe" | "nfse";
  environment: "homologacao" | "producao";
  key: string;
  status: FiscalDocumentStatus;
  createdAt: string;
  message?: string;
  protocol?: string;
  accessKey?: string;
  issuedAt?: string;
  number?: string;
  series?: string;
  recipientName?: string;
  recipientDocument?: string;
  destinationState?: string;
  amount?: number;
  products?: string[];
};
export type FiscalDocumentFilters = {
  query: string;
  status: FiscalDocumentStatus | "";
  kind: FiscalDocumentRecord["kind"] | "";
  environment: FiscalDocumentRecord["environment"] | "";
  from: string;
  to: string;
  dateField?: "createdAt" | "issuedAt";
  product?: string;
  destinationState?: string;
};

const statusLabels: Record<FiscalDocumentStatus, string> = {
  rascunho: "Rascunho",
  enviando: "Enviando",
  incerto: "Situação incerta",
  processando: "Processando",
  autorizado: "Autorizada",
  rejeitado: "Rejeitada",
  cancelado: "Cancelada no fisco",
};

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

export function fiscalDocumentStatusLabel(document: Pick<FiscalDocumentRecord, "status" | "message">) {
  return document.status === "cancelado" && document.message?.startsWith("Rascunho descartado internamente.")
    ? "Rascunho descartado"
    : statusLabels[document.status];
}

export function fiscalDocumentNumber(document: FiscalDocumentRecord) {
  if (document.number) return document.number.padStart(6, "0");
  if (document.kind !== "nfe") return "";
  const digits = (document.accessKey ?? document.key).replace(/^NFe/, "");
  return /^\d{44}$/.test(digits) ? digits.slice(25, 34) : "";
}

export function filterFiscalDocuments(
  documents: FiscalDocumentRecord[],
  invoices: Invoice[],
  filters: FiscalDocumentFilters,
  clients: { id: string; document: string }[] = [],
) {
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const query = normalized(filters.query);
  const compactQuery = query.replace(/[^a-z0-9]/g, "");
  return documents.filter((document) => {
    if (filters.status && document.status !== filters.status) return false;
    if (filters.kind && document.kind !== filters.kind) return false;
    if (filters.environment && document.environment !== filters.environment) return false;
    const date = document[filters.dateField ?? "createdAt"]?.slice(0, 10);
    if ((filters.from || filters.to) && !date) return false;
    if (filters.from && date! < filters.from) return false;
    if (filters.to && date! > filters.to) return false;
    if (filters.destinationState && document.destinationState !== filters.destinationState) return false;
    const invoice = invoicesById.get(document.invoiceId);
    if (filters.product && ![
      ...(document.products ?? []),
      ...(invoice?.orders.flatMap((order) => order.items?.map((item) => item.name) ?? []) ?? []),
    ].some((name) => normalized(name).includes(normalized(filters.product!)))) return false;
    if (!query) return true;
    const searchable = [
      document.key,
      document.accessKey ?? "",
      document.protocol ?? "",
      document.message ?? "",
      fiscalDocumentNumber(document),
      document.number ?? "",
      document.recipientName ?? "",
      document.recipientDocument ?? "",
      ...(document.products ?? []),
      invoice?.clientName ?? "",
      clientsById.get(invoice?.clientId ?? "")?.document ?? "",
      invoice?.id ?? "",
      ...(invoice?.orders.map((order) => order.code) ?? []),
      ...(invoice?.orders.flatMap((order) => order.items?.map((item) => item.name) ?? []) ?? []),
    ].map(normalized).join(" ");
    return searchable.includes(query) ||
      (compactQuery.length > 0 && searchable.replace(/[^a-z0-9]/g, "").includes(compactQuery));
  });
}

export function fiscalSelection(documents: FiscalDocumentRecord[], selectedIds: string[]) {
  const selected = documents.filter((item) => selectedIds.includes(item.id));
  return {
    selected,
    drafts: selected.filter((item) => item.status === "rascunho"),
    authorized: selected.filter((item) => item.status === "autorizado"),
  };
}
