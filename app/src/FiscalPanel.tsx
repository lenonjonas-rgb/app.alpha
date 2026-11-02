import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { FilePlus2, FileText, Settings2 } from "lucide-react";
import { z } from "zod";
import type { Database } from "./domain";
import { currency } from "./domain";
import { fiscalConfigured, fiscalRequest, fileBase64 } from "./fiscalApi";
import { errorMessage } from "./useDatabase";
import { FiscalCatalogPanel } from "./FiscalCatalogPanel";
import { fiscalCatalogSchema } from "./fiscalCatalogSchema";
import { FiscalAddressFields } from "./FiscalAddressFields";
import { FiscalRecipientPanel } from "./FiscalRecipientPanel";
import { addressFromForm, fiscalIssuerSchema, fiscalRecipientSchema } from "./fiscalPartySchema";
import { fiscalMatrixSchema } from "./fiscalMatrixSchema";
import { FiscalMatrixPanel } from "./FiscalMatrixPanel";
import { FiscalInvoiceCalculation } from "./FiscalInvoiceCalculation";
import { invoiceCalculationMetadataSchema } from "./fiscalTaxCalculation";
import { FiscalNumberingPanel } from "./FiscalNumberingPanel";
import { fiscalNumberingSchema, fiscalNumberReservationSchema } from "./fiscalNumberingSchema";
import { FiscalNfeGenerationPanel } from "./FiscalNfeGenerationPanel";
import { FiscalDpsGenerationPanel } from "./FiscalDpsGenerationPanel";
import { FiscalNfseReconciliation } from "./FiscalNfseReconciliation";
import { FiscalPdfActions } from "./FiscalPdfActions";
import { FiscalEventActions } from "./FiscalEventActions";
import { FiscalOutgoingDocuments } from "./FiscalOutgoingDocuments";
import { transmitFiscalDocuments } from "./fiscalDocumentActions";
import { Modal } from "./components";
import { downloadFiscalPdf, fiscalPdfFile } from "./fiscalPdf";

const ruleSchema = z.object({ id: z.string(), kind: z.enum(["nfe", "nfse"]), name: z.string(), source: z.string(), scope: z.string(), reviewed: z.boolean(), fields: z.record(z.string(), z.string()) });
const statusSchema = z.object({
  issuer: fiscalIssuerSchema.nullable(),
  recipients: z.array(fiscalRecipientSchema),
  matrices: z.array(fiscalMatrixSchema),
  calculations: z.array(invoiceCalculationMetadataSchema),
  numbering: z.array(fiscalNumberingSchema),
  numberReservations: z.array(fiscalNumberReservationSchema),
  dpsNumbering: z.array(fiscalNumberingSchema),
  dpsNumberReservations: z.array(fiscalNumberReservationSchema),
  certificate: z.object({ cnpj: z.string(), expiresAt: z.string(), subject: z.string() }).nullable(),
  schemas: z.record(z.string(), z.boolean()),
  rules: z.array(ruleSchema),
  catalog: fiscalCatalogSchema,
  documents: z.array(z.object({
    id: z.string(), invoiceId: z.string(), kind: z.enum(["nfe", "nfse"]), environment: z.enum(["homologacao", "producao"]), key: z.string(),
    status: z.enum(["rascunho", "enviando", "incerto", "processando", "autorizado", "rejeitado", "cancelado"]),
    createdAt: z.iso.datetime(), message: z.string().optional(), protocol: z.string().optional(), accessKey: z.string().optional(),
    issuedAt: z.string().optional(), number: z.string().optional(), series: z.string().optional(),
    recipientName: z.string().optional(), recipientDocument: z.string().optional(),
    destinationState: z.string().optional(), amount: z.number().int().nonnegative().optional(),
    products: z.array(z.string()).optional(),
  })),
});
type Status = z.infer<typeof statusSchema>;
type FiscalView = "documents" | "issue" | "settings";

export function FiscalPanel({ data, commit, initialView, documentKind, eyebrow, presentation, initialInvoiceId, onBackToList, onIncludeDocument }: {
  documentKind?: "nfe" | "nfse";
  eyebrow?: string;
  presentation?: "sales";
  data: Database;
  commit: (update: (current: Database) => Database) => void;
  initialView?: FiscalView;
  initialInvoiceId?: string;
  onBackToList?: () => void;
  onIncludeDocument?: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [view, setView] = useState<FiscalView>(initialView ?? "documents");
  const [busy, setBusy] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(fiscalConfigured);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rule, setRule] = useState<z.infer<typeof ruleSchema> | null>(null);
  const [printUrl, setPrintUrl] = useState("");
  const inSales = presentation === "sales";
  const heading = inSales && view === "issue"
    ? documentKind === "nfse" ? "Incluir nota de serviço" : "Incluir nota fiscal de saída"
    : inSales && view === "settings" ? "Configuração fiscal"
      : documentKind === "nfse" ? "Notas de serviço" : "Notas fiscais de saída";
  useEffect(() => () => { if (printUrl) URL.revokeObjectURL(printUrl); }, [printUrl]);
  async function refresh() { setStatus(statusSchema.parse(await (await fiscalRequest("/status")).json())); }
  useEffect(() => {
    if (!fiscalConfigured) return;
    let active = true;
    void fiscalRequest("/status")
      .then((response) => response.json())
      .then((result) => {
        if (active) setStatus(statusSchema.parse(result));
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoadingStatus(false);
      });
    return () => { active = false; };
  }, []);
  async function act(operation: () => Promise<void>, success: string, refreshOnFailure = false) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); await refresh(); setMessage(success); }
    catch (cause) {
      setError(errorMessage(cause));
      if (refreshOnFailure) {
        try { await refresh(); }
        catch (refreshCause) { setError(`${errorMessage(cause)} Não foi possível atualizar a situação: ${errorMessage(refreshCause)}. Atualize o backend antes de continuar.`); }
      }
    }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>, operation: (form: FormData, element: HTMLFormElement) => Promise<void>, success: string) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    void act(() => operation(form, element), success);
  }
  const fileFrom = (form: FormData) => {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 2_000_000) throw new Error("Selecione um arquivo de até 2 MB.");
    return file;
  };
  const companyAddress = data.settings.addressDetails;
  const normalizedCity = companyAddress.city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const registeredIssuerAddress = companyAddress.state === "SC" && normalizedCity === "florianopolis" &&
    companyAddress.street && companyAddress.number && companyAddress.district && /^\d{8}$/.test(companyAddress.postalCode)
    ? { ...companyAddress, municipality: "4205407" }
    : undefined;
  const registeredStateIeCandidate = data.settings.stateRegistrations.find((item) => item.state === "SC" && item.active === true)?.number ?? "";
  const registeredStateIe = /^\d{2,14}$/.test(registeredStateIeCandidate) ? registeredStateIeCandidate : "";
  const registeredIssuerName = data.settings.legalName.length <= 60 ? data.settings.legalName : "";
  const registeredIssuerEmail = data.settings.email.length <= 80 ? data.settings.email : "";
  async function download(id: string) {
    const response = await fiscalRequest(`/documents/${id}/xml`);
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `fiscal-${id}.xml`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportDocuments(ids: string[], format: "xml" | "pdf" | "print") {
    await act(async () => {
      const response = await fiscalRequest("/documents/export", "POST", { ids, format });
      if (format === "print") {
        const file = await fiscalPdfFile(response, "notas-fiscais.pdf");
        setPrintUrl(URL.createObjectURL(file));
      } else {
        if (response.headers.get("Content-Type")?.split(";")[0] !== "application/zip")
          throw new Error("O backend não retornou um arquivo ZIP fiscal.");
        const blob = await response.blob();
        if (!blob.size) throw new Error("A exportação fiscal retornou um arquivo vazio.");
        downloadFiscalPdf(new File([blob], `notas-${format}.zip`, { type: "application/zip" }));
      }
    }, format === "print" ? "PDF preparado. Abra a visualização para imprimir." : "Exportação baixada em ZIP.");
  }
  const documentActions = (item: NonNullable<Status>["documents"][number]) =>
    <div className="finance-actions">
      {item.status === "rascunho" && <button className="button primary" disabled={busy} onClick={() => {
        const confirmation = window.prompt(`Transmitir ${item.kind.toUpperCase()} em ${item.environment}? Digite a chave/Id para confirmar:`, "");
        if (confirmation === null) return;
        void act(async () => { await fiscalRequest(`/documents/${item.id}/transmit`, "POST", { confirmation }); }, "Transmissão concluída. Confira a situação retornada pelo fisco.", true);
      }}>Assinar e transmitir</button>}
      {item.status === "rascunho" && <button className="text-button" disabled={busy} onClick={() => {
        if (!window.confirm("Descartar este rascunho nunca transmitido? A numeração não poderá ser reutilizada. Isso não cancela nota autorizada.")) return;
        void act(async () => { await fiscalRequest(`/documents/${item.id}/discard`, "POST", {}); }, "Rascunho descartado; nenhuma operação no fisco.");
      }}>Descartar rascunho</button>}
      {!["rascunho", "enviando", "cancelado"].includes(item.status) && <button className="button secondary" disabled={busy} onClick={() => void act(async () => {
        await fiscalRequest(`/documents/${item.id}/consult`, "POST", {});
      }, "Situação consultada no fisco.")}>Consultar situação</button>}
      <button className="text-button" disabled={busy} onClick={() => void act(() => download(item.id), "XML baixado. Confira se é rascunho, assinado ou autorizado.")}>Baixar XML</button>
      <FiscalPdfActions key={`${item.id}-${item.status}-${item.key}-${item.protocol ?? item.accessKey ?? ""}`} item={item} busy={busy} />
      <FiscalEventActions item={item} busy={busy} act={(operation, success) => act(operation, success, true)} />
    </div>;
  return <section className="finance-panel">
    {view !== "documents" && <header className="fiscal-module-header">
      <div><span className="fiscal-eyebrow">{eyebrow ?? "FINANCEIRO · FISCAL"}</span><h2>{heading}</h2></div>
      {(inSales || fiscalConfigured) && <div className="finance-actions">
        {inSales && <button type="button" className="button secondary" onClick={() => onBackToList ? onBackToList() : setView("documents")}>Voltar para notas</button>}
        {inSales && view === "issue" && <button type="button" className="button secondary" onClick={() => setView("settings")}>Configuração fiscal</button>}
        {inSales && view === "settings" && <button type="button" className="button secondary" onClick={() => onIncludeDocument ? onIncludeDocument() : setView("issue")}>Incluir nota fiscal</button>}
        {fiscalConfigured && <button className="button secondary" disabled={busy || loadingStatus}
          onClick={() => void act(async () => {}, "Dados fiscais atualizados.")}>Atualizar</button>}
      </div>}
    </header>}
    {!fiscalConfigured && <p role="alert">Backend não conectado. Publique o serviço fiscal Docker e configure VITE_FISCAL_API_URL no frontend. Não envie o certificado até conectar o ambiente seguro.</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!inSales && <nav className="fiscal-module-tabs fiscal-context-tabs" aria-label="Fiscal">
      <button type="button" className={view === "documents" ? "active" : ""} aria-current={view === "documents" ? "page" : undefined}
        onClick={() => setView("documents")}><FileText size={17} />{documentKind === "nfse" ? "Notas de serviço" : "Notas fiscais de saída"}</button>
      <button type="button" className={view === "issue" ? "active" : ""} aria-current={view === "issue" ? "page" : undefined}
        onClick={() => setView("issue")}><FilePlus2 size={17} />Incluir nota fiscal</button>
      <button type="button" className={view === "settings" ? "active" : ""} aria-current={view === "settings" ? "page" : undefined}
        onClick={() => setView("settings")}><Settings2 size={17} />Configuração fiscal</button>
    </nav>}
    {!status && loadingStatus && <p role="status">Conectando ao serviço fiscal…</p>}
    {!status && !loadingStatus && !error && <p role="status">Atualize para carregar a listagem fiscal.</p>}
    {status && view === "settings" && <>
      <div className="fiscal-configuration-intro">
        <p>NF-e: SEFAZ/SVRS de Santa Catarina. NFS-e: Emissor Nacional, Florianópolis. Produção depende de homologação e liberação explícita do servidor.</p>
        <p>Não há cálculo tributário automático universal. Revise o enquadramento e a operação com a contabilidade antes de transmitir.</p>
        <p>Schemas: NF-e {status.schemas.nfe ? "instalado" : "ausente"} · NFS-e {status.schemas.nfse ? "instalado" : "ausente"}.
          {" "}Cancelamento NF-e {status.schemas.nfeCancellation ? "instalado" : "ausente"} · Cancelamento NFS-e {status.schemas.nfseCancellation ? "instalado" : "ausente"}.</p>
      </div>
      <p>Schema de cancelamento NF-e: {status.schemas.nfeCancellation ? "instalado" : "ausente (instale no backend antes de solicitar evento)"}.</p>
      <p>Schema do pedido de cancelamento NFS-e: {status.schemas.nfseCancellation ? "instalado" : "ausente (instale os schemas NFS-e no backend antes de solicitar evento)"}.</p>
      <form key={status.issuer?.cnpj ?? "new"} onSubmit={(event) => submit(event, async (form) => {
        await fiscalRequest("/issuer", "PUT", { cnpj: String(form.get("cnpj")).replace(/[.\s/-]/g, ""), name: form.get("name"), ie: form.get("ie"), im: form.get("im"),
          municipality: "4205407", taxRegime: "Lucro Real", address: addressFromForm(form), email: form.get("email"), phone: form.get("phone") });
      }, "Emitente salvo no backend.")}>
        <h3>Emitente · Lucro Real · Florianópolis/SC</h3>
        <div className="form-grid">
          <label className="field">CNPJ<input name="cnpj" required pattern="[0-9]{14}" maxLength={14} defaultValue={status.issuer?.cnpj ?? (/^\d{14}$/.test(data.settings.cnpj) ? data.settings.cnpj : "")} /></label>
          <label className="field">Razão social<input name="name" required maxLength={60} defaultValue={status.issuer?.name ?? registeredIssuerName} /></label>
          <label className="field">Inscrição estadual (sem pontuação)<input name="ie" required pattern="[0-9]{2,14}" maxLength={14} defaultValue={status.issuer?.ie ?? registeredStateIe} /></label>
          <label className="field">Inscrição municipal<input name="im" required maxLength={30} defaultValue={status.issuer?.im} /></label>
          <label className="field">E-mail fiscal<input name="email" type="email" maxLength={80} defaultValue={status.issuer?.email ?? registeredIssuerEmail} /></label>
          <label className="field">Telefone (somente dígitos)<input name="phone" pattern="[0-9]{6,14}|^$" maxLength={14} defaultValue={status.issuer?.phone ?? data.settings.phone.split(" / ")[0]?.replace(/\D/g, "")} /></label>
        </div>
        {!status.issuer && <p>Dados disponíveis do cadastro da empresa foram pré-preenchidos quando compatíveis. Confira-os e complete IM e demais dados fiscais; só o cadastro empresarial confirmado no backend será usado para emissão.</p>}
        {!status.issuer?.address && <p>Complete o endereço fiscal estruturado. Cadastros anteriores sem endereço não estão completos para geração automática.</p>}
        <FiscalAddressFields address={status.issuer?.address ?? registeredIssuerAddress} issuer />
        <button disabled={busy} className="button primary">Salvar emitente</button>
      </form>
      <FiscalRecipientPanel data={data} recipients={status.recipients} busy={busy} act={act} />
      <form onSubmit={(event) => submit(event, async (form, element) => {
        try { await fiscalRequest("/certificate", "POST", { pfxBase64: await fileBase64(fileFrom(form)), password: form.get("password") }); }
        finally { element.reset(); }
      }, "A1 validado e armazenado criptografado no backend.")}>
        <h3>Certificado A1 (somente Master)</h3>
        <p>{status.certificate ? `CNPJ ${status.certificate.cnpj} · validade ${status.certificate.expiresAt}` : "Nenhum A1 cadastrado."}</p>
        <div className="form-grid">
          <label className="field">Arquivo .pfx / .p12<input name="file" type="file" accept=".pfx,.p12" required /></label>
          <label className="field">Senha do A1<input name="password" type="password" autoComplete="off" maxLength={1000} /></label>
        </div><p>A senha e a chave privada não são incluídas na base ou no backup da empresa. A chave mestra fica somente no ambiente do servidor.</p>
        <button disabled={busy || !status.issuer} className="button primary">Enviar A1 ao backend seguro</button>
      </form>
      <h3>Regras e referências tributárias</h3>
      <form onSubmit={(event) => submit(event, async (form, element) => {
        await fiscalRequest("/rules/import", "POST", { xml: await fileFrom(form).text() }); element.reset();
      }, "Referências do XML importadas sem aprovação automática.")}>
        <label className="field">XML de NF-e autorizada ou NFS-e emitida<input name="file" type="file" accept=".xml" required /></label>
        <button disabled={busy} className="button secondary">Importar referência tributária</button>
      </form>
      <div className="finance-table"><table><thead><tr><th>Referência</th><th>Aplicabilidade</th><th>Revisão</th><th>Ação</th></tr></thead><tbody>
        {status.rules.map((item) => <tr key={item.id}><td>{item.name}<br />{item.source}</td><td>{item.scope}</td><td>{item.reviewed ? "Revisada" : "Pendente"}</td>
          <td><button className="text-button" disabled={busy} onClick={() => setRule(item)}>Conferir / editar</button></td></tr>)}
      </tbody></table></div>
      {rule && <form onSubmit={(event) => submit(event, async (form) => {
        const fields = z.record(z.string(), z.string()).parse(JSON.parse(String(form.get("fields"))));
        await fiscalRequest("/rules", "PUT", { ...rule, scope: form.get("scope"), fields, reviewed: form.get("reviewed") === "on" }); setRule(null);
      }, "Revisão da referência registrada.")}>
        <h4>{rule.name}</h4>
        <label className="field">Escopo da operação<textarea name="scope" required minLength={10} maxLength={1000} defaultValue={rule.scope} /></label>
        <label className="field">Campos tributários (JSON)<textarea name="fields" required rows={12} defaultValue={JSON.stringify(rule.fields, null, 2)} /></label>
        <label className="checkbox-field"><input name="reviewed" type="checkbox" defaultChecked={rule.reviewed} />Conferi a aplicabilidade com a contabilidade; referência revisada.</label>
        <button disabled={busy} className="button primary">Salvar revisão</button>
        <button type="button" className="button secondary" onClick={() => setRule(null)}>Fechar</button>
      </form>}
      <FiscalCatalogPanel data={data} catalog={status.catalog} rules={status.rules} busy={busy} act={act} />
      <FiscalMatrixPanel matrices={status.matrices} rules={status.rules} busy={busy} act={act} />
      <FiscalInvoiceCalculation data={data} catalog={status.catalog} calculations={status.calculations} busy={busy} act={act} commit={commit} />
      <FiscalNumberingPanel records={status.numbering} reservations={status.numberReservations} busy={busy} act={act} />
    </>}
    {status && view === "issue" && <>
      <div className="fiscal-issue-intro">
        <h3>Preparar uma nota fiscal</h3>
        <p>Selecione um faturamento existente para emitir o documento correspondente. A NF-e de produtos e a NFS-e de serviços são fluxos separados; a autorização depende de validação fiscal e retorno do ambiente escolhido.</p>
        {!status.issuer && <p role="alert">Cadastre e valide o emitente na Configuração fiscal antes de preparar uma nota.</p>}
        {!status.certificate && <p role="alert">Cadastre o certificado A1 no ambiente seguro antes de gerar ou transmitir documentos.</p>}
      </div>
      {documentKind !== "nfse" && <FiscalNfeGenerationPanel data={data} catalog={status.catalog} numbering={status.numbering} busy={busy}
        certificateReady={Boolean(status.certificate)} schemaReady={status.schemas.nfe === true} act={act} initialInvoiceId={initialInvoiceId} />}
      {documentKind !== "nfe" && <>
        <FiscalNumberingPanel records={status.dpsNumbering} reservations={status.dpsNumberReservations} busy={busy} act={act} model="nfse" />
        <FiscalDpsGenerationPanel data={data} catalog={status.catalog} numbering={status.dpsNumbering} busy={busy}
          certificateReady={Boolean(status.certificate)} schemaReady={status.schemas.nfse === true} act={act} initialInvoiceId={initialInvoiceId} />
      </>}
      <form onSubmit={(event) => submit(event, async (form, element) => {
        const invoice = data.finance.invoices.find((item) => item.id === form.get("invoiceId"));
        if (!invoice || invoice.kind === "Legado") throw new Error("Selecione um faturamento separado.");
        await fiscalRequest("/documents", "POST", { invoiceId: invoice.id, kind: invoice.kind === "Produtos" ? "nfe" : "nfse", environment: form.get("environment"),
          ruleId: form.get("ruleId"), xml: await fileFrom(form).text() }); element.reset();
      }, "Rascunho validado e salvo. Nenhuma nota transmitida.")}>
        <h3>Preparar documento fiscal</h3>
        <p>Aguarde o financeiro ficar Sincronizado. O backend confere cliente, total, modelo e forma de pagamento na base da nuvem antes da emissão.</p>
        <div className="form-grid">
          <label className="field">Faturamento<select name="invoiceId" required defaultValue={initialInvoiceId ?? ""}><option value="">Selecione</option>
            {data.finance.invoices.filter((invoice) => !invoice.canceled && invoice.kind !== "Legado" &&
              (!documentKind || invoice.kind === (documentKind === "nfe" ? "Produtos" : "Serviços"))).map((invoice) => <option key={invoice.id} value={invoice.id}>
              {invoice.kind} · {invoice.clientName} · {currency(invoice.amount)} · {invoice.orders.map((order) => order.code).join(", ")}
            </option>)}</select></label>
          <label className="field">Ambiente<select name="environment"><option value="homologacao">Homologação</option><option value="producao">Produção (exige liberação no servidor)</option></select></label>
          <label className="field">Referência revisada<select name="ruleId" required defaultValue=""><option value="">Selecione</option>
            {status.rules.filter((item) => item.reviewed && (!documentKind || item.kind === documentKind)).map((item) => <option key={item.id} value={item.id}>{item.kind.toUpperCase()} · {item.name}</option>)}</select></label>
          <label className="field">XML não assinado<input name="file" type="file" required accept=".xml" /></label>
        </div><button disabled={busy || !status.certificate} className="button primary">Validar e salvar rascunho</button>
      </form>
      {documentKind !== "nfe" && <FiscalNfseReconciliation documents={status.documents} busy={busy} act={act} />}
      <p>DANFE/DANFSe só ficam disponíveis para documentos autorizados. O PDF é auxiliar; o XML permanece como documento fiscal oficial.</p>
    </>}
    {view === "documents" && <FiscalOutgoingDocuments
      fixedKind={documentKind}
      documents={status?.documents ?? []}
      invoices={data.finance.invoices}
      clients={data.clients}
      busy={busy}
      loading={loadingStatus}
      renderActions={documentActions}
      onInclude={() => setView("issue")}
      onConfigure={inSales ? () => setView("settings") : undefined}
      onRefresh={() => void act(async () => {}, "Listagem atualizada.")}
      onTransmit={(documents) => void act(() => transmitFiscalDocuments(documents, fiscalRequest),
        "Envio concluído. Confira a situação de cada nota na listagem.", true)}
      onExport={(ids, format) => void exportDocuments(ids, format)}
    />}
    {printUrl && <Modal title="Imprimir notas fiscais selecionadas" wide onClose={() => setPrintUrl("")}>
      <div className="modal-body">
        <p>Use o comando de impressão do visualizador de PDF. Documentos de homologação não têm validade fiscal.</p>
        <a className="button secondary" href={printUrl} target="_blank" rel="noopener noreferrer">Abrir PDF para imprimir</a>
        <iframe className="fiscal-print-preview" title="Prévia dos documentos fiscais para impressão" src={printUrl} />
      </div>
    </Modal>}
  </section>;
}
