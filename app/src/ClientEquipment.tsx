import { useState } from "react";
import { Modal } from "./components";
import { displayDate, getOrderDetails } from "./domain";
import type { Client, Database } from "./domain";
import { clientEquipmentHistory, linkClientEquipment } from "./equipmentCatalogData";
import { questionAnswerText } from "./questionnaireAnswers";
import { errorMessage } from "./useDatabase";

export function ClientEquipment({ client, data, commit, onClose, onEdit, onCreateTask, onOpenOrder }: {
  client: Client;
  data: Database;
  commit: (update: (current: Database) => Database) => void;
  onClose: () => void;
  onEdit: () => void;
  onCreateTask: (equipmentId: string) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const [linking, setLinking] = useState(false);
  const [brandId, setBrandId] = useState("");
  const [line, setLine] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [historyId, setHistoryId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const units = data.equipment.filter((item) => item.clientId === client.id);
  const models = data.equipmentModels.filter((model) => model.brandId === brandId && !model.archived &&
    data.equipmentBrands.some((brand) => brand.id === brandId && !brand.archived));
  const lines = [...new Set(models.map((model) => model.line ?? ""))].sort();
  const equipment = units.find((item) => item.id === historyId);
  const history = equipment ? clientEquipmentHistory(data, client.id, equipment.id) : [];
  return <Modal title={`Cadastro do cliente · ${client.name}`} onClose={onClose} wide>
    <div className="modal-body client-equipment">
      <section>
        <h3>{client.name}</h3>
        <p>{client.document || "Documento não informado"}</p>
        <p>{client.address || "Endereço não informado"}</p>
        <p>{[client.phone, client.email].filter(Boolean).join(" · ")}</p>
      </section>
      <div className="row-actions">
        <button className="button secondary" onClick={onEdit}>Editar dados do cliente</button>
        <button className="button primary" disabled={!client.active} onClick={() => { setLinking(!linking); setError(""); setNotice(""); }}>Vincular equipamento</button>
      </div>
      {error && <p role="alert" className="error-message">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {linking && <form className="equipment-link-form" onSubmit={(event) => {
        event.preventDefault();
        setError(""); setNotice("");
        try {
          const selections = Object.entries(quantities).map(([modelId, quantity]) => ({ modelId, quantity }));
          if (!selections.length) throw new Error("Selecione pelo menos um equipamento e informe a quantidade.");
          commit((current) => linkClientEquipment(current, client.id, selections));
          setNotice(`${selections.reduce((sum, item) => sum + item.quantity, 0)} equipamento(s) vinculado(s), cada um com um código único.`);
          setQuantities({}); setLinking(false);
        } catch (cause) { setError(errorMessage(cause)); }
      }}>
        <h3>Vincular equipamentos do catálogo</h3>
        <p>Escolha marca e linha, selecione os modelos e informe as quantidades. Cada unidade aparecerá separadamente na lista. O mesmo modelo pode ser utilizado em vários clientes.</p>
        <div className="form-grid">
          <label className="field">Marca para vincular *
            <select required value={brandId} onChange={(event) => { setBrandId(event.target.value); setLine(""); setQuantities({}); }}>
              <option value="">Selecione uma marca</option>
              {data.equipmentBrands.filter((brand) => !brand.archived).map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
          </label>
          <label className="field">Linha para vincular *
            <select required value={line} onChange={(event) => { setLine(event.target.value); setQuantities({}); }}>
              <option value="">Selecione uma linha</option>
              {lines.map((value) => <option key={value} value={JSON.stringify(value)}>{value || "Sem linha cadastrada"}</option>)}
            </select>
          </label>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>Selecionar</th><th>Equipamento</th><th>Categoria</th><th>Quantidade</th></tr></thead>
          <tbody>{models.filter((model) => line && JSON.stringify(model.line ?? "") === line).map((model) => <tr key={model.id}>
            <td><input type="checkbox" aria-label={`Selecionar ${model.name}`} checked={model.id in quantities}
              onChange={(event) => {
                if (event.target.checked) setQuantities((current) => ({ ...current, [model.id]: 1 }));
                else setQuantities((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== model.id)));
              }} /></td>
            <td>{model.name}</td><td>{model.category || "—"}</td>
            <td><input type="number" aria-label={`Quantidade de ${model.name}`} min={1} max={10000} step={1}
              required disabled={!(model.id in quantities)} value={quantities[model.id] ?? 1}
              onChange={(event) => setQuantities((current) => ({ ...current, [model.id]: Number(event.target.value) }))} /></td>
          </tr>)}</tbody>
        </table></div>
        {!models.length && <p>Cadastre modelos ativos desta marca em Equipamentos.</p>}
        <div className="row-actions">
          <button type="button" className="button secondary" onClick={() => setLinking(false)}>Cancelar vínculo</button>
          <button className="button primary">Confirmar vínculo</button>
        </div>
      </form>}
      <section>
        <h3>Equipamentos vinculados · {units.length} unidade(s)</h3>
        <p>O código identifica a unidade no cliente. Vincule a unidade à tarefa para registrar o atendimento no histórico correto.</p>
        <div className="table-scroll"><table>
          <thead><tr><th>Código / identificação</th><th>Marca</th><th>Linha</th><th>Equipamento</th><th>Ações</th></tr></thead>
          <tbody>{units.map((unit) => <tr key={unit.id}>
            <td className="equipment-code">{unit.assetCode ?? unit.serial}</td>
            <td>{unit.model?.brand || "Não informada"}</td><td>{unit.model?.line || "Sem linha"}</td><td>{unit.name}</td>
            <td><div className="row-actions">
              <button className="text-button" aria-label={`Histórico de ${unit.assetCode ?? unit.serial}`} onClick={() => setHistoryId(unit.id)}>Histórico</button>
              <button className="text-button" aria-label={`Criar tarefa para ${unit.assetCode ?? unit.serial}`} onClick={() => onCreateTask(unit.id)} disabled={!client.active}>Criar tarefa</button>
            </div></td>
          </tr>)}</tbody>
        </table></div>
        {!units.length && <p>Nenhum equipamento vinculado a este cliente.</p>}
      </section>
      {equipment && <section aria-label="Histórico do equipamento" className="equipment-history">
        <h3>Histórico · {equipment.name} · {equipment.assetCode ?? equipment.serial}</h3>
        <p>São exibidas as tarefas que citam esta unidade como principal ou associada, inclusive as arquivadas. Relatos gerais da tarefa podem abranger outros equipamentos.</p>
        {!history.length && <p>Nenhuma tarefa registrada para este equipamento.</p>}
        {history.map((order) => {
          const details = getOrderDetails(order);
          const lists = details.checklists.filter((checklist) => !checklist.equipmentId || checklist.equipmentId === equipment.id);
          return <article key={order.id}>
            <h4><button className="text-button" onClick={() => onOpenOrder(order.id)}>{order.code} · {order.title}</button></h4>
            <p>{displayDate(order.date)} · {order.time} · {order.technician} · {order.type} · {order.status}{details.archived ? " · Arquivada" : ""}</p>
            <p><strong>Solicitação:</strong> {order.notes || "Não informada."}</p>
            <p className="preserve-lines"><strong>{order.status === "Finalizada" ? "Relato registrado na tarefa finalizada" : "Relato em andamento (tarefa não finalizada)"}:</strong> {details.report || "Nenhuma manutenção descrita no relato."}</p>
            {lists.map((list) => <div key={list.id}>
              <strong>{list.title} · {list.equipmentId ? "Deste equipamento" : "Geral da tarefa"}</strong>
              {list.questions.map((question) => {
                const answer = questionAnswerText(question, details);
                return answer.trim() ? <p key={question.id}>{question.label}: {answer}</p> : null;
              })}
            </div>)}
          </article>;
        })}
      </section>}
    </div>
  </Modal>;
}
