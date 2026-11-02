import { FileText, Receipt } from "lucide-react";
import type { Database, Quote } from "./domain";
import type { DropdownAction } from "./DropdownMenu";
import { nfeNumberLabel } from "./outgoingInvoices";
import { quoteInvoices } from "./quoteInvoices";
import { nfseNumberLabel } from "./serviceInvoices";

/** Ações de nota da proposta: serviços vão para a NFS-e e produtos para a NF-e de venda. */
export function quoteInvoiceActions(data: Database, quote: Quote, onGenerate: (kind: "nfe" | "nfse", id: string) => void): DropdownAction[] {
  const approved = quote.status === "Aprovado";
  const existing = quoteInvoices(data, quote);
  const hasServices = quote.items.some((item) => item.kind === "servico");
  const hasProducts = quote.items.some((item) => item.kind === "produto");
  const hint = (has: boolean, empty: string) => !has ? empty : !approved ? "aprove a proposta" : undefined;
  return [
    {
      label: existing.nfse ? `Abrir nota de serviço RPS ${nfseNumberLabel(existing.nfse)}` : "Gerar nota de serviço",
      icon: Receipt, disabled: !hasServices || !approved, hint: existing.nfse ? undefined : hint(hasServices, "sem serviços"),
      onSelect: () => onGenerate("nfse", quote.id),
    },
    {
      label: existing.nfe ? `Abrir nota fiscal de venda ${nfeNumberLabel(existing.nfe)}` : "Gerar nota fiscal de venda",
      icon: FileText, disabled: !hasProducts || !approved, hint: existing.nfe ? undefined : hint(hasProducts, "sem produtos"),
      onSelect: () => onGenerate("nfe", quote.id),
    },
  ];
}
