import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Calculator, ChevronDown, History, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { currency, displayDate } from "./domain";
import type { Database } from "./domain";
import { Modal } from "./components";
import {
  blankNfeItem, calculateNfeItem, fromCents, generateNfeInstallments, itemGross, nfeBillingTarget, nfeBlockingIssues,
  nfeItemTabs, nfeNumberLabel, nfeTotals, nfeWarnings, recalculateNfe, recipientFromClient,
} from "./outgoingInvoices";
import type { NfeField } from "./outgoingInvoices";
import {
  nfeFreightModes, nfeGovernmentPurchases, nfeOutputTypes, nfePaymentMethods, nfePresenceIndicators, nfePurposes, nfeTaxRegimes,
} from "./outgoingInvoiceSchema";
import type { NfeInstallment, NfeItem, OutgoingInvoice } from "./outgoingInvoiceSchema";
import "./NfeEditor.css";

const operationNatures = [
  "5102 - Venda de mercadoria",
  "6102 - Venda de mercadoria (fora do estado)",
  "5101 - Venda de produção do estabelecimento",
  "5405 - Venda de mercadoria com ST (substituído)",
  "5949 - Outra saída de mercadoria",
  "5202 - Devolução de compra para comercialização",
];
const states = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const toInput = (cents: number) => (cents / 100).toFixed(2);
const fromInput = (value: string) => Math.max(0, Math.round((Number(value) || 0) * 100));

function Section({ title, children, collapsible = false, defaultOpen = true }: {
  title: string; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean;
}) {
  if (!collapsible) return <section className="nfe-section"><h3>{title}</h3>{children}</section>;
  return <details className="nfe-section nfe-collapsible" open={defaultOpen}>
    <summary><h3>{title}</h3><ChevronDown size={16} aria-hidden="true" /></summary>
    {children}
  </details>;
}

function TextInput({ label, value, onChange, disabled, maxLength = 160, placeholder, list, wide }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean; maxLength?: number;
  placeholder?: string; list?: string; wide?: boolean;
}) {
  return <label className={`field${wide ? " nfe-wide" : ""}`}><span>{label}</span>
    <input value={value} maxLength={maxLength} disabled={disabled} placeholder={placeholder} list={list}
      onChange={(event) => onChange(event.target.value)} /></label>;
}

function MoneyInput({ label, value, onChange, disabled }: {
  label: string; value: number; onChange: (value: number) => void; disabled?: boolean;
}) {
  return <label className="field"><span>{label}</span>
    <input type="number" min="0" step="0.01" value={toInput(value)} disabled={disabled}
      onChange={(event) => onChange(fromInput(event.target.value))} /></label>;
}

function SelectInput({ label, value, options, onChange, disabled, wide }: {
  label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void;
  disabled?: boolean; wide?: boolean;
}) {
  return <label className={`field${wide ? " nfe-wide" : ""}`}><span>{label}</span>
    <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
    </select></label>;
}

function ItemField({ definition, item, auto, onChange }: {
  definition: NfeField; item: NfeItem; auto: boolean; onChange: (key: string, value: string) => void;
}) {
  const value = item.fields[definition.key] ?? "";
  const readOnly = Boolean(definition.calculated && auto);
  const className = `field${definition.wide || definition.type === "textarea" ? " nfe-wide" : ""}`;
  if (definition.type === "checkbox")
    return <label className="checkbox-field nfe-checkbox"><input type="checkbox" checked={value === "true"}
      onChange={(event) => onChange(definition.key, event.target.checked ? "true" : "false")} />{definition.label}</label>;
  if (definition.type === "select")
    return <label className={className}><span>{definition.label}</span>
      <select value={value} onChange={(event) => onChange(definition.key, event.target.value)}>
        {!definition.options?.some(([option]) => option === "") && <option value="">Selecione</option>}
        {definition.options?.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
      </select></label>;
  if (definition.type === "textarea")
    return <label className={className}><span>{definition.label}</span>
      <textarea rows={2} maxLength={2000} value={value} onChange={(event) => onChange(definition.key, event.target.value)} /></label>;
  const numeric = definition.type === "money" || definition.type === "percent" || definition.type === "number";
  return <label className={className}><span>{definition.label}{readOnly && <small> · automático</small>}</span>
    <input type={definition.type === "date" ? "date" : numeric ? "number" : "text"} min={numeric ? "0" : undefined}
      step={definition.type === "money" ? "0.01" : numeric ? "any" : undefined} maxLength={numeric ? undefined : 200}
      value={value} readOnly={readOnly} aria-readonly={readOnly || undefined}
      onChange={(event) => onChange(definition.key, event.target.value)} /></label>;
}

function ItemModal({ data, item, auto, onSave, onClose }: {
  data: Database; item: NfeItem; auto: boolean; onSave: (item: NfeItem) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const [tab, setTab] = useState(nfeItemTabs[0].id);
  const [error, setError] = useState("");
  const shown = auto ? calculateNfeItem(draft) : draft;
  const current = nfeItemTabs.find((entry) => entry.id === tab)!;
  const setField = (key: string, value: string) => setDraft((previous) => ({ ...previous, fields: { ...previous.fields, [key]: value } }));
  function chooseProduct(id: string) {
    const product = data.products.find((entry) => entry.id === id);
    if (!product) { setDraft((previous) => ({ ...previous, referenceId: "" })); return; }
    setDraft((previous) => ({ ...previous, referenceId: product.id, name: product.name.slice(0, 120), code: product.code, price: product.price }));
  }
  function save() {
    if (!draft.name.trim()) { setError("Informe a descrição do item."); return; }
    if (!(draft.quantity > 0)) { setError("Informe uma quantidade maior que zero."); return; }
    if (draft.discount > itemGross(draft)) { setError("O desconto não pode ser maior que o valor do item."); return; }
    onSave(auto ? calculateNfeItem(draft) : draft);
  }
  return <Modal title="Item da nota fiscal" wide onClose={onClose}>
    <div className="modal-body nfe-item-modal">
      {error && <div className="error-message" role="alert">{error}</div>}
      <div className="nfe-grid">
        <label className="field nfe-wide"><span>Produto do catálogo</span>
          <select value={draft.referenceId} onChange={(event) => chooseProduct(event.target.value)}>
            <option value="">Item avulso (não vinculado ao cadastro)</option>
            {data.products.map((product) => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}
          </select></label>
        <TextInput label="Descrição" value={draft.name} maxLength={120} wide onChange={(name) => setDraft((previous) => ({ ...previous, name }))} />
        <TextInput label="Código" value={draft.code} maxLength={60} onChange={(code) => setDraft((previous) => ({ ...previous, code }))} />
        <SelectInput label="Tipo" value={draft.kind} options={[["produto", "Produto"], ["servico", "Serviço"]]}
          onChange={(kind) => setDraft((previous) => ({ ...previous, kind: kind === "servico" ? "servico" : "produto" }))} />
      </div>
      <div className="nfe-tabs" role="tablist" aria-label="Abas do item">
        {nfeItemTabs.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id}
          className={tab === entry.id ? "active" : ""} onClick={() => setTab(entry.id)}>{entry.label}</button>)}
      </div>
      <div className="nfe-grid" role="tabpanel" aria-label={current.label}>
        {tab === "data" && <>
          <label className="field"><span>Quantidade</span><input type="number" min="0" step="any" value={draft.quantity}
            onChange={(event) => setDraft((previous) => ({ ...previous, quantity: Number(event.target.value) }))} /></label>
          <TextInput label="Unidade" value={draft.unit} maxLength={6} onChange={(unit) => setDraft((previous) => ({ ...previous, unit }))} />
          <MoneyInput label="Valor unitário" value={draft.price} onChange={(price) => setDraft((previous) => ({ ...previous, price }))} />
          <label className="field"><span>Valor total</span><input readOnly value={currency(itemGross(draft))} /></label>
          <MoneyInput label="Valor frete" value={draft.freight} onChange={(freight) => setDraft((previous) => ({ ...previous, freight }))} />
          <MoneyInput label="Valor desconto" value={draft.discount} onChange={(discount) => setDraft((previous) => ({ ...previous, discount }))} />
        </>}
        {current.fields.map((definition) => <ItemField key={definition.key} definition={definition} item={shown} auto={auto} onChange={setField} />)}
      </div>
      {auto && <p className="nfe-hint"><Calculator size={14} aria-hidden="true" />Cálculo automático ligado: bases e valores dos impostos são calculados pelas alíquotas informadas.</p>}
    </div>
    <footer className="modal-footer">
      <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
      <button type="button" className="button primary" onClick={save}>Salvar item</button>
    </footer>
  </Modal>;
}

function InstallmentModal({ data, installment, onSave, onClose }: {
  data: Database; installment: NfeInstallment; onSave: (installment: NfeInstallment) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(installment);
  return <Modal title="Dados da parcela" onClose={onClose}>
    <div className="modal-body nfe-grid">
      <label className="field"><span>Dias</span><input type="number" min="0" max="3650" value={draft.days}
        onChange={(event) => setDraft({ ...draft, days: Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></label>
      <label className="field"><span>Data</span><input type="date" value={draft.dueOn} onChange={(event) => setDraft({ ...draft, dueOn: event.target.value })} /></label>
      <SelectInput label="Forma" value={draft.method} options={nfePaymentMethods.map((method) => [method, method] as const)}
        onChange={(method) => setDraft({ ...draft, method: method === "Pix" ? "Pix" : "Boleto" })} />
      <label className="field"><span>Destino / Conta financeira</span>
        <select value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>
          <option value="">Primeira conta ativa</option>
          {data.finance.accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select></label>
      <TextInput label="Tipo de pagamento" value={draft.paymentType} maxLength={80} onChange={(paymentType) => setDraft({ ...draft, paymentType })} />
      <TextInput label="Código de autorização" value={draft.authorization} maxLength={80} onChange={(authorization) => setDraft({ ...draft, authorization })} />
      <MoneyInput label="Valor" value={draft.amount} onChange={(amount) => setDraft({ ...draft, amount })} />
      <TextInput label="Observação" value={draft.notes} maxLength={500} wide onChange={(notes) => setDraft({ ...draft, notes })} />
    </div>
    <footer className="modal-footer">
      <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
      <button type="button" className="button primary" onClick={() => onSave(draft)}>Salvar parcela</button>
    </footer>
  </Modal>;
}

export function NfeEditor({ data, initial, onSave, onCancel }: {
  data: Database;
  initial: OutgoingInvoice;
  onSave: (nfe: OutgoingInvoice) => string | void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => recalculateNfe(initial));
  const [editingItem, setEditingItem] = useState<{ item: NfeItem; isNew: boolean } | null>(null);
  const [editingInstallment, setEditingInstallment] = useState<number | null>(null);
  const [historyItem, setHistoryItem] = useState<NfeItem | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const existing = data.outgoingInvoices.some((item) => item.id === draft.id);
  const readOnly = draft.status !== "Pendente";
  const order = draft.salesOrderId ? data.salesOrders.find((item) => item.id === draft.salesOrderId) : undefined;
  const totals = nfeTotals(draft);
  const target = useMemo(() => nfeBillingTarget(data, draft), [data, draft]);
  const issues = nfeBlockingIssues(draft);
  const warnings = nfeWarnings(draft);
  const installmentsTotal = draft.payment.installments.reduce((sum, item) => sum + item.amount, 0);

  function update(change: (current: OutgoingInvoice) => OutgoingInvoice) {
    setDraft((current) => recalculateNfe(change(current)));
  }
  const setRecipient = (patch: Partial<OutgoingInvoice["recipient"]>) =>
    update((current) => ({ ...current, recipient: { ...current.recipient, ...patch } }));
  const setTransport = (patch: Partial<OutgoingInvoice["transport"]>) =>
    update((current) => ({ ...current, transport: { ...current.transport, ...patch } }));
  const setAdditional = (patch: Partial<OutgoingInvoice["additional"]>) =>
    update((current) => ({ ...current, additional: { ...current.additional, ...patch } }));
  const setInstallments = (installments: NfeInstallment[]) =>
    update((current) => ({ ...current, payment: { ...current.payment, installments } }));

  function chooseClient(id: string) {
    const client = data.clients.find((item) => item.id === id);
    setRecipient({ ...recipientFromClient(client), seller: draft.recipient.seller });
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
    const failure = onSave(draft);
    if (failure) setError(failure);
  }
  const history = historyItem ? data.salesOrders
    .filter((item) => item.clientId === draft.recipient.clientId && item.status !== "Cancelado")
    .flatMap((item) => item.items.filter((line) => line.referenceId === historyItem.referenceId && line.kind === "produto")
      .map((line) => ({ order: item, line })))
    .sort((a, b) => b.order.date.localeCompare(a.order.date)).slice(0, 10) : [];

  return <section className="nfe-editor" aria-label="Nota fiscal de saída">
    <header className="nfe-editor-heading">
      <div>
        <span className="fiscal-eyebrow">VENDAS · NOTAS FISCAIS DE SAÍDA</span>
        <h2>{existing ? `Nota fiscal ${nfeNumberLabel(draft)}` : "Incluir nota fiscal de saída"}</h2>
        <p>{order ? `Gerada a partir do pedido ${order.code}` : "Nota fiscal de venda de produto (NF-e)"} · Situação: {draft.status}</p>
      </div>
      <div className="nfe-editor-actions">
        <button type="button" className="button secondary" onClick={onCancel}>{readOnly ? "Voltar" : "Cancelar"}</button>
        {!readOnly && <button type="button" className="button primary" onClick={save}>Salvar</button>}
      </div>
    </header>
    {error && <div className="error-message" role="alert">{error}</div>}
    {(issues.length > 0 || warnings.length > 0) && <div className="nfe-warning" role="status">
      <AlertTriangle size={17} aria-hidden="true" />
      <div><strong>Algumas informações podem causar a rejeição dessa nota</strong>
        <ul>{[...issues, ...warnings].map((text) => <li key={text}>{text}</li>)}</ul></div>
    </div>}
    <p className="nfe-hint">A nota é salva no Alpha como <strong>Pendente</strong>. A transmissão à SEFAZ ficará disponível quando o backend fiscal estiver conectado.</p>
    <fieldset className="nfe-fieldset" disabled={readOnly}>
      <Section title="Dados da nota">
        <div className="nfe-grid">
          <SelectInput label="Tipo de saída" value={draft.outputType} options={nfeOutputTypes.map((type) => [type, type] as const)}
            onChange={(outputType) => update((current) => ({ ...current, outputType: outputType as OutgoingInvoice["outputType"] }))} />
          <label className="field"><span>Série</span><input inputMode="numeric" maxLength={3} value={draft.series}
            onChange={(event) => update((current) => ({ ...current, series: event.target.value.replace(/\D/g, "") }))} /></label>
          <label className="field"><span>Número</span><input type="number" min="1" value={draft.number}
            onChange={(event) => update((current) => ({ ...current, number: Math.max(1, Math.round(Number(event.target.value) || 1)) }))} />
            <small>O número pode mudar ao gravar.</small></label>
          <TextInput label="Loja" value={draft.store} maxLength={120} onChange={(store) => update((current) => ({ ...current, store }))} />
          <TextInput label="Unidade de negócio" value={draft.businessUnit} maxLength={120} onChange={(businessUnit) => update((current) => ({ ...current, businessUnit }))} />
          <TextInput label="Natureza de operação" value={draft.operationNature} list="nfe-natures" wide
            onChange={(operationNature) => update((current) => ({ ...current, operationNature }))} />
          <datalist id="nfe-natures">{operationNatures.map((nature) => <option key={nature} value={nature} />)}</datalist>
          <label className="field"><span>Data de emissão</span><input type="date" value={draft.issueDate}
            onChange={(event) => update((current) => ({ ...current, issueDate: event.target.value }))} /></label>
          <label className="field"><span>Hora de emissão</span><input disabled value="" placeholder="Preenchida na emissão" /></label>
          <label className="field"><span>Data de saída</span><input type="date" value={draft.exitDate} min={draft.issueDate}
            onChange={(event) => update((current) => ({ ...current, exitDate: event.target.value }))} /></label>
          <label className="field"><span>Hora de saída</span><input type="time" value={draft.exitTime}
            onChange={(event) => update((current) => ({ ...current, exitTime: event.target.value }))} /></label>
          <SelectInput label="Código do regime tributário" value={draft.taxRegime} options={nfeTaxRegimes}
            onChange={(taxRegime) => update((current) => ({ ...current, taxRegime: taxRegime as OutgoingInvoice["taxRegime"] }))} />
          <SelectInput label="Finalidade" value={draft.purpose} options={nfePurposes}
            onChange={(purpose) => update((current) => ({ ...current, purpose: purpose as OutgoingInvoice["purpose"] }))} />
          <SelectInput label="Indicador de presença" value={draft.presence} options={nfePresenceIndicators} wide
            onChange={(presence) => update((current) => ({ ...current, presence: presence as OutgoingInvoice["presence"] }))} />
        </div>
      </Section>

      <Section title="Destinatário">
        <div className="nfe-grid">
          <label className="field nfe-wide"><span>Nome do contato</span>
            <select value={draft.recipient.clientId} disabled={Boolean(order)} onChange={(event) => chooseClient(event.target.value)}>
              <option value="">Selecione o cliente</option>
              {data.clients.filter((client) => client.active || client.id === draft.recipient.clientId)
                .map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
            {order && <small>Destinatário definido pelo pedido {order.code}.</small>}</label>
          <SelectInput label="Tipo da pessoa" value={draft.recipient.personType} options={[["J", "Jurídica"], ["F", "Física"], ["E", "Estrangeiro"]]}
            onChange={(personType) => setRecipient({ personType: personType as OutgoingInvoice["recipient"]["personType"] })} />
          <TextInput label={draft.recipient.personType === "F" ? "CPF" : draft.recipient.personType === "E" ? "Documento" : "CNPJ"}
            value={draft.recipient.document} maxLength={20} onChange={(document) => setRecipient({ document })} />
          <TextInput label="Inscrição estadual" value={draft.recipient.stateRegistration} maxLength={30} onChange={(stateRegistration) => setRecipient({ stateRegistration })} />
          <TextInput label="Vendedor" value={draft.recipient.seller} onChange={(seller) => setRecipient({ seller })} />
          <label className="checkbox-field nfe-checkbox"><input type="checkbox" checked={draft.recipient.finalConsumer}
            onChange={(event) => setRecipient({ finalConsumer: event.target.checked })} />Consumidor final</label>
          <TextInput label="CEP" value={draft.recipient.postalCode} maxLength={9} onChange={(postalCode) => setRecipient({ postalCode })} />
          <SelectInput label="UF" value={draft.recipient.state} options={[["", "—"], ...states.map((state) => [state, state] as const)]}
            onChange={(state) => setRecipient({ state })} />
          <TextInput label="Município" value={draft.recipient.city} maxLength={80} onChange={(city) => setRecipient({ city })} />
          <TextInput label="Bairro" value={draft.recipient.district} maxLength={80} onChange={(district) => setRecipient({ district })} />
          <TextInput label="Endereço" value={draft.recipient.street} wide onChange={(street) => setRecipient({ street })} />
          <TextInput label="Número" value={draft.recipient.number} maxLength={20} onChange={(number) => setRecipient({ number })} />
          <TextInput label="Complemento" value={draft.recipient.complement} maxLength={80} onChange={(complement) => setRecipient({ complement })} />
          <TextInput label="Fone" value={draft.recipient.phone} maxLength={40} onChange={(phone) => setRecipient({ phone })} />
          <TextInput label="E-mail" value={draft.recipient.email} maxLength={254} onChange={(email) => setRecipient({ email })} />
          <SelectInput label="Compra governamental · Ente governamental" value={draft.recipient.governmentPurchase} options={nfeGovernmentPurchases} wide
            onChange={(governmentPurchase) => setRecipient({ governmentPurchase: governmentPurchase as OutgoingInvoice["recipient"]["governmentPurchase"] })} />
        </div>
      </Section>

      <Section title="Itens da nota fiscal">
        <div className="nfe-items-toolbar">
          <button type="button" className="text-button" onClick={() => setReconciling(true)} disabled={!draft.items.length}>
            <RefreshCw size={15} />Atualizar ou criar produtos a partir da nota</button>
        </div>
        <div className="table-scroll">
          <table className="nfe-items">
            <thead><tr><th>#</th><th>Produto ou serviço</th><th>Código</th><th>UN</th><th>Qtde</th><th>Preço un</th><th>Preço total</th><th>NCM</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>{draft.items.map((item, index) => <tr key={item.id} className="nfe-item-row" onClick={() => setEditingItem({ item, isNew: false })}>
              <td>{index + 1}</td>
              <td><button type="button" className="record-link" onClick={(event) => { event.stopPropagation(); setEditingItem({ item, isNew: false }); }}>{item.name}</button></td>
              <td>{item.code || "—"}</td><td>{item.unit || "—"}</td><td>{item.quantity.toLocaleString("pt-BR")}</td>
              <td className="amount">{currency(item.price)}</td><td className="amount">{currency(itemGross(item))}</td>
              <td>{item.fields["data.ncm"] || "—"}</td>
              <td onClick={(event) => event.stopPropagation()}><div className="nfe-row-actions">
                <button type="button" className="icon-button" aria-label={`Editar item ${index + 1}`} title="Editar item" onClick={() => setEditingItem({ item, isNew: false })}><Pencil size={15} /></button>
                <button type="button" className="icon-button" aria-label={`Histórico do produto ${item.name} para o cliente`} title="Visualizar histórico do produto para o cliente"
                  disabled={!item.referenceId || !draft.recipient.clientId} onClick={() => setHistoryItem(item)}><History size={15} /></button>
                <button type="button" className="icon-button" aria-label={`Remover item ${index + 1}`} title="Remover item"
                  onClick={() => update((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== item.id) }))}><Trash2 size={15} /></button>
              </div></td>
            </tr>)}</tbody>
          </table>
          {!draft.items.length && <p className="nfe-empty">Nenhum item na nota.</p>}
        </div>
        <button type="button" className="button secondary nfe-add" onClick={() => setEditingItem({ item: blankNfeItem(), isNew: true })}>
          <Plus size={15} />Adicionar outro item</button>
      </Section>

      <Section title="Cálculo de imposto">
        <label className="nfe-switch">
          <input type="checkbox" role="switch" checked={draft.autoCalculation}
            onChange={(event) => update((current) => ({ ...current, autoCalculation: event.target.checked }))} />
          <span>{draft.autoCalculation ? "Cálculo automático ligado" : "Cálculo automático desligado"}</span>
        </label>
        <dl className="nfe-totals">
          {([
            ["Total dos produtos", totals.products], ["Valor do frete", totals.freight], ["Valor do seguro", totals.insurance],
            ["Outras despesas", totals.otherExpenses], ["Desconto", totals.discount], ["Base ICMS", totals.icmsBase],
            ["Valor ICMS", totals.icms], ["Base ICMS ST", totals.icmsStBase], ["Valor ICMS ST", totals.icmsSt],
            ["Valor IPI", totals.ipi], ["Valor IS", totals.is], ["Valor IBS", totals.ibs], ["Valor CBS", totals.cbs],
            ["Total dos serviços", totals.services], ["Valor ISSQN", totals.issqn], ["Valor Funrural", totals.funrural],
            ["Total aproximado de tributos", totals.approximateTaxes], ["Total faturado", totals.billed],
          ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{currency(value)}</dd></div>)}
          <div className="nfe-grand-total"><dt>Total da nota</dt><dd>{currency(totals.total)}</dd></div>
        </dl>
      </Section>

      <Section title="Retenções" collapsible defaultOpen={false}>
        <div className="nfe-grid">
          {([
            ["minimum", "Mínimo para retenção"], ["base", "Base para retenções"], ["ir", "IR"], ["csll", "CSLL"],
            ["pis", "PIS retido"], ["cofins", "COFINS retido"], ["iss", "ISS retido"],
          ] as const).map(([key, label]) => <MoneyInput key={key} label={label} value={draft.retentions[key]}
            disabled={draft.autoCalculation && (key === "base" || key === "ir" || key === "csll")}
            onChange={(value) => update((current) => ({ ...current, retentions: { ...current.retentions, [key]: value } }))} />)}
        </div>
      </Section>

      <Section title="Transportador / Volumes">
        <div className="nfe-radio-group" role="radiogroup" aria-label="Transporte">
          {([["none", "Não haverá transporte"], ["logistics", "Logística cadastrada"], ["manual", "Inserir manualmente"]] as const).map(([mode, label]) =>
            <label key={mode}><input type="radio" name={`nfe-transport-${draft.id}`} checked={draft.transport.mode === mode}
              onChange={() => setTransport({ mode })} />{label}</label>)}
        </div>
        <div className="nfe-grid">
          <SelectInput label="Frete por conta" value={draft.transport.freightBy} options={nfeFreightModes} wide
            onChange={(freightBy) => setTransport({ freightBy: freightBy as OutgoingInvoice["transport"]["freightBy"] })} />
          {draft.transport.mode === "logistics" && <TextInput label="Logística (integração)" value={draft.transport.logistics} maxLength={120}
            placeholder="Nenhuma integração de logística configurada" onChange={(logistics) => setTransport({ logistics })} />}
          {draft.transport.mode === "manual" && ([
            ["name", "Transportadora", 160], ["plate", "Placa", 10], ["plateState", "UF do veículo", 2], ["rntc", "RNTC", 30],
            ["document", "CNPJ/CPF", 20], ["stateRegistration", "IE", 30], ["state", "UF", 2], ["city", "Município", 80], ["address", "Endereço", 200],
          ] as const).map(([key, label, max]) => <TextInput key={key} label={label} value={draft.transport.carrier[key]} maxLength={max}
            onChange={(value) => setTransport({ carrier: { ...draft.transport.carrier, [key]: value } })} />)}
        </div>
        <h4>Volumes</h4>
        <div className="nfe-grid">
          {([
            ["quantity", "Quantidade"], ["grossWeight", "Peso bruto (kg)"], ["netWeight", "Peso líquido (kg)"],
            ["numbering", "Numeração"], ["species", "Espécie"], ["brand", "Marca"],
          ] as const).map(([key, label]) => <TextInput key={key} label={label} value={draft.transport.volumes[key]} maxLength={60}
            onChange={(value) => setTransport({ volumes: { ...draft.transport.volumes, [key]: value } })} />)}
        </div>
        <label className="checkbox-field nfe-checkbox"><input type="checkbox" checked={draft.transport.differentDelivery}
          onChange={(event) => setTransport({ differentDelivery: event.target.checked })} />Endereço de entrega diferente da cobrança</label>
        {draft.transport.differentDelivery && <div className="nfe-grid">
          {([
            ["name", "Nome", 160], ["document", "CPF/CNPJ", 20], ["postalCode", "CEP", 9], ["state", "UF", 2], ["city", "Município", 80],
            ["district", "Bairro", 80], ["street", "Endereço", 160], ["number", "Número", 20], ["complement", "Complemento", 80],
          ] as const).map(([key, label, max]) => <TextInput key={key} label={label} value={draft.transport.delivery[key]} maxLength={max}
            onChange={(value) => setTransport({ delivery: { ...draft.transport.delivery, [key]: value } })} />)}
        </div>}
      </Section>

      <Section title="Pagamento">
        {target.mode === "external" ? <p className="nfe-hint">{target.message}</p> : target.mode !== "create" ? <>
          <p className="nfe-hint">Contas já lançadas{target.mode === "linked" && order ? ` pelo faturamento do pedido ${order.code}` : " por esta nota"}. Estorne as contas pelo menu da nota para alterar as parcelas.</p>
          <div className="table-scroll"><table className="nfe-installments">
            <thead><tr><th>#</th><th>Vencimento</th><th>Valor</th><th>Forma</th><th>Situação</th></tr></thead>
            <tbody>{target.entries.map((entry, index) => <tr key={entry.id}>
              <td>{index + 1}</td><td>{displayDate(entry.dueOn)}</td><td className="amount">{currency(entry.amount)}</td>
              <td>{entry.paymentMethod}</td><td>{entry.canceled ? "Cancelada" : entry.settlements.some((item) => !item.reversed) ? "Recebida" : "Em aberto"}</td>
            </tr>)}</tbody>
          </table></div>
        </> : <>
          <div className="nfe-payment-terms">
            <TextInput label="Condição de pagamento" value={draft.payment.terms} maxLength={120} placeholder='Ex.: "30 60", "3x" ou "15 +2x"'
              onChange={(terms) => update((current) => ({ ...current, payment: { ...current.payment, terms } }))} />
            <button type="button" className="button secondary" onClick={generateInstallments} disabled={target.amount <= 0}>Gerar parcelas</button>
            <TextInput label="Categoria" value={draft.payment.category} maxLength={120}
              onChange={(category) => update((current) => ({ ...current, payment: { ...current.payment, category } }))} />
          </div>
          {paymentError && <div className="error-message" role="alert">{paymentError}</div>}
          {draft.payment.installments.length > 0 && !data.finance.accounts.some((account) => account.active) && <p className="error-message">
            Nenhuma conta financeira ativa. Cadastre uma conta em Financeiro para lançar as parcelas, ou remova as parcelas para salvar a nota sem contas.</p>}
          {draft.salesOrderId && draft.payment.installments.length > 1 && <p className="error-message" role="alert">
            Em base sincronizada, o faturamento de pedido com múltiplas parcelas ainda não é compatível com as proteções financeiras.
            Não salve com várias parcelas; use uma parcela ou remova-as para salvar sem contas.</p>}
          {target.fixed && <p className="nfe-hint">O pedido já tem faturamento de serviços; as parcelas devem somar o valor de produtos rateado no pedido ({currency(target.amount)}).</p>}
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
                <td><div className="nfe-row-actions">
                  <button type="button" className="icon-button" aria-label={`Detalhes da parcela ${index + 1}`} title="Ver detalhes" onClick={() => setEditingInstallment(index)}><Search size={15} /></button>
                  <button type="button" className="icon-button" aria-label={`Remover parcela ${index + 1}`} title="Remover parcela"
                    onClick={() => setInstallments(draft.payment.installments.filter((_, position) => position !== index))}><X size={15} /></button>
                </div></td>
              </tr>;
            })}</tbody>
          </table></div> : <p className="nfe-empty">Sem parcelas: a nota será salva sem lançar contas a receber.</p>}
          {draft.payment.installments.length > 0 && <p className={installmentsTotal === target.amount ? "nfe-hint" : "error-message"}>
            Total das parcelas: {currency(installmentsTotal)} de {currency(target.amount)}{installmentsTotal === target.amount
              ? draft.salesOrderId && draft.payment.installments.length > 1
                ? ". O lançamento de várias parcelas ainda não é compatível com a base sincronizada."
                : ". Ao salvar, as contas a receber serão lançadas."
              : ". Ajuste as parcelas ou gere novamente."}</p>}
        </>}
      </Section>

      <Section title="Pessoas autorizadas a acessar o XML" collapsible defaultOpen={draft.xmlAuthorized.length > 0}>
        {draft.xmlAuthorized.map((person, index) => <div key={index} className="nfe-grid nfe-person">
          <TextInput label="Contato" value={person.name} onChange={(name) => update((current) => ({ ...current,
            xmlAuthorized: current.xmlAuthorized.map((item, position) => position === index ? { ...item, name } : item) }))} />
          <TextInput label="CPF/CNPJ" value={person.document} maxLength={20} onChange={(document) => update((current) => ({ ...current,
            xmlAuthorized: current.xmlAuthorized.map((item, position) => position === index ? { ...item, document } : item) }))} />
          <button type="button" className="icon-button" aria-label={`Remover pessoa autorizada ${index + 1}`}
            onClick={() => update((current) => ({ ...current, xmlAuthorized: current.xmlAuthorized.filter((_, position) => position !== index) }))}><Trash2 size={15} /></button>
        </div>)}
        <button type="button" className="text-button" disabled={draft.xmlAuthorized.length >= 10}
          onClick={() => update((current) => ({ ...current, xmlAuthorized: [...current.xmlAuthorized, { name: "", document: "" }] }))}>
          <Plus size={15} />Adicionar outro contato</button>
      </Section>

      <Section title="Informações adicionais">
        <div className="nfe-grid">
          <TextInput label="Número da loja virtual" value={draft.additional.storeOrderNumber} maxLength={60} onChange={(storeOrderNumber) => setAdditional({ storeOrderNumber })} />
          <TextInput label="Origem da loja virtual" value={draft.additional.storeOrigin} maxLength={120} onChange={(storeOrigin) => setAdditional({ storeOrigin })} />
          <TextInput label="Origem canal de venda" value={draft.additional.channel} maxLength={120} onChange={(channel) => setAdditional({ channel })} />
          <label className="field nfe-wide"><span>Informações complementares</span>
            <textarea rows={3} maxLength={5000} value={draft.additional.complementary} onChange={(event) => setAdditional({ complementary: event.target.value })} /></label>
          <label className="field nfe-wide"><span>Informações complementares da natureza{draft.autoCalculation && <small> · automático</small>}</span>
            <textarea rows={2} maxLength={5000} readOnly={draft.autoCalculation} value={draft.additional.natureComplementary}
              onChange={(event) => setAdditional({ natureComplementary: event.target.value })} /></label>
          <label className="field nfe-wide"><span>Informações de interesse do fisco da natureza</span>
            <textarea rows={2} maxLength={2000} value={draft.additional.fiscoInfo} onChange={(event) => setAdditional({ fiscoInfo: event.target.value })} /></label>
        </div>
      </Section>
    </fieldset>
    {existing && <Section title="Histórico" collapsible defaultOpen={false}>
      <ul className="nfe-history">{draft.events.map((event, index) => <li key={index}>{new Date(event.at).toLocaleString("pt-BR")} · {event.description}</li>)}</ul>
    </Section>}
    {!readOnly && <footer className="nfe-editor-footer">
      <button type="button" className="button secondary" onClick={onCancel}>Cancelar</button>
      <button type="button" className="button primary" onClick={save}>Salvar</button>
    </footer>}

    {editingItem && <ItemModal data={data} item={editingItem.item} auto={draft.autoCalculation} onClose={() => setEditingItem(null)}
      onSave={(item) => {
        update((current) => ({ ...current, items: editingItem.isNew ? [...current.items, item]
          : current.items.map((entry) => entry.id === item.id ? item : entry) }));
        setEditingItem(null);
      }} />}
    {editingInstallment !== null && draft.payment.installments[editingInstallment] && <InstallmentModal data={data}
      installment={draft.payment.installments[editingInstallment]} onClose={() => setEditingInstallment(null)}
      onSave={(installment) => {
        setInstallments(draft.payment.installments.map((item, index) => index === editingInstallment ? installment : item));
        setEditingInstallment(null);
      }} />}
    {historyItem && <Modal title={`Últimas vendas de ${historyItem.name}`} onClose={() => setHistoryItem(null)}>
      <div className="modal-body">
        {history.length ? <div className="table-scroll"><table>
          <thead><tr><th>Data</th><th>Pedido</th><th>Qtde</th><th>Preço un</th></tr></thead>
          <tbody>{history.map(({ order: sale, line }) => <tr key={`${sale.id}:${line.id}`}>
            <td>{displayDate(sale.date)}</td><td>{sale.code}</td><td>{line.quantity}</td><td className="amount">{currency(line.price)}</td>
          </tr>)}</tbody>
        </table></div> : <p className="nfe-empty">Nenhuma venda anterior deste produto para o cliente.</p>}
      </div>
      <footer className="modal-footer"><button type="button" className="button secondary" onClick={() => setHistoryItem(null)}>Fechar</button></footer>
    </Modal>}
    {reconciling && <ReconcileModal data={data} items={draft.items} onClose={() => setReconciling(false)}
      onApply={(items) => { update((current) => ({ ...current, items })); setReconciling(false); }} />}
  </section>;
}

function ReconcileModal({ data, items, onApply, onClose }: {
  data: Database; items: NfeItem[]; onApply: (items: NfeItem[]) => void; onClose: () => void;
}) {
  const [links, setLinks] = useState(() => Object.fromEntries(items.map((item) => [item.id, item.referenceId])));
  return <Modal title="Conciliar itens da nota" wide onClose={onClose}>
    <div className="modal-body">
      <p className="nfe-hint">Relacione cada item da NF-e a um produto cadastrado. Itens sem vínculo continuam como itens avulsos.</p>
      <div className="table-scroll"><table>
        <thead><tr><th>Item da NF-e</th><th>Código</th><th>Valor</th><th>Produto cadastrado</th></tr></thead>
        <tbody>{items.map((item) => <tr key={item.id}>
          <td>{item.name}</td><td>{item.code || "—"}</td><td className="amount">{fromCents(item.price).replace(".", ",")}</td>
          <td><select aria-label={`Produto cadastrado para ${item.name}`} value={links[item.id] ?? ""}
            onChange={(event) => setLinks({ ...links, [item.id]: event.target.value })}>
            <option value="">Não vinculado</option>
            {data.products.map((product) => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}
          </select></td>
        </tr>)}</tbody>
      </table></div>
    </div>
    <footer className="modal-footer">
      <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
      <button type="button" className="button secondary" disabled title="em breve">Pedido de compra</button>
      <button type="button" className="button primary" onClick={() => onApply(items.map((item) => {
        const product = data.products.find((entry) => entry.id === links[item.id]);
        return product ? { ...item, referenceId: product.id, code: product.code || item.code } : { ...item, referenceId: "" };
      }))}>Conciliar produtos</button>
    </footer>
  </Modal>;
}
