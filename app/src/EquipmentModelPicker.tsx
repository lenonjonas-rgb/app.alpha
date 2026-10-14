import { useState } from "react";
import type { Database, EquipmentSelection } from "./domain";
import { selectEquipmentModel } from "./equipmentCatalogData";
import { errorMessage } from "./useDatabase";

export function EquipmentModelPicker({ data, value, onChange }: {
  data: Database; value: string; onChange: (id: string) => void;
}) {
  const initialBrand = data.equipmentModels.find((model) => model.id === value)?.brandId ?? "";
  const [brandId, setBrandId] = useState(initialBrand);
  const [line, setLine] = useState(data.equipmentModels.find((model) => model.id === value)?.line ?? "");
  return <>
    <label className="field">Marca (opcional)
      <select value={brandId} onChange={(event) => { setBrandId(event.target.value); setLine(""); onChange(""); }}>
        <option value="">Selecione uma marca</option>
        {data.equipmentBrands.filter((brand) => brand.archived && brand.id === brandId).map((brand) => <option key={brand.id} value={brand.id}>{brand.name} (arquivada)</option>)}
        {data.equipmentBrands.filter((brand) => !brand.archived).map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
      </select>
    </label>
    <label className="field">Linha (opcional)
      <select value={line} onChange={(event) => { setLine(event.target.value); onChange(""); }}>
        <option value="">Sem linha cadastrada</option>
        {[...new Set(data.equipmentModels.filter((model) => model.brandId === brandId && (!model.archived || model.id === value)).map((model) => model.line ?? "").filter(Boolean))].sort().map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
    <label className="field">Modelo do catálogo (opcional)
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Sem modelo do catálogo</option>
        {value && !data.equipmentModels.some((model) => model.id === value && !model.archived && data.equipmentBrands.some((brand) => brand.id === model.brandId && !brand.archived)) && <option value={value}>{data.equipmentModels.find((model) => model.id === value)?.name ?? "Modelo vinculado"} (indisponível para novas seleções)</option>}
        {data.equipmentModels.filter((model) => !model.archived && model.brandId === brandId && (model.line ?? "") === line && data.equipmentBrands.some((brand) => brand.id === model.brandId && !brand.archived)).map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
    </label>
  </>;
}

export function EquipmentSelections({ data, value, onChange }: {
  data: Database; value: EquipmentSelection[]; onChange: (value: EquipmentSelection[]) => void;
}) {
  const [modelId, setModelId] = useState("");
  const [error, setError] = useState("");
  return <section className="full equipment-selections">
    <h3>Equipamentos do catálogo (opcional)</h3>
    <p>Selecione modelos para montagem, manutenção ou outro atendimento, sem precisar cadastrar uma unidade no cliente. Os valores são definidos nos produtos e serviços do orçamento.</p>
    <div className="form-grid">
      <EquipmentModelPicker data={data} value={modelId} onChange={setModelId} />
      <button type="button" className="button secondary" disabled={!modelId} onClick={() => {
        try {
          if (value.some((item) => item.modelId === modelId)) throw new Error("Modelo já incluído. Ajuste a quantidade na lista.");
          onChange([...value, selectEquipmentModel(data, modelId)]);
          setError("");
        } catch (cause) { setError(errorMessage(cause)); }
      }}>Incluir modelo</button>
    </div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {value.map((item, index) => <div key={`${item.modelId}-${index}`} className="form-grid equipment-selection-row">
      <strong className="full">{item.brand}{item.line ? ` · ${item.line}` : ""} · {item.name}</strong>
      <label className="field">Quantidade de {item.name}
        <input type="number" min={1} max={10000} step={1} required value={item.quantity}
          onChange={(event) => onChange(value.map((entry, position) => position === index ? { ...entry, quantity: Number(event.target.value) } : entry))} />
      </label>
      <label className="field">Finalidade de {item.name}
        <select value={item.purpose} onChange={(event) => {
          const purpose = event.target.value;
          if (purpose === "Montagem" || purpose === "Manutenção" || purpose === "Outro")
            onChange(value.map((entry, position) => position === index ? { ...entry, purpose } : entry));
        }}>
          <option>Montagem</option><option>Manutenção</option><option>Outro</option>
        </select>
      </label>
      <button type="button" className="text-button" onClick={() => onChange(value.filter((_, position) => position !== index))}>Remover {item.name}</button>
    </div>)}
  </section>;
}

export function EquipmentSelectionSummary({ value }: { value: EquipmentSelection[] }) {
  if (!value.length) return null;
  return <section>
    <h3>Equipamentos do catálogo</h3>
    {value.map((item, index) => <p key={`${item.modelId}-${index}`}>{item.quantity} × {item.brand}{item.line ? ` · ${item.line}` : ""} · {item.name} · {item.purpose}</p>)}
  </section>;
}
