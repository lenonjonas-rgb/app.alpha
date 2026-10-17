import { Paperclip, Trash2 } from "lucide-react";
import { useState } from "react";
import { Empty, Modal } from "./components";
import { DropdownMenu } from "./DropdownMenu";
import { currency, displayDate, localDay, makeId, shiftDay } from "./domain";
import type { Attachment, Database, MaintenanceContract, MaintenanceEquipmentType } from "./domain";
import { changeMaintenanceContractStatus, clientMaintenanceEquipment, maintenanceContractLifecycle, maintenanceContractStatus, plannedMaintenanceVisits, saveMaintenanceContract, saveMaintenanceEquipmentType } from "./maintenanceContracts";
import { prepareAttachment } from "./mobile";
import { errorMessage } from "./useDatabase";

type Commit = (update: (current: Database) => Database) => void;
type Editor = { mode: "new" } | { mode: "status"; item: MaintenanceContract; status: "Ativo" | "Suspenso" | "Cancelado" };

export function MaintenanceContractsPanel({ data, commit, onSuccess }: {
  data: Database; commit: Commit; onSuccess: (message: string) => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Todos");
  const [newType, setNewType] = useState(false);
  const [typeName, setTypeName] = useState("");
  const [error, setError] = useState("");
  const today = localDay();
  const contracts = data.maintenanceContracts.filter((item) => {
    const current = maintenanceContractStatus(item, today);
    return (status === "Todos" || current === status) &&
      `${item.name} ${item.coverage} ${item.id} ${data.clients.find((client) => client.id === item.clientId)?.name ?? ""}`
        .toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
  });
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
      <p>Cadastre a cobertura, o valor mensal e o intervalo entre visitas. Ocorrências previstas geram alertas internos cinco dias antes; a equipe agenda cada visita manualmente. O valor só entra na OS se o contrato for selecionado nela.</p>
      <button className="button primary" onClick={() => setEditor({ mode: "new" })}>Novo contrato</button>
    </div>
    <div className="toolbar-filters">
      <label className="field">Buscar contrato<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="field">Situação<select value={status} onChange={(event) => setStatus(event.target.value)}>
        {["Todos", "Ativo", "Suspenso", "Cancelado", "Vencido", "Vigência futura"].map((value) => <option key={value}>{value}</option>)}
      </select></label>
    </div>
    <div className="table-scroll"><table>
      <thead><tr><th>Contrato / cliente</th><th>Equipamentos cobertos</th><th>Valor mensal</th><th>Vigência / visitas</th><th>Situação / histórico</th><th>Ações</th></tr></thead>
      <tbody>{contracts.map((item) => {
        const lifecycle = maintenanceContractLifecycle(item);
        return <tr key={item.id}>
          <td><strong>{item.name}</strong><small>{data.clients.find((client) => client.id === item.clientId)?.name ?? "Cliente indisponível"}</small>
            <small>{item.coverage}</small>
            {item.signedAttachment && <small><a href={item.signedAttachment.data} download={item.signedAttachment.name}>
              Contrato assinado: {item.signedAttachment.name}</a></small>}
            <small>{item.id}</small></td>
          <td>{item.equipmentIds.map((id) => {
            const equipment = data.equipment.find((unit) => unit.id === id);
            return equipment ? `${equipment.assetCode ?? equipment.serial} · ${equipment.name}` : "Equipamento indisponível";
          }).join("; ")}</td>
          <td>{currency(item.monthlyAmount)}</td>
          <td>{displayDate(item.startsOn)} até {displayDate(item.endsOn)}<small>{intervalLabel(item)}</small>
            <small>Próximas visitas: {plannedMaintenanceVisits(item, today, item.endsOn < shiftDay(today, 365) ? item.endsOn : shiftDay(today, 365))
              .slice(0, 3).map(displayDate).join(", ") || "nenhuma"}</small></td>
          <td>{maintenanceContractStatus(item, today)}<details><summary>Histórico ({item.events.length})</summary>
            <p>Cadastrado: {item.createdAt}</p>
            {item.events.map((event, index) => <p key={`${event.at}-${index}`}>{event.at} · {event.status} · {event.reason}</p>)}
          </details></td>
          <td>{lifecycle !== "Cancelado" && <DropdownMenu
            accessibleLabel={`Mais ações: ${item.name}`} actions={[
              { label: lifecycle === "Ativo" ? "Suspender" : "Reativar",
                onSelect: () => setEditor({ mode: "status", item, status: lifecycle === "Ativo" ? "Suspenso" : "Ativo" }) },
              { label: "Cancelar contrato", danger: true,
                onSelect: () => setEditor({ mode: "status", item, status: "Cancelado" }) },
            ]} />}</td>
        </tr>;
      })}</tbody>
    </table>{!contracts.length && <Empty title="Nenhum contrato encontrado" />}</div>
    <p>Os dados de cobertura, valor e intervalo são preservados após o cadastro. Para alterar condições, encerre este contrato e cadastre outro; versionamento, reajustes, renovações, OS e cobranças automáticas continuam fora desta etapa.</p>
    {editor && <ContractEditor data={data} editor={editor} onClose={() => setEditor(null)} onSave={(update) => {
      commit(update);
      setEditor(null);
      onSuccess("Contrato atualizado. Aguarde Sincronizado quando conectado.");
    }} />}
  </section>;
}

function intervalLabel(item: MaintenanceContract) {
  return item.visitInterval.kind === "Dias" ? `A cada ${item.visitInterval.days} dias` : item.visitInterval.kind;
}

function ContractEditor({ data, editor, onClose, onSave }: {
  data: Database; editor: Editor; onClose: () => void; onSave: Commit;
}) {
  const [clientId, setClientId] = useState(editor.mode === "new" ? "" : editor.item.clientId);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);
  const [visitInterval, setVisitInterval] = useState<MaintenanceContract["visitInterval"]>({ kind: "Mensal" });
  const [signedAttachment, setSignedAttachment] = useState<Attachment | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [error, setError] = useState("");
  const clientEquipment = clientMaintenanceEquipment(data, clientId);
  const title = editor.mode === "new" ? "Cadastrar contrato de manutenção" : "Alterar situação do contrato";
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
          visitInterval, createdAt: new Date().toISOString(), events: [],
          ...(signedAttachment ? { signedAttachment } : {}),
        };
        onSave((current) => saveMaintenanceContract(current, contract, text("confirmed") === "on"));
      } else onSave((current) => changeMaintenanceContractStatus(current, editor.item, editor.status, text("reason"), text("confirmed") === "on"));
    } catch (cause) { setError(errorMessage(cause)); }
  }}>
    <div className="modal-body"><div className="form-grid">
      {error && <p className="error-message full" role="alert">{error}</p>}
      {editor.mode === "new" ? <>
        <label className="field">Nome / referência *
          <input name="name" required maxLength={160} />
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
        <label className="field">Início da vigência *<input type="date" name="startsOn" required /></label>
        <label className="field">Fim da vigência *<input type="date" name="endsOn" required /></label>
        <label className="field">Valor mensal do contrato (R$) *
          <input type="number" name="monthlyAmount" min="0.01" max="1000000" step="0.01" required />
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
          <textarea name="coverage" rows={4} maxLength={5000} required />
        </label>
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
