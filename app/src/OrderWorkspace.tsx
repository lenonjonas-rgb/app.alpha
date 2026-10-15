import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import SignaturePad from "signature_pad";
import {
  ArrowLeft,
  Archive,
  Check,
  ClipboardList,
  Clock3,
  Copy,
  FileText,
  History,
  ImagePlus,
  Link2,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Send,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import {
  activityTotals,
  allowedActivities,
  appendActivity,
  associateQuote,
  currency,
  displayDate,
  getOrderDetails,
  orderServiceAddress,
  localDay,
  makeId,
  orderPending,
  orderValues,
  orderDetailsSchema,
  replicateOrder,
  shiftDay,
  total,
  updateOrderDetails,
} from "./domain";
import type {
  Activity,
  Attachment,
  Checklist,
  Database,
  Order,
  OrderDetails,
} from "./domain";
import { Badge, Empty, Modal } from "./components";
import { EditorModal } from "./Forms";
import type { Editor } from "./Forms";
import { downloadFile, errorMessage } from "./useDatabase";
import { questionDefinitionSchema, questionKinds, requiresJustification } from "./questionnaireSchema";
import { prepareQuestionnairePhoto } from "./questionnairePhoto";
import { questionAnswerText, questionSignature, withQuestionAnswer } from "./questionnaireAnswers";
import { addQuestionnaire, assertSingleEquipmentQuestionnaire, assignQuestionnaireEquipment, keepEquipmentQuestionnaire, replaceOrderQuestionnaire } from "./questionnaires";
import { EquipmentSelections, EquipmentSelectionSummary } from "./EquipmentModelPicker";
import { serviceDistanceForActivity, serviceDistanceText } from "./serviceDistance";
import { captureLocation } from "./mobile";
import { csvContent } from "./reporting";
import { TravelPanel } from "./TravelPanel";
import { assertTravelReady, travelValues } from "./travel";
import "./OrderWorkspace.css";

const tabs = [
  "Detalhes",
  "Relato e assinatura",
  "Anexos e fotos",
  "Questionários",
  "Equipamentos",
  "Pendências",
  "Controle de horas",
  "Envios",
  "Valores",
] as const;
function orderDraftKey(scope: string, orderId: string) {
  return `alpha-tec.order-draft.v1.${scope}.${orderId}`;
}
function orderEditorKey(scope: string, orderId: string) {
  return `alpha-tec.order-editor.v1.${scope}.${orderId}`;
}
function readOrderEditor(key: string): Editor | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved) || !("kind" in saved) ||
      typeof saved.kind !== "string" ||
      !["client", "equipment", "product", "service", "order", "quote", "movement"].includes(saved.kind)) return null;
    if (("id" in saved && typeof saved.id !== "string") ||
      ("date" in saved && typeof saved.date !== "string") ||
      ("time" in saved && typeof saved.time !== "string") ||
      ("clientId" in saved && typeof saved.clientId !== "string") ||
      ("equipmentId" in saved && typeof saved.equipmentId !== "string")) return null;
    return { ...saved, kind: saved.kind as Editor["kind"] };
  } catch (error) {
    console.warn("Não foi possível restaurar o formulário da OS.", error);
    return null;
  }
}
function readOrderDraft(key: string) {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved) || !("draft" in saved) || !("snapshot" in saved) || typeof saved.snapshot !== "string") return null;
    const draft = orderDetailsSchema.safeParse(saved.draft);
    return draft.success ? { draft: draft.data, snapshot: saved.snapshot } : null;
  } catch (error) {
    console.warn("Não foi possível restaurar as alterações da OS.", error);
    try {
      sessionStorage.removeItem(key);
    } catch (removeError) {
      console.warn("Não foi possível remover o rascunho inválido da OS.", removeError);
    }
    return null;
  }
}
type Tab = (typeof tabs)[number];
const timeText = (milliseconds: number) => {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const localDateTime = () => {
  const date = new Date();
  return `${localDay(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
};
async function readAttachment(file: File): Promise<Attachment> {
  const allowed = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/pdf",
    "text/plain",
  ];
  if (!allowed.includes(file.type))
    throw new Error("Use PNG, JPG, WebP, PDF ou TXT.");
  if (file.size === 0 || file.size > 500_000)
    throw new Error(
      "Cada arquivo deve ter entre 1 byte e 500 KB na versão local.",
    );
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
  if (file.type.startsWith("image/")) {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("A imagem não pôde ser lida."));
      image.src = data;
    });
  }
  return {
    id: makeId(),
    name: file.name,
    mime: file.type as Attachment["mime"],
    size: file.size,
    data,
    at: new Date().toISOString(),
  };
}

export function OrderWorkspace({
  order,
  data,
  commit,
  draftScope,
  cloudEnabled,
  cloudSaveVersion,
  getSaveRequestVersion,
  onBack,
  onOpen,
}: {
  order: Order;
  data: Database;
  commit: (update: Database | ((data: Database) => Database)) => void;
  draftScope: string;
  cloudEnabled: boolean;
  cloudSaveVersion: number;
  getSaveRequestVersion: () => number;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const persistedDraftKey = orderDraftKey(draftScope || "local", order.id);
  const persistedEditorKey = orderEditorKey(draftScope || "local", order.id);
  const [persistedDraft] = useState(() => readOrderDraft(persistedDraftKey));
  const [persistedEditor] = useState(() => readOrderEditor(persistedEditorKey));
  const [tab, setTab] = useState<Tab>("Detalhes");
  const pendingDraftCleanup = useRef(0);
  const [editing, setEditing] = useState(Boolean(persistedDraft));
  const [draft, setDraft] = useState(() => persistedDraft?.draft ?? getOrderDetails(order));
  const [snapshot, setSnapshot] = useState(() => persistedDraft?.snapshot ?? "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(persistedEditor);
  const [dialog, setDialog] = useState<
    | "signature"
    | "checklist"
    | "question"
    | "activity"
    | "replicate"
    | "history"
    | null
  >(null);
  const [catalog, setCatalog] = useState("");
  const [questionnaireTemplateId, setQuestionnaireTemplateId] = useState("");
  const [signatureQuestion, setSignatureQuestion] = useState<{ checklistId: string; questionId: string } | null>(null);
  const [quoteId, setQuoteId] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const pendingEditorCleanup = useRef<{ editor: Editor; targetVersion: number } | null>(null);
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (!editing || !snapshot) return;
    try {
      sessionStorage.setItem(persistedDraftKey, JSON.stringify({ draft, snapshot }));
    } catch (cause) {
      const message = errorMessage(cause);
      requestAnimationFrame(() => setError(`Não foi possível salvar o rascunho temporário da OS: ${message}`));
    }
  }, [draft, editing, persistedDraftKey, snapshot]);
  useEffect(() => {
    if (!pendingDraftCleanup.current || cloudSaveVersion < pendingDraftCleanup.current) return;
    try {
      sessionStorage.removeItem(persistedDraftKey);
      pendingDraftCleanup.current = 0;
    } catch (cause) {
      console.warn("Não foi possível remover o rascunho sincronizado da OS.", cause);
    }
  }, [cloudSaveVersion, persistedDraftKey]);
  useEffect(() => {
    if (!editor) return;
    try {
      sessionStorage.setItem(persistedEditorKey, JSON.stringify(editor));
    } catch (cause) {
      const message = errorMessage(cause);
      requestAnimationFrame(() => setError(`Não foi possível guardar o formulário temporário: ${message}`));
    }
  }, [editor, persistedEditorKey]);
  useEffect(() => {
    const pending = pendingEditorCleanup.current;
    if (!pending) return;
    if (cloudSaveVersion < pending.targetVersion) return;
    try {
      sessionStorage.removeItem(persistedEditorKey);
      sessionStorage.removeItem(`alpha-tec.form-draft.v1.${draftScope || "local"}.${pending.editor.kind}.${pending.editor.id ?? "new"}`);
      pendingEditorCleanup.current = null;
    } catch (cause) {
      console.warn("Não foi possível remover o formulário sincronizado.", cause);
    }
  }, [cloudSaveVersion, draftScope, persistedEditorKey]);
  function closeNestedEditor(saved = false) {
    if (editor && saved && cloudEnabled) {
      pendingEditorCleanup.current = { editor, targetVersion: getSaveRequestVersion() };
    } else if (editor) {
      try {
        sessionStorage.removeItem(persistedEditorKey);
        sessionStorage.removeItem(`alpha-tec.form-draft.v1.${draftScope || "local"}.${editor.kind}.${editor.id ?? "new"}`);
      } catch (cause) {
        console.warn("Não foi possível remover o formulário temporário.", cause);
      }
    }
    setEditor(null);
  }
  const details = editing ? draft : getOrderDetails(order);
  const client = data.clients.find((item) => item.id === order.clientId)!;
  const pending = orderPending({ ...order, details });
  const linkedEquipment = [
    ...new Set([order.equipmentId, ...details.equipmentIds].filter(Boolean)),
  ];
  const totals = activityTotals(details.activities, clock);
  const values = orderValues(details);
  const linkedQuotes = data.quotes.filter((item) => item.orderId === order.id);
  const availableQuotes = data.quotes.filter(
    (item) => item.clientId === order.clientId && !item.orderId,
  );
  const images = details.attachments.filter((file) =>
    file.mime.startsWith("image/"),
  );

  function act(
    update: (current: Database) => Database,
    success: string,
  ): boolean {
    try {
      commit(update);
      setError("");
      setNotice(success);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  }
  function startEditing() {
    const current = getOrderDetails(order);
    setDraft(current);
    setSnapshot(JSON.stringify(current));
    setError("");
    setEditing(true);
  }
  function save() {
    if (busy) return;
    if (
      act(
        (current) =>
          updateOrderDetails(
            current,
            order.id,
            (existing) => {
              if (JSON.stringify(existing) !== snapshot)
                throw new Error(
                  "Esta OS foi alterada em outra aba. Cancele e abra a edição novamente.",
                );
              assertSingleEquipmentQuestionnaire(draft.checklists);
              if (draft.travel) assertTravelReady(draft.travel, draft.travel.chargeTravel);
              return draft;
            },
            `Informações da OS atualizadas: ${tab}`,
          ),
        "Alterações salvas.",
      )
    ) {
      setEditing(false);
      if (cloudEnabled) {
        pendingDraftCleanup.current = getSaveRequestVersion();
      } else {
        try {
          sessionStorage.removeItem(persistedDraftKey);
        } catch (cause) {
          console.warn("Não foi possível remover o rascunho salvo da OS.", cause);
        }
      }
    }
  }
  function cancel() {
    if (busy) return;
    if (
      JSON.stringify(draft) !== snapshot &&
      !confirm("Descartar as alterações não salvas?")
    )
      return;
    setEditing(false);
    setError("");
    try {
      sessionStorage.removeItem(persistedDraftKey);
    } catch (cause) {
      console.warn("Não foi possível remover o rascunho descartado da OS.", cause);
    }
  }
  function patch(update: Partial<OrderDetails>) {
    setDraft((previous) => ({ ...previous, ...update }));
  }
  function answer(
    checklistId: string,
    questionId: string,
    value: string | string[],
  ) {
    setDraft((previous) => ({
      ...previous,
      checklists: previous.checklists.map((checklist) =>
        checklist.id === checklistId
          ? {
              ...checklist,
              questions: checklist.questions.map((question) =>
                question.id === questionId
                  ? withQuestionAnswer(question, value)
                  : question,
              ),
            }
          : checklist,
      ),
    }));
  }
  async function upload(
    files: FileList | null,
    question?: { checklistId: string; questionId: string; justificationPhoto?: boolean },
  ) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const attachments = await Promise.all(
        Array.from(files).map((file) => {
          const definition = question ? draft.checklists.find((item) => item.id === question.checklistId)?.questions.find((item) => item.id === question.questionId) : undefined;
          return definition ? prepareQuestionnairePhoto(file, !question?.justificationPhoto && (definition.photoMetadata ?? false)) : readAttachment(file);
        }),
      );
      setDraft((previous) => ({
        ...previous,
        attachments: [...previous.attachments, ...attachments],
        checklists: question
          ? previous.checklists.map((checklist) =>
              checklist.id === question.checklistId
                ? {
                    ...checklist,
                    questions: checklist.questions.map((item) =>
                      item.id === question.questionId
                        ? question.justificationPhoto ? { ...item, justificationPhotoId: attachments[0].id } : { ...item, answer: attachments[0].id }
                        : item,
                    ),
                  }
                : checklist,
            )
          : previous.checklists,
      }));
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  function removeFile(id: string) {
    setDraft((previous) => ({
      ...previous,
      attachments: previous.attachments.filter((file) => file.id !== id),
      checklists: previous.checklists.map((checklist) => ({
        ...checklist,
        questions: checklist.questions.map((question) =>
          ({
            ...question,
            ...(question.kind === "Foto" && question.answer === id ? { answer: "" } : {}),
            ...(question.justificationPhotoId === id ? { justificationPhotoId: "" } : {}),
          }),
        ),
      })),
    }));
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}${location.pathname}#orders/${order.id}`,
      );
      setNotice("Link interno copiado.");
    } catch {
      setError(
        "Não foi possível acessar a área de transferência. Copie o endereço do navegador.",
      );
    }
  }
  function exportDocument() {
    const report = document.querySelector(".order-page .order-print-only");
    if (!report) {
      setError("Não foi possível preparar o relatório. Reabra a tarefa e tente novamente.");
      return;
    }
    const content = document.createElement("div");
    content.append(report.cloneNode(true));
    content.querySelector(".report-watermark")?.remove();
    content.querySelectorAll("h1, h2, h3, p, section, tr, .print-question").forEach((element) => element.append("\n"));
    content.querySelectorAll("td, th").forEach((element) => element.append("\t"));
    const text = (content.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
    downloadFile(`${order.code}.txt`, text, "text/plain;charset=utf-8");
    act(
      (current) =>
        updateOrderDetails(
          current,
          order.id,
          (existing) => existing,
          "Documento exportado localmente; não enviado ao cliente",
        ),
      "Documento preparado para download.",
    );
  }
  function addItem() {
    const [kind, id] = catalog.split(":");
    const item = (kind === "produto" ? data.products : data.services).find(
      (record) => record.id === id,
    );
    if (!item) return;
    patch({
      items: [
        ...details.items,
        {
          id: makeId(),
          referenceId: id,
          kind: kind as "produto" | "servico",
          name: item.name,
          price: item.price,
          quantity: 1,
          discount: 0,
        },
      ],
    });
    setCatalog("");
  }
  function back() {
    if (
      editing &&
      JSON.stringify(draft) !== snapshot &&
      !confirm("Sair sem salvar as alterações?")
    )
      return;
    onBack();
  }

  return (
    <div className="order-page">
      <header className="order-topbar">
        <button className="text-button" onClick={back}>
          <ArrowLeft size={17} />
          Ordens de serviço
        </button>
        <span>{data.settings.company}</span>
        <span className="local-badge">Dados locais</span>
      </header>
      <main className="order-main">
        <div className="order-page-heading">
          <div>
            <span className="eyebrow">ORDEM DE SERVIÇO / {order.code}</span>
            <h1>{order.title}</h1>
            <p>
              {client.name} · {displayDate(order.date)} às {order.time}
            </p>
          </div>
          <div className="order-heading-actions">
            <Badge value={details.archived ? "Arquivada" : order.status} />
            {pending.length > 0 && (
              <button
                className="pending-pill"
                onClick={() => setTab("Pendências")}
              >
                <TriangleAlert size={14} />
                {pending.length} pendências
              </button>
            )}
          </div>
        </div>
        <div className="order-actionbar document-controls">
          {editing ? (
            <>
              <button className="button primary" onClick={save} disabled={busy}>
                <Save size={16} />
                Salvar alterações
              </button>
              <button
                className="button secondary"
                onClick={cancel}
                disabled={busy}
              >
                <X size={16} />
                Cancelar edição
              </button>
            </>
          ) : (
            <>
              <button className="button primary" onClick={startEditing}>
                <Pencil size={16} />
                Editar informações
              </button>
              <button
                className="button secondary"
                onClick={() => setEditor({ kind: "order", id: order.id })}
              >
                <Clock3 size={16} />
                Reagendar / dados básicos
              </button>
              <button
                className="button secondary"
                onClick={() => setDialog("replicate")}
              >
                <Copy size={16} />
                Replicar
              </button>
              <button
                className="button secondary"
                onClick={() => void copyLink()}
              >
                <Link2 size={16} />
                Copiar link interno
              </button>
              <button
                className="icon-button"
                title="Imprimir OS completa"
                aria-label="Imprimir OS completa"
                onClick={() => window.print()}
              >
                <Printer size={18} />
              </button>
              <button
                className="icon-button"
                title={details.archived ? "Restaurar OS" : "Arquivar OS"}
                aria-label={details.archived ? "Restaurar OS" : "Arquivar OS"}
                onClick={() => {
                  if (
                    confirm(
                      details.archived
                        ? "Restaurar esta OS?"
                        : "Arquivar esta OS? O registro não será apagado e poderá ser restaurado.",
                    )
                  )
                    act(
                      (current) =>
                        updateOrderDetails(
                          current,
                          order.id,
                          (existing) => ({
                            ...existing,
                            archived: !existing.archived,
                          }),
                          details.archived ? "OS restaurada" : "OS arquivada",
                        ),
                      details.archived ? "OS restaurada." : "OS arquivada.",
                    );
                }}
              >
                {details.archived ? (
                  <RotateCcw size={18} />
                ) : (
                  <Archive size={18} />
                )}
              </button>
            </>
          )}
        </div>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="order-notice" role="status">
            <Check size={17} />
            {notice}
          </div>
        )}
        <nav
          className="order-tabs document-controls"
          aria-label="Informações da OS"
        >
          {tabs.map((label) => (
            <button
              key={label}
              className={tab === label ? "active" : ""}
              aria-current={tab === label ? "page" : undefined}
              onClick={() => setTab(label)}
            >
              {label}
              {label === "Pendências" && pending.length > 0 && (
                <b>{pending.length}</b>
              )}
            </button>
          ))}
        </nav>
        <section className="order-panel" aria-label={tab}>
          {tab === "Detalhes" && (
            <>
              <div className="order-two-columns">
                <section>
                  <h2>
                    <FileText size={18} />
                    Dados da tarefa
                  </h2>
                  <dl className="order-facts">
                    <div>
                      <dt>Cliente</dt>
                      <dd>{client.name}</dd>
                    </div>
                    <div>
                      <dt>Endereço de atendimento</dt>
                      <dd>{orderServiceAddress(order, client) || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Endereço cadastrado do cliente</dt>
                      <dd>{client.address || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Responsável pelo atendimento</dt>
                      <dd>{details.responsibleName || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Telefone do responsável</dt>
                      <dd>{details.responsiblePhone || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Técnico</dt>
                      <dd>{order.technician}</dd>
                    </div>
                    <div>
                      <dt>Tipo / prioridade</dt>
                      <dd>
                        {order.type} · {order.priority}
                      </dd>
                    </div>
                    <div>
                      <dt>Agendamento</dt>
                      <dd>
                        {displayDate(order.date)} às {order.time} ·{" "}
                        {order.duration} min
                      </dd>
                    </div>
                    <div>
                      <dt>Criação</dt>
                      <dd>
                        {details.createdAt
                          ? new Date(details.createdAt).toLocaleString("pt-BR")
                          : "Data não registrada na base anterior"}
                      </dd>
                    </div>
                  </dl>
                  <h3>Orientações</h3>
                  <p className="preserve-lines">
                    {order.notes || "Sem orientações."}
                  </p>
                </section>
                <section>
                  <h2>
                    <Clock3 size={18} />
                    Monitoramento local
                  </h2>
                  <dl className="order-facts">
                    <div>
                      <dt>Check-in</dt>
                      <dd>
                        {details.activities.find(
                          (item) => item.kind === "Check-in",
                        )
                          ? new Date(
                              details.activities.find(
                                (item) => item.kind === "Check-in",
                              )!.at,
                            ).toLocaleString("pt-BR")
                          : "Não registrado"}
                      </dd>
                    </div>
                    <div>
                      <dt>Check-out</dt>
                      <dd>
                        {details.activities.findLast(
                          (item) => item.kind === "Check-out",
                        )
                          ? new Date(
                              details.activities.findLast(
                                (item) => item.kind === "Check-out",
                              )!.at,
                            ).toLocaleString("pt-BR")
                          : "Não registrado"}
                      </dd>
                    </div>
                    <div>
                      <dt>Finalização</dt>
                      <dd>
                        {order.status === "Finalizada"
                          ? pending.length
                            ? "Finalizada com pendências"
                            : "Finalizada sem pendências"
                          : "Em aberto"}
                      </dd>
                    </div>
                    <div>
                      <dt>Recebimento no aplicativo</dt>
                      <dd>Não disponível · aplicativo não conectado</dd>
                    </div>
                  </dl>
                  <div className="form-grid">
                    <label className="field">
                      Código externo
                      <input
                        disabled={!editing}
                        value={details.externalCode}
                        maxLength={100}
                        onChange={(event) =>
                          patch({ externalCode: event.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      Km informado
                      <input
                        disabled={!editing}
                        type="number"
                        min="0"
                        max="100000"
                        step="0.1"
                        value={details.distanceKm}
                        onChange={(event) =>
                          patch({ distanceKm: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field full">
                      Palavras-chave
                      <input
                        disabled={!editing}
                        value={details.tags.join(", ")}
                        onChange={(event) =>
                          patch({
                            tags: event.target.value
                              .split(",")
                              .map((value) => value.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>
                  </div>
                </section>
              </div>
              <section className="order-section">
                <div className="section-heading">
                  <h2>Orçamentos associados</h2>
                  {!editing && (
                    <button
                      className="button secondary"
                      onClick={() => setEditor({ kind: "quote" })}
                    >
                      <Plus size={16} />
                      Criar orçamento
                    </button>
                  )}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Situação</th>
                        <th>Solicitação</th>
                        <th>Validade</th>
                        <th>Valor</th>
                        <th className="document-controls">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linkedQuotes.map((quote) => (
                        <tr key={quote.id}>
                          <td>{quote.code}</td>
                          <td>
                            <Badge value={quote.status} />
                          </td>
                          <td>{displayDate(quote.date)}</td>
                          <td>{displayDate(quote.expires)}</td>
                          <td>{currency(total(quote))}</td>
                          <td className="document-controls">
                            <button
                              className="icon-button"
                              disabled={editing}
                              title="Desassociar orçamento"
                              aria-label={`Desassociar ${quote.code}`}
                              onClick={() =>
                                act(
                                  (current) => ({
                                    ...current,
                                    quotes: current.quotes.map((item) =>
                                      item.id === quote.id
                                        ? { ...item, orderId: "" }
                                        : item,
                                    ),
                                  }),
                                  "Orçamento desassociado.",
                                )
                              }
                            >
                              <X size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!linkedQuotes.length && (
                    <Empty title="Nenhum orçamento associado" />
                  )}
                </div>
                {!editing && (
                  <div className="inline-add">
                    <select
                      aria-label="Orçamento para associar"
                      value={quoteId}
                      onChange={(event) => setQuoteId(event.target.value)}
                    >
                      <option value="">
                        Selecione um orçamento deste cliente
                      </option>
                      {availableQuotes.map((quote) => (
                        <option key={quote.id} value={quote.id}>
                          {quote.code} · {currency(total(quote))}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button secondary"
                      disabled={!quoteId}
                      onClick={() => {
                        if (
                          act(
                            (current) =>
                              associateQuote(current, order.id, quoteId),
                            "Orçamento associado.",
                          )
                        )
                          setQuoteId("");
                      }}
                    >
                      <Link2 size={16} />
                      Associar
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "Relato e assinatura" && (
            <>
              <section className="order-section">
                <h2>Informe o que foi feito</h2>
                <textarea
                  aria-label="Relato técnico"
                  disabled={!editing}
                  value={details.report}
                  onChange={(event) => patch({ report: event.target.value })}
                  rows={7}
                  maxLength={10000}
                />
                <div className="field-counter">
                  {details.report.length} / 10000
                </div>
              </section>
              <section className="order-section">
                <div className="section-heading">
                  <h2>Assinatura</h2>
                  {editing && (
                    <div className="row-actions">
                      <button
                        className="button secondary"
                        onClick={() => setDialog("signature")}
                      >
                        <Pencil size={16} />
                        Coletar assinatura
                      </button>
                      {details.signature && (
                        <button
                          className="icon-button danger"
                          title="Remover assinatura"
                          aria-label="Remover assinatura"
                          onClick={() => {
                            if (confirm("Remover a assinatura desta edição?"))
                              patch({ signature: null });
                          }}
                        >
                          <Trash2 size={17} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {details.signature ? (
                  <div className="signature-evidence">
                    <img
                      src={details.signature.image}
                      alt={`Assinatura de ${details.signature.signer}`}
                    />
                    <strong>{details.signature.signer}</strong>
                    <small>
                      {new Date(details.signature.at).toLocaleString("pt-BR")} ·
                      Coleta local, sem verificação de identidade
                    </small>
                  </div>
                ) : (
                  <Empty title="Nenhuma assinatura coletada" />
                )}
              </section>
            </>
          )}
          {tab === "Anexos e fotos" && (
            <>
              <section className="order-section">
                <div className="section-heading">
                  <h2>
                    <Paperclip size={17} />
                    Arquivos
                  </h2>
                  {editing && (
                    <label className="button secondary">
                      <Plus size={16} />
                      Adicionar anexo
                      <input
                        className="file-input"
                        aria-label="Adicionar anexo"
                        type="file"
                        accept="application/pdf,text/plain,image/png,image/jpeg,image/webp"
                        multiple
                        disabled={busy}
                        onChange={(event) => {
                          void upload(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
                {details.attachments
                  .filter((file) => !file.mime.startsWith("image/"))
                  .map((file) => (
                    <div className="attachment-row" key={file.id}>
                      <FileText size={20} />
                      <div>
                        <a href={file.data} download={file.name}>
                          {file.name}
                        </a>
                        <small>
                          {Math.ceil(file.size / 1000)} KB ·{" "}
                          {new Date(file.at).toLocaleString("pt-BR")}
                        </small>
                      </div>
                      {editing && (
                        <button
                          className="icon-button danger"
                          title="Remover anexo"
                          aria-label={`Remover ${file.name}`}
                          onClick={() => removeFile(file.id)}
                        >
                          <Trash2 size={17} />
                        </button>
                      )}
                    </div>
                  ))}
                {!details.attachments.some(
                  (file) => !file.mime.startsWith("image/"),
                ) && <Empty title="Nenhum arquivo anexado" />}
              </section>
              <section className="order-section">
                <div className="section-heading">
                  <h2>
                    <ImagePlus size={17} />
                    Fotos
                  </h2>
                  {editing && (
                    <label className="button secondary">
                      <Plus size={16} />
                      Adicionar foto
                      <input
                        className="file-input"
                        aria-label="Adicionar foto"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        disabled={busy}
                        onChange={(event) => {
                          void upload(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
                <div className="photo-grid">
                  {images.map((file) => (
                    <figure key={file.id}>
                      <a href={file.data} download={file.name}>
                        <img src={file.data} alt={file.name} />
                      </a>
                      <figcaption>
                        <span>{file.name}</span>
                        {editing && (
                          <button
                            className="icon-button danger"
                            title="Remover foto"
                            aria-label={`Remover ${file.name}`}
                            onClick={() => removeFile(file.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </figcaption>
                    </figure>
                  ))}
                </div>
                {!images.length && <Empty title="Nenhuma foto anexada" />}
              </section>
            </>
          )}
          {tab === "Questionários" && (
            <>
              <div className="section-heading">
                <h2>
                  <ClipboardList size={18} />
                  Questionários da OS
                </h2>
                {editing && (
                  <div className="row-actions">
                    <button
                      className="button secondary"
                      onClick={() => setDialog("checklist")}
                    >
                      <Plus size={16} />
                      Adicionar questionário
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setDialog("question")}
                    >
                      <Plus size={16} />
                      Nova pergunta
                    </button>
                  </div>
                )}
              </div>
              {details.checklists.some((item) => item.equipmentId && details.checklists.filter((other) => other.equipmentId === item.equipmentId).length > 1) &&
                <p role="alert" className="error-message">Há equipamentos com mais de um questionário nesta tarefa. Em Editar informações, use “Manter somente este questionário” no questionário correto de cada equipamento. As respostas do escolhido serão preservadas.</p>}
              {details.checklists.map((checklist) => (
                <section className="checklist-block" key={checklist.id}>
                  {editing && checklist.equipmentId && details.checklists.filter((item) => item.equipmentId === checklist.equipmentId).length > 1 &&
                    <button className="button secondary" onClick={() => {
                      if (!window.confirm(`Manter somente "${checklist.title}" neste equipamento? As respostas deste questionário serão preservadas. Os outros questionários deste equipamento e suas respostas serão removidos; os arquivos anexados serão mantidos.`)) return;
                      try { patch({ checklists: keepEquipmentQuestionnaire(details.checklists, checklist.id) }); setError(""); }
                      catch (cause) { setError(errorMessage(cause)); }
                    }}>Manter somente este questionário</button>}
                  <div className="section-heading">
                    <h2>{checklist.title}</h2>
                    {editing && (
                      <button
                        className="icon-button danger"
                        title="Remover questionário"
                        aria-label={`Remover ${checklist.title}`}
                        onClick={() =>
                          patch({
                            checklists: details.checklists.filter(
                              (item) => item.id !== checklist.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  {checklist.templateId && <small>{order.status === "Finalizada" || details.archived ? "Questionário preservado no histórico desta tarefa" : "Questionário vinculado · Alterações do cadastro são aplicadas automaticamente"}</small>}
                  <p>{checklist.requiredForCheckout === false ? "Preenchimento opcional para check-out." : "Perguntas obrigatórias bloqueiam o check-out enquanto não respondidas."}</p>
                  {checklist.header && <p className="questionnaire-text">{checklist.header}</p>}
                  {(!checklist.display || checklist.display.equipment) && <label className="field questionnaire-equipment">
                    Equipamento
                    <select
                      disabled={!editing}
                      value={checklist.equipmentId}
                      onChange={(event) => {
                        try { patch({ checklists: assignQuestionnaireEquipment(details.checklists, checklist.id, event.target.value) }); setError(""); }
                        catch (cause) { setError(errorMessage(cause)); }
                      }}
                    >
                      <option value="">Questionário da tarefa</option>
                      {data.equipment
                        .filter((item) => linkedEquipment.includes(item.id))
                        .map((item) => (
                          <option key={item.id} value={item.id} disabled={details.checklists.some((other) => other.id !== checklist.id && other.equipmentId === item.id)}>
                            {item.name} · {item.assetCode ?? item.serial}
                          </option>
                        ))}
                    </select>
                  </label>}
                  <div className="form-grid">
                    {checklist.questions.map((question, index) => (
                      <div
                        className="field full question-field"
                        key={question.id}
                      >
                        <div className="question-heading">
                          <span>
                            {index + 1}. {question.label}
                            {question.required ? " *" : ""}
                          </span>
                          {editing && (
                            <button
                              className="icon-button danger"
                              title="Remover pergunta"
                              aria-label={`Remover pergunta ${question.label}`}
                              onClick={() =>
                                patch({
                                  checklists: details.checklists
                                    .map((item) =>
                                      item.id === checklist.id
                                        ? {
                                            ...item,
                                            questions: item.questions.filter(
                                              (record) =>
                                                record.id !== question.id,
                                            ),
                                          }
                                        : item,
                                    )
                                    .filter(
                                      (item) => item.questions.length > 0,
                                    ),
                                })
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                        {question.description && <p className="questionnaire-text">{question.description}</p>}
                        {question.kind === "Sim ou Não" ? <div>
                          <select aria-label={question.label} disabled={!editing || busy} value={String(question.answer)} onChange={(event) => answer(checklist.id, question.id, event.target.value)}><option value="">Selecione</option><option value="Sim">Sim</option><option value="Nao">Não</option></select>
                          {requiresJustification(question) && <div>
                            <label className="field">Justificativa de {question.label} *<textarea disabled={!editing || busy} rows={3} maxLength={10000} value={question.justification ?? ""} onChange={(event) => patch({ checklists: details.checklists.map((item) => item.id === checklist.id ? { ...item, questions: item.questions.map((record) => record.id === question.id ? { ...record, justification: event.target.value } : record) } : item) })} /></label>
                            <small>Justificativa obrigatória. Foto opcional.</small>
                            {editing && <div className="row-actions">{[true, false].map((capture) => <label key={String(capture)} className="button secondary">
                              {capture ? "Tirar foto" : "Enviar imagem"}
                              <input className="file-input" aria-label={`${capture ? "Tirar foto" : "Enviar imagem"} para ${question.label}`} type="file" accept="image/png,image/jpeg,image/webp" capture={capture ? "environment" : undefined} disabled={busy} onChange={(event) => { void upload(event.target.files, { checklistId: checklist.id, questionId: question.id, justificationPhoto: true }); event.target.value = ""; }} />
                            </label>)}</div>}
                            {question.justificationPhotoId && <div>
                              <img className="question-justification-photo" src={details.attachments.find((file) => file.id === question.justificationPhotoId)?.data} alt={`Foto da justificativa de ${question.label}`} />
                              {editing && <button disabled={busy} className="text-button" onClick={() => patch({ checklists: details.checklists.map((item) => item.id === checklist.id ? { ...item, questions: item.questions.map((record) => record.id === question.id ? { ...record, justificationPhotoId: "" } : record) } : item) })}>Remover foto da justificativa</button>}
                            </div>}
                          </div>}
                        </div> : question.kind === "Multipla escolha" ? (
                          <div className="question-options">
                            {question.options.map((option) => (
                              <label key={option}>
                                <input
                                  type="checkbox"
                                  disabled={!editing}
                                  checked={
                                    Array.isArray(question.answer) &&
                                    question.answer.includes(option)
                                  }
                                  onChange={(event) => {
                                    const selected = Array.isArray(
                                      question.answer,
                                    )
                                      ? question.answer
                                      : [];
                                    answer(
                                      checklist.id,
                                      question.id,
                                      event.target.checked
                                        ? [...selected, option]
                                        : selected.filter(
                                            (item) => item !== option,
                                          ),
                                    );
                                  }}
                                />
                                {option}
                              </label>
                            ))}
                          </div>
                        ) : question.kind === "Escolha" ||
                          question.kind === "Check" ? (
                          <select
                            aria-label={question.label}
                            disabled={!editing}
                            value={String(question.answer)}
                            onChange={(event) =>
                              answer(
                                checklist.id,
                                question.id,
                                event.target.value,
                              )
                            }
                          >
                            <option value="">Selecione</option>
                            {(question.kind === "Check"
                              ? ["Sim", "Nao"]
                              : question.options
                            ).map((option) => (
                              <option key={option}>{option}</option>
                            ))}
                          </select>
                        ) : question.kind === "Foto" ? (
                          <div className="inline-add">
                            <select
                              aria-label={question.label}
                              disabled={!editing || question.photoMetadata}
                              value={String(question.answer)}
                              onChange={(event) =>
                                answer(
                                  checklist.id,
                                  question.id,
                                  event.target.value,
                                )
                              }
                            >
                              <option value="">Selecione uma foto da OS</option>
                              {images.map((file) => (
                                <option key={file.id} value={file.id}>
                                  {file.name}
                                </option>
                              ))}
                            </select>
                            {question.photoMetadata && <small>Envie uma foto para gravar localização, data e hora na imagem.</small>}
                            {editing && question.photoMetadata && question.answer && <button className="text-button" onClick={() => answer(checklist.id, question.id, "")}>Limpar resposta da foto</button>}
                            {editing && (
                              <label className="button secondary">
                                <ImagePlus size={16} />
                                Foto
                                <input
                                  className="file-input"
                                  aria-label={`Foto para ${question.label}`}
                                  type="file"
                                  accept="image/png,image/jpeg,image/webp"
                                  disabled={busy}
                                  onChange={(event) => {
                                    void upload(event.target.files, {
                                      checklistId: checklist.id,
                                      questionId: question.id,
                                    });
                                    event.target.value = "";
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        ) : question.kind === "Assinatura" ? (
                          <div>
                            <Badge
                              value={
                                (question.signature === undefined ? details.signature : question.signature) ? "Coletada" : "Não coletada"
                              }
                            />
                            {(question.signature === undefined ? details.signature : question.signature) && <div className="question-signature">
                              <img src={(question.signature === undefined ? details.signature : question.signature)!.image} alt={`Assinatura para ${question.label}`} />
                              <small>{(question.signature === undefined ? details.signature : question.signature)!.signer}</small>
                            </div>}
                            {editing && (
                              <button
                                className="text-button"
                                onClick={() => { setSignatureQuestion({ checklistId: checklist.id, questionId: question.id }); setDialog("signature"); }}
                              >
                                Coletar assinatura
                              </button>
                            )}
                            {editing && question.signature && <button className="text-button" onClick={() => patch({ checklists: details.checklists.map((item) => item.id === checklist.id ? { ...item, questions: item.questions.map((record) => record.id === question.id ? { ...record, signature: null } : record) } : item) })}>Remover assinatura desta pergunta</button>}
                          </div>
                        ) : question.kind === "Texto" || question.kind === "Area de texto" ? (
                          <textarea
                            rows={3}
                            aria-label={question.label}
                            disabled={!editing}
                            maxLength={10000}
                            value={String(question.answer)}
                            onChange={(event) =>
                              answer(
                                checklist.id,
                                question.id,
                                event.target.value,
                              )
                            }
                          />
                        ) : (
                          <input
                            aria-label={question.label}
                            disabled={!editing}
                            type={
                              question.kind === "Numero" ||
                              question.kind === "Monetaria"
                                ? "number"
                                : question.kind === "Data"
                                  ? "date"
                                  : question.kind === "Hora"
                                    ? "time"
                                    : "text"
                            }
                            step="any"
                            value={String(question.answer)}
                            onChange={(event) =>
                              answer(
                                checklist.id,
                                question.id,
                                event.target.value,
                              )
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  {checklist.footer && <p className="questionnaire-text">{checklist.footer}</p>}
                </section>
              ))}
              {!details.checklists.length && (
                <Empty title="Nenhum questionário associado" />
              )}
            </>
          )}
          {tab === "Equipamentos" && (
            <>
            {editing
              ? <EquipmentSelections data={data} value={details.equipmentModels} onChange={(equipmentModels) => patch({ equipmentModels })} />
              : <EquipmentSelectionSummary value={details.equipmentModels} />}
              <h2>
                <Wrench size={18} />
                Equipamentos associados
              </h2>
              <div className="equipment-choices">
                {data.equipment
                  .filter((item) => item.clientId === order.clientId)
                  .map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        disabled={!editing || item.id === order.equipmentId}
                        checked={linkedEquipment.includes(item.id)}
                        onChange={(event) =>
                          patch({
                            equipmentIds: event.target.checked
                              ? [...details.equipmentIds, item.id]
                              : details.equipmentIds.filter(
                                  (id) => id !== item.id,
                                ),
                          })
                        }
                      />
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.assetCode ?? item.serial} · {item.category}
                          {item.id === order.equipmentId ? " · Principal" : ""}
                        </small>
                        {item.model && <small>{item.model.brand}{item.model.line ? ` · ${item.model.line}` : ""} · {item.model.name}</small>}
                        {item.warranty && (
                          <small>
                            Garantia até {displayDate(item.warranty)}
                          </small>
                        )}
                        <small>{item.notes}</small>
                      </span>
                    </label>
                  ))}
              </div>
              {!data.equipment.some(
                (item) => item.clientId === order.clientId,
              ) && (
                <Empty title="Este cliente não possui equipamentos cadastrados" />
              )}
            </>
          )}
          {tab === "Pendências" && (
            <>
              <div className="section-heading">
                <h2>
                  <TriangleAlert size={18} />
                  Pendências da OS
                </h2>
              </div>
              {editing && (
                <form
                  className="inline-add"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const title = String(form.get("title")).trim();
                    if (!title) return;
                    patch({
                      pending: [
                        ...details.pending,
                        { id: makeId(), title, resolved: false },
                      ],
                    });
                    event.currentTarget.reset();
                  }}
                >
                  <input
                    aria-label="Nova pendência"
                    name="title"
                    placeholder="Nova pendência"
                    maxLength={300}
                    required
                  />
                  <button className="button secondary">
                    <Plus size={16} />
                    Adicionar
                  </button>
                </form>
              )}
              {pending.map((item) => (
                <div className="pending-row" key={item.id}>
                  <TriangleAlert size={17} />
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.source}</small>
                  </div>
                  {editing &&
                    details.pending.some((record) => record.id === item.id) && (
                      <button
                        className="button secondary"
                        onClick={() =>
                          patch({
                            pending: details.pending.map((record) =>
                              record.id === item.id
                                ? { ...record, resolved: true }
                                : record,
                            ),
                          })
                        }
                      >
                        <Check size={15} />
                        Resolver
                      </button>
                    )}
                </div>
              ))}
              {!pending.length && <Empty title="Nenhuma pendência em aberto" />}
              {details.pending
                .filter((item) => item.resolved)
                .map((item) => (
                  <div className="pending-row resolved" key={item.id}>
                    <Check size={17} />
                    <strong>{item.title}</strong>
                    {editing && (
                      <button
                        className="text-button"
                        onClick={() =>
                          patch({
                            pending: details.pending.map((record) =>
                              record.id === item.id
                                ? { ...record, resolved: false }
                                : record,
                            ),
                          })
                        }
                      >
                        Reabrir
                      </button>
                    )}
                  </div>
                ))}
            </>
          )}
          {tab === "Controle de horas" && (
            <>
              <div className="section-heading">
                <h2>
                  <Clock3 size={18} />
                  Atividades e apontamentos
                </h2>
                <div className="row-actions">
                  <button
                    className="button secondary"
                    onClick={() => setDialog("history")}
                  >
                    <History size={16} />
                    Histórico completo
                  </button>
                  <button
                    className="button primary"
                    disabled={editing}
                    onClick={() => setDialog("activity")}
                  >
                    <Plus size={16} />
                    Adicionar atividade
                  </button>
                </div>
              </div>
              <div className="hours-summary">
                <div>
                  <small>Deslocamento</small>
                  <strong>{timeText(totals.travel)}</strong>
                </div>
                <div>
                  <small>Pausas</small>
                  <strong>{timeText(totals.pause)}</strong>
                </div>
                <div>
                  <small>Execução</small>
                  <strong>{timeText(totals.work)}</strong>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Colaborador</th>
                      <th>Atividade</th>
                      <th>Horário</th>
                      <th>Motivo</th>
                      <th>Justificativa</th>
                      <th>Origem</th>
                      <th>Localização</th>
                      <th>Distância do atendimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.activities.map((item) => (
                      <tr key={item.id}>
                        <td>{item.technician}</td>
                        <td>{item.kind}</td>
                        <td>{new Date(item.at).toLocaleString("pt-BR")}</td>
                        <td>{item.reason || "—"}</td>
                        <td>{item.justification || "—"}</td>
                        <td>{item.origin}</td>
                        <td>{item.location ? (
                          <a target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${item.location.latitude},${item.location.longitude}`}>
                            {item.location.latitude.toFixed(5)}, {item.location.longitude.toFixed(5)} (±{Math.round(item.location.accuracy)} m)
                          </a>
                        ) : "—"}</td>
                        <td>
                          {serviceDistanceText(item)}
                          {item.serviceDistance && <small>
                            Referência registrada: {item.serviceDistance.address} · {item.serviceDistance.latitude.toFixed(6)}, {item.serviceDistance.longitude.toFixed(6)}
                          </small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!details.activities.length && (
                  <Empty title="Nenhuma atividade registrada" />
                )}
              </div>
              <p>A distância é em linha reta, não quilometragem de rota. A precisão do GPS indica a margem de incerteza da posição; não comprova a presença no endereço.</p>
              <button className="button secondary" onClick={() => downloadFile(`${order.code}-atividades.csv`, csvContent(
                ["OS", "Colaborador", "Atividade", "Data/hora", "Origem", "Latitude GPS", "Longitude GPS", "Precisão GPS (m)", "Distância do atendimento (m)", "Endereço de referência", "Latitude de referência", "Longitude de referência", "Situação"],
                details.activities.map((item) => [
                  order.code, item.technician, item.kind, item.at, item.origin,
                  item.location?.latitude ?? "", item.location?.longitude ?? "", item.location?.accuracy ?? "",
                  item.serviceDistance?.meters ?? "", item.serviceDistance?.address ?? "",
                  item.serviceDistance?.latitude ?? "", item.serviceDistance?.longitude ?? "", serviceDistanceText(item),
                ]),
              ), "text/csv;charset=utf-8")}>Exportar atividades e distâncias</button>
            </>
          )}
          {tab === "Envios" && (
            <>
              <h2>
                <Send size={18} />
                Documentos e notificações
              </h2>
              <div className="delivery-status">
                <div>
                  <h3>OS digital</h3>
                  <Badge value="Não enviada" />
                  <small>Integração de e-mail não configurada</small>
                </div>
                <div>
                  <h3>Pesquisa de satisfação</h3>
                  <Badge value="Não enviada" />
                  <small>Integração de e-mail não configurada</small>
                </div>
              </div>
              <button
                className="button secondary document-controls"
                disabled={editing}
                onClick={exportDocument}
              >
                <FileText size={17} />
                Exportar documento local
              </button>
              <section className="order-section">
                <h3>Histórico de preparação</h3>
                {order.history
                  .filter((item) =>
                    item.description.includes("exportado localmente"),
                  )
                  .map((item) => (
                    <div className="attachment-row" key={item.id}>
                      <FileText size={16} />
                      <span>
                        {item.description}
                        <small>
                          {new Date(item.at).toLocaleString("pt-BR")}
                        </small>
                      </span>
                    </div>
                  ))}
              </section>
            </>
          )}
          {tab === "Valores" && (
            <>
              <TravelPanel data={data} order={{ ...order, details }} travel={details.travel} editing={editing} busy={busy}
                onBusy={setBusy} onChange={(travel) => patch({ travel })} onError={setError} />
              <div className="section-heading">
                <h2>Produtos e serviços</h2>
              </div>
              {editing && (
                <div className="inline-add">
                  <select
                    aria-label="Produto ou serviço da OS"
                    value={catalog}
                    onChange={(event) => setCatalog(event.target.value)}
                  >
                    <option value="">Selecione um item</option>
                    <optgroup label="Produtos">
                      {data.products.map((item) => (
                        <option key={item.id} value={`produto:${item.id}`}>
                          {item.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Serviços">
                      {data.services.map((item) => (
                        <option key={item.id} value={`servico:${item.id}`}>
                          {item.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <button
                    className="button secondary"
                    disabled={!catalog}
                    onClick={addItem}
                  >
                    <Plus size={16} />
                    Incluir item
                  </button>
                </div>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Descrição</th>
                      <th>Quantidade</th>
                      <th>Unitário (R$)</th>
                      <th>Desconto (R$)</th>
                      <th>Total</th>
                      <th className="document-controls">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.name}
                          <small>
                            {item.kind === "produto" ? "Produto" : "Serviço"}
                          </small>
                        </td>
                        <td>
                          <input
                            aria-label={`Quantidade ${item.name}`}
                            disabled={!editing}
                            type="number"
                            min="0.01"
                            max="10000"
                            step="0.01"
                            value={item.quantity}
                            onChange={(event) =>
                              patch({
                                items: details.items.map((record) =>
                                  record.id === item.id
                                    ? {
                                        ...record,
                                        quantity: Number(event.target.value),
                                      }
                                    : record,
                                ),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Unitário ${item.name}`}
                            disabled={!editing}
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.price / 100}
                            onChange={(event) =>
                              patch({
                                items: details.items.map((record) =>
                                  record.id === item.id
                                    ? {
                                        ...record,
                                        price: Math.round(
                                          Number(event.target.value) * 100,
                                        ),
                                      }
                                    : record,
                                ),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Desconto ${item.name}`}
                            disabled={!editing}
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.discount / 100}
                            onChange={(event) =>
                              patch({
                                items: details.items.map((record) =>
                                  record.id === item.id
                                    ? {
                                        ...record,
                                        discount: Math.round(
                                          Number(event.target.value) * 100,
                                        ),
                                      }
                                    : record,
                                ),
                              })
                            }
                          />
                        </td>
                        <td>
                          {currency(
                            Math.round(item.quantity * item.price) -
                              item.discount,
                          )}
                        </td>
                        <td className="document-controls">
                          {editing && (
                            <button
                              className="icon-button danger"
                              title="Remover item"
                              aria-label={`Remover ${item.name}`}
                              onClick={() =>
                                patch({
                                  items: details.items.filter(
                                    (record) => record.id !== item.id,
                                  ),
                                })
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!details.items.length && (
                  <Empty title="Nenhum produto ou serviço incluído" />
                )}
              </div>
              <section className="order-section">
                <h2>Custos adicionais</h2>
                {editing && (
                  <form
                    className="inline-add"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      patch({
                        costs: [
                          ...details.costs,
                          {
                            id: makeId(),
                            name: String(form.get("name")).trim(),
                            value: Math.round(Number(form.get("value")) * 100),
                          },
                        ],
                      });
                      event.currentTarget.reset();
                    }}
                  >
                    <input
                      name="name"
                      aria-label="Descrição do custo"
                      placeholder="Descrição do custo"
                      required
                      maxLength={200}
                    />
                    <input
                      name="value"
                      aria-label="Valor do custo"
                      type="number"
                      placeholder="R$"
                      min="0"
                      max="1000000"
                      step="0.01"
                      required
                    />
                    <button className="button secondary">
                      <Plus size={16} />
                      Incluir custo
                    </button>
                  </form>
                )}
                {details.costs.map((item) => (
                  <div className="attachment-row" key={item.id}>
                    <span>{item.name}</span>
                    <strong>{currency(item.value)}</strong>
                    {editing && (
                      <button
                        className="icon-button danger"
                        title="Remover custo"
                        aria-label={`Remover ${item.name}`}
                        onClick={() =>
                          patch({
                            costs: details.costs.filter(
                              (record) => record.id !== item.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </section>
              <div className="os-values-summary">
                <div>
                  <small>Itens</small>
                  <strong>{currency(values.items)}</strong>
                </div>
                <div>
                  <small>Custos</small>
                  <strong>{currency(values.costs)}</strong>
                </div>
                <div>
                  <small>Deslocamento cobrado</small>
                  <strong>{currency(details.travel ? travelValues(details.travel).mileageCharge : 0)}</strong>
                </div>
                <div>
                  <small>Pedágio cobrado</small>
                  <strong>{currency(details.travel?.chargeTravel ? details.travel.tolls : 0)}</strong>
                </div>
                <label className="field">
                  Desconto geral
                  <div className="discount-control">
                    <input
                      disabled={!editing}
                      aria-label="Desconto geral"
                      type="number"
                      min="0"
                      step="0.01"
                      value={
                        details.discountMode === "R$"
                          ? details.discount / 100
                          : details.discount
                      }
                      onChange={(event) =>
                        patch({
                          discount:
                            details.discountMode === "R$"
                              ? Math.round(Number(event.target.value) * 100)
                              : Number(event.target.value),
                        })
                      }
                    />
                    <select
                      disabled={!editing}
                      aria-label="Tipo do desconto"
                      value={details.discountMode}
                      onChange={(event) =>
                        patch({
                          discountMode: event.target.value as "R$" | "%",
                          discount: 0,
                        })
                      }
                    >
                      <option>R$</option>
                      <option>%</option>
                    </select>
                  </div>
                </label>
                <div className="grand-total">
                  <small>Total</small>
                  <strong>{currency(values.total)}</strong>
                </div>
              </div>
            </>
          )}
        </section>
        {editing && (
          <div className="order-savebar document-controls">
            <span>
              {busy ? "Lendo arquivos..." : persistedDraft ? "Rascunho recuperado automaticamente" : "Alterações ainda não salvas"}
            </span>
            <button className="button primary" onClick={save} disabled={busy}>
              <Save size={16} />
              Salvar alterações
            </button>
          </div>
        )}
        <OrderPrintable order={order} data={data} details={details} />
      </main>
      {editor && (
        <EditorModal
          editor={editor}
          data={data}
          draftScope={draftScope}
          commit={(update) =>
            commit((current) => {
              const next =
                typeof update === "function" ? update(current) : update;
              if (editor.kind !== "quote") return next;
              const created = next.quotes.find(
                (quote) =>
                  !current.quotes.some((existing) => existing.id === quote.id),
              );
              return created
                ? associateQuote(next, order.id, created.id)
                : next;
            })
          }
          onClose={closeNestedEditor}
          onSuccess={setNotice}
        />
      )}
      {dialog === "signature" && (
        <SignatureEditor
          signer={details.signature?.signer ?? client.name}
          onClose={() => { setDialog(null); setSignatureQuestion(null); }}
          onApply={(signature) => {
            if (signatureQuestion) {
              patch({ checklists: details.checklists.map((item) => item.id === signatureQuestion.checklistId ? { ...item, questions: item.questions.map((question) => question.id === signatureQuestion.questionId ? { ...question, signature } : question) } : item) });
            } else patch({ signature });
            setSignatureQuestion(null);
            setDialog(null);
          }}
        />
      )}
      {dialog === "checklist" && (
        <Modal title="Adicionar questionário" onClose={() => setDialog(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              try {
                const template = data.questionnaires.find((item) => item.id === questionnaireTemplateId && !item.archived);
                if (!template) throw new Error("Selecione um questionário ativo no catálogo.");
                const equipmentId = String(form.get("equipmentId") ?? "");
                const linked = details.checklists.filter((item) => equipmentId && item.equipmentId === equipmentId);
                if (linked.length && !(linked.length === 1 && linked[0].templateId === template.id) &&
                  !window.confirm("Este equipamento já possui questionário. Deseja manter somente o modelo selecionado? Se já estiver vinculado, suas respostas serão preservadas; caso contrário, começará sem respostas. Os outros questionários desse equipamento e suas respostas serão removidos. Os anexos e demais equipamentos serão preservados.")) return;
                patch({ checklists: equipmentId
                  ? replaceOrderQuestionnaire(details.checklists, template, equipmentId)
                  : addQuestionnaire(details.checklists, template) });
                setDialog(null); setQuestionnaireTemplateId(""); setError("");
              } catch (cause) { setError(errorMessage(cause)); }
            }}
          >
            <div className="modal-body form-grid">
              {error && <p role="alert" className="error-message full">{error}</p>}
              <label className="field full">
                Modelo
                <select name="type" required value={questionnaireTemplateId} onChange={(event) => setQuestionnaireTemplateId(event.target.value)}>
                  <option value="">Selecione um questionário</option>
                  {data.questionnaires.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
                {!data.questionnaires.some((item) => !item.archived) && <small>Cadastre um modelo em Cadastros → Questionários. Perguntas avulsas continuam disponíveis em Nova pergunta.</small>}
              </label>
              <label className="field full">
                Equipamento
                <select name="equipmentId" key={questionnaireTemplateId} disabled={!data.questionnaires.find((item) => item.id === questionnaireTemplateId)?.display.equipment}>
                  <option value="">Questionário da tarefa</option>
                  {data.equipment
                    .filter((item) => linkedEquipment.includes(item.id))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.assetCode ?? item.serial}
                      </option>
                    ))}
                </select>
              </label>
              <p className="full">Cada equipamento pode ter apenas um questionário nesta tarefa. Selecionar uma unidade já atendida substitui o modelo atual, após confirmação, sem adicionar outra manutenção.</p>
            </div>
            <footer className="modal-footer">
              <button className="button primary">
                <Plus size={16} />
                Adicionar
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {dialog === "question" && (
        <QuestionEditor
          checklists={details.checklists}
          onClose={() => setDialog(null)}
          onApply={(question, checklistId) => {
            if (checklistId)
              patch({
                checklists: details.checklists.map((item) =>
                  item.id === checklistId
                    ? { ...item, questions: [...item.questions, question] }
                    : item,
                ),
              });
            else
              patch({
                checklists: [
                  ...details.checklists,
                  {
                    id: makeId(),
                    title: "Checklist da OS",
                    equipmentId: "",
                    questions: [question],
                  },
                ],
              });
            setDialog(null);
          }}
        />
      )}
      {dialog === "activity" && (
        <ActivityEditor
          order={order}
          clientAddress={client.address}
          allowed={allowedActivities(details.activities)}
          onClose={() => setDialog(null)}
          onSave={(activity) => {
            let failure: unknown;
            try {
              commit((current) => appendActivity(current, order.id, activity));
              setNotice("Atividade registrada.");
              setError("");
              setDialog(null);
            } catch (cause) {
              failure = cause;
            }
            if (failure) throw failure;
          }}
        />
      )}
      {dialog === "replicate" && (
        <Modal title="Replicar OS" onClose={() => setDialog(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              let copyId = "";
              if (
                act((current) => {
                  const next = replicateOrder(
                    current,
                    order.id,
                    String(form.get("date")),
                    String(form.get("time")),
                  );
                  copyId = next.orders.at(-1)!.id;
                  return next;
                }, "OS replicada sem dados da execução anterior.")
              ) {
                setDialog(null);
                onOpen(copyId);
              }
            }}
          >
            <div className="modal-body form-grid">
              <label className="field">
                Nova data
                <input
                  type="date"
                  name="date"
                  defaultValue={shiftDay(localDay(), 1)}
                  required
                />
              </label>
              <label className="field">
                Horário
                <input
                  type="time"
                  name="time"
                  defaultValue={order.time}
                  required
                />
              </label>
            </div>
            <footer className="modal-footer">
              <button className="button primary">
                <Copy size={16} />
                Replicar
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {dialog === "history" && (
        <Modal
          title="Histórico completo de alterações"
          wide
          onClose={() => setDialog(null)}
        >
          <div className="modal-body table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Alteração</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {[...order.history].reverse().map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.at).toLocaleString("pt-BR")}</td>
                    <td>{event.description}</td>
                    <td>Web local</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!order.history.length && (
              <Empty title="Nenhuma alteração registrada" />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function SignatureEditor({
  signer,
  onClose,
  onApply,
}: {
  signer: string;
  onClose: () => void;
  onApply: (signature: NonNullable<OrderDetails["signature"]>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const canvas = canvasRef.current!;
    const pad = new SignaturePad(canvas, {
      backgroundColor: "#ffffff",
      penColor: "#252529",
    });
    padRef.current = pad;
    function resize() {
      const strokes = pad.toData();
      const ratio = Math.max(devicePixelRatio, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.getContext("2d")!.scale(ratio, ratio);
      pad.clear();
      if (strokes.length) pad.fromData(strokes);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => {
      observer.disconnect();
      pad.off();
      padRef.current = null;
    };
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (padRef.current!.isEmpty()) {
      setError("Desenhe a assinatura antes de aplicar.");
      return;
    }
    onApply({
      signer: String(new FormData(event.currentTarget).get("signer")).trim(),
      image: padRef.current!.toDataURL("image/png"),
      at: new Date().toISOString(),
    });
  }
  return (
    <Modal title="Coletar assinatura local" wide onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <label className="field">
            Nome de quem assina *
            <input
              name="signer"
              defaultValue={signer}
              maxLength={120}
              required
            />
          </label>
          <canvas
            ref={canvasRef}
            className="signature-canvas"
            aria-label="Área para desenhar assinatura"
          />
          <button
            type="button"
            className="text-button"
            onClick={() => padRef.current!.clear()}
          >
            <RotateCcw size={15} />
            Limpar desenho
          </button>
        </div>
        <footer className="modal-footer">
          <button className="button primary">
            <Check size={16} />
            Aplicar assinatura
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function QuestionEditor({
  checklists,
  onClose,
  onApply,
}: {
  checklists: Checklist[];
  onClose: () => void;
  onApply: (
    question: Checklist["questions"][number],
    checklistId: string,
  ) => void;
}) {
  const [kind, setKind] =
    useState<Checklist["questions"][number]["kind"]>("Texto");
  const [error, setError] = useState("");
  return (
    <Modal title="Nova pergunta" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const options = [
            ...new Set(
              String(form.get("options") ?? "")
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          ];
          if (
            ["Escolha", "Multipla escolha"].includes(kind) &&
            options.length < 2
          ) {
            setError("Cadastre pelo menos duas opções.");
            return;
          }
          onApply(
            {
              id: makeId(),
              label: String(form.get("label")).trim(),
              kind,
              required: form.get("required") === "on",
              options,
              answer: kind === "Multipla escolha" ? [] : "",
              description: String(form.get("description") ?? "").trim(),
              ...(kind === "Assinatura" ? { signature: null } : {}),
              ...(kind === "Sim ou Não" ? { justificationOn: questionDefinitionSchema.shape.justificationOn.parse(form.get("justificationOn")), justification: "", justificationPhotoId: "" } : {}),
            },
            String(form.get("checklist") ?? ""),
          );
        }}
      >
        <div className="modal-body form-grid">
          {error && (
            <div className="error-message full" role="alert">
              {error}
            </div>
          )}
          <label className="field full">
            Questionário
            <select name="checklist">
              <option value="">Novo checklist da OS</option>
              {checklists.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field full">
            Pergunta *<input name="label" required maxLength={200} />
          </label>
          <label className="field full">Descrição da pergunta<textarea name="description" rows={2} maxLength={3000} /></label>
          <label className="field">
            Tipo de resposta
            <select
              value={kind}
              onChange={(event) => setKind(questionDefinitionSchema.shape.kind.parse(event.target.value))}
            >
              {questionKinds.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" name="required" />
            Resposta obrigatória
          </label>
          {["Escolha", "Multipla escolha"].includes(kind) && (
            <label className="field full">
              Opções (uma por linha)
              <textarea name="options" rows={4} maxLength={3000} required />
            </label>
          )}
          {kind === "Sim ou Não" && <label className="field full">Exigir justificativa quando responder<select name="justificationOn" defaultValue="Nao"><option value="Sim">Sim</option><option value="Nao">Não</option></select><small>Texto obrigatório para a resposta selecionada. Foto opcional.</small></label>}
        </div>
        <footer className="modal-footer">
          <button className="button primary">
            <Plus size={16} />
            Adicionar pergunta
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ActivityEditor({
  order,
  clientAddress,
  allowed,
  onClose,
  onSave,
}: {
  order: Order;
  clientAddress: string;
  allowed: Activity["kind"][];
  onClose: () => void;
  onSave: (activity: Activity) => void;
}) {
  const [kind, setKind] = useState<Activity["kind"]>(allowed[0]);
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [at] = useState(localDateTime);
  return (
    <Modal title="Adicionar atividade" onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (locating) return;
          const form = new FormData(event.currentTarget);
          setLocating(true);
          try {
            const date = new Date(String(form.get("at")));
            if (date.getTime() > Date.now() + 1000)
              throw new Error("Não registre atividade em horário futuro.");
            const location = kind === "Check-in" || kind === "Check-out" ? await captureLocation() : undefined;
            onSave({
              id: makeId(),
              kind,
              at: date.toISOString(),
              technician: String(form.get("technician")).trim(),
              reason: String(form.get("reason") ?? "").trim(),
              justification: String(form.get("justification")).trim(),
              origin: "Web local",
              ...(location ? {
                location,
                serviceDistance: serviceDistanceForActivity(order, { address: clientAddress }, location),
              } : {}),
            });
          } catch (cause) {
            setError(errorMessage(cause));
          } finally { setLocating(false); }
        }}
      >
        <div className="modal-body form-grid">
          {error && (
            <div className="error-message full" role="alert">
              {error}
            </div>
          )}
          <label className="field">
            Atividade
            <select
              disabled={locating}
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as Activity["kind"])
              }
            >
              {allowed.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Data e horário *
            <input
              type="datetime-local"
              disabled={locating}
              name="at"
              step="1"
              defaultValue={at}
              required
            />
          </label>
          <label className="field full">
            Colaborador *
            <input
              name="technician"
              disabled={locating}
              defaultValue={order.technician}
              required
              maxLength={120}
            />
          </label>
          {kind === "Pausa" && (
            <label className="field full">
              Motivo da pausa *<input name="reason" disabled={locating} required maxLength={200} />
            </label>
          )}
          <label className="field full">
            Justificativa
            <textarea name="justification" disabled={locating} rows={3} maxLength={1000} />
          </label>
          {(kind === "Check-in" || kind === "Check-out") && <p className="full">Será solicitado o GPS deste dispositivo no momento do registro. A distância é calculada até o ponto confirmado do atendimento; o registro administrativo mantém a origem Web local.</p>}
        </div>
        <footer className="modal-footer">
          <button className="button primary" disabled={locating}>
            <Save size={16} />
            {locating ? "Obtendo GPS e registrando…" : "Registrar atividade"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function OrderPrintable({
  order,
  data,
  details,
  preview = false,
}: {
  order: Order;
  data: Database;
  details: OrderDetails;
  preview?: boolean;
}) {
  const client = data.clients.find((item) => item.id === order.clientId)!;
  const values = orderValues(details);
  const pending = orderPending({ ...order, details });
  const totals = activityTotals(details.activities);
  const equipmentIds = [order.equipmentId, ...details.equipmentIds];
  const equipment = data.equipment.filter((item) =>
    equipmentIds.includes(item.id),
  );
  const config = data.settings.reportSettings;
  const show = config.sections;
  const taskRows = [
    ...(show.client ? [
      ["Cliente", client.name],
      ["CPF/CNPJ", client.document || "Não informado"],
      ["Endereço de atendimento", orderServiceAddress(order, client)],
      ["Endereço cadastrado", client.address],
      ["Responsável pelo atendimento", `${details.responsibleName || "Não informado"} · Telefone: ${details.responsiblePhone || "Não informado"}`],
      ["Contato do cliente", `${client.phone} ${client.email}`.trim() || "Não informado"],
    ] : []),
    ...(show.schedule ? [
      ["Agendamento", `${displayDate(order.date)} às ${order.time} · ${order.duration} minutos`],
      ["Técnico", order.technician],
      ["Tipo / prioridade", `${order.type} · ${order.priority}`],
      ["Código externo", details.externalCode || "—"],
      ["Km informado", String(details.distanceKm)],
    ] : []),
  ];
  const checklists = details.checklists.filter((item) => item.display?.showOnOrder !== false);
  if (config.questionnaireOrder !== "task") checklists.sort((a, b) => {
    const equipmentLabel = (id: string) => {
      const item = data.equipment.find((unit) => unit.id === id);
      return item?.assetCode ?? item?.serial ?? "";
    };
    const first = config.questionnaireOrder === "name" ? a.title : equipmentLabel(a.equipmentId);
    const second = config.questionnaireOrder === "name" ? b.title : equipmentLabel(b.equipmentId);
    return first.localeCompare(second, "pt-BR", { numeric: true }) || a.title.localeCompare(b.title, "pt-BR");
  });
  return (
    <article className={`${preview ? "order-report-preview" : "order-print-only"} order-report layout-${config.layout} font-${config.fontSize}`}>
      {config.layout === "watermark" && show.company && <div className="report-watermark" aria-hidden="true">
        {data.settings.logo ? <img src={data.settings.logo} alt="" /> : <span>{data.settings.company}</span>}
      </div>}
      <header className="print-brand">
        {show.company && data.settings.logo && (
          <img src={data.settings.logo} alt={data.settings.company} />
        )}
        <div>
          <h1>{config.title}</h1>
          {show.company && <><h2>{data.settings.company}</h2><p>{[
            data.settings.cnpj && `CNPJ: ${data.settings.cnpj}`, data.settings.address,
            data.settings.phone, data.settings.email,
          ].filter(Boolean).join(" · ")}</p></>}
          <p>
            {order.code} · {order.title} · {order.status}
            {show.pending && pending.length ? " com pendências" : ""}
          </p>
        </div>
      </header>
      {(show.client || show.schedule) && <section>
      <h2>Dados da tarefa</h2>
      {config.layout === "classic" ? <table className="report-task-table"><tbody>
        {taskRows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value || "Não informado"}</td></tr>)}
      </tbody></table> : <p>{taskRows.map(([label, value]) => `${label}: ${value || "Não informado"}`).join("\n")}</p>}
      </section>}
      {show.instructions && <section>
      <h2>Orientações</h2>
      <p>{order.notes || "Não informadas."}</p>
      </section>}
      {show.report && <section>
      <h2>Relato técnico</h2>
      <p>{details.report || "Não registrado."}</p>
      </section>}
      {show.equipment && <section>
      <h2>Equipamentos</h2>
      <EquipmentSelectionSummary value={details.equipmentModels} />
      {equipment.length ? (
        equipment.map((item) => (
          <p key={item.id}>
            {item.name} · {item.assetCode ?? item.serial}
            {item.model ? ` · ${item.model.brand}${item.model.line ? ` · ${item.model.line}` : ""} · ${item.model.name}` : ""}
            {item.warranty ? ` · Garantia: ${displayDate(item.warranty)}` : ""}
          </p>
        ))
      ) : (
        <p>Nenhuma unidade física associada.</p>
      )}
      </section>}
      {show.questionnaires && <section>
      <h2>Questionários</h2>
      {checklists.length ? (
        checklists.map((checklist) => (
          <section key={checklist.id}>
            <h3>{checklist.title}</h3>
            {show.equipment && checklist.equipmentId && <p>Equipamento: {(() => {
              const unit = data.equipment.find((item) => item.id === checklist.equipmentId);
              return unit ? `${unit.name} · ${unit.assetCode ?? unit.serial}` : "Não encontrado";
            })()}</p>}
            {checklist.header && <p>{checklist.header}</p>}
            <div className={`print-question-grid columns-${checklist.display?.columns ?? 1} ${checklist.display?.inlineAnswers ? "inline-answers" : ""}`}>
              {checklist.questions.filter((question) => (show.photos || question.kind !== "Foto") && (show.signature || question.kind !== "Assinatura") &&
                (checklist.display?.showUnanswered !== false || questionAnswerText(question, details).trim())).map((question) => {
                const signature = question.kind === "Assinatura" ? questionSignature(question, details) : null;
                const photo = details.attachments.find((item) => item.id === (question.kind === "Foto" ? question.answer : requiresJustification(question) ? question.justificationPhotoId : undefined));
                return <div className="print-question" key={question.id}>
                  <strong>{question.label}{question.required ? " *" : ""}: </strong>
                  <span>{questionAnswerText(question, details) || "Não respondida"}</span>
                  {question.description && <p>{question.description}</p>}
                  {signature && <img src={signature.image} alt={`Assinatura para ${question.label}`} />}
                  {show.photos && photo && <img src={photo.data} alt={question.label} />}
                </div>;
              })}
            </div>
            {checklist.footer && <p>{checklist.footer}</p>}
          </section>
        ))
      ) : (
        <p>Não associados.</p>
      )}
      </section>}
      {show.pending && <section>
      <h2>Pendências</h2>
      {pending.length ? (
        pending.map((item) => (
          <p key={item.id}>
            {item.title} · {item.source}
          </p>
        ))
      ) : (
        <p>Nenhuma pendência em aberto.</p>
      )}
      </section>}
      {show.hours && <section>
      <h2>Controle de horas</h2>
      <p>
        Deslocamento: {timeText(totals.travel)} · Pausas:{" "}
        {timeText(totals.pause)} · Execução: {timeText(totals.work)}
      </p>
      {details.activities.map((item) => (
        <p key={item.id}>
          {new Date(item.at).toLocaleString("pt-BR")} · {item.kind} ·{" "}
          {item.technician}
          {item.reason ? ` · ${item.reason}` : ""}
          {item.justification ? ` · ${item.justification}` : ""}
          {item.location ? ` · GPS: ${item.location.latitude.toFixed(5)}, ${item.location.longitude.toFixed(5)} (precisão ${Math.round(item.location.accuracy)} m)` : ""}
          {` · ${serviceDistanceText(item)}`}
          {item.serviceDistance ? ` · Referência: ${item.serviceDistance.address} (${item.serviceDistance.latitude.toFixed(6)}, ${item.serviceDistance.longitude.toFixed(6)})` : ""}
        </p>
      ))}
      </section>}
      {show.values && <section>
      <h2>Valores</h2>
      <table>
        <thead>
          <tr>
            <th>Descrição</th>
            <th>Quantidade</th>
            <th>Unitário</th>
            <th>Desconto</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {details.items.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td>{item.quantity}</td>
              <td>{currency(item.price)}</td>
              <td>{currency(item.discount)}</td>
              <td>
                {currency(
                  Math.round(item.price * item.quantity) - item.discount,
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {details.costs.map((item) => (
        <p key={item.id}>
          {item.name}: {currency(item.value)}
        </p>
      ))}
      {details.travel?.chargeTravel && <p>Deslocamento ({travelValues(details.travel).kilometers.toLocaleString("pt-BR")} km ida e volta × {currency(details.travel.kilometerRate)}/km): {currency(travelValues(details.travel).mileageCharge)}<br />Pedágios: {currency(details.travel.tolls)}<br />Total do deslocamento: {currency(values.travel)}</p>}
      <p>{`Desconto geral: ${currency(values.discount)}\nTotal da OS: ${currency(values.total)}`}</p>
      </section>}
      {show.quotes && <section>
      <h2>Orçamentos vinculados</h2>
      {data.quotes
        .filter((quote) => quote.orderId === order.id)
        .map((quote) => (
          <p key={quote.id}>
            {quote.code} · {quote.status}{show.values ? ` · ${currency(total(quote))}` : ""}
          </p>
        ))}
      </section>}
      {(show.photos || show.attachments) && <section>
      <h2>Anexos e fotos</h2>
      {details.attachments.filter((file) => file.mime.startsWith("image/") ? show.photos : show.attachments).map((file) =>
        file.mime.startsWith("image/") ? (
          <figure key={file.id}>
            <img src={file.data} alt={file.name} />
            <figcaption>{file.name}</figcaption>
          </figure>
        ) : (
          <p key={file.id}>
            {file.name} · {Math.ceil(file.size / 1000)} KB
          </p>
        ),
      )}
      </section>}
      {show.signature && <section>
      <h2>Assinatura</h2>
      {details.signature ? (
        <div className="print-signature">
          <img
            src={details.signature.image}
            alt={`Assinatura de ${details.signature.signer}`}
          />
          <p>{`${details.signature.signer} · ${new Date(details.signature.at).toLocaleString("pt-BR")}\nColeta local, sem verificação de identidade.`}</p>
        </div>
      ) : (
        <p>Não coletada.</p>
      )}
      </section>}
    </article>
  );
}
