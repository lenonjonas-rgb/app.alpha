import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ChevronDown, Plus, X } from "lucide-react";
import { currency } from "./domain";
import type { Database } from "./domain";
import { generateNfeInstallments } from "./outgoingInvoices";
import { nfePaymentMethods } from "./outgoingInvoiceSchema";
import type { NfeInstallment } from "./outgoingInvoiceSchema";
import {
  NFSE_COFINS_RATE, NFSE_CSLL_RATE, NFSE_INSS_RATE, NFSE_PIS_RATE, nfseConsumptionIndicators, nfseGovernmentPurchases,
  nfseOperationNatures, nfseOperationTypes,
} from "./serviceInvoiceSchema";
import type { ServiceInvoice } from "./serviceInvoiceSchema";
import { nfseBillingTarget, nfseBlockingIssues, nfseNumberLabel, nfseRecipientFromClient, nfseTotals, nfseWarnings } from "./serviceInvoices";
import "./NfeEditor.css";

const states = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const operationIndicators = ["050101", "050102", "050103", "050104"];
const cstOptions = ["000 - Tributação integral", "200 - Alíquota reduzida", "410 - Imunidade e não incidência", "510 - Diferimento"];
const toInput = (cents: number) => (cents / 100).toFixed(2);
const fromInput = (value: string) => Math.max(0, Math.round((Number(value) || 0) * 100));
const rateInput = (value: string) => Math.min(100, Math.max(0, Number(value) || 0));

function Section({ title, children, collapsible = false, defaultOpen = true }: {
  title: string; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean;
}) {
  if (!collapsible) return <section className="nfe-section"><h3>{title}</h3>{children}</section>;
  return <details className="nfe-section nfe-collapsible" open={defaultOpen}>
    <summary><h3>{title}</h3><ChevronDown size={16} aria-hidden="true" /></summary>
    {children}
  </details>;
}

function TextInput({ label, value, onChange, maxLength = 160, list, wide, disabled }: {
  label: string; value: string; onChange: (value: string) => void; maxLength?: number; list?: string; wide?: boolean; disabled?: boolean;
}) {
  return <label className={`field${wide ? " nfe-wide" : ""}`}><span>{label}</span>
    <input value={value} maxLength={maxLength} list={list} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SelectInput({ label, value, options, onChange, wide }: {
  label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void; wide?: boolean;
}) {
  return <label className={`field${wide ? " nfe-wide" : ""}`}><span>{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
    </select></label>;
}

function RateInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span>
    <input type="number" min="0" max="100" step="0.0001" value={value} onChange={(event) => onChange(rateInput(event.target.value))} /></label>;
}

function ReadOnlyMoney({ label, value }: { label: string; value: number }) {
  return <label className="field"><span>{label}<small> · automático</small></span><input readOnly aria-readonly value={currency(value)} /></label>;
}

export function NfseEditor({ data, initial, onSave, onCancel }: {
  data: Database;
  initial: ServiceInvoice;
  onSave: (nfse: ServiceInvoice) => string | void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const existing = data.serviceInvoices.some((item) => item.id === draft.id);
  const readOnly = draft.status !== "Pendente";
  const totals = nfseTotals(draft);
  const target = useMemo(() => nfseBillingTarget(data, draft), [data, draft]);
  const issues = nfseBlockingIssues(draft);
  const warnings = nfseWarnings(draft);
  const installmentsTotal = draft.payment.installments.reduce((sum, item) => sum + item.amount, 0);
  const salesOrder = draft.salesOrderId ? data.salesOrders.find((item) => item.id === draft.salesOrderId) : undefined;
  const serviceOrder = draft.serviceOrderId ? data.orders.find((item) => item.id === draft.serviceOrderId) : undefined;
  const charge = draft.contractChargeId ? data.contractCharges.find((item) => item.id === draft.contractChargeId) : undefined;
  const origin = salesOrder ? `Gerada a partir do pedido ${salesOrder.code}` : serviceOrder ? `Gerada a partir da ordem de serviço ${serviceOrder.code}`
    : charge ? `Gerada pela cobrança de contrato ${charge.period.slice(5)}/${charge.period.slice(0, 4)}` : "Nota fiscal de serviço eletrônica (NFS-e)";
  const lockedClient = Boolean(salesOrder || serviceOrder || charge);

  const update = (change: (current: ServiceInvoice) => ServiceInvoice) => setDraft(change);
  const setRecipient = (patch: Partial<ServiceInvoice["recipient"]>) => update((current) => ({ ...current, recipient: { ...current.recipient, ...patch } }));
  const setService = (patch: Partial<ServiceInvoice["service"]>) => update((current) => ({ ...current, service: { ...current.service, ...patch } }));
  const setTaxes = (patch: Partial<ServiceInvoice["taxes"]>) => update((current) => ({ ...current, taxes: { ...current.taxes, ...patch } }));
  const setInstallments = (installments: NfeInstallment[]) => update((current) => ({ ...current, payment: { ...current.payment, installments } }));

  function chooseClient(id: string) {
    setRecipient(nfseRecipientFromClient(data.clients.find((item) => item.id === id)));
  }
  function generateInstallments() {
    setPaymentError("");
    if (target.mode !== "create") return;
    try {
      const first = draft.payment.installments[0];
      setInstallments(generateNfeInstallments(draft.payment.terms, target.amount, draft.issueDate, {
        method: first?.method ?? "Boleto", accountId: first?.accountId ?? data.finance.accounts.find((account) => account.active)?.id ?? "",
      }));
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : "Não foi possível gerar as parcelas.");
    }
  }
  function save() {
    setError("");
    if (issues.length) { setError(issues.join(" ")); return; }
    if (target.mode === "create" && draft.payment.installments.length && installmentsTotal !== target.amount) {
      setError(`A soma das parcelas (${currency(installmentsTotal)}) deve ser igual ao total da nota (${currency(target.amount)}).`);
      return;
    }
    const failure = onSave(draft);
    if (failure) setError(failure);
  }

  return <section className="nfe-editor" aria-label="Nota de serviço">
    <header className="nfe-editor-heading">
      <div>
        <span className="fiscal-eyebrow">VENDAS · NOTAS DE SERVIÇO</span>
        <h2>{existing ? `Nota de serviço RPS ${nfseNumberLabel(draft)}` : "Incluir nota de serviço"}</h2>
        <p>{origin} · Situação: {draft.status}{draft.nfseNumber ? ` · NFS-e ${draft.nfseNumber}` : ""}</p>
      </div>
      <div className="nfe-editor-actions">
        <button type="button" className="button secondary" onClick={onCancel}>{readOnly ? "Voltar" : "Cancelar"}</button>
        {!readOnly && <button type="button" className="button primary" onClick={save}>Salvar</button>}
      </div>
    </header>
    {error && <div className="error-message" role="alert">{error}</div>}
    {!readOnly && (issues.length > 0 || warnings.length > 0) && <div className="nfe-warning" role="status">
      <AlertTriangle size={17} aria-hidden="true" />
      <div><strong>Algumas informações podem causar a rejeição dessa nota</strong>
        <ul>{[...issues, ...warnings].map((text) => <li key={text}>{text}</li>)}</ul></div>
    </div>}
    <p className="nfe-hint">A nota é salva no Alpha como <strong>Pendente</strong>. Depois de emitida no portal da prefeitura, use "Informar emissão" para registrar o número da NFS-e.</p>
    <fieldset className="nfe-fieldset" disabled={readOnly}>
      <Section title="Dados gerais">
        <div className="nfe-grid">
          <label className="field"><span>Número RPS</span><input type="number" min="1" value={draft.rpsNumber}
            onChange={(event) => update((current) => ({ ...current, rpsNumber: Math.max(1, Math.round(Number(event.target.value) || 1)) }))} />
            <small>O número pode mudar ao gravar.</small></label>
          <TextInput label="Série RPS" value={draft.rpsSeries} maxLength={5} onChange={(rpsSeries) => update((current) => ({ ...current, rpsSeries }))} />
          <TextInput label="Número NFS-e" value={draft.nfseNumber} disabled onChange={() => undefined} />
          <label className="field"><span>Data de emissão</span><input type="date" value={draft.issueDate}
            onChange={(event) => update((current) => ({ ...current, issueDate: event.target.value }))} /></label>
          <SelectInput label="Natureza de operação" value={draft.operationNature} options={nfseOperationNatures} wide
            onChange={(operationNature) => update((current) => ({ ...current, operationNature: operationNature as ServiceInvoice["operationNature"] }))} />
        </div>
      </Section>

      <Section title="Cliente">
        <div className="nfe-grid">
          <label className="field nfe-wide"><span>Nome</span>
            <select value={draft.recipient.clientId} disabled={lockedClient} onChange={(event) => chooseClient(event.target.value)}>
              <option value="">{draft.recipient.clientId ? "Selecione" : draft.recipient.name || "Selecione o cliente"}</option>
              {data.clients.filter((client) => client.active || client.id === draft.recipient.clientId)
                .map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select></label>
          <TextInput label="CPF/CNPJ" value={draft.recipient.document} maxLength={20} onChange={(document) => setRecipient({ document })} />
          <TextInput label="Inscrição estadual" value={draft.recipient.stateRegistration} maxLength={30} onChange={(stateRegistration) => setRecipient({ stateRegistration })} />
          <TextInput label="Inscrição municipal" value={draft.recipient.municipalRegistration} maxLength={30} onChange={(municipalRegistration) => setRecipient({ municipalRegistration })} />
          <SelectInput label="Compra governamental" value={draft.recipient.governmentPurchase} options={nfseGovernmentPurchases}
            onChange={(governmentPurchase) => setRecipient({ governmentPurchase: governmentPurchase as ServiceInvoice["recipient"]["governmentPurchase"] })} />
          <SelectInput label="Tipo de operação" value={draft.recipient.operationType} options={nfseOperationTypes}
            onChange={(operationType) => setRecipient({ operationType: operationType as ServiceInvoice["recipient"]["operationType"] })} />
          <SelectInput label="Indicador de uso e consumo" value={draft.recipient.consumptionIndicator} options={nfseConsumptionIndicators}
            onChange={(consumptionIndicator) => setRecipient({ consumptionIndicator: consumptionIndicator as ServiceInvoice["recipient"]["consumptionIndicator"] })} />
          <TextInput label="CEP" value={draft.recipient.postalCode} maxLength={9} onChange={(postalCode) => setRecipient({ postalCode })} />
          <label className="field"><span>UF</span><select value={draft.recipient.state} onChange={(event) => setRecipient({ state: event.target.value })}>
            <option value="">Selecione</option>{states.map((state) => <option key={state}>{state}</option>)}</select></label>
          <TextInput label="Município" value={draft.recipient.city} maxLength={80} onChange={(city) => setRecipient({ city })} />
          <TextInput label="Bairro" value={draft.recipient.district} maxLength={80} onChange={(district) => setRecipient({ district })} />
          <TextInput label="Endereço" value={draft.recipient.street} wide onChange={(street) => setRecipient({ street })} />
          <TextInput label="Número" value={draft.recipient.number} maxLength={20} onChange={(number) => setRecipient({ number })} />
          <TextInput label="Complemento" value={draft.recipient.complement} maxLength={80} onChange={(complement) => setRecipient({ complement })} />
          <TextInput label="Fone" value={draft.recipient.phone} maxLength={40} onChange={(phone) => setRecipient({ phone })} />
          <TextInput label="E-mail" value={draft.recipient.email} maxLength={254} onChange={(email) => setRecipient({ email })} />
          <label className="field"><span>UF da prestação</span><select value={draft.recipient.serviceState} onChange={(event) => setRecipient({ serviceState: event.target.value })}>
            <option value="">Selecione</option>{states.map((state) => <option key={state}>{state}</option>)}</select></label>
          <TextInput label="Município da prestação" value={draft.recipient.serviceCity} maxLength={80} onChange={(serviceCity) => setRecipient({ serviceCity })} />
        </div>
      </Section>

      <Section title="Serviços">
        <div className="nfe-grid">
          <label className="field nfe-wide"><span>Descrição <small>· {draft.service.description.length}/2000 caracteres</small></span>
            <textarea rows={4} maxLength={2000} value={draft.service.description} onChange={(event) => setService({ description: event.target.value })} /></label>
          <label className="field"><span>Valor do serviço</span><input type="number" min="0" step="0.01" value={toInput(draft.service.amount)}
            disabled={target.mode === "linked"} onChange={(event) => setService({ amount: fromInput(event.target.value) })} /></label>
          <TextInput label="Conjunto de tributações (código do serviço)" value={draft.service.taxSet} wide
            onChange={(taxSet) => setService({ taxSet })} />
          <TextInput label="Código de tributação nacional" value={draft.service.nationalCode} maxLength={20} onChange={(nationalCode) => setService({ nationalCode })} />
          <TextInput label="Código de tributação municipal" value={draft.service.municipalCode} maxLength={20} onChange={(municipalCode) => setService({ municipalCode })} />
          <TextInput label="NBS" value={draft.service.nbs} maxLength={20} onChange={(nbs) => setService({ nbs })} />
          <TextInput label="Indicador de operação" value={draft.service.operationIndicator} maxLength={20} list="nfse-operation-indicators"
            onChange={(operationIndicator) => setService({ operationIndicator })} />
          <datalist id="nfse-operation-indicators">{operationIndicators.map((value) => <option key={value} value={value} />)}</datalist>
          <TextInput label="CST IBS/CBS" value={draft.service.cst} maxLength={80} list="nfse-cst" onChange={(cst) => setService({ cst })} />
          <datalist id="nfse-cst">{cstOptions.map((value) => <option key={value} value={value} />)}</datalist>
          <TextInput label="Classificação tributária" value={draft.service.classification} maxLength={120} onChange={(classification) => setService({ classification })} />
        </div>
      </Section>

      <Section title="Impostos">
        <div className="nfe-grid">
          <RateInput label="% IR" value={draft.taxes.irRate} onChange={(irRate) => setTaxes({ irRate })} />
          <ReadOnlyMoney label="Valor IR" value={totals.ir} />
          <RateInput label="% ISS" value={draft.taxes.issRate} onChange={(issRate) => setTaxes({ issRate })} />
          <ReadOnlyMoney label="Valor ISS" value={totals.iss} />
          <RateInput label="% aproximado de tributos (IBPT)" value={draft.taxes.ibptRate} onChange={(ibptRate) => setTaxes({ ibptRate })} />
          <ReadOnlyMoney label="Valor aproximado de tributos" value={totals.ibpt} />
        </div>
        <div className="nfe-grid">
          <label className="checkbox-field nfe-checkbox"><input type="checkbox" checked={draft.taxes.retainIss}
            onChange={(event) => setTaxes({ retainIss: event.target.checked })} />Reter ISS</label>
          <label className="checkbox-field nfe-checkbox"><input type="checkbox" checked={draft.taxes.discountIss}
            onChange={(event) => setTaxes({ discountIss: event.target.checked })} />Descontar ISS do total</label>
          <label className="checkbox-field nfe-checkbox"><input type="checkbox" checked={draft.taxes.retainInss}
            onChange={(event) => setTaxes({ retainInss: event.target.checked })} />Reter INSS ({NFSE_INSS_RATE}%)</label>
          <label className="checkbox-field nfe-checkbox"><input type="checkbox" checked={draft.taxes.retainFederal}
            onChange={(event) => setTaxes({ retainFederal: event.target.checked })} />Reter CSLL, PIS e COFINS</label>
        </div>
        {totals.retentions + totals.issDeducted > 0 && <div className="table-scroll"><table className="nfe-installments">
          <thead><tr><th>Retenção</th><th>Alíquota</th><th className="amount">Valor</th></tr></thead>
          <tbody>
            {totals.inss > 0 && <tr><td>INSS</td><td>{NFSE_INSS_RATE}%</td><td className="amount">{currency(totals.inss)}</td></tr>}
            {totals.cofins > 0 && <tr><td>COFINS</td><td>{NFSE_COFINS_RATE}%</td><td className="amount">{currency(totals.cofins)}</td></tr>}
            {totals.pis > 0 && <tr><td>PIS</td><td>{NFSE_PIS_RATE.toLocaleString("pt-BR")}%</td><td className="amount">{currency(totals.pis)}</td></tr>}
            {totals.csll > 0 && <tr><td>CSLL</td><td>{NFSE_CSLL_RATE}%</td><td className="amount">{currency(totals.csll)}</td></tr>}
            {totals.ir > 0 && <tr><td>IR</td><td>{draft.taxes.irRate.toLocaleString("pt-BR")}%</td><td className="amount">{currency(totals.ir)}</td></tr>}
            {totals.issDeducted > 0 && <tr><td>ISS descontado</td><td>{draft.taxes.issRate.toLocaleString("pt-BR")}%</td><td className="amount">{currency(totals.issDeducted)}</td></tr>}
            <tr><td><strong>Total impostos</strong></td><td /><td className="amount"><strong>{currency(totals.retentions + totals.issDeducted)}</strong></td></tr>
          </tbody>
        </table></div>}
      </Section>

      <Section title="Totais">
        <div className="nfe-grid">
          <ReadOnlyMoney label="Total dos serviços" value={totals.services} />
          <ReadOnlyMoney label="Base de cálculo" value={totals.base} />
          <label className="field"><span>Desconto incondicional</span><input type="number" min="0" step="0.01" value={toInput(draft.discount)}
            disabled={target.mode === "linked"} onChange={(event) => update((current) => ({ ...current, discount: fromInput(event.target.value) }))} /></label>
          <label className="field"><span>Total da nota</span><input readOnly aria-readonly aria-label="Total da nota" value={currency(totals.total)} /></label>
        </div>
      </Section>

      <Section title="Vendedor" collapsible defaultOpen={Boolean(draft.seller)}>
        <div className="nfe-grid">
          <TextInput label="Vendedor" value={draft.seller} onChange={(seller) => update((current) => ({ ...current, seller }))} />
          <RateInput label="Comissão %" value={draft.commissionRate} onChange={(commissionRate) => update((current) => ({ ...current, commissionRate }))} />
          <ReadOnlyMoney label="Valor da comissão" value={totals.commission} />
        </div>
      </Section>

      <Section title="Pagamento">
        {target.mode === "linked" ? <p className="nfe-hint">Contas já lançadas pelo faturamento {target.invoice.orders.map((item) => item.code).join(", ")} ({currency(target.invoice.amount)}).</p>
          : target.mode === "entries" ? <p className="nfe-hint">Contas lançadas: {target.entries.length} parcela{target.entries.length === 1 ? "" : "s"} · {currency(target.entries.reduce((sum, entry) => sum + entry.amount, 0))}.</p>
          : target.mode === "external" ? <p className="nfe-hint">{target.message}</p>
          : <>
            <div className="nfe-grid">
              <TextInput label="Condição de pagamento" value={draft.payment.terms} maxLength={120}
                onChange={(terms) => update((current) => ({ ...current, payment: { ...current.payment, terms } }))} />
              <div className="field"><span>&nbsp;</span><button type="button" className="button secondary" onClick={generateInstallments}>Gerar parcelas</button></div>
              <TextInput label="Categoria" value={draft.payment.category} maxLength={120}
                onChange={(category) => update((current) => ({ ...current, payment: { ...current.payment, category } }))} />
            </div>
            <p className="nfe-hint">Exemplos: "30 60 90", "3x" ou "15 +2x". Em branco gera parcela única à vista.</p>
            {paymentError && <div className="error-message" role="alert">{paymentError}</div>}
            {draft.payment.installments.length > 0 ? <div className="table-scroll"><table className="nfe-installments">
              <thead><tr><th>#</th><th>Dias</th><th>Data</th><th>Valor</th><th>Forma</th><th>Observação</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>{draft.payment.installments.map((installment, index) => {
                const change = (patch: Partial<NfeInstallment>) => setInstallments(draft.payment.installments.map((item, position) =>
                  position === index ? { ...item, ...patch } : item));
                return <tr key={installment.id}>
                  <td>{index + 1}</td>
                  <td><input aria-label={`Dias da parcela ${index + 1}`} type="number" min="0" max="3650" value={installment.days}
                    onChange={(event) => change({ days: Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></td>
                  <td><input aria-label={`Data da parcela ${index + 1}`} type="date" value={installment.dueOn} onChange={(event) => change({ dueOn: event.target.value })} /></td>
                  <td><input aria-label={`Valor da parcela ${index + 1}`} type="number" min="0" step="0.01" value={toInput(installment.amount)}
                    onChange={(event) => change({ amount: fromInput(event.target.value) })} /></td>
                  <td><select aria-label={`Forma da parcela ${index + 1}`} value={installment.method}
                    onChange={(event) => change({ method: event.target.value === "Pix" ? "Pix" : "Boleto" })}>
                    {nfePaymentMethods.map((method) => <option key={method}>{method}</option>)}</select></td>
                  <td><input aria-label={`Observação da parcela ${index + 1}`} maxLength={500} value={installment.notes} onChange={(event) => change({ notes: event.target.value })} /></td>
                  <td><button type="button" className="icon-button" aria-label={`Remover parcela ${index + 1}`} title="Remover parcela"
                    onClick={() => setInstallments(draft.payment.installments.filter((_, position) => position !== index))}><X size={15} /></button></td>
                </tr>;
              })}</tbody>
            </table></div> : <p className="nfe-empty">Sem parcelas: a nota será salva sem lançar contas a receber.</p>}
            <button type="button" className="text-button" disabled={draft.payment.installments.length >= 120} onClick={() => {
              const last = draft.payment.installments.at(-1);
              setInstallments([...draft.payment.installments, {
                id: crypto.randomUUID(), days: (last?.days ?? -30) + 30, dueOn: last?.dueOn ?? draft.issueDate, amount: 0,
                method: last?.method ?? "Boleto", accountId: last?.accountId ?? data.finance.accounts.find((account) => account.active)?.id ?? "",
                paymentType: "", authorization: "", notes: "",
              }]);
            }}><Plus size={15} />Adicionar outra parcela</button>
            {draft.payment.installments.length > 0 && <p className={installmentsTotal === target.amount ? "nfe-hint" : "error-message"}>
              Total das parcelas: {currency(installmentsTotal)} de {currency(target.amount)}{installmentsTotal === target.amount
                ? ". Ao salvar, as contas a receber serão lançadas." : ". Ajuste as parcelas ou gere novamente."}</p>}
          </>}
      </Section>

      <Section title="Informações complementares">
        <label className="field nfe-wide"><span>Informações complementares</span>
          <textarea rows={3} maxLength={5000} value={draft.complementary} onChange={(event) => update((current) => ({ ...current, complementary: event.target.value }))} /></label>
      </Section>
    </fieldset>
    {existing && <Section title="Histórico" collapsible defaultOpen={false}>
      <ul className="nfe-history">{draft.events.map((event, index) => <li key={index}>{new Date(event.at).toLocaleString("pt-BR")} · {event.description}</li>)}</ul>
    </Section>}
    {!readOnly && <footer className="nfe-editor-footer">
      <button type="button" className="button secondary" onClick={onCancel}>Cancelar</button>
      <button type="button" className="button primary" onClick={save}>Salvar</button>
    </footer>}
  </section>;
}
