import { CalendarPlus, Copy, FileText, Paperclip, Pencil, Printer, Trash2 } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Empty, Modal } from "./components";
import { DropdownMenu } from "./DropdownMenu";
import type { DropdownAction } from "./DropdownMenu";
import { currency, displayDate, localDay, makeId, shiftDay } from "./domain";
import type { Attachment, Database, MaintenanceContract, MaintenanceEquipmentType } from "./domain";
import {
  contractBilling, contractDueRules, contractMaintenanceTypes, contractPeriodicities, contractPeriodPrints,
} from "./contractChargeSchema";
import type { ContractBilling } from "./contractChargeSchema";
import {
  addMonths, contractBillingOf, contractChargeStats, contractExpectedTotal, contractLabel, generateContractCharges, updateContractBilling,
} from "./contractCharges";
import {
  changeMaintenanceContractStatus, clientMaintenanceEquipment, maintenanceContractLifecycle, maintenanceContractStatus, plannedMaintenanceVisits,
  saveMaintenanceContract, saveMaintenanceEquipmentType,
} from "./maintenanceContracts";
import type { MaintenanceContractLifecycle } from "./maintenanceContracts";
import { prepareAttachment } from "./mobile";
import { errorMessage } from "./useDatabase";

type Commit = (update: (current: Database) => Database) => void;
type Editor = { mode: "new"; source?: MaintenanceContract } | { mode: "status"; item: MaintenanceContract; status: MaintenanceContractLifecycle };

const lifecycleOptions: MaintenanceContractLifecycle[] = ["Ativo", "Suspenso", "Isento", "Avaliação"];

export function MaintenanceContractsPanel({ data, commit, onSuccess }: {
  data: Database; commit: Commit; onSuccess: (message: string) => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [billingTarget, setBillingTarget] = useState<MaintenanceContract | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<MaintenanceContract | null>(null);
  const [generateFor, setGenerateFor] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Todos");
  const [newType, setNewType] = useState(false);
  const [typeName, setTypeName] = useState("");
  const [error, setError] = useState("");
  const today = localDay();
  const contracts = data.maintenanceContracts.filter((item) => {
    const current = maintenanceContractStatus(item, today);
    return (status === "Todos" || current === status) &&
      `${item.name} ${contractBillingOf(item).number} ${item.coverage} ${item.id} ${data.clients.find((client) => client.id === item.clientId)?.name ?? ""}`
        .toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
  });
  const allSelected = contracts.length > 0 && contracts.every((item) => selected.includes(item.id));

  function actions(item: MaintenanceContract): DropdownAction[] {
    const lifecycle = maintenanceContractLifecycle(item);
    const cancelled = lifecycle === "Cancelado";
    return [
      { label: "Editar cobrança", icon: Pencil, disabled: cancelled, onSelect: () => setBillingTarget(item) },
      { label: "Gerar cobranças", icon: CalendarPlus, disabled: lifecycle !== "Ativo", hint: lifecycle !== "Ativo" ? "somente ativos" : undefined,
        onSelect: () => setGenerateFor([item.id]) },
      { label: "Clonar contrato", icon: Copy, onSelect: () => setEditor({ mode: "new", source: item }) },
      { label: "Imprimir recibo", icon: Printer, onSelect: () => setReceiptTarget(item) },
      ...(cancelled ? [] : lifecycleOptions.filter((option) => option !== lifecycle).map((option, index): DropdownAction => ({
        label: option === "Ativo" ? "Reativar" : option === "Suspenso" ? "Suspender" : option === "Isento" ? "Marcar como isento" : "Marcar em avaliação",
        separatorBefore: index === 0, onSelect: () => setEditor({ mode: "status", item, status: option }),
      }))),
      ...(cancelled ? [] : [{ label: "Cancelar contrato", danger: true, onSelect: () => setEditor({ mode: "status", item, status: "Cancelado" }) } as DropdownAction]),
    ];
  }

  return <section className="module-section maintenance-contracts" aria-label="Contratos de manutenção">
    {error && <p className="error-message" role="alert">{error}</p>}
    <details className="secondary-disclosure">
      <summary>Gerenciar tipos de equipamento</summary>
      <section aria-label="Tipos de equipamento para contratos">
      <div className="section-heading"><h2>Tipos de equipamento cobertos</h2>
        <button className="button secondary" onClick={() => { setNewType(!newType); setError(""); }}>Cadastrar tipo</button>
      </div>
      {newType && <form className="row-actions" onSubmit={(event) => {
        event.preventDefault();
        try {
          const item: MaintenanceEquipmentType = { id: makeId(), name: typeName, active: true };
          commit((current) => saveMaintenanceEquipmentType(current, item));
          setTypeName(""); setNewType(false); setError("");
          onSuccess("Tipo de equipamento cadastrado.");
        } catch (cause) { setError(errorMessage(cause)); }
      }}>
        <label className="field">Novo tipo<input required maxLength={160} value={typeName} onChange={(event) => setTypeName(event.target.value)} /></label>
        <button className="button primary">Salvar tipo</button>
      </form>}
      <div className="row-actions">{data.maintenanceEquipmentTypes.map((item) => <span key={item.id} className="tag">
        {item.name}{item.active ? "" : " · Inativo"}
        {item.active && <button className="text-button" aria-label={`Inativar tipo ${item.name}`} onClick={() => {
          try {
            commit((current) => saveMaintenanceEquipmentType(current, { ...item, active: false }));
            onSuccess("Tipo inativado; contratos existentes preservados.");
          } catch (cause) { setError(errorMessage(cause)); }
        }}>Inativar</button>}
      </span>)}
      {!data.maintenanceEquipmentTypes.length && <p>Nenhum tipo cadastrado.</p>}</div>
    </section>
    </details>
    <div className="section-heading">
      <p>Cadastre a cobertura, o valor por período, a cobrança e o intervalo entre visitas. "Gerar cobranças" lança as contas a receber dos contratos ativos e, se configurado, a nota de serviço e a OS de cada mês. Ocorrências previstas geram alertas internos cinco dias antes.</p>
      <div className="row-actions">
        <button className="button secondary" disabled={!data.maintenanceContracts.length}
          onClick={() => setGenerateFor(selected.length ? selected : data.maintenanceContracts.map((item) => item.id))}>
          <CalendarPlus size={16} />{selected.length ? `Gerar cobranças (${selected.length})` : "Gerar cobranças"}</button>
        <button className="button primary" onClick={() => setEditor({ mode: "new" })}>Novo contrato</button>
      </div>
    </div>
    <div className="toolbar-filters">
      <label className="field">Buscar contrato<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="field">Situação<select value={status} onChange={(event) => setStatus(event.target.value)}>
        {["Todos", "Ativo", "Suspenso", "Isento", "Avaliação", "Cancelado", "Vencido", "Vigência futura"].map((value) => <option key={value}>{value}</option>)}
      </select></label>
    </div>
    <div className="table-scroll"><table>
      <thead><tr>
        <th><input type="checkbox" aria-label="Selecionar todos os contratos" checked={allSelected}
          onChange={(event) => setSelected(event.target.checked ? contracts.map((item) => item.id) : [])} /></th>
        <th>Contrato / cliente</th><th>Equipamentos cobertos</th><th>Valor / vencimento</th><th>Vigência / visitas</th><th>Parcelas pagas</th><th>Contas em aberto</th><th>Situação / histórico</th><th>Ações</th>
      </tr></thead>
      <tbody>{contracts.map((item) => {
        const billing = contractBillingOf(item);
        const stats = contractChargeStats(data, item);
        return <tr key={item.id}>
          <td><input type="checkbox" aria-label={`Selecionar ${item.name}`} checked={selected.includes(item.id)}
            onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></td>
          <td><strong>{contractLabel(item)}</strong><small>{data.clients.find((client) => client.id === item.clientId)?.name ?? "Cliente indisponível"}</small>
            <small>{item.coverage}</small>
            {item.signedAttachment && <small><a href={item.signedAttachment.data} download={item.signedAttachment.name}>
              Contrato assinado: {item.signedAttachment.name}</a></small>}
            <small>{item.id}</small></td>
          <td>{item.equipmentIds.map((id) => {
            const equipment = data.equipment.find((unit) => unit.id === id);
            return equipment ? `${equipment.assetCode ?? equipment.serial} · ${equipment.name}` : "Equipamento indisponível";
          }).join("; ")}</td>
          <td>{currency(item.monthlyAmount)}<small>{billing.periodicity} · dia {billing.dueDay}</small>
            <small>Previsto: {currency(contractExpectedTotal(item))}</small></td>
          <td>{displayDate(item.startsOn)} até {displayDate(item.endsOn)}<small>{intervalLabel(item)}</small>
            <small>Próximas visitas: {plannedMaintenanceVisits(item, today, item.endsOn < shiftDay(today, 365) ? item.endsOn : shiftDay(today, 365))
              .slice(0, 3).map(displayDate).join(", ") || "nenhuma"}</small></td>
          <td>{stats.paid}/{stats.installments}</td>
          <td>{stats.open}{stats.open > 0 && <small>{currency(stats.openAmount)}</small>}</td>
          <td>{maintenanceContractStatus(item, today)}<details><summary>Histórico ({item.events.length})</summary>
            <p>Cadastrado: {item.createdAt}</p>
            {item.events.map((event, index) => <p key={`${event.at}-${index}`}>{event.at} · {event.status} · {event.reason}</p>)}
          </details></td>
          <td><DropdownMenu accessibleLabel={`Mais ações: ${item.name}`} actions={actions(item)} /></td>
        </tr>;
      })}</tbody>
    </table>{!contracts.length && <Empty title="Nenhum contrato encontrado" />}</div>
    <p>Cobertura, valor e intervalo são preservados após o cadastro; a cobrança (vencimento, periodicidade, desconto, nota e OS) pode ser ajustada em "Editar cobrança". Para mudar a cobertura ou o valor, encerre este contrato e cadastre outro (use "Clonar contrato").</p>
    {editor && <ContractEditor data={data} editor={editor} onClose={() => setEditor(null)} onSave={(update) => {
      commit(update);
      setEditor(null);
      onSuccess("Contrato atualizado. Aguarde Sincronizado quando conectado.");
    }} />}
    {billingTarget && <Modal title={`Cobrança do contrato ${billingTarget.name}`} wide onClose={() => setBillingTarget(null)}>
      <BillingForm data={data} initial={contractBillingOf(billingTarget)} submitLabel="Salvar cobrança" onCancel={() => setBillingTarget(null)}
        onSubmit={(billing) => {
          commit((current) => updateContractBilling(current, billingTarget.id, billing));
          setBillingTarget(null);
          onSuccess("Dados de cobrança do contrato salvos.");
        }} />
    </Modal>}
    {generateFor && <GenerateChargesModal data={data} contractIds={generateFor} onClose={() => setGenerateFor(null)}
      onDone={(message) => { setGenerateFor(null); setSelected([]); onSuccess(message); }} commit={commit} />}
    {receiptTarget && <ReceiptModal data={data} contract={receiptTarget} onClose={() => setReceiptTarget(null)} />}
  </section>;
}

function GenerateChargesModal({ data, contractIds, commit, onClose, onDone }: {
  data: Database; contractIds: string[]; commit: Commit; onClose: () => void; onDone: (message: string) => void;
}) {
  const month = localDay().slice(0, 7);
  const [mode, setMode] = useState<"month" | "period">("month");
  const [from, setFrom] = useState(month);
  const [through, setThrough] = useState(addMonths(month, 2));
  const [error, setError] = useState("");
  const names = data.maintenanceContracts.filter((item) => contractIds.includes(item.id)).map((item) => item.name);
  return <Modal title="Gerar cobranças" onClose={onClose}>
    <div className="modal-body">
      {error && <p className="error-message" role="alert">{error}</p>}
      <p>{names.length === 1 ? `Contrato: ${names[0]}` : `${names.length} contratos selecionados`}. Somente contratos ativos e dentro da vigência geram cobranças; meses já cobrados são ignorados.</p>
      <fieldset className="row-actions"><legend>Gerar cobranças</legend>
        <label className="checkbox-field"><input type="radio" name="mode" checked={mode === "month"} onChange={() => setMode("month")} />Para o mês</label>
        <label className="checkbox-field"><input type="radio" name="mode" checked={mode === "period"} onChange={() => setMode("period")} />Por período</label>
      </fieldset>
      <div className="form-grid">
        <label className="field">{mode === "month" ? "Mês" : "De"}<input type="month" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        {mode === "period" && <label className="field">Até<input type="month" value={through} onChange={(event) => setThrough(event.target.value)} /></label>}
      </div>
    </div>
    <div className="modal-footer">
      <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
      <button type="button" className="button primary" onClick={() => {
        let summary = { created: 0, skipped: [] as string[] };
        try {
          commit((current) => {
            const result = generateContractCharges(current, { from, through: mode === "month" ? from : through, contractIds });
            summary = { created: result.created, skipped: result.skipped };
            return result.data;
          });
        } catch (cause) { setError(errorMessage(cause)); return; }
        if (!summary.created) { setError(summary.skipped.length ? summary.skipped.join(" ") : "Nenhuma cobrança nova para o período."); return; }
        onDone(`${summary.created} cobrança${summary.created === 1 ? " gerada" : "s geradas"}. Confira em Vendas › Cobranças.${summary.skipped.length ? ` Ignorados: ${summary.skipped.join(" ")}` : ""}`);
      }}>Gerar cobranças</button>
    </div>
  </Modal>;
}

function ReceiptModal({ data, contract, onClose }: { data: Database; contract: MaintenanceContract; onClose: () => void }) {
  const [date, setDate] = useState(localDay());
  const [description, setDescription] = useState(`Referente ao contrato ${contractLabel(contract)}`);
  const [ready, setReady] = useState(false);
  const client = data.clients.find((item) => item.id === (contractBillingOf(contract).billingClientId || contract.clientId));
  if (!ready) return <Modal title="Imprimir recibo" onClose={onClose}>
    <div className="modal-body"><div className="form-grid">
      <label className="field">Data<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label className="field full">Descrição<textarea rows={3} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    </div></div>
    <div className="modal-footer">
      <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
      <button type="button" className="button primary" onClick={() => setReady(true)}>Gerar recibo</button>
    </div>
  </Modal>;
  return createPortal(<Modal title="Recibo" wide onClose={onClose}>
    <div className="modal-body document-body">
      <div className="document-brand">
        {data.settings.logo ? <img className="brand-image compact" src={data.settings.logo} alt={data.settings.company} /> : <strong>{data.settings.company}</strong>}
        <span>RECIBO</span>
      </div>
      <div className="detail-heading"><h2>Recibo · {currency(contract.monthlyAmount)}</h2><span>{displayDate(date)}</span></div>
      <p>Recebemos de <strong>{client?.name ?? "—"}</strong>{client?.document ? ` (${client.document})` : ""} a importância de <strong>{currency(contract.monthlyAmount)}</strong>.</p>
      <p>{description}</p>
      <p style={{ marginTop: 48 }}>______________________________<br />{data.settings.company}</p>
    </div>
    <div className="modal-footer">
      <button type="button" className="button secondary" onClick={onClose}>Fechar</button>
      <button type="button" className="button primary" onClick={() => window.print()}><Printer size={16} />Imprimir</button>
    </div>
  </Modal>, document.body);
}

function BillingFields({ data, billing, onChange }: { data: Database; billing: ContractBilling; onChange: (billing: ContractBilling) => void }) {
  const set = (patch: Partial<ContractBilling>) => onChange({ ...billing, ...patch });
  const number = (value: string) => Math.max(0, Number(value) || 0);
  return <div className="form-grid">
    <label className="field">Número do contrato<input maxLength={40} value={billing.number} onChange={(event) => set({ number: event.target.value })} /></label>
    <label className="field">Cliente de cobrança<select value={billing.billingClientId} onChange={(event) => set({ billingClientId: event.target.value })}>
      <option value="">O mesmo do contrato</option>
      {data.clients.filter((client) => client.active || client.id === billing.billingClientId).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
    </select></label>
    <label className="field">Data do contrato<input type="date" value={billing.contractDate} onChange={(event) => set({ contractDate: event.target.value })} /></label>
    <label className="field">Data base da cobrança<input type="date" value={billing.baseDate} onChange={(event) => set({ baseDate: event.target.value })} /></label>
    <label className="field">Periodicidade<select value={billing.periodicity} onChange={(event) => set({ periodicity: event.target.value })}>
      {contractPeriodicities.map(([name]) => <option key={name}>{name}</option>)}</select></label>
    <label className="field">Vencimento<select value={billing.dueRule} onChange={(event) => set({ dueRule: event.target.value as ContractBilling["dueRule"] })}>
      {contractDueRules.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
    <label className="field">Dia do vencimento<input type="number" min="1" max="31" value={billing.dueDay}
      onChange={(event) => set({ dueDay: Math.min(31, Math.max(1, Math.round(Number(event.target.value) || 1))) })} />
      <small>Se o dia não existir no mês, usa o último dia.</small></label>
    <label className="field">Imprimir período<select value={billing.periodPrint} onChange={(event) => set({ periodPrint: event.target.value as ContractBilling["periodPrint"] })}>
      {contractPeriodPrints.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
    <label className="field">Tipo de manutenção<select value={billing.maintenanceType} onChange={(event) => set({ maintenanceType: event.target.value as ContractBilling["maintenanceType"] })}>
      {contractMaintenanceTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label className="field">Categoria<input maxLength={120} value={billing.category} onChange={(event) => set({ category: event.target.value })} /></label>
    <label className="field">Forma de pagamento<select value={billing.paymentMethod} onChange={(event) => set({ paymentMethod: event.target.value === "Pix" ? "Pix" : "Boleto" })}>
      <option>Boleto</option><option>Pix</option></select></label>
    <label className="field">Conta financeira<select value={billing.accountId} onChange={(event) => set({ accountId: event.target.value })}>
      <option value="">Primeira conta ativa</option>
      {data.finance.accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
    </select></label>
    <label className="field">Desconto %<input type="number" min="0" max="100" step="0.01" value={billing.discountRate} onChange={(event) => set({ discountRate: Math.min(100, number(event.target.value)) })} /></label>
    <label className="field">Desconto R$<input type="number" min="0" step="0.01" value={(billing.discountAmount / 100).toFixed(2)}
      onChange={(event) => set({ discountAmount: Math.round(number(event.target.value) * 100) })} /></label>
    <label className="field">Desconto até<input type="month" value={billing.discountUntil} onChange={(event) => set({ discountUntil: event.target.value })} /></label>
    <label className="field">Vendedor<input maxLength={160} value={billing.seller} onChange={(event) => set({ seller: event.target.value })} /></label>
    <label className="field">Comissão %<input type="number" min="0" max="100" step="0.01" value={billing.commissionRate} onChange={(event) => set({ commissionRate: Math.min(100, number(event.target.value)) })} /></label>
    <label className="field">Parcelas com comissão<input type="number" min="0" max="999" value={billing.commissionInstallments}
      onChange={(event) => set({ commissionInstallments: Math.min(999, Math.round(number(event.target.value))) })} /></label>
    <label className="checkbox-field full"><input type="checkbox" checked={billing.generateServiceOrder} onChange={(event) => set({ generateServiceOrder: event.target.checked })} />Gerar ordem de serviço a cada cobrança</label>
    <label className="checkbox-field full"><input type="checkbox" checked={billing.generateNfse} onChange={(event) => set({ generateNfse: event.target.checked })} />Gerar nota de serviço (NFS-e) a cada cobrança</label>
    {billing.generateNfse && <>
      <label className="field">Código do serviço<input maxLength={20} value={billing.serviceCode} onChange={(event) => set({ serviceCode: event.target.value })} /></label>
      <label className="field">% ISS<input type="number" min="0" max="100" step="0.01" value={billing.issRate} onChange={(event) => set({ issRate: Math.min(100, number(event.target.value)) })} /></label>
      <label className="checkbox-field"><input type="checkbox" checked={billing.discountIss} onChange={(event) => set({ discountIss: event.target.checked })} />Descontar ISS do total</label>
      <label className="field">Reter IR<select value={billing.irMode} onChange={(event) => set({ irMode: event.target.value as ContractBilling["irMode"] })}>
        <option value="config">Conforme configuração</option><option value="yes">Sim</option><option value="no">Não</option></select></label>
      <label className="field full">Descrição do serviço na nota<textarea rows={3} maxLength={2000} value={billing.nfseDescription}
        onChange={(event) => set({ nfseDescription: event.target.value })} /></label>
    </>}
    <label className="field full">Observações<textarea rows={2} maxLength={2000} value={billing.notes} onChange={(event) => set({ notes: event.target.value })} /></label>
  </div>;
}

function BillingForm({ data, initial, submitLabel, onSubmit, onCancel }: {
  data: Database; initial: ContractBilling; submitLabel: string; onSubmit: (billing: ContractBilling) => void; onCancel: () => void;
}) {
  const [billing, setBilling] = useState(initial);
  const [error, setError] = useState("");
  return <form onSubmit={(event) => {
    event.preventDefault();
    try { onSubmit(billing); } catch (cause) { setError(errorMessage(cause)); }
  }}>
    <div className="modal-body">
      {error && <p className="error-message" role="alert">{error}</p>}
      <BillingFields data={data} billing={billing} onChange={setBilling} />
    </div>
    <div className="modal-footer">
      <button type="button" className="button secondary" onClick={onCancel}>Cancelar</button>
      <button className="button primary"><FileText size={16} />{submitLabel}</button>
    </div>
  </form>;
}

function intervalLabel(item: MaintenanceContract) {
  return item.visitInterval.kind === "Dias" ? `A cada ${item.visitInterval.days} dias` : item.visitInterval.kind;
}

function ContractEditor({ data, editor, onClose, onSave }: {
  data: Database; editor: Editor; onClose: () => void; onSave: Commit;
}) {
  const source = editor.mode === "new" ? editor.source : undefined;
  const [clientId, setClientId] = useState(editor.mode === "new" ? source?.clientId ?? "" : editor.item.clientId);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>(source?.equipmentIds ?? []);
  const [visitInterval, setVisitInterval] = useState<MaintenanceContract["visitInterval"]>(source?.visitInterval ?? { kind: "Mensal" });
  const [billing, setBilling] = useState<ContractBilling>(() => contractBilling(source ? { ...contractBillingOf(source), number: "" } : undefined));
  const [signedAttachment, setSignedAttachment] = useState<Attachment | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [error, setError] = useState("");
  const clientEquipment = clientMaintenanceEquipment(data, clientId);
  const title = editor.mode === "new" ? source ? `Clonar contrato ${source.name}` : "Cadastrar contrato de manutenção" : "Alterar situação do contrato";
  return <Modal title={title} onClose={onClose} wide><form onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget), text = (key: string) => String(form.get(key) ?? "").trim();
    try {
      if (editor.mode === "new") {
        const equipmentIds = form.getAll("equipmentIds").map(String);
        if (!equipmentIds.length) throw new Error("Selecione ao menos uma unidade/equipamento vinculado ao cliente.");
        const contract: MaintenanceContract = {
          id: makeId(), name: text("name"), clientId, equipmentTypeIds: [], equipmentIds, coverage: text("coverage"),
          startsOn: text("startsOn"), endsOn: text("endsOn"), monthlyAmount: Math.round(Number(text("monthlyAmount")) * 100),
          visitInterval, createdAt: new Date().toISOString(), events: [], billing,
          ...(signedAttachment ? { signedAttachment } : {}),
        };
        onSave((current) => updateContractBilling(saveMaintenanceContract(current, contract, text("confirmed") === "on"), contract.id, billing));
      } else onSave((current) => changeMaintenanceContractStatus(current, editor.item, editor.status, text("reason"), text("confirmed") === "on"));
    } catch (cause) { setError(errorMessage(cause)); }
  }}>
    <div className="modal-body"><div className="form-grid">
      {error && <p className="error-message full" role="alert">{error}</p>}
      {editor.mode === "new" ? <>
        <label className="field">Nome / referência *
          <input name="name" required maxLength={160} defaultValue={source ? `${source.name} (cópia)`.slice(0, 160) : undefined} />
        </label>
        <label className="field">Cliente *
          <select required value={clientId} onChange={(event) => {
            const nextClientId = event.target.value;
            setClientId(nextClientId);
            setSelectedEquipmentIds(clientMaintenanceEquipment(data, nextClientId).map((unit) => unit.id));
          }}>
            <option value="">Selecione um cliente</option>
            {data.clients.filter((client) => client.active).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <fieldset className="full"><legend>Equipamentos vinculados ao cliente *</legend>
          {!clientId ? <p>Selecione primeiro o cliente.</p> : clientEquipment.map((unit) =>
            <label key={unit.id} className="checkbox-field"><input type="checkbox" name="equipmentIds" value={unit.id}
              checked={selectedEquipmentIds.includes(unit.id)}
              onChange={(event) => setSelectedEquipmentIds((current) => event.target.checked
                ? [...current, unit.id]
                : current.filter((id) => id !== unit.id))} />
              {unit.assetCode ?? unit.serial} · {unit.name}</label>)}
          {clientId && !clientEquipment.length && <p>Este cliente ainda não tem unidades cadastradas.</p>}
          {clientEquipment.length > 0 &&
            <small>As unidades já vinculadas no cadastro do cliente foram selecionadas automaticamente. Desmarque as que não farão parte deste contrato.</small>}
        </fieldset>
        <label className="field">Início da vigência *<input type="date" name="startsOn" required defaultValue={source?.startsOn} /></label>
        <label className="field">Fim da vigência *<input type="date" name="endsOn" required defaultValue={source?.endsOn} /></label>
        <label className="field">Valor por período (R$) *
          <input type="number" name="monthlyAmount" min="0.01" max="1000000" step="0.01" required
            defaultValue={source ? (source.monthlyAmount / 100).toFixed(2) : undefined} />
        </label>
        <label className="field">Intervalo entre atendimentos *
          <select value={visitInterval.kind} onChange={(event) => setVisitInterval(
            event.target.value === "Dias" ? { kind: "Dias", days: 30 } :
              { kind: event.target.value as "Quinzenal" | "Mensal" | "Semestral" })}>
            <option value="Quinzenal">Quinzenal (15 dias)</option><option value="Mensal">Mensal</option>
            <option value="Semestral">Semestral (6 meses)</option><option value="Dias">Quantidade de dias</option>
          </select>
        </label>
        {visitInterval.kind === "Dias" && <label className="field">Quantidade de dias *
          <input type="number" min="1" max="3650" step="1" value={visitInterval.days}
            onChange={(event) => setVisitInterval({ kind: "Dias", days: Number(event.target.value) })} />
        </label>}
        <label className="field full">Cobertura / escopo *
          <textarea name="coverage" rows={4} maxLength={5000} required defaultValue={source?.coverage} />
        </label>
        <details className="full secondary-disclosure" open={Boolean(source)}>
          <summary>Cobrança (periodicidade, vencimento, desconto, nota de serviço e OS)</summary>
          <BillingFields data={data} billing={billing} onChange={setBilling} />
        </details>
        <div className="field full">
          <span>Anexo do contrato assinado (opcional)</span>
          <label className="button secondary">
            <Paperclip size={16} />{signedAttachment ? "Trocar arquivo assinado" : "Anexar PDF ou imagem"}
            <input className="file-input" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={uploadingAttachment}
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                setError("");
                if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type)) {
                  setError("O contrato assinado deve ser PDF, PNG, JPG ou WebP.");
                  return;
                }
                setUploadingAttachment(true);
                try {
                  setSignedAttachment(await prepareAttachment(file));
                } catch (cause) {
                  setError(errorMessage(cause));
                } finally {
                  setUploadingAttachment(false);
                }
              }} />
          </label>
          {signedAttachment
            ? <div className="attachment-row"><Paperclip size={18} /><span>{signedAttachment.name}<small>{Math.ceil(signedAttachment.size / 1000)} KB</small></span>
              <button type="button" className="icon-button danger" aria-label="Remover contrato assinado"
                onClick={() => setSignedAttachment(null)}><Trash2 size={17} /></button></div>
            : <small>PDF ou imagem de até 500 KB. O arquivo ficará salvo com o cadastro do contrato.</small>}
        </div>
      </> : <>
        <p className="full">{editor.item.name} · {editor.status === "Cancelado" ? "O cancelamento é definitivo." : `Nova situação: ${editor.status}.`}</p>
        <label className="field full">Motivo *
          <textarea name="reason" rows={3} minLength={5} maxLength={1000} required />
        </label>
      </>}
      <label className="checkbox-field full"><input type="checkbox" name="confirmed" required />Confirmo os dados e a alteração solicitada.</label>
    </div></div>
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Voltar</button>
      <button className="button primary" disabled={uploadingAttachment}>{editor.mode === "new" ? "Cadastrar contrato" : "Confirmar alteração"}</button></div>
  </form></Modal>;
}
