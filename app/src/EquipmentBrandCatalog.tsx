import { useState } from "react";
import { Modal } from "./components";
import { makeId } from "./domain";
import type { Database, EquipmentBrand, EquipmentModel } from "./domain";
import { saveEquipmentBrand, saveEquipmentModel } from "./equipmentCatalogData";
import { errorMessage } from "./useDatabase";

export function EquipmentBrandCatalog({ data, commit }: {
  data: Database; commit: (update: (data: Database) => Database) => void;
}) {
  const [brandId, setBrandId] = useState("");
  const [brandDraft, setBrandDraft] = useState<EquipmentBrand | null>(null);
  const [modelDraft, setModelDraft] = useState<EquipmentModel | null>(null);
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");
  const brand = data.equipmentBrands.find((item) => item.id === brandId);
  function act(update: (current: Database) => Database) {
    try { commit(update); setError(""); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
  }
  return <section className="equipment-brand-catalog">
    <div className="section-heading">
      <h2>Catálogo de marcas e modelos</h2>
      <button className="button secondary" onClick={() => { setError(""); setBrandDraft({ id: makeId(), name: "", archived: false }); }}>Nova marca</button>
    </div>
    <p>Cadastre a marca e, dentro dela, seus modelos. O catálogo é independente das unidades dos clientes e seu uso é opcional.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    <label className="checkbox-field"><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setBrandId(""); }} />Mostrar marcas arquivadas</label>
    <label className="field">Marca do catálogo
      <select value={brandId} onChange={(event) => setBrandId(event.target.value)}>
        <option value="">Selecione uma marca para cadastrar ou consultar modelos</option>
        {data.equipmentBrands.filter((item) => item.archived === archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    {brand && <>
      <div className="row-actions">
        <button className="button secondary" onClick={() => { setError(""); setBrandDraft({ ...brand }); }}>Editar marca</button>
        <button className="button secondary" onClick={() => {
          if (act((current) => saveEquipmentBrand(current, { ...brand, archived: !brand.archived })))
            setArchived(!brand.archived);
        }}>{brand.archived ? "Restaurar marca" : "Arquivar marca"}</button>
        {!brand.archived && <button className="button primary" onClick={() => { setError(""); setModelDraft({ id: makeId(), brandId: brand.id, name: "", line: "", category: "", notes: "", archived: false }); }}>Novo modelo em {brand.name}</button>}
      </div>
      <div className="table-scroll"><table>
        <thead><tr><th>Modelo</th><th>Linha</th><th>Categoria</th><th>Observações</th><th>Ações</th></tr></thead>
        <tbody>{data.equipmentModels.filter((item) => item.brandId === brand.id).map((model) => <tr key={model.id}>
          <td>{model.name}{model.archived ? " (arquivado)" : ""}</td><td>{model.line || "Sem linha"}</td><td>{model.category || "—"}</td><td className="preserve-lines">{model.notes || "—"}</td>
          <td>{!brand.archived && <>
            <button className="text-button" onClick={() => { setError(""); setModelDraft({ ...model }); }}>Editar {model.name}</button>
            <button className="text-button" onClick={() => act((current) => saveEquipmentModel(current, { ...model, archived: !model.archived }))}>{model.archived ? "Restaurar" : "Arquivar"} {model.name}</button>
          </>}</td>
        </tr>)}</tbody>
      </table></div>
      {!data.equipmentModels.some((item) => item.brandId === brand.id) && <p>Nenhum modelo cadastrado nesta marca.</p>}
    </>}
    {brandDraft && <Modal title={data.equipmentBrands.some((item) => item.id === brandDraft.id) ? "Editar marca" : "Nova marca"} onClose={() => setBrandDraft(null)}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (act((current) => saveEquipmentBrand(current, brandDraft))) { setBrandId(brandDraft.id); setArchived(brandDraft.archived); setBrandDraft(null); }
      }}>
        <div className="modal-body">
          {error && <p className="error-message" role="alert">{error}</p>}
          <label className="field">Nome da marca *<input autoFocus required maxLength={160} value={brandDraft.name} onChange={(event) => setBrandDraft({ ...brandDraft, name: event.target.value })} /></label>
        </div>
        <footer className="modal-footer"><button type="button" className="button secondary" onClick={() => setBrandDraft(null)}>Cancelar</button><button className="button primary">Salvar marca</button></footer>
      </form>
    </Modal>}
    {modelDraft && <Modal title={`Modelo de ${brand?.name ?? ""}`} onClose={() => setModelDraft(null)}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (act((current) => saveEquipmentModel(current, modelDraft))) setModelDraft(null);
      }}>
        <div className="modal-body form-grid">
          {error && <p className="error-message full" role="alert">{error}</p>}
          <label className="field full">Nome do modelo *<input autoFocus required maxLength={160} value={modelDraft.name} onChange={(event) => setModelDraft({ ...modelDraft, name: event.target.value })} /></label>
          <label className="field full">Linha do modelo
            <input aria-label="Linha do modelo" list="equipment-model-lines" maxLength={200} value={modelDraft.line ?? ""} onChange={(event) => setModelDraft({ ...modelDraft, line: event.target.value })} />
            <datalist id="equipment-model-lines">{[...new Set(data.equipmentModels.filter((item) => item.brandId === modelDraft.brandId).map((item) => item.line).filter(Boolean))].map((line) => <option key={line} value={line} />)}</datalist>
            <small>Ex.: Cardio. Digite uma linha ou escolha uma já utilizada nesta marca.</small>
          </label>
          <label className="field full">Categoria do modelo<input maxLength={200} value={modelDraft.category} onChange={(event) => setModelDraft({ ...modelDraft, category: event.target.value })} /></label>
          <label className="field full">Observações do modelo<textarea maxLength={3000} value={modelDraft.notes} onChange={(event) => setModelDraft({ ...modelDraft, notes: event.target.value })} /></label>
        </div>
        <footer className="modal-footer"><button type="button" className="button secondary" onClick={() => setModelDraft(null)}>Cancelar</button><button className="button primary">Salvar modelo</button></footer>
      </form>
    </Modal>}
  </section>;
}
