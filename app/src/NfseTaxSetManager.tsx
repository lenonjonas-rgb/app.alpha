import { useState } from "react";
import type { FormEvent } from "react";
import { localDay, makeId } from "./domain";
import { Modal } from "./components";
import { NfseTaxCodeSelect } from "./NfseTaxCodeSelect";
import { nfseTaxOptions } from "./nfseTaxCatalog";
import { normalizedFiscalCode } from "./nfseTaxCodes";
import { nfseTaxSetSchema } from "./nfseTaxSetSchema";
import type { NfseTaxSet } from "./nfseTaxSetSchema";

type TaxSetForm = Omit<NfseTaxSet, "issRate" | "ibptRate"> & { issRate: string; ibptRate: string };

function emptyForm(): TaxSetForm {
  return {
    id: "", name: "", nationalCode: "", municipalCode: "", nbs: "", operationIndicator: "",
    issRate: "", ibptRate: "", active: true, isDefault: false,
  };
}

function toForm(set: NfseTaxSet): TaxSetForm {
  return { ...set, issRate: String(set.issRate), ibptRate: set.ibptRate === null ? "" : String(set.ibptRate) };
}

function readRate(value: string) {
  const trimmed = value.trim();
  if (!/^\d{1,3}(?:[.,]\d{1,4})?$/.test(trimmed)) return null;
  return Number(trimmed.replace(",", "."));
}

export function NfseTaxSetManager({ sets, onSave, onClose }: {
  sets: NfseTaxSet[];
  onSave: (set: NfseTaxSet) => string | void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<TaxSetForm>(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const options = nfseTaxOptions({
    nationalCode: form.nationalCode, nbs: form.nbs, operationIndicator: form.operationIndicator, cst: "", issueDate: localDay(),
  });
  const change = (patch: Partial<TaxSetForm>) => setForm((current) => ({ ...current, ...patch }));

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const issRate = readRate(form.issRate);
    const ibptRate = form.ibptRate.trim() ? readRate(form.ibptRate) : null;
    if (issRate === null) {
      setError("Informe explicitamente a alíquota de ISS, inclusive quando for zero.");
      return;
    }
    if (form.ibptRate.trim() && ibptRate === null) {
      setError("Informe uma alíquota IBPT válida ou deixe o campo em branco.");
      return;
    }
    const result = nfseTaxSetSchema.safeParse({
      ...form, id: form.id || makeId(), issRate, ibptRate,
      nationalCode: normalizedFiscalCode(form.nationalCode),
      nbs: normalizedFiscalCode(form.nbs),
      operationIndicator: normalizedFiscalCode(form.operationIndicator),
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Confira os dados do conjunto.");
      return;
    }
    const failure = onSave(result.data);
    if (failure) {
      setError(failure);
      return;
    }
    setForm(emptyForm());
    setNotice("Conjunto salvo. Selecione-o na nota para aplicar seus dados.");
  }

  return <Modal title="Conjuntos de tributação da NFS-e" onClose={onClose} wide>
    <div className="modal-body nfse-tax-manager">
      <p className="nfe-hint">Estes conjuntos pertencem à NFS-e local e não alteram o cadastro fiscal avançado nem transmitem notas. Confirme códigos e alíquotas com a contabilidade.</p>
      {sets.length > 0 ? <div className="table-scroll">
        <table className="nfse-tax-set-list">
          <thead><tr><th>Conjunto</th><th>Código nacional</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>{sets.map((set) => <tr key={set.id}>
            <td>{set.name}</td><td>{set.nationalCode}</td><td>{set.active ? set.isDefault ? "Ativo · padrão" : "Ativo" : "Inativo"}</td>
            <td><button type="button" className="text-button" onClick={() => {
              setForm(toForm(set)); setError(""); setNotice("");
            }}>Editar</button></td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="nfe-empty">Nenhum conjunto cadastrado. Crie o primeiro abaixo.</p>}
      <form onSubmit={save} className="nfse-tax-set-form">
        <div className="nfse-tax-form-heading">
          <h3>{form.id ? "Editar conjunto" : "Novo conjunto"}</h3>
          {form.id && <button type="button" className="text-button" onClick={() => {
            setForm(emptyForm()); setError(""); setNotice("");
          }}>Novo conjunto</button>}
        </div>
        <div className="nfe-grid">
          <label className="field nfe-wide"><span>Nome do conjunto</span>
            <input maxLength={160} value={form.name} onChange={(event) => change({ name: event.target.value })} /></label>
          <label className="field"><span>Código nacional</span>
            <input maxLength={20} inputMode="numeric" value={form.nationalCode} onChange={(event) => change({ nationalCode: event.target.value })} />
            <small>6 dígitos</small></label>
          <label className="field"><span>Código municipal</span>
            <input maxLength={20} value={form.municipalCode} onChange={(event) => change({ municipalCode: event.target.value })} /></label>
          <label className="field"><span>NBS</span>
            <input maxLength={20} inputMode="numeric" value={form.nbs} onChange={(event) => change({ nbs: event.target.value })} />
            <small>9 dígitos, se aplicável</small></label>
          <label className="field"><span>ISS %</span>
            <input inputMode="decimal" value={form.issRate} onChange={(event) => change({ issRate: event.target.value })} />
            <small>Informe inclusive quando for zero.</small></label>
          <label className="field"><span>IBPT % (opcional)</span>
            <input inputMode="decimal" value={form.ibptRate} onChange={(event) => change({ ibptRate: event.target.value })} /></label>
          <NfseTaxCodeSelect label="Indicador de operação" value={form.operationIndicator} options={options.indicators}
            length={6} maxLength={20} onChange={(operationIndicator) => change({ operationIndicator })} />
        </div>
        <div className="nfse-tax-toggles">
          <label><input type="checkbox" checked={form.active} onChange={(event) => change({
            active: event.target.checked, isDefault: event.target.checked && form.isDefault,
          })} /> Conjunto ativo</label>
          <label><input type="checkbox" checked={form.isDefault} disabled={!form.active}
            onChange={(event) => change({ isDefault: event.target.checked })} /> Usar como padrão em novas notas</label>
        </div>
        <p className="nfe-hint">O padrão é aplicado às novas notas, exceto às geradas automaticamente por contrato. Revise-o em cada serviço. Sem IBPT no conjunto, o percentual já informado na nota é mantido.</p>
        {error && <div className="error-message" role="alert">{error}</div>}
        {notice && <p className="nfe-hint" role="status">{notice}</p>}
        <div className="nfse-tax-form-actions">
          <button type="submit" className="button primary">{form.id ? "Salvar alterações" : "Salvar conjunto"}</button>
        </div>
      </form>
    </div>
    <footer className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Fechar</button></footer>
  </Modal>;
}
