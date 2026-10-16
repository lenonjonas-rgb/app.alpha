import { useState } from "react";
import type { Database } from "./domain";
import { fiscalRequest } from "./fiscalApi";
import type { FiscalCatalogItem } from "./fiscalCatalogSchema";

type Rule = { id: string; kind: "nfe" | "nfse"; name: string; reviewed: boolean };

export function FiscalCatalogPanel({ data, catalog, rules, busy, act }: {
  data: Database; catalog: FiscalCatalogItem[]; rules: Rule[]; busy: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<"nfe" | "nfse">("nfe");
  const [referenceId, setReferenceId] = useState("");
  const records = kind === "nfe" ? data.products : data.services;
  const current = catalog.find((item) => item.kind === kind && item.referenceId === referenceId);
  const product = current?.kind === "nfe" ? current : undefined;
  const service = current?.kind === "nfse" ? current : undefined;
  return <section>
    <h3>Cadastro fiscal de produtos e serviços</h3>
    <p>Classificação básica por item do catálogo. Não calcula impostos nem gera XML automaticamente. A referência vinculada pode estar pendente; salvar o cadastro não aprova a tributação. CFOP, alíquotas e bases permanecem na referência e precisam de revisão por operação.</p>
    <div className="form-grid">
      <label className="field">Tipo do cadastro<select value={kind} disabled={busy} onChange={(event) => {
        setKind(event.target.value === "nfe" ? "nfe" : "nfse"); setReferenceId("");
      }}><option value="nfe">Produto · NF-e</option><option value="nfse">Serviço · NFS-e</option></select></label>
      <label className="field">Item do catálogo<select value={referenceId} disabled={busy} onChange={(event) => setReferenceId(event.target.value)}>
        <option value="">Selecione</option>{records.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    </div>
    {referenceId && <form key={`${kind}:${referenceId}:${current?.updatedAt ?? "new"}`} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const classification = kind === "nfe" ? { unit: form.get("unit"), ncm: form.get("ncm"), origin: form.get("origin") } :
        { nationalCode: form.get("nationalCode"), municipalCode: form.get("municipalCode"), nbs: form.get("nbs") };
      void act(async () => {
        await fiscalRequest("/catalog", "PUT", { kind, referenceId, ruleId: form.get("ruleId"), notes: form.get("notes"),
          active: form.get("active") === "on", ...classification });
      }, "Cadastro fiscal básico salvo no backend; tributação não aprovada automaticamente.");
    }}>
      <fieldset disabled={busy}><legend>{current ? "Editar classificação" : "Nova classificação"}</legend>
        <div className="form-grid">
          {kind === "nfe" ? <>
            <label className="field">Unidade comercial<input name="unit" required maxLength={6} defaultValue={product?.unit} placeholder="Ex.: UN" /></label>
            <label className="field">NCM (8 dígitos)<input name="ncm" required pattern="[0-9]{8}" maxLength={8} defaultValue={product?.ncm} /></label>
            <label className="field">Origem da mercadoria<select name="origin" required defaultValue={product?.origin ?? ""}>
              <option value="">Selecione</option>
              <option value="0">0 · Nacional, exceto códigos 3, 4, 5 e 8</option>
              <option value="1">1 · Estrangeira, importação direta, exceto 6</option>
              <option value="2">2 · Estrangeira, mercado interno, exceto 7</option>
              <option value="3">3 · Nacional, conteúdo importação superior a 40% até 70%</option>
              <option value="4">4 · Nacional, processos produtivos básicos</option>
              <option value="5">5 · Nacional, conteúdo importação até 40%</option>
              <option value="6">6 · Estrangeira, importação direta sem similar nacional</option>
              <option value="7">7 · Estrangeira, mercado interno sem similar nacional</option>
              <option value="8">8 · Nacional, conteúdo importação superior a 70%</option>
            </select></label>
          </> : <>
            <label className="field">Código de tributação nacional (6 dígitos)<input name="nationalCode" required pattern="[0-9]{6}" maxLength={6} defaultValue={service?.nationalCode} /></label>
            <label className="field">Código de tributação municipal (quando aplicável)<input name="municipalCode" maxLength={20} defaultValue={service?.municipalCode} /></label>
            <label className="field">NBS (9 dígitos)<input name="nbs" required pattern="[0-9]{9}" maxLength={9} defaultValue={service?.nbs} /></label>
          </>}
          <label className="field">Referência tributária<select name="ruleId" required defaultValue={current?.ruleId ?? ""}>
            <option value="">Selecione sem aplicar automaticamente</option>{rules.filter((rule) => rule.kind === kind).map((rule) =>
              <option key={rule.id} value={rule.id}>{rule.name} · {rule.reviewed ? "Revisada" : "Revisão pendente"}</option>)}
          </select></label>
        </div>
        <label className="field">Observações da classificação<textarea name="notes" maxLength={1000} defaultValue={current?.notes ?? ""} /></label>
        <label className="checkbox-field"><input name="active" type="checkbox" defaultChecked={current?.active ?? true} />Cadastro ativo (não significa autorizado para emitir)</label>
        <button className="button primary">Salvar cadastro fiscal do item</button>
      </fieldset>
    </form>}
    <div className="finance-table"><table><thead><tr><th>Item / modelo</th><th>Classificação</th><th>Referência</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
      {catalog.map((item) => {
        const record = (item.kind === "nfe" ? data.products : data.services).find((entry) => entry.id === item.referenceId);
        const rule = rules.find((entry) => entry.id === item.ruleId);
        return <tr key={`${item.kind}:${item.referenceId}`}><td>{record?.name ?? `Item ausente: ${item.referenceId}`} · {item.kind.toUpperCase()}</td>
          <td>{item.kind === "nfe" ? `NCM ${item.ncm} · origem ${item.origin} · ${item.unit}` : `Tributação ${item.nationalCode} · NBS ${item.nbs}`}</td>
          <td>{rule?.name ?? "Referência ausente"}<br />{rule?.reviewed ? "Referência revisada; conferir operação" : "Revisão pendente"}</td>
          <td>{item.active ? "Ativo" : "Inativo"}{!record && " · item não encontrado"}</td>
          <td><button className="text-button" disabled={busy || !record} onClick={() => { setKind(item.kind); setReferenceId(item.referenceId); }}>Editar / inativar</button></td></tr>;
      })}
    </tbody></table></div>
    {!catalog.length && <p>Nenhum item com classificação fiscal cadastrada.</p>}
  </section>;
}
