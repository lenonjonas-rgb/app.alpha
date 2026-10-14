import { useState } from "react";
import type { Database } from "./domain";
import { getOrderDetails } from "./domain";
import { OrderPrintable } from "./OrderWorkspace";
import { reportSections, reportSettingsSchema } from "./reportSettings";
import { errorMessage } from "./useDatabase";
import "./ReportSettings.css";

const layouts = [
  { id: "classic", title: "Tabelado", description: "Seções delimitadas, bordas e organização compacta." },
  { id: "clean", title: "Limpo", description: "Mais espaço e títulos discretos para facilitar a leitura." },
  { id: "watermark", title: "Marca-d’água", description: "Identidade da empresa ao fundo, com baixa opacidade." },
] as const;

export function ReportSettingsPanel({ data, commit, onSuccess, onError }: {
  data: Database;
  commit: (update: (current: Database) => Database) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [config, setConfig] = useState(data.settings.reportSettings);
  const [orderId, setOrderId] = useState(data.orders[0]?.id ?? "");
  const order = data.orders.find((item) => item.id === orderId);
  const previewData = { ...data, settings: { ...data.settings, reportSettings: config } };
  return <section className="settings-section report-settings">
    <div className="section-heading"><h2>Relatórios de atendimento</h2></div>
    <p>Escolha o modelo e as informações que serão incluídas ao imprimir ou salvar a OS como PDF. Estas opções não alteram os registros do atendimento nem enviam documentos ao cliente.</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        const saved = reportSettingsSchema.parse(config);
        commit((current) => ({ ...current, settings: { ...current.settings, reportSettings: saved } }));
        onError("");
        onSuccess("Configurações de relatório salvas.");
      } catch (cause) { onError(errorMessage(cause)); }
    }}>
      <fieldset>
        <legend>Modelo do relatório</legend>
        <div className="report-layout-options">
          {layouts.map((layout) => <label className={`report-layout-option ${config.layout === layout.id ? "selected" : ""}`} key={layout.id}>
            <input type="radio" name="reportLayout" value={layout.id} checked={config.layout === layout.id}
              onChange={() => setConfig({ ...config, layout: layout.id })} />
            <strong>{layout.title}</strong>
            <span className={`report-layout-thumbnail layout-${layout.id}`} aria-hidden="true">
              {layout.id === "watermark" && <b>ALPHA</b>}
              <i /><i /><i /><i />
            </span>
            <small>{layout.description}</small>
          </label>)}
        </div>
      </fieldset>
      <div className="form-grid">
        <label className="field full">Título do relatório
          <input value={config.title} required maxLength={120} onChange={(event) => setConfig({ ...config, title: event.target.value })} />
        </label>
        <label className="field">Tamanho do texto
          <select value={config.fontSize} onChange={(event) => setConfig({ ...config, fontSize: reportSettingsSchema.shape.fontSize.parse(event.target.value) })}>
            <option value="small">Pequeno</option><option value="medium">Médio</option><option value="large">Grande</option>
          </select>
        </label>
        <label className="field">Ordem dos questionários
          <select value={config.questionnaireOrder} onChange={(event) => setConfig({ ...config, questionnaireOrder: reportSettingsSchema.shape.questionnaireOrder.parse(event.target.value) })}>
            <option value="task">Ordem da tarefa</option><option value="name">Nome do questionário</option><option value="equipment">Código do equipamento</option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend>Informações visíveis no relatório</legend>
        <div className="report-section-options">
          {Object.entries(reportSections).map(([key, label]) => {
            const section = key as keyof typeof reportSections;
            return <label key={section}><input type="checkbox" checked={config.sections[section]}
              onChange={(event) => setConfig({ ...config, sections: { ...config.sections, [section]: event.target.checked } })} />{label}</label>;
          })}
        </div>
      </fieldset>
      <p>A marca-d’água usa a logo cadastrada na identidade da empresa ou, na ausência dela, o nome da empresa. Ocultar valores também remove os totais dos orçamentos; fotos e assinaturas ocultas não aparecem nos questionários. Textos livres e anexos podem conter informações inseridas manualmente: revise o documento antes de compartilhar.</p>
      <button className="button primary" type="submit">Salvar configurações de relatório</button>
    </form>
    <label className="field">OS para pré-visualização
      <select value={orderId} onChange={(event) => setOrderId(event.target.value)}>
        <option value="">Selecione uma OS</option>
        {data.orders.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}
      </select>
    </label>
    <p>Pré-visualização das opções acima, incluindo alterações ainda não salvas. A impressão usa as configurações salvas.</p>
    {order ? <div className="report-preview-container"><OrderPrintable order={order} details={getOrderDetails(order)} data={previewData} preview /></div>
      : <p>Selecione uma OS existente para visualizar o relatório.</p>}
  </section>;
}
