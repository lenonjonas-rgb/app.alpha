import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { Empty, Modal } from "./components";
import { makeId } from "./domain";
import type { Database, QuestionDefinition, QuestionnaireTemplate } from "./domain";
import { errorMessage } from "./useDatabase";
import { archiveQuestionnaire, saveQuestionnaire } from "./questionnaires";
import { orderTypes, questionKinds, questionDefinitionSchema, questionnaireDisplaySchema } from "./questionnaireSchema";
import "./QuestionnaireCatalog.css";

const newQuestion = (): QuestionDefinition => ({
  id: makeId(), label: "", kind: "Texto", required: false, options: [], description: "",
});
const newTemplate = (): QuestionnaireTemplate => ({
  id: makeId(), title: "", revision: 1, archived: false, requiredForCheckout: true, header: "", footer: "",
  display: questionnaireDisplaySchema.parse({}), questions: [newQuestion()],
});

export function QuestionnaireCatalog({ data, commit, onSuccess }: {
  data: Database;
  commit: (update: Database | ((current: Database) => Database)) => void;
  onSuccess: (message: string) => void;
}) {
  const [draft, setDraft] = useState<QuestionnaireTemplate | null>(null);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");
  const templates = data.questionnaires.filter((item) => item.archived === archived && item.title.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  function act(update: (current: Database) => Database, message: string) {
    try { commit(update); setError(""); onSuccess(message); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  return <section className="questionnaire-catalog">
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="section-heading">
      <label className="field">Buscar questionário<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="checkbox-field"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Arquivados</label>
      <button className="button primary" onClick={() => { setError(""); setDraft(newTemplate()); }}><Plus size={17} />Novo questionário</button>
    </div>
    <p>Modelos reutilizáveis. Cada tarefa recebe uma cópia; editar ou arquivar o modelo não altera atendimentos já cadastrados.</p>
    <div className="questionnaire-template-list">{templates.map((template) => <article className="checklist-block" key={template.id}>
      <h2>{template.title}</h2><p>{template.questions.length} perguntas · Versão {template.revision}{template.display.equipment ? " · Permite resposta por equipamento" : ""}</p>
      <p>{template.requiredForCheckout ? "Preenchimento obrigatório para check-out" : "Preenchimento opcional para check-out"}</p>
      <div className="row-actions">
        {!archived && <button className="button secondary" onClick={() => { setError(""); setDraft(structuredClone(template)); }}><Pencil size={16} />Editar {template.title}</button>}
        <button className="button secondary" onClick={() => { setError(""); setDraft({ ...structuredClone(template), id: makeId(), title: `${template.title} (cópia)`, revision: 1, archived: false, questions: template.questions.map((question) => ({ ...question, id: makeId(), options: [...question.options] })) }); }}><Copy size={16} />Duplicar</button>
        {!archived ? <button className="button secondary" onClick={() => {
          if (window.confirm("Arquivar este modelo? As tarefas existentes serão preservadas e os padrões por tipo serão desvinculados.")) act((current) => archiveQuestionnaire(current, template.id), "Questionário arquivado.");
        }}><Trash2 size={16} />Arquivar</button> : <button className="button secondary" onClick={() => act((current) => saveQuestionnaire(current, { ...template, archived: false }), "Questionário restaurado.")}>Restaurar</button>}
      </div>
    </article>)}</div>
    {!templates.length && <Empty title="Nenhum questionário encontrado" />}
    <section className="checklist-block">
      <h2>Questionário padrão por tipo de tarefa</h2>
      <p>O padrão é aplicado às novas tarefas. A obrigatoriedade também é copiada para a tarefa e exige ao menos um questionário antes da finalização.</p>
      {orderTypes.map((type) => {
        const setting = data.orderTypeQuestionnaires.find((item) => item.type === type) ?? { type, questionnaireId: "", required: false };
        const update = (values: Partial<typeof setting>) => act((current) => {
          const previous = current.orderTypeQuestionnaires.find((item) => item.type === type) ?? { type, questionnaireId: "", required: false };
          return { ...current, orderTypeQuestionnaires: [...current.orderTypeQuestionnaires.filter((item) => item.type !== type), { ...previous, ...values }] };
        }, "Padrão do tipo de tarefa atualizado.");
        return <div className="questionnaire-type-row" key={type}>
          <label className="field">{type}<select aria-label={`Questionário padrão de ${type}`} value={setting.questionnaireId} onChange={(event) => update({ questionnaireId: event.target.value })}><option value="">Sem questionário padrão</option>{data.questionnaires.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label className="checkbox-field"><input type="checkbox" checked={setting.required} onChange={(event) => update({ required: event.target.checked })} />Exigir questionário em {type}</label>
        </div>;
      })}
    </section>
    {draft && <TemplateEditor key={draft.id} initial={draft} onClose={() => setDraft(null)} onSave={(template) => {
      try { commit((current) => saveQuestionnaire(current, template)); setDraft(null); setError(""); onSuccess("Questionário salvo. Tarefas existentes foram preservadas."); }
      catch (cause) { throw new Error(errorMessage(cause)); }
    }} />}
  </section>;
}

function TemplateEditor({ initial, onClose, onSave }: { initial: QuestionnaireTemplate; onClose: () => void; onSave: (template: QuestionnaireTemplate) => void }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  function patchQuestion(id: string, change: Partial<QuestionDefinition>) {
    setDraft((current) => ({ ...current, questions: current.questions.map((item) => item.id === id ? { ...item, ...change } : item) }));
  }
  function move(index: number, offset: number) {
    setDraft((current) => {
      const questions = [...current.questions];
      [questions[index], questions[index + offset]] = [questions[index + offset], questions[index]];
      return { ...current, questions };
    });
  }
  return <Modal title="Editor de questionário" onClose={onClose}><form onSubmit={(event) => {
    event.preventDefault(); setError("");
    try { onSave({ ...draft, questions: draft.questions.map((question) => ({ ...question, options: question.options.map((option) => option.trim()).filter(Boolean) })) }); } catch (cause) { setError(errorMessage(cause)); }
  }}>
    <div className="modal-body questionnaire-editor">
      {error && <div className="error-message" role="alert">{error}</div>}
      <label className="field">Título do questionário *<input required maxLength={1000} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label className="checkbox-field"><input type="checkbox" checked={draft.requiredForCheckout} onChange={(event) => setDraft({ ...draft, requiredForCheckout: event.target.checked })} />Exigir preenchimento para fazer check-out</label>
      <p>Quando marcado, as perguntas obrigatórias precisam ser respondidas antes de finalizar. Quando desmarcado, o questionário pode ficar incompleto sem bloquear o check-out. Esta opção é copiada para novas associações; tarefas existentes não são alteradas.</p>
      <label className="field">Cabeçalho<textarea rows={3} maxLength={10000} value={draft.header} onChange={(event) => setDraft({ ...draft, header: event.target.value })} /></label>
      <p>Cabeçalho, descrição e rodapé usam texto simples, sem HTML.</p>
      {draft.questions.map((question, index) => <fieldset className="questionnaire-definition" key={question.id}><legend>Pergunta {index + 1}</legend>
        <label className="field">Enunciado da pergunta {index + 1} *<input required maxLength={1000} value={question.label} onChange={(event) => patchQuestion(question.id, { label: event.target.value })} /></label>
        <label className="field">Descrição da pergunta {index + 1}<textarea rows={2} maxLength={3000} value={question.description ?? ""} onChange={(event) => patchQuestion(question.id, { description: event.target.value })} /></label>
        <label className="field">Tipo de resposta da pergunta {index + 1}<select value={question.kind} onChange={(event) => patchQuestion(question.id, { kind: questionDefinitionSchema.shape.kind.parse(event.target.value), options: [], justificationOn: event.target.value === "Sim ou Não" ? "Nao" : undefined })}>{questionKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        {question.kind === "Sim ou Não" && <label className="field">Exigir justificativa quando responder à pergunta {index + 1}<select value={question.justificationOn ?? "Nao"} onChange={(event) => patchQuestion(question.id, { justificationOn: questionDefinitionSchema.shape.justificationOn.parse(event.target.value) })}><option value="Sim">Sim</option><option value="Nao">Não</option></select><small>Texto obrigatório para a resposta selecionada. Tirar foto ou enviar imagem é opcional.</small></label>}
        <label className="checkbox-field"><input type="checkbox" checked={question.required} onChange={(event) => patchQuestion(question.id, { required: event.target.checked })} />Resposta obrigatória da pergunta {index + 1}</label>
        {["Escolha", "Multipla escolha"].includes(question.kind) && <label className="field">Opções da pergunta {index + 1} (uma por linha)<textarea required rows={4} value={question.options.join("\n")} onChange={(event) => patchQuestion(question.id, { options: event.target.value.split("\n") })} /></label>}
        {question.kind === "Foto" && <label className="checkbox-field"><input type="checkbox" checked={question.photoMetadata ?? false} onChange={(event) => patchQuestion(question.id, { photoMetadata: event.target.checked })} />Apresentar localização, data e hora na foto</label>}
        <div className="row-actions">
          <button type="button" className="button secondary" disabled={index === 0} aria-label={`Subir pergunta ${index + 1}`} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
          <button type="button" className="button secondary" disabled={index === draft.questions.length - 1} aria-label={`Descer pergunta ${index + 1}`} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
          <button type="button" className="button secondary" disabled={draft.questions.length >= 200} onClick={() => setDraft({ ...draft, questions: [...draft.questions.slice(0, index + 1), { ...question, id: makeId(), options: [...question.options] }, ...draft.questions.slice(index + 1)] })}><Copy size={16} />Duplicar pergunta {index + 1}</button>
          <button type="button" className="button secondary" disabled={draft.questions.length === 1} onClick={() => setDraft({ ...draft, questions: draft.questions.filter((item) => item.id !== question.id) })}><Trash2 size={16} />Excluir pergunta {index + 1}</button>
        </div>
      </fieldset>)}
      <button type="button" className="button secondary" disabled={draft.questions.length >= 200} onClick={() => setDraft({ ...draft, questions: [...draft.questions, newQuestion()] })}><Plus size={16} />Adicionar pergunta</button>
      <label className="field">Rodapé<textarea rows={3} maxLength={10000} value={draft.footer} onChange={(event) => setDraft({ ...draft, footer: event.target.value })} /></label>
      <h3>Apresentação na OS e nos relatórios</h3>
      <label className="checkbox-field"><input type="checkbox" checked={draft.display.showOnOrder} onChange={(event) => setDraft({ ...draft, display: { ...draft.display, showOnOrder: event.target.checked } })} />Exibir questionário na OS</label>
      <label className="field">Perguntas por linha<select value={draft.display.columns} onChange={(event) => setDraft({ ...draft, display: { ...draft.display, columns: Number(event.target.value) } })}>{[1, 2, 3, 4].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="checkbox-field"><input type="checkbox" checked={draft.display.inlineAnswers} onChange={(event) => setDraft({ ...draft, display: { ...draft.display, inlineAnswers: event.target.checked } })} />Perguntas e respostas na mesma linha</label>
      <label className="checkbox-field"><input type="checkbox" checked={draft.display.showUnanswered} onChange={(event) => setDraft({ ...draft, display: { ...draft.display, showUnanswered: event.target.checked } })} />Exibir perguntas não respondidas na OS e nos relatórios</label>
      <label className="checkbox-field"><input type="checkbox" checked={draft.display.equipment} onChange={(event) => setDraft({ ...draft, display: { ...draft.display, equipment: event.target.checked } })} />Permitir resposta por equipamento</label>
    </div>
    <footer className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary"><Save size={17} />Salvar questionário</button></footer>
  </form></Modal>;
}
