import { useState } from "react";
import type { FormEvent } from "react";
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
    id: z.string(), invoiceId: z.string(), kind: z.string(), environment: z.string(), key: z.string(),
    status: z.string(), message: z.string().optional(), protocol: z.string().optional(), accessKey: z.string().optional(),
  })),
});
type Status = z.infer<typeof statusSchema>;

export function FiscalPanel({ data, commit }: { data: Database; commit: (update: (current: Database) => Database) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rule, setRule] = useState<z.infer<typeof ruleSchema> | null>(null);
  async function refresh() { setStatus(statusSchema.parse(await (await fiscalRequest("/status")).json())); }
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
  return <section className="finance-panel">
    <h2>Emissão fiscal e certificado A1</h2>
    {!fiscalConfigured && <p role="alert">Backend não conectado. Publique o serviço fiscal Docker e configure VITE_FISCAL_API_URL no frontend. Não envie o certificado até conectar o ambiente seguro.</p>}
    <p>NF-e: SEFAZ/SVRS de Santa Catarina. NFS-e: Emissor Nacional, Florianópolis. Produção depende de homologação e liberação explícita do servidor.</p>
    <p>O fluxo atual recebe XML fiscal preparado para o faturamento e valida uma cópia assinada no XSD antes de permitir transmissão. Cadastre primeiro o A1. Referências do Bling não substituem a revisão da operação. Não há cálculo tributário automático universal.</p>
    <button className="button secondary" disabled={!fiscalConfigured || busy} onClick={() => void act(async () => {}, "Backend atualizado.")}>Conectar / atualizar backend</button>
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
    {status && <>
      <p>Schemas: NF-e {status.schemas.nfe ? "instalado" : "ausente"} · NFS-e {status.schemas.nfse ? "instalado" : "ausente"}</p>
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
      <FiscalNfeGenerationPanel data={data} numbering={status.numbering} busy={busy}
        certificateReady={Boolean(status.certificate)} schemaReady={status.schemas.nfe === true} act={act} />
      <FiscalNumberingPanel records={status.dpsNumbering} reservations={status.dpsNumberReservations} busy={busy} act={act} model="nfse" />
      <FiscalDpsGenerationPanel data={data} catalog={status.catalog} numbering={status.dpsNumbering} busy={busy}
        certificateReady={Boolean(status.certificate)} schemaReady={status.schemas.nfse === true} act={act} />
      <form onSubmit={(event) => submit(event, async (form, element) => {
        const invoice = data.finance.invoices.find((item) => item.id === form.get("invoiceId"));
        if (!invoice || invoice.kind === "Legado") throw new Error("Selecione um faturamento separado.");
        await fiscalRequest("/documents", "POST", { invoiceId: invoice.id, kind: invoice.kind === "Produtos" ? "nfe" : "nfse", environment: form.get("environment"),
          ruleId: form.get("ruleId"), xml: await fileFrom(form).text() }); element.reset();
      }, "Rascunho validado e salvo. Nenhuma nota transmitida.")}>
        <h3>Preparar documento fiscal</h3>
        <p>Aguarde o financeiro ficar Sincronizado. O backend confere cliente, total, modelo e forma de pagamento na base da nuvem antes da emissão.</p>
        <div className="form-grid">
          <label className="field">Faturamento<select name="invoiceId" required defaultValue=""><option value="">Selecione</option>
            {data.finance.invoices.filter((invoice) => !invoice.canceled && invoice.kind !== "Legado").map((invoice) => <option key={invoice.id} value={invoice.id}>
              {invoice.kind} · {invoice.clientName} · {currency(invoice.amount)} · {invoice.orders.map((order) => order.code).join(", ")}
            </option>)}</select></label>
          <label className="field">Ambiente<select name="environment"><option value="homologacao">Homologação</option><option value="producao">Produção (exige liberação no servidor)</option></select></label>
          <label className="field">Referência revisada<select name="ruleId" required defaultValue=""><option value="">Selecione</option>
            {status.rules.filter((item) => item.reviewed).map((item) => <option key={item.id} value={item.id}>{item.kind.toUpperCase()} · {item.name}</option>)}</select></label>
          <label className="field">XML não assinado<input name="file" type="file" required accept=".xml" /></label>
        </div><button disabled={busy || !status.certificate} className="button primary">Validar e salvar rascunho</button>
      </form>
      <FiscalNfseReconciliation documents={status.documents} busy={busy} act={act} />
      <h3>Documentos fiscais</h3>
      <p>DANFE/DANFSe disponíveis apenas para documentos autorizados no backend. O PDF é auxiliar e não substitui o XML nem consulta a situação atual no fisco. Compartilhamento envia um arquivo, não cria link público.</p>
      <div className="finance-table"><table><thead><tr><th>Documento / ambiente</th><th>Situação</th><th>Protocolo / mensagem</th><th>Ações</th></tr></thead><tbody>
        {status.documents.map((item) => <tr key={item.id}><td>{item.kind.toUpperCase()} · {item.environment}<br /><small>{item.accessKey ?? item.key}</small></td><td>{item.status}</td><td>{item.protocol}<br />{item.message}</td>
          <td><div className="finance-actions">
            {item.status === "rascunho" && <button className="button primary" disabled={busy} onClick={() => {
              const confirmation = window.prompt(`Transmitir ${item.kind.toUpperCase()} em ${item.environment}? Digite a chave/Id para confirmar:`, "");
              if (confirmation === null) return;
              void act(async () => { await fiscalRequest(`/documents/${item.id}/transmit`, "POST", { confirmation }); }, "Transmissão concluída. Confira a situação retornada pelo fisco.");
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
          </div></td></tr>)}
      </tbody></table></div>
    </>}
  </section>;
}
