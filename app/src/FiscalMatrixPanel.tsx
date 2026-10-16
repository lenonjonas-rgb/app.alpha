import { useState } from "react";
import { fiscalRequest } from "./fiscalApi";
import type { FiscalMatrixRecord } from "./fiscalMatrixSchema";
import { FiscalTaxParameterFields } from "./FiscalTaxParameterFields";
import { taxParametersFromForm } from "./fiscalTaxParameters";
import { FiscalTaxSimulation } from "./FiscalTaxSimulation";

type Rule = { id: string; name: string; kind: "nfe" | "nfse"; reviewed: boolean; scope: string; fields: Record<string, string> };
export function FiscalMatrixPanel({ matrices, rules, busy, act }: {
  matrices: FiscalMatrixRecord[]; rules: Rule[]; busy: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<FiscalMatrixRecord | null>(null);
  const [kind, setKind] = useState<"nfe" | "nfse">("nfe");
  const [open, setOpen] = useState(false);
  const [simulationId, setSimulationId] = useState<string | null>(null);
  const simulatedMatrix = matrices.find((matrix) => matrix.id === simulationId);
  return <section>
    <h3>Matriz tributária por operação e vigência</h3>
    <p>Defina a aplicabilidade por UF do destinatário, indicador ICMS, consumidor final e período. Preencha seus parâmetros fiscais no formulário e salve na matriz. Não há alíquotas padrão nem aprovação automática. A referência permanece como histórico para conferência. Simule os cálculos da matriz salva para conferência; a prévia não aplica tributos na OS nem gera XML.</p>
    <button className="button secondary" disabled={busy} onClick={() => { setEditing(null); setKind("nfe"); setOpen(true); }}>Cadastrar matriz tributária</button>
    {open && <form key={editing ? `${editing.id}:${editing.updatedAt}` : `new:${kind}`} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void act(async () => {
        await fiscalRequest("/matrices", "PUT", {
          ...(editing ? { id: editing.id } : {}), kind, name: form.get("name"), operation: form.get("operation"), ruleId: form.get("ruleId"),
          validFrom: form.get("validFrom"), validUntil: form.get("validUntil"), destinationState: form.get("destinationState"),
          ieIndicator: form.get("ieIndicator"), finalConsumer: form.get("finalConsumer") === "on", active: form.get("active") === "on",
          reviewed: form.get("reviewed") === "on", approval: form.get("approval"),
          parameters: taxParametersFromForm(form, kind),
        });
        setOpen(false); setEditing(null);
      }, "Matriz salva com o estado de revisão informado. Isso não libera produção nem representa homologação.");
    }}>
      <fieldset disabled={busy}><legend>{editing ? "Editar / inativar matriz" : "Nova matriz (pendente por padrão)"}</legend>
        <div className="form-grid">
          <label className="field">Modelo fiscal<select value={kind} disabled={Boolean(editing)} onChange={(event) => setKind(event.target.value === "nfse" ? "nfse" : "nfe")}>
            <option value="nfe">NF-e · Produtos</option><option value="nfse">NFS-e · Serviços</option>
          </select></label>
          <label className="field">Nome da matriz<input name="name" required maxLength={100} defaultValue={editing?.name} /></label>
          <label className="field">Referência tributária da operação<select name="ruleId" required defaultValue={editing?.ruleId ?? ""}>
            <option value="">Selecione</option>{rules.filter((rule) => rule.kind === kind).map((rule) => <option key={rule.id} value={rule.id}>{rule.name} · {rule.reviewed ? "revisada" : "pendente"}</option>)}
          </select></label>
          <label className="field">UF do destinatário<select name="destinationState" required defaultValue={editing?.destinationState ?? ""}>
            <option value="">Selecione</option>{["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"].map((state) =>
              <option key={state} value={state}>{state}</option>)}
          </select></label>
          <label className="field">Início da vigência<input type="date" name="validFrom" required defaultValue={editing?.validFrom} /></label>
          <label className="field">Fim da vigência<input type="date" name="validUntil" required defaultValue={editing?.validUntil} /></label>
          <label className="field">Indicador ICMS do destinatário<select name="ieIndicator" defaultValue={editing?.ieIndicator ?? "9"}>
            <option value="1">1 · Contribuinte</option><option value="2">2 · Isento</option><option value="9">9 · Não contribuinte</option>
          </select></label>
        </div>
        <label className="field">Operação e limites de aplicação<textarea name="operation" required minLength={10} maxLength={500} defaultValue={editing?.operation} /></label>
        <label className="checkbox-field"><input type="checkbox" name="finalConsumer" defaultChecked={editing?.finalConsumer ?? true} />Consumidor final</label>
        <label className="checkbox-field"><input type="checkbox" name="active" defaultChecked={editing?.active ?? true} />Matriz ativa (vigência não pode sobrepor outra da mesma referência/perfil)</label>
        <FiscalTaxParameterFields kind={kind} parameters={editing?.parameters} />
        <label className="field">Responsável, data e fundamento da revisão contábil<textarea name="approval" maxLength={1000} defaultValue={editing?.approval ?? ""} /></label>
        <label className="checkbox-field"><input type="checkbox" name="reviewed" defaultChecked={false} />Confirmo novamente a revisão contábil desta versão (exige referência também revisada)</label>
        <button className="button primary">Salvar matriz tributária</button>
        <button type="button" className="button secondary" onClick={() => setOpen(false)}>Fechar sem salvar</button>
      </fieldset>
    </form>}
    <div className="finance-table"><table><thead><tr><th>Matriz / operação</th><th>Perfil e vigência</th><th>Revisão</th><th>Ação</th></tr></thead><tbody>
      {matrices.map((matrix) => {
        const rule = rules.find((item) => item.id === matrix.ruleId);
        const changed = !rule || rule.reviewed !== matrix.ruleSnapshot.reviewed || rule.scope !== matrix.ruleSnapshot.scope ||
          Object.keys({ ...rule?.fields, ...matrix.ruleSnapshot.fields }).some((key) => rule?.fields[key] !== matrix.ruleSnapshot.fields[key]);
        return <tr key={matrix.id}><td>{matrix.name} · {matrix.kind.toUpperCase()}<br />{matrix.operation}</td>
          <td>{matrix.destinationState} · indicador {matrix.ieIndicator} · {matrix.finalConsumer ? "consumidor final" : "não final"}<br />{matrix.validFrom} a {matrix.validUntil}</td>
          <td>{matrix.active ? "Ativa" : "Inativa"} · {matrix.reviewed ? "Revisada" : "Pendente"}{!matrix.parameters && " · parâmetros incompletos"}{changed && " · referência alterada/ausente: reconferir"}</td>
          <td><button className="text-button" disabled={busy} onClick={() => { setEditing(matrix); setKind(matrix.kind); setOpen(true); }}>Conferir / editar matriz</button>
            <button className="text-button" disabled={busy || !matrix.parameters} onClick={() => setSimulationId(matrix.id)}>Simular tributos</button></td></tr>;
      })}
    </tbody></table></div>
    {!matrices.length && <p>Nenhuma matriz cadastrada. Não há enquadramento tributário padrão aprovado.</p>}
    {simulatedMatrix && <><FiscalTaxSimulation key={`${simulatedMatrix.id}:${simulatedMatrix.updatedAt}`} matrix={simulatedMatrix} busy={busy} act={act} />
      <button className="button secondary" type="button" disabled={busy} onClick={() => setSimulationId(null)}>Fechar simulação</button></>}
  </section>;
}
