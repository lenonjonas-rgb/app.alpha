import { useEffect, useState } from "react";
import { CalendarClock, ClipboardCheck, ClipboardList, FileSignature, FileText, Receipt } from "lucide-react";
import type { Database } from "./domain";
import { MaintenanceContractsPanel } from "./MaintenanceContractsPanel";
import { SalesChargesPanel } from "./SalesChargesPanel";
import { SalesOrdersPanel } from "./SalesOrdersPanel";
import { CommercialProposalsPanel } from "./CommercialProposalsPanel";
import { SalesNfePanel } from "./SalesNfePanel";
import { SalesNfsePanel } from "./SalesNfsePanel";
import "./FinancePanel.css";
import "./SalesOrdersPanel.css";

type SalesTab = "orders" | "proposals" | "nfe" | "contracts" | "nfse" | "charges";
const salesTabs: SalesTab[] = ["orders", "proposals", "nfe", "contracts", "nfse", "charges"];

export type SalesServiceOrderStart = { tab: "nfe" | "nfse"; serviceOrderId?: string; quoteId?: string };

export function SalesPanel({ data, commit, initialTab, serviceOrderStart, onCreateProposal, onOpenProposal, onEditProposal, onOpenServiceOrder }: {
  data: Database;
  commit: (update: (current: Database) => Database) => void;
  initialTab?: SalesTab;
  serviceOrderStart?: SalesServiceOrderStart;
  onCreateProposal: () => void;
  onOpenProposal: (id: string) => void;
  onEditProposal: (id: string) => void;
  onOpenServiceOrder?: (id: string) => void;
}) {
  const [tab, setTab] = useState<SalesTab>(serviceOrderStart?.tab ?? initialTab ?? "proposals");
  const [serviceOrderId, setServiceOrderId] = useState(serviceOrderStart?.serviceOrderId ?? "");
  const [quoteId, setQuoteId] = useState(serviceOrderStart?.quoteId ?? "");
  const [fiscalInvoiceId, setFiscalInvoiceId] = useState("");
  const [nfeOrderId, setNfeOrderId] = useState("");
  const [contractNotice, setContractNotice] = useState("");
  useEffect(() => {
    function syncTab() {
      const [section, next] = window.location.hash.slice(1).split("/");
      if (section !== "sales") return;
      if (salesTabs.includes(next as SalesTab)) setTab(next as SalesTab);
      else if (!next) setTab("proposals");
    }
    window.addEventListener("hashchange", syncTab);
    return () => window.removeEventListener("hashchange", syncTab);
  }, []);
  function selectTab(next: SalesTab) {
    setTab(next);
    setFiscalInvoiceId("");
    setNfeOrderId("");
    setServiceOrderId("");
    setQuoteId("");
    setContractNotice("");
    location.hash = `sales/${next}`;
  }
  return <section className="sales-panel">
    <nav className="fiscal-module-tabs" aria-label="Vendas">
      <button type="button" className={tab === "proposals" ? "active" : ""} aria-current={tab === "proposals" ? "page" : undefined}
        onClick={() => selectTab("proposals")}><FileSignature size={17} />Propostas comerciais</button>
      <button type="button" className={tab === "orders" ? "active" : ""} aria-current={tab === "orders" ? "page" : undefined}
        onClick={() => selectTab("orders")}><ClipboardList size={17} />Pedidos de venda</button>
      <button type="button" className={tab === "nfe" ? "active" : ""} aria-current={tab === "nfe" ? "page" : undefined}
        onClick={() => selectTab("nfe")}><FileText size={17} />Notas Fiscais de Saída</button>
      <button type="button" className={tab === "contracts" ? "active" : ""} aria-current={tab === "contracts" ? "page" : undefined}
        onClick={() => selectTab("contracts")}><ClipboardCheck size={17} />Contratos</button>
      <button type="button" className={tab === "nfse" ? "active" : ""} aria-current={tab === "nfse" ? "page" : undefined}
        onClick={() => selectTab("nfse")}><Receipt size={17} />Notas de Serviço</button>
      <button type="button" className={tab === "charges" ? "active" : ""} aria-current={tab === "charges" ? "page" : undefined}
        onClick={() => selectTab("charges")}><CalendarClock size={17} />Cobranças</button>
    </nav>
    {tab === "contracts" && contractNotice && <div className="sales-order-notice" role="status"><span>{contractNotice}</span></div>}
    {tab === "orders"
      ? <SalesOrdersPanel data={data} commit={commit} onOpenServiceOrder={onOpenServiceOrder}
        onIssueFiscal={(kind, invoiceId) => { selectTab(kind); setFiscalInvoiceId(invoiceId); }}
        onCreateNfe={(orderId) => { selectTab("nfe"); setNfeOrderId(orderId); }} />
      : tab === "proposals"
        ? <CommercialProposalsPanel data={data} onCreate={onCreateProposal} onOpen={onOpenProposal} onEdit={onEditProposal}
          onGenerateInvoice={(kind, id) => { selectTab(kind); setQuoteId(id); }} />
        : tab === "nfe"
          ? <SalesNfePanel key={`nfe:${nfeOrderId}:${serviceOrderId}:${quoteId}`} data={data} commit={commit} initialOrderId={nfeOrderId || undefined}
            initialServiceOrderId={serviceOrderId || undefined} initialQuoteId={quoteId || undefined}
            onOpenOrders={() => selectTab("orders")} />
          : tab === "contracts"
            ? <MaintenanceContractsPanel data={data} commit={commit} onSuccess={setContractNotice} />
            : tab === "charges"
              ? <SalesChargesPanel data={data} commit={commit} onOpenContracts={() => selectTab("contracts")} onOpenNfse={() => selectTab("nfse")} />
              : <SalesNfsePanel key={`nfse:${fiscalInvoiceId}:${serviceOrderId}:${quoteId}`} data={data} commit={commit}
                start={fiscalInvoiceId ? { kind: "invoice", id: fiscalInvoiceId } : serviceOrderId ? { kind: "serviceOrder", id: serviceOrderId }
                  : quoteId ? { kind: "quote", id: quoteId } : undefined} onOpenOrders={() => selectTab("orders")} />}
  </section>;
}
