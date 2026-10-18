import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";
import { Minus, Plus, Save, Trash2 } from "lucide-react";
import {
  currency,
  localDay,
  equipmentSelectionSchema,
  lineSchema,
  makeId,
  nextCode,
  orderDetailsSchema,
  getOrderDetails,
  serviceLocationSchema,
  serviceLocationAddress,
  servicePointSchema,
  shiftDay,
  subtotal,
  stockAvailable,
  stockLocationBalance,
} from "./domain";
import type {
  Client,
  Database,
  Equipment,
  EquipmentSelection,
  Line,
  Order,
  Product,
  Quote,
  Service,
} from "./domain";
import { errorMessage } from "./useDatabase";
import { Modal } from "./components";
import { ClientPicker } from "./ClientPicker";
import { useTechnicians } from "./useTechnicians";
import { cloudEnabled } from "./supabase";
import { displayLogin } from "./userAccess";
import {
  formatCnpj,
  isValidCnpj,
  lookupCompanyByCnpj,
  normalizeCnpj,
} from "./cnpj";
import { formatCpf, isValidCpf } from "./cpf";
import { orderTypes, orderTypeQuestionnaireSchema } from "./questionnaireSchema";
import { equipmentDefaultQuestionnaire, orderEquipmentQuestionnaires, replaceOrderQuestionnaire } from "./questionnaires";
import type { OrderEquipmentSelection } from "./questionnaires";
import { ServiceLocationFields } from "./ServiceLocationFields";
import { EquipmentModelPicker, EquipmentSelections } from "./EquipmentModelPicker";
import { generateEquipmentCode, selectEquipmentModel } from "./equipmentCatalogData";
import { TravelPanel } from "./TravelPanel";
import { assertTravelReady, routeTolls, sameTravelEndpoint, travelEndpoint, travelSchema } from "./travel";
import type { Travel } from "./travel";
import { assistanceEndpoint, calculateTravelRoute } from "./travelClient";
import { addMaintenanceContractCharge, maintenanceContractLifecycle } from "./maintenanceContracts";

export type FormKind =
  | "client"
  | "equipment"
  | "product"
  | "service"
  | "order"
  | "quote"
  | "movement";
export type Editor = {
  kind: FormKind;
  id?: string;
  date?: string;
  time?: string;
  clientId?: string;
  equipmentId?: string;
  contractId?: string;
};
type SavedFormControl = {
  name: string;
  value: string;
  checked?: boolean;
  selected?: string[];
};
type SavedFormDraft = Record<string, SavedFormControl[]>;
function formDraftKey(scope: string, editor: Editor) {
  return `alpha-tec.form-draft.v1.${scope}.${editor.kind}.${editor.id ?? "new"}`;
}
function readFormDraft(key: string): SavedFormDraft | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const draft = value as Record<string, unknown>;
    for (const [name, controls] of Object.entries(draft)) {
      if (!Array.isArray(controls) || !controls.every((control) =>
        control && typeof control === "object" &&
        "name" in control && control.name === name &&
        "value" in control && typeof control.value === "string",
      )) return null;
    }
    return draft as SavedFormDraft;
  } catch (error) {
    console.warn("Não foi possível restaurar os campos do formulário.", error);
    try {
      sessionStorage.removeItem(key);
    } catch (removeError) {
      console.warn("Não foi possível remover os campos temporários inválidos.", removeError);
    }
    return null;
  }
}
function savedFormValue(draft: SavedFormDraft | null, name: string, fallback: string) {
  return draft?.[name]?.[0]?.value ?? fallback;
}
function savedServicePoint(draft: SavedFormDraft | null) {
  const value = savedFormValue(draft, "servicePoint", "");
  if (!value) return undefined;
  try {
    return servicePointSchema.parse(JSON.parse(value));
  } catch (cause) {
    console.warn("Ponto do atendimento inválido no rascunho. Confirme o ponto novamente.", cause);
    return undefined;
  }
}
function savedTravel(draft: SavedFormDraft | null, fallback?: Travel) {
  const value = savedFormValue(draft, "draftTravel", "");
  if (!value) return fallback;
  try { return travelSchema.parse(JSON.parse(value)); }
  catch (cause) {
    console.warn("Cálculo de deslocamento inválido no rascunho. Calcule novamente.", cause);
    return fallback;
  }
}
function orderLocation(form: FormData) {
  return serviceLocationSchema.parse({
    useClientAddress: form.get("useClientAddress") === "on",
    postalCode: getText(form, "service_postalCode").replace(/\D/g, ""),
    street: getText(form, "service_street"), number: getText(form, "service_number"),
    complement: getText(form, "service_complement"), neighborhood: getText(form, "service_neighborhood"),
    city: getText(form, "service_city"), state: getText(form, "service_state").toUpperCase(),
  });
}
function orderPoint(form: FormData) {
  const value = getText(form, "servicePoint");
  return value ? servicePointSchema.parse(JSON.parse(value)) : undefined;
}
function savedFormArray<T>(
  draft: SavedFormDraft | null,
  name: string,
  schema: z.ZodType<T>,
): T[] | null {
  try {
    const parsed = z.array(schema).safeParse(JSON.parse(savedFormValue(draft, name, "null")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function saveFormDraft(form: HTMLFormElement, key: string) {
  const draft: SavedFormDraft = {};
  Array.from(form.elements).forEach((element) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) return;
    if (!element.name || ["file", "password", "submit", "reset", "button"].includes(element.type)) return;
    const controls = draft[element.name] ?? [];
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
      controls.push({ name: element.name, value: element.value, checked: element.checked });
    } else if (element instanceof HTMLSelectElement && element.multiple) {
      controls.push({ name: element.name, value: element.value, selected: Array.from(element.selectedOptions, (option) => option.value) });
    } else {
      controls.push({ name: element.name, value: element.value });
    }
    draft[element.name] = controls;
  });
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
  } catch (error) {
    console.warn("Não foi possível salvar os campos temporários do formulário.", error);
  }
}
function restoreFormDraft(form: HTMLFormElement, draft: SavedFormDraft) {
  Object.entries(draft).forEach(([name, savedControls]) => {
    const controls = Array.from(form.elements).filter((element) =>
      (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) &&
      element.name === name,
    );
    savedControls.forEach((saved, index) => {
      const element = controls[index];
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) return;
      if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(element, saved.checked ?? false);
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (element instanceof HTMLSelectElement && element.multiple) {
        Array.from(element.options).forEach((option) => { option.selected = saved.selected?.includes(option.value) ?? false; });
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        const prototype = element instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, saved.value);
        element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      }
    });
  });
}
const getText = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
const getNumber = (form: FormData, key: string) => Number(getText(form, key));
const getMoney = (form: FormData, key: string) =>
  Math.round(getNumber(form, key) * 100);

function FormButtons({ onClose, busy = false }: { onClose: () => void; busy?: boolean }) {
  return (
    <footer className="modal-footer">
      <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
        Cancelar
      </button>
      <button className="button primary" type="submit" disabled={busy}>
        <Save size={17} />
        {busy ? "Calculando rota e pedágios…" : "Salvar"}
      </button>
    </footer>
  );
}

function ClientFormFields({ client }: { client?: Client }) {
  const [name, setName] = useState(client?.name ?? "");
  const [document, setDocument] = useState(client?.document ?? "");
  const [group, setGroup] = useState(client?.group ?? "Academias");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [address, setAddress] = useState(client?.address ?? "");
  const [active, setActive] = useState(client?.active ?? true);
  const [lookup, setLookup] = useState<{
    document: string;
    status: "idle" | "loading" | "success" | "error";
    message: string;
    attempt: number;
  }>({ document: "", status: "idle", message: "", attempt: 0 });
  const digits = document.replace(/\D/g, "");
  const cnpj = normalizeCnpj(document);
  const isCnpjInput = /[A-Z]/i.test(document) || digits.length > 11;
  const normalizedCnpj = isCnpjInput ? cnpj : "";
  const currentLookup =
    lookup.document === normalizedCnpj ? lookup : { ...lookup, status: "idle" as const, message: "" };

  useEffect(() => {
    if (!isValidCnpj(normalizedCnpj)) return;
    const controller = new AbortController();
    const attempt = lookup.attempt;
    const timeout = window.setTimeout(() => {
      setLookup({
        document: normalizedCnpj,
        status: "loading",
        message: "Consultando o cadastro público da empresa…",
        attempt,
      });
      void lookupCompanyByCnpj(normalizedCnpj, controller.signal)
        .then((registration) => {
          if (controller.signal.aborted) return;
          setName(registration.tradeName || registration.legalName);
          if (registration.phone) setPhone(registration.phone);
          if (registration.email) setEmail(registration.email);
          if (registration.address) setAddress(registration.address);
          setLookup({
            document: normalizedCnpj,
            status: "success",
            message: "Cadastro localizado. Os dados disponíveis foram preenchidos.",
            attempt,
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setLookup({
            document: normalizedCnpj,
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Não foi possível consultar este CNPJ.",
            attempt,
          });
        });
    }, 450);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [normalizedCnpj, lookup.attempt]);

  function retryCnpjLookup() {
    setLookup((current) => ({
      document: normalizedCnpj,
      status: "idle",
      message: "",
      attempt: current.attempt + 1,
    }));
  }

  let documentMessage = "";
  let documentStatus: "idle" | "loading" | "success" | "error" = "idle";
  if (document && isCnpjInput) {
    if (normalizedCnpj.length === 14 && !isValidCnpj(normalizedCnpj)) {
      documentMessage = "Confira o CNPJ informado.";
      documentStatus = "error";
    } else if (currentLookup.status !== "idle") {
      documentMessage = currentLookup.message;
      documentStatus = currentLookup.status;
    } else if (isValidCnpj(normalizedCnpj)) {
      documentMessage = "A consulta será iniciada automaticamente.";
      documentStatus = "loading";
    }
  } else if (document && digits.length === 11) {
    documentMessage = isValidCpf(digits)
      ? "CPF válido. A consulta de dados pessoais exige um serviço autorizado; não há consulta pública aberta equivalente."
      : "Confira o CPF informado.";
    documentStatus = isValidCpf(digits) ? "idle" : "error";
  }

  const displayedDocument = isCnpjInput
    ? formatCnpj(cnpj)
    : formatCpf(document);

  return (
    <>
      <label className="field full">
        Nome *
        <input
          autoFocus
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={160}
        />
      </label>
      <label className="field">
        CPF / CNPJ
        <input
          name="document"
          value={displayedDocument}
          onChange={(event) => {
            const value = event.target.value;
            const next = /[A-Z]/i.test(value)
              ? normalizeCnpj(value)
              : value.replace(/\D/g, "").slice(0, 14);
            setDocument(next);
            setLookup((current) => ({
              document:
                next.replace(/\D/g, "").length > 11 || /[A-Z]/i.test(next)
                  ? normalizeCnpj(next)
                  : "",
              status: "idle",
              message: "",
              attempt: current.attempt,
            }));
          }}
          maxLength={25}
          autoComplete="off"
          aria-describedby="client-document-status"
        />
        <small
          className={`client-document-status ${documentStatus}`}
          id="client-document-status"
          aria-live="polite"
        >
          {documentMessage}
        </small>
      </label>
      <label className="field">
        Grupo
        <select
          name="group"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
        >
          <option>Academias</option>
          <option>Condominios</option>
          <option>Residencial</option>
          <option>Outros</option>
        </select>
      </label>
      <label className="field">
        Telefone
        <input
          type="tel"
          name="phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          maxLength={40}
        />
      </label>
      <label className="field">
        E-mail
        <input
          type="email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={160}
        />
      </label>
      <label className="field full">
        Endereço
        <input
          name="address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          maxLength={300}
        />
      </label>
      <label className="field">
        Situação
        <select
          name="active"
          value={String(active)}
          onChange={(event) => setActive(event.target.value === "true")}
        >
          <option value="true">Ativo</option>
          <option value="false">Inativo</option>
        </select>
      </label>
      {currentLookup.status === "error" && (
        <button
          className="text-button field full"
          type="button"
          onClick={retryCnpjLookup}
        >
          Tentar consulta do CNPJ novamente
        </button>
      )}
    </>
  );
}

export function EditorModal({
  editor,
  data,
  commit,
  draftScope,
  onClose,
  onSuccess,
  onClientEquipment,
}: {
  editor: Editor;
  data: Database;
  commit: (update: Database | ((data: Database) => Database)) => void;
  draftScope: string;
  onClose: (saved?: boolean) => void;
  onSuccess: (text: string) => void;
  onClientEquipment?: (clientId: string) => void;
}) {
  const [error, setError] = useState("");
  const [draftRecovered, setDraftRecovered] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const draftKey = formDraftKey(draftScope || "local", editor);
  const [savedDraft] = useState(() => draftScope ? readFormDraft(draftKey) : null);
  const [draftReady, setDraftReady] = useState(() => !savedDraft);
  const technicians = useTechnicians(editor.kind === "order");
  const [assignedTechnicianId, setAssignedTechnicianId] = useState(() =>
    editor.kind === "order"
      ? savedFormValue(savedDraft, "technicianUserId", data.orders.find((record) => record.id === editor.id)?.technicianUserId ?? "")
      : "",
  );
  const [clientId, setClientId] = useState(() =>
    editor.kind === "order"
      ? savedFormValue(savedDraft, "clientId", data.orders.find((record) => record.id === editor.id)?.clientId ?? editor.clientId ?? "")
      : "",
  );
  const [orderDate, setOrderDate] = useState(() =>
    editor.kind === "order" ? savedFormValue(savedDraft, "date", data.orders.find((record) => record.id === editor.id)?.date ?? editor.date ?? localDay()) : "",
  );
  const [contractId, setContractId] = useState(() =>
    editor.kind === "order" ? savedFormValue(savedDraft, "maintenanceContractId", editor.contractId ?? data.orders.find((record) => record.id === editor.id)?.details?.maintenanceContract?.id ?? "") : "",
  );
  const [lines, setLines] = useState<Line[]>(() => {
    const saved = savedFormArray(savedDraft, "draftLines", lineSchema);
    return saved ?? data.quotes.find((record) => record.id === editor.id)?.items ?? [];
  });
  const [discount, setDiscount] = useState(
    () => {
      const initial = (data.quotes.find((record) => record.id === editor.id)?.discount ?? 0) / 100;
      const saved = Number(savedFormValue(savedDraft, "discount", String(initial)));
      return Number.isFinite(saved) && saved >= 0 ? saved : initial;
    },
  );
  const [catalogId, setCatalogId] = useState(() => savedFormValue(savedDraft, "catalogId", ""));
  const [orderType, setOrderType] = useState<Order["type"]>(() => {
    const saved = savedFormValue(savedDraft, "type", data.orders.find((record) => record.id === editor.id)?.type ?? "Corretiva");
    return orderTypes.find((type) => type === saved) ?? "Corretiva";
  });
  const [questionnaireId, setQuestionnaireId] = useState(() => savedFormValue(savedDraft, "questionnaireId", editor.id ? "" : data.orderTypeQuestionnaires.find((item) => item.type === "Corretiva")?.questionnaireId ?? ""));
  const client = data.clients.find((record) => record.id === editor.id);
  const equipment = data.equipment.find((record) => record.id === editor.id);
  const product = data.products.find((record) => record.id === editor.id);
  const service = data.services.find((record) => record.id === editor.id);
  const order = data.orders.find((record) => record.id === editor.id);
  const [travel, setTravel] = useState(() => savedTravel(savedDraft, order?.details?.travel));
  const [travelBusy, setTravelBusy] = useState(false);
  const quote = data.quotes.find((record) => record.id === editor.id);
  const generalChecklists = order ? getOrderDetails(order).checklists.filter((item) => !item.equipmentId) : [];
  const [generalChecklistId, setGeneralChecklistId] = useState(() => savedFormValue(savedDraft, "generalChecklistId", ""));
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [orderEquipment, setOrderEquipment] = useState<OrderEquipmentSelection[]>(() => {
    const ids = order ? [order.equipmentId, ...getOrderDetails(order).equipmentIds] : [editor.equipmentId ?? ""];
    const fallback = [...new Set(ids.filter(Boolean))].map((equipmentId) => ({
      equipmentId, questionnaireId: order ? "" : equipmentDefaultQuestionnaire(data, equipmentId, orderType),
    }));
    const selectionSchema = z.array(z.object({ equipmentId: z.string(), questionnaireId: z.string(), checklistId: z.string().optional() }));
    const saved = savedFormArray(savedDraft, "draftOrderEquipment", selectionSchema.element);
    return saved
      ? saved.filter((selection) => data.equipment.some((item) => item.id === selection.equipmentId && item.clientId === clientId))
      : fallback;
  });
  const clientEquipment = data.equipment.filter((item) => item.clientId === clientId);
  const contractOptions = editor.kind === "order" ? data.maintenanceContracts.filter((item) =>
    item.clientId === clientId && maintenanceContractLifecycle(item) === "Ativo" &&
    item.startsOn <= orderDate && item.endsOn >= orderDate) : [];
  const equipmentQuestionnaires = data.questionnaires.filter((item) => !item.archived && item.display.equipment);
  const previousEquipmentIds = order ? [order.equipmentId, ...getOrderDetails(order).equipmentIds].filter(Boolean) : [];
  function equipmentSelection(equipmentId: string): OrderEquipmentSelection {
    return { equipmentId, questionnaireId: previousEquipmentIds.includes(equipmentId) ? "" : equipmentDefaultQuestionnaire(data, equipmentId, orderType) };
  }
  const [modelId, setModelId] = useState(savedFormValue(savedDraft, "modelId", equipment?.model?.modelId ?? ""));
  const [equipmentName, setEquipmentName] = useState(savedFormValue(savedDraft, "name", equipment?.name ?? ""));
  const [equipmentCategory, setEquipmentCategory] = useState(savedFormValue(savedDraft, "category", equipment?.category ?? "Cardio"));
  const [selectedModels, setSelectedModels] = useState<EquipmentSelection[]>(() => {
    const saved = savedFormArray(savedDraft, "draftSelectedModels", equipmentSelectionSchema);
    return saved ?? (editor.kind === "order" && order ? getOrderDetails(order).equipmentModels : quote?.equipmentModels ?? []);
  });
  const titles: Record<FormKind, string> = {
    client: "cliente",
    equipment: "equipamento",
    product: "produto",
    service: "serviço",
    order: "ordem de serviço",
    quote: "orçamento",
    movement: "movimentação de estoque",
  };
  useEffect(() => {
    const form = formRef.current;
    if (!form || !draftScope) return;
    const draft = savedDraft;
    let restoring = Boolean(draft);
    const save = () => { if (!restoring) saveFormDraft(form, draftKey); };
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    let restoreFrame = 0;
    if (draft) {
      restoreFrame = requestAnimationFrame(() => {
        setDraftRecovered(true);
        restoreFormDraft(form, draft);
        restoreFrame = requestAnimationFrame(() => {
          restoreFormDraft(form, draft);
          restoring = false;
          setDraftReady(true);
        });
      });
    }
    return () => {
      cancelAnimationFrame(restoreFrame);
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
    };
  }, [draftKey, draftScope, savedDraft]);
  useEffect(() => {
    if (!draftReady || !draftScope || !formRef.current) return;
    saveFormDraft(formRef.current, draftKey);
  }, [draftKey, draftReady, draftScope, discount, lines, orderEquipment, selectedModels, travel]);

  function previewDestination(form = new FormData(formRef.current!)) {
    const selectedClient = data.clients.find((item) => item.id === getText(form, "clientId"));
    const address = serviceLocationAddress(orderLocation(form), selectedClient?.address ?? "");
    return travelEndpoint(address, orderPoint(form));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (travelBusy) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    let submittedTravel = travel;
    setError("");
    try {
      if (editor.kind === "order" && order) {
        const checklists = getOrderDetails(order).checklists;
        const changes = [
          ...orderEquipment,
          { equipmentId: "", questionnaireId, checklistId: generalChecklistId },
        ].filter((selection) => {
          if (!selection.questionnaireId) return false;
          const linked = checklists.filter((item) => item.equipmentId === selection.equipmentId);
          if (selection.equipmentId && linked.length > 1) return true;
          const previous = selection.checklistId ? linked.find((item) => item.id === selection.checklistId)
            : linked.length === 1 ? linked[0] : undefined;
          return previous && previous.templateId !== selection.questionnaireId;
        });
        if (changes.length && !window.confirm("Aplicar a troca de questionários? Cada equipamento ficará com apenas um questionário. Se o modelo escolhido já estiver vinculado, suas respostas serão preservadas; os outros questionários desse equipamento e suas respostas serão removidos. Modelos novos começam sem respostas. Outros equipamentos e arquivos anexados serão preservados.")) return;
      }
      if (editor.kind === "order" && (!order || travel || form.get("travelChargeTravel") === "Sim")) {
        const target = previewDestination(form);
        const chargeTravel = form.get("travelChargeTravel") === "Sim";
        if (!submittedTravel || !sameTravelEndpoint(submittedTravel.route.origin, assistanceEndpoint(data)) ||
          !sameTravelEndpoint(submittedTravel.route.destination, target)) {
          setTravelBusy(true);
          const route = await calculateTravelRoute(data, target);
          if (!sameTravelEndpoint(target, previewDestination()) ||
            element.querySelector<HTMLSelectElement>('[name="travelChargeTravel"]')?.value !== form.get("travelChargeTravel"))
            throw new Error("O endereço ou a cobrança mudou durante a consulta. Confira e salve novamente.");
          const tolls = routeTolls(route);
          submittedTravel = { route, chargeTravel, tolls: tolls ?? 0, tollsConfirmed: tolls !== undefined,
            fuelPrice: data.settings.fuelPrice, kilometersPerLiter: data.settings.kilometersPerLiter, kilometerRate: data.settings.kilometerRate };
          setTravel(submittedTravel);
        } else submittedTravel = { ...submittedTravel, chargeTravel };
        assertTravelReady(submittedTravel, chargeTravel);
      }
      commit((current) => {
        const recordId = editor.id ?? makeId();
        const upsert = <RecordType extends { id: string }>(
          records: RecordType[],
          record: RecordType,
        ) =>
          records.some((item) => item.id === record.id)
            ? records.map((item) => (item.id === record.id ? record : item))
            : [...records, record];
        switch (editor.kind) {
          case "client": {
            const record: Client = {
              id: recordId,
              name: getText(form, "name"),
              document: getText(form, "document"),
              phone: getText(form, "phone"),
              email: getText(form, "email"),
              address: getText(form, "address"),
              group: getText(form, "group"),
              active: getText(form, "active") === "true",
            };
            return { ...current, clients: upsert(current.clients, record) };
          }
          case "equipment": {
            const serial = getText(form, "serial");
            if (
              current.equipment.some(
                (item) =>
                  item.id !== recordId &&
                  item.serial.toLowerCase() === serial.toLowerCase(),
              )
            )
              throw new Error("Este identificador já está em uso.");
            const record: Equipment = {
              id: recordId,
              name: equipmentName.trim(),
              assetCode: equipment?.assetCode ?? generateEquipmentCode(current.equipment),
              serial,
              clientId: getText(form, "clientId"),
              category: equipmentCategory,
              warranty: getText(form, "warranty"),
              notes: getText(form, "notes"),
              ...(modelId ? { model: equipment?.model?.modelId === modelId ? equipment.model : selectEquipmentModel(current, modelId) } : {}),
            };
            return { ...current, equipment: upsert(current.equipment, record) };
          }
          case "product": {
            const code = getText(form, "code");
            if (
              current.products.some(
                (item) =>
                  item.id !== recordId &&
                  item.code.toLowerCase() === code.toLowerCase(),
              )
            )
              throw new Error("Este código de produto já está em uso.");
            const existing = current.products.find(
              (item) => item.id === editor.id,
            );
            const record: Product = {
              id: recordId,
              name: getText(form, "name"),
              code,
              price: getMoney(form, "price"),
              cost: getMoney(form, "cost"),
              minimum: getNumber(form, "minimum"),
              stock: existing?.stock ?? getNumber(form, "stock"),
            };
            const initial =
              !existing && record.stock > 0
                ? [
                    {
                      id: makeId(),
                      productId: recordId,
                      delta: record.stock,
                      reason: "Saldo inicial",
                      balance: record.stock,
                      at: new Date().toISOString(),
                      locationId: current.inventory!.defaultLocationId,
                      source: { type: "opening" as const },
                      unitCost: record.cost,
                      averageCostBefore: record.cost,
                      averageCostAfter: record.cost,
                    },
                  ]
                : [];
            return {
              ...current,
              products: upsert(current.products, record),
              movements: [...initial, ...current.movements],
            };
          }
          case "service": {
            const record: Service = {
              id: recordId,
              name: getText(form, "name"),
              price: getMoney(form, "price"),
            };
            return { ...current, services: upsert(current.services, record) };
          }
          case "order": {
            const existing = current.orders.find(
              (item) => item.id === editor.id,
            );
            const date = getText(form, "date");
            const time = getText(form, "time");
            const duration = getNumber(form, "duration");
            const technician = getText(form, "technician");
            const technicianUserId = getText(form, "technicianUserId");
            const technicianAccount = technicians.accounts.find(
              (account) => account.userId === technicianUserId,
            );
            if (cloudEnabled && !technicianAccount)
              throw new Error("Selecione uma conta de técnico vinculada à empresa.");
            const start = new Date(`${date}T${time}`).getTime();
            const overlap = current.orders.some(
              (item) =>
                item.id !== recordId &&
                item.status !== "Finalizada" &&
                (technicianUserId
                  ? item.technicianUserId === technicianUserId
                  : item.technician.toLowerCase() === technician.toLowerCase()) &&
                start <
                  new Date(`${item.date}T${item.time}`).getTime() +
                    item.duration * 60000 &&
                start + duration * 60000 >
                  new Date(`${item.date}T${item.time}`).getTime(),
            );
            if (overlap && existing?.status !== "Finalizada")
              throw new Error(
                "Este técnico já possui uma OS neste horário. Ajuste o horário ou o técnico.",
              );
            const template = current.questionnaires.find((item) => item.id === questionnaireId && !item.archived);
            if (questionnaireId && (existing || orderEquipment.length === 0) && !template) throw new Error("Questionário indisponível. Selecione um modelo ativo.");
            const previousDetails = existing ? getOrderDetails(existing) : orderDetailsSchema.parse({ createdAt: new Date().toISOString() });
            const equipmentLinks = orderEquipmentQuestionnaires(current, clientId, orderEquipment, previousDetails.checklists,
              existing ? [existing.equipmentId, ...previousDetails.equipmentIds].filter(Boolean) : []);
            const selectedContractId = existing?.details?.maintenanceContract?.id ?? getText(form, "maintenanceContractId");
            const selectedContract = selectedContractId
              ? current.maintenanceContracts.find((item) => item.id === selectedContractId && item.clientId === getText(form, "clientId") &&
                (existing?.details?.maintenanceContract ? true :
                  maintenanceContractLifecycle(item) === "Ativo" && item.startsOn <= date && item.endsOn >= date))
              : undefined;
            if (selectedContractId && !selectedContract)
              throw new Error("O contrato não está ativo para este cliente e data da OS.");
            if (selectedContract && (date < selectedContract.startsOn || date > selectedContract.endsOn))
              throw new Error("A data da OS vinculada deve estar dentro da vigência do contrato.");
            if (selectedContract && ![equipmentLinks.equipmentId, ...equipmentLinks.equipmentIds].some((id) => selectedContract.equipmentIds.includes(id)))
              throw new Error("Selecione na OS ao menos uma unidade coberta pelo contrato.");
            const useClientAddress = form.get("useClientAddress") === "on";
            const selectedClient = current.clients.find((item) => item.id === getText(form, "clientId"));
            if (useClientAddress && !selectedClient?.address.trim())
              throw new Error("O cliente não possui endereço cadastrado. Informe o endereço de atendimento ou atualize o cadastro do cliente.");
            const serviceLocation = orderLocation(form);
            const servicePoint = orderPoint(form);
            if (submittedTravel && (!sameTravelEndpoint(submittedTravel.route.origin, assistanceEndpoint(current)) ||
              !sameTravelEndpoint(submittedTravel.route.destination, travelEndpoint(serviceLocationAddress(serviceLocation, selectedClient?.address ?? ""), servicePoint))))
              throw new Error("Os endereços mudaram. Calcule o deslocamento novamente antes de salvar.");
            const details = {
              ...previousDetails,
              ...(!existing && selectedContract ? addMaintenanceContractCharge(previousDetails, selectedContract) : {}),
              servicePoint,
              travel: submittedTravel,
              equipmentModels: selectedModels,
              equipmentIds: equipmentLinks.equipmentIds,
              serviceLocation,
              responsibleName: getText(form, "responsibleName"),
              responsiblePhone: getText(form, "responsiblePhone"),
              ...(existing ? {} : { questionnaireRequired: current.orderTypeQuestionnaires.find((item) => item.type === orderType)?.required ?? false }),
              checklists: template && (existing || orderEquipment.length === 0)
                ? replaceOrderQuestionnaire(equipmentLinks.checklists, template, "", generalChecklistId) : equipmentLinks.checklists,
            };
            const record: Order = {
              id: recordId,
              code: existing?.code ?? nextCode(current.orders, "OS"),
              clientId: getText(form, "clientId"),
              equipmentId: equipmentLinks.equipmentId,
              title: getText(form, "title"),
              technician: technicianAccount?.name ?? technician,
              technicianUserId,
              date,
              time,
              duration,
              type: orderType,
              priority: getText(form, "priority") as Order["priority"],
              status: existing?.status ?? "Aberta",
              notes: getText(form, "notes"),
              details,
              history: [
                ...(existing?.history ?? []),
                {
                  id: makeId(),
                  at: new Date().toISOString(),
                  description: existing
                    ? "Dados da OS atualizados"
                    : "OS criada",
                },
              ],
            };
            return { ...current, orders: upsert(current.orders, record) };
          }
          case "quote": {
            const existing = current.quotes.find(
              (item) => item.id === editor.id,
            );
            if (existing?.status === "Aprovado")
              throw new Error(
                "Orçamento aprovado: os termos comerciais não podem ser editados.",
              );
            if (existing?.orderId)
              throw new Error(
                "O orçamento já gerou uma OS e não pode ser editado.",
              );
            if (!lines.length)
              throw new Error("Inclua pelo menos um produto ou serviço.");
            const record: Quote = {
              id: recordId,
              code: existing?.code ?? nextCode(current.quotes, "ORC"),
              clientId: getText(form, "clientId"),
              date: getText(form, "date"),
              expires: getText(form, "expires"),
              status: existing?.status ?? "Rascunho",
              items: lines,
              discount: Math.round(discount * 100),
              notes: getText(form, "notes"),
              orderId: existing?.orderId ?? "",
              equipmentModels: selectedModels,
            };
            return { ...current, quotes: upsert(current.quotes, record) };
          }
          default:
            return current;
        }
      });
      onSuccess("Registro salvo.");
      onClose(true);
    } catch (cause) {
      setError(errorMessage(cause));
      if (editor.kind === "order" && orderEquipment.length > 0) setEquipmentOpen(true);
    } finally { setTravelBusy(false); }
  }

  function addLine() {
    if (!catalogId) return;
    const [kind, referenceId] = catalogId.split(":");
    const selected = (kind === "produto" ? data.products : data.services).find(
      (item) => item.id === referenceId,
    );
    if (!selected) return;
    setLines((previous) => [
      ...previous,
      {
        id: makeId(),
        kind: kind as Line["kind"],
        referenceId,
        name: selected.name,
        quantity: 1,
        price: selected.price,
      },
    ]);
    setCatalogId("");
  }

  const clientOptions = (
    <>
      <option value="">Selecione um cliente</option>
      {data.clients
        .filter(
          (item) =>
            item.active ||
            item.id === client?.id ||
            item.id === equipment?.clientId ||
            item.id === order?.clientId ||
            item.id === quote?.clientId,
        )
        .map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
    </>
  );

  return (
    <Modal
      title={`${editor.id ? "Editar" : "Novo"} ${titles[editor.kind]}`}
      wide={editor.kind === "quote"}
      onClose={() => { if (!travelBusy) onClose(); }}
    >
      <form ref={formRef} onSubmit={submit}>
        <input type="hidden" name="draftLines" value={JSON.stringify(lines)} readOnly />
        <input type="hidden" name="draftOrderEquipment" value={JSON.stringify(orderEquipment)} readOnly />
        <input type="hidden" name="draftSelectedModels" value={JSON.stringify(selectedModels)} readOnly />
        {editor.kind === "order" && <input type="hidden" name="draftTravel" value={travel ? JSON.stringify(travel) : ""} readOnly />}
        <div className="modal-body" inert={travelBusy}>
          {draftRecovered && <p className="full" role="status">Rascunho recuperado automaticamente. Arquivos ainda não salvos não são recuperados.</p>}
          {error && (
            <div role="alert" className="error-message">
              {error}
            </div>
          )}
          <div className="form-grid">
            {editor.kind === "client" && (
              <>
                <ClientFormFields client={client} />
                {client && onClientEquipment && <button type="button" className="button secondary full" onClick={() => onClientEquipment(client.id)}>Vincular equipamento / histórico do cliente</button>}
              </>
            )}
            {editor.kind === "equipment" && (
              <>
                <input type="hidden" name="modelId" value={modelId} readOnly />
                <EquipmentModelPicker data={data} value={modelId} onChange={(id) => {
                  setModelId(id);
                  if (id) {
                    const selection = selectEquipmentModel(data, id);
                    setEquipmentName(selection.name);
                    setEquipmentCategory(selection.category || "Outros");
                  }
                }} />
                {equipment?.model && <p className="full">Modelo vinculado: {equipment.model.brand}{equipment.model.line ? ` · ${equipment.model.line}` : ""} · {equipment.model.name}. Deixe sem modelo para desvincular; nome, série e dados da unidade continuam independentes do catálogo.</p>}
                {equipment?.assetCode && <label className="field full">Código único do equipamento<input value={equipment.assetCode} readOnly /></label>}
                <label className="field full">
                  Equipamento *
                  <input
                    autoFocus
                    name="name"
                    value={equipmentName}
                    onChange={(event) => setEquipmentName(event.target.value)}
                    required
                    maxLength={160}
                  />
                </label>
                <label className="field">
                  Identificador / número de série *
                  <input
                    name="serial"
                    defaultValue={equipment?.serial}
                    required
                    maxLength={80}
                  />
                </label>
                <label className="field">
                  Categoria
                  <select
                    name="category"
                    value={equipmentCategory}
                    onChange={(event) => setEquipmentCategory(event.target.value)}
                  >
                    {!["Cardio", "Musculacao", "Acessorios", "Outros"].includes(equipmentCategory) && <option>{equipmentCategory}</option>}
                    <option>Cardio</option>
                    <option>Musculacao</option>
                    <option>Acessorios</option>
                    <option>Outros</option>
                  </select>
                </label>
                <label className="field full">
                  Cliente *
                  <select
                    name="clientId"
                    defaultValue={equipment?.clientId ?? ""}
                    required
                  >
                    {clientOptions}
                  </select>
                </label>
                <label className="field">
                  Garantia até
                  <input
                    type="date"
                    name="warranty"
                    defaultValue={equipment?.warranty}
                  />
                </label>
                <label className="field full">
                  Observações
                  <textarea
                    name="notes"
                    defaultValue={equipment?.notes}
                    maxLength={3000}
                    rows={3}
                  />
                </label>
              </>
            )}
            {editor.kind === "product" && (
              <>
                <label className="field full">
                  Produto *
                  <input
                    autoFocus
                    name="name"
                    defaultValue={product?.name}
                    required
                    maxLength={160}
                  />
                </label>
                <label className="field full">
                  Código *
                  <input
                    name="code"
                    defaultValue={product?.code}
                    required
                    maxLength={50}
                  />
                </label>
                <label className="field">
                  Preço de venda (R$) *
                  <input
                    type="number"
                    name="price"
                    defaultValue={(product?.price ?? 0) / 100}
                    min="0"
                    max="1000000"
                    step="0.01"
                    required
                  />
                </label>
                <label className="field">
                  {product ? "Custo médio atual (R$)" : "Custo inicial (R$)"}
                  <input
                    type="number"
                    name="cost"
                    defaultValue={(product?.cost ?? 0) / 100}
                    min="0"
                    max="1000000"
                    step="0.01"
                    required
                    readOnly={!!product}
                  />
                  {product && <small>Atualizado automaticamente pelos recebimentos; custos históricos não são reescritos.</small>}
                </label>
                {!product && (
                  <label className="field">
                    Saldo inicial
                    <input
                      type="number"
                      name="stock"
                      defaultValue="0"
                      min="0"
                      max="1000000"
                      step="1"
                      required
                    />
                  </label>
                )}
                <label className="field">
                  Estoque mínimo
                  <input
                    type="number"
                    name="minimum"
                    defaultValue={product?.minimum ?? 1}
                    min="0"
                    max="1000000"
                    step="1"
                    required
                  />
                </label>
              </>
            )}
            {editor.kind === "service" && (
              <>
                <label className="field full">
                  Serviço *
                  <input
                    autoFocus
                    name="name"
                    defaultValue={service?.name}
                    required
                    maxLength={160}
                  />
                </label>
                <label className="field">
                  Valor (R$) *
                  <input
                    type="number"
                    name="price"
                    defaultValue={(service?.price ?? 0) / 100}
                    min="0"
                    max="1000000"
                    step="0.01"
                    required
                  />
                </label>
              </>
            )}
            {editor.kind === "order" && (
              <>
                <label className="field full">
                  Descrição do atendimento *
                  <input
                    autoFocus
                    name="title"
                    defaultValue={order?.title}
                    required
                    maxLength={250}
                  />
                </label>
                <ClientPicker
                  clients={data.clients}
                  value={clientId}
                  onChange={(id) => {
                    if (id === clientId) return;
                    setClientId(id);
                    setContractId("");
                    setOrderEquipment([]);
                    setEquipmentOpen(false);
                  }}
                />
                <ServiceLocationFields
                  key={clientId}
                  client={data.clients.find((item) => item.id === clientId)}
                  details={order?.clientId === clientId ? getOrderDetails(order) : undefined}
                  initialPoint={savedServicePoint(savedDraft)}
                />
                <div className="full">
                  <TravelPanel data={data} previewDestination={previewDestination} travel={travel} editing busy={travelBusy}
                    initialCharge={savedFormValue(savedDraft, "travelChargeTravel", travel?.chargeTravel ? "Sim" : "Não") === "Sim"}
                    onBusy={setTravelBusy} onChange={setTravel} onError={setError} />
                </div>
                {clientEquipment.length > 0 && <section className="field full order-equipment-picker">
                  <button type="button" className="button secondary" aria-expanded={equipmentOpen} aria-controls="order-client-equipment" onClick={() => setEquipmentOpen(!equipmentOpen)}>
                    Equipamentos ({orderEquipment.length} de {clientEquipment.length} selecionados)
                  </button>
                  {equipmentOpen && <div id="order-client-equipment">
                    <label className="check">
                      <input type="checkbox" checked={clientEquipment.every((item) => orderEquipment.some((selection) => selection.equipmentId === item.id))}
                        ref={(node) => { if (node) node.indeterminate = orderEquipment.length > 0 && orderEquipment.length < clientEquipment.length; }}
                        onChange={(event) => setOrderEquipment(event.target.checked
                          ? clientEquipment.map((item) => orderEquipment.find((selection) => selection.equipmentId === item.id) ?? equipmentSelection(item.id))
                          : [])} />
                      Selecionar todos
                    </label>
                    {clientEquipment.map((item) => {
                      const selection = orderEquipment.find((entry) => entry.equipmentId === item.id);
                      const existingChecklists = order ? getOrderDetails(order).checklists.filter((checklist) => checklist.equipmentId === item.id) : [];
                      const modelDefaultId = data.equipmentModels.find((model) => model.id === item.model?.modelId)?.questionnaireId;
                      const modelDefault = equipmentQuestionnaires.find((template) => template.id === modelDefaultId);
                      return <div className="order-equipment-option" key={item.id}>
                        <label className="check">
                          <input type="checkbox" checked={Boolean(selection)} onChange={(event) => setOrderEquipment(event.target.checked
                            ? [...orderEquipment, equipmentSelection(item.id)] : orderEquipment.filter((entry) => entry.equipmentId !== item.id))} />
                          <span>{item.name} · {item.assetCode ?? item.serial}{item.model && <small>{item.model.brand} · {item.model.line || "Sem linha cadastrada"}</small>}</span>
                        </label>
                        {selection && <>
                        {modelDefaultId && <small>{modelDefault ? `Padrão do modelo: ${modelDefault.title}. A escolha abaixo vale apenas para esta OS.` : "O questionário padrão deste modelo está indisponível. Escolha um modelo ativo abaixo e revise o cadastro do equipamento."}</small>}
                        {existingChecklists.length > 1 && <label className="field">
                          Questionário atual de referência
                          <select aria-label={`Questionário a substituir no equipamento ${item.assetCode ?? item.serial}`}
                            value={selection.checklistId ?? ""}
                            onChange={(event) => setOrderEquipment(orderEquipment.map((entry) => entry.equipmentId === item.id ? { ...entry, checklistId: event.target.value } : entry))}>
                            <option value="">Selecione o vínculo atual</option>
                            {existingChecklists.map((checklist) => <option key={checklist.id} value={checklist.id}>{checklist.title}</option>)}
                          </select>
                        </label>}
                        <label className="field">
                          Questionário para {item.name} · {item.assetCode ?? item.serial}
                          <select aria-label={`Questionário do equipamento ${item.assetCode ?? item.serial}`} value={selection.questionnaireId}
                            required={existingChecklists.length === 0 && !previousEquipmentIds.includes(item.id)}
                            onChange={(event) => setOrderEquipment(orderEquipment.map((entry) => entry.equipmentId === item.id ? { ...entry, questionnaireId: event.target.value } : entry))}>
                            <option value="">{previousEquipmentIds.includes(item.id) ? "Preservar vínculo atual, sem adicionar questionário" : "Selecione um questionário"}</option>
                            {equipmentQuestionnaires.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
                          </select>
                          {existingChecklists.length > 0 && <small>Vinculados: {existingChecklists.map((checklist) => checklist.title).join(", ")}. Ao escolher um modelo, este equipamento ficará com apenas um questionário, após confirmação. Se o modelo já existir, suas respostas serão preservadas; novos modelos começam sem respostas. Para duplicatas do mesmo modelo, escolha o vínculo de referência a manter.</small>}
                        </label></>}
                      </div>;
                    })}
                    {equipmentQuestionnaires.length === 0 && <p role="alert">Não há questionários ativos com resposta por equipamento. Habilite essa opção no cadastro do questionário.</p>}
                    <small>O questionário padrão do modelo é preenchido automaticamente e pode ser trocado somente nesta OS, sem alterar o catálogo. Sem padrão do modelo, será sugerido o padrão compatível do tipo da tarefa. Cada unidade tem apenas um questionário e suas próprias respostas. A seleção de equipamentos é opcional.</small>
                  </div>}
                  {!equipmentOpen && orderEquipment.length > 0 && <small>Abra Equipamentos para conferir o questionário de cada unidade.</small>}
                </section>}
                <EquipmentSelections data={data} value={selectedModels} onChange={setSelectedModels} />
                <label className="field">
                  Data *
                  <input
                    type="date"
                    name="date"
                    value={orderDate}
                    onChange={(event) => { setOrderDate(event.target.value); setContractId(""); }}
                    required
                  />
                </label>
                {order?.details?.maintenanceContract ? <p className="field full">
                  Contrato vinculado: {data.maintenanceContracts.find((item) => item.id === order.details?.maintenanceContract?.id)?.name ?? "histórico"} ·
                  valor registrado nesta OS: {currency(order.details.maintenanceContract.monthlyAmount)}
                </p> : <fieldset className="full"><legend>Contrato mensal (opcional)</legend>
                  {contractOptions.map((item) => <label key={item.id} className="checkbox-field">
                    <input type="checkbox" name="maintenanceContractId" value={item.id} checked={contractId === item.id}
                      onChange={(event) => setContractId(event.target.checked ? item.id : "")} />
                    {item.name} · {currency(item.monthlyAmount)}
                  </label>)}
                  {!contractOptions.length && <small>Não há contratos ativos para este cliente e esta data. Selecione também uma unidade coberta.</small>}
                  <small>Ao marcar um contrato, seu valor mensal é incluído como serviço adicional nos valores desta OS e segue o faturamento já existente.</small>
                </fieldset>}
                <label className="field">
                  Horário *
                  <input
                    type="time"
                    name="time"
                    defaultValue={order?.time ?? editor.time ?? "09:00"}
                    required
                  />
                </label>
                <label className="field">
                  Duração (minutos) *
                  <input
                    type="number"
                    name="duration"
                    min="15"
                    max="1440"
                    step="15"
                    defaultValue={order?.duration ?? 60}
                    required
                  />
                </label>
                <label className="field">
                  Técnico *
                  {cloudEnabled ? (
                    <>
                      <select name="technicianUserId" value={assignedTechnicianId} onChange={(event) => setAssignedTechnicianId(event.target.value)} required disabled={technicians.loading}>
                        <option value="">Selecione uma conta vinculada</option>
                        {technicians.accounts.map((account) => (
                          <option key={account.userId} value={account.userId}>{account.name} · {displayLogin(account.email)}</option>
                        ))}
                      </select>
                      {technicians.error && <small role="alert">{technicians.error} <button type="button" className="text-button" onClick={() => void technicians.refresh()}>Tentar novamente</button></small>}
                      {!technicians.loading && !technicians.accounts.length && <small>Vincule técnicos em Configurações.</small>}
                    </>
                  ) : (
                    <input name="technician" defaultValue={order?.technician ?? data.settings.technician} required maxLength={120} />
                  )}
                </label>
                <label className="field">
                  Tipo
                  <select name="type" value={orderType} onChange={(event) => {
                    const type = orderTypeQuestionnaireSchema.shape.type.parse(event.target.value);
                    setOrderType(type);
                    if (!order) setQuestionnaireId(data.orderTypeQuestionnaires.find((item) => item.type === type)?.questionnaireId ?? "");
                  }}>
                    {orderTypes.map((type) => <option key={type}>{type}</option>)}
                  </select>
                </label>
                {(order || orderEquipment.length === 0) && <label className="field full">
                  {order ? "Questionário geral da tarefa" : "Questionário"}
                  <select name="questionnaireId" aria-label={order ? "Questionário geral da tarefa" : "Questionário"} value={questionnaireId} onChange={(event) => setQuestionnaireId(event.target.value)}>
                    <option value="">{order ? "Preservar questionários atuais, sem adicionar" : "Sem questionário"}</option>
                    {data.questionnaires.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                  </select>
                  <small>{order ? "Sem seleção, os vínculos atuais são preservados. Outro modelo substitui o questionário geral escolhido, após confirmação; o mesmo modelo mantém as respostas. Os questionários dos equipamentos são alterados na lista Equipamentos." : "O padrão do tipo é selecionado automaticamente e pode ser substituído. As respostas são exclusivas desta tarefa."}</small>
                </label>}
                {order && generalChecklists.length > 1 && <label className="field full">
                  Questionário geral a substituir
                  <select name="generalChecklistId" value={generalChecklistId} required={Boolean(questionnaireId)} onChange={(event) => setGeneralChecklistId(event.target.value)}>
                    <option value="">Selecione o vínculo atual</option>
                    {generalChecklists.map((checklist) => <option key={checklist.id} value={checklist.id}>{checklist.title}</option>)}
                  </select>
                </label>}
                <label className="field">
                  Prioridade
                  <select
                    name="priority"
                    defaultValue={order?.priority ?? "Media"}
                  >
                    <option>Alta</option>
                    <option>Media</option>
                    <option>Baixa</option>
                  </select>
                </label>
                <label className="field full">
                  Orientações e relato
                  <textarea
                    name="notes"
                    defaultValue={order?.notes}
                    maxLength={6000}
                    rows={4}
                  />
                </label>
              </>
            )}
            {editor.kind === "quote" && (
              <>
                <EquipmentSelections data={data} value={selectedModels} onChange={setSelectedModels} />
                <label className="field full">
                  Cliente *
                  <select
                    autoFocus
                    name="clientId"
                    defaultValue={quote?.clientId ?? ""}
                    required
                  >
                    {clientOptions}
                  </select>
                </label>
                <label className="field">
                  Emissão *
                  <input
                    type="date"
                    name="date"
                    defaultValue={quote?.date ?? localDay()}
                    required
                  />
                </label>
                <label className="field">
                  Validade *
                  <input
                    type="date"
                    name="expires"
                    defaultValue={quote?.expires ?? shiftDay(localDay(), 15)}
                    required
                  />
                </label>
                <div className="full quote-builder">
                  <div className="add-line">
                    <label className="field">
                      Produto ou serviço
                      <select
                        name="catalogId"
                        value={catalogId}
                        onChange={(event) => setCatalogId(event.target.value)}
                      >
                        <option value="">Selecione um item</option>
                        <optgroup label="Produtos">
                          {data.products.map((item) => (
                            <option key={item.id} value={`produto:${item.id}`}>
                              {item.name} · {currency(item.price)}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Serviços">
                          {data.services.map((item) => (
                            <option key={item.id} value={`servico:${item.id}`}>
                              {item.name} · {currency(item.price)}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </label>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={addLine}
                      disabled={!catalogId}
                    >
                      <Plus size={16} />
                      Incluir
                    </button>
                  </div>
                  {!lines.length && (
                    <div className="line-empty">Nenhum item incluído.</div>
                  )}
                  {lines.map((item) => (
                    <div className="quote-line" key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <small>
                          {item.kind === "produto" ? "Peça" : "Serviço"}
                        </small>
                      </div>
                      <label className="field">
                        Qtd.
                        <input
                          aria-label={`Quantidade de ${item.name}`}
                          type="number"
                          min={item.kind === "produto" ? "1" : "0.01"}
                          max="10000"
                          step={item.kind === "produto" ? "1" : "0.01"}
                          required
                          value={item.quantity}
                          onChange={(event) =>
                            setLines((previous) =>
                              previous.map((record) =>
                                record.id === item.id
                                  ? {
                                      ...record,
                                      quantity: Number(event.target.value),
                                    }
                                  : record,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="field">
                        Unitário (R$)
                        <input
                          aria-label={`Preço de ${item.name}`}
                          type="number"
                          min="0"
                          max="1000000"
                          step="0.01"
                          required
                          value={item.price / 100}
                          onChange={(event) =>
                            setLines((previous) =>
                              previous.map((record) =>
                                record.id === item.id
                                  ? {
                                      ...record,
                                      price: Math.round(
                                        Number(event.target.value) * 100,
                                      ),
                                    }
                                  : record,
                              ),
                            )
                          }
                        />
                      </label>
                      <strong>
                        {currency(Math.round(item.quantity * item.price))}
                      </strong>
                      <button
                        className="icon-button danger"
                        aria-label={`Remover ${item.name}`}
                        title="Remover item"
                        type="button"
                        onClick={() =>
                          setLines((previous) =>
                            previous.filter((record) => record.id !== item.id),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <div className="quote-totals">
                    <span>
                      Subtotal<strong>{currency(subtotal(lines))}</strong>
                    </span>
                    <label className="field">
                      Desconto (R$)
                      <input
                        name="discount"
                        type="number"
                        min="0"
                        max={subtotal(lines) / 100}
                        step="0.01"
                        value={discount}
                        onChange={(event) =>
                          setDiscount(Number(event.target.value))
                        }
                        required
                      />
                    </label>
                    <span className="grand-total">
                      Total
                      <strong>
                        {currency(subtotal(lines) - Math.round(discount * 100))}
                      </strong>
                    </span>
                  </div>
                </div>
                <label className="field full">
                  Condições e observações
                  <textarea
                    name="notes"
                    defaultValue={quote?.notes}
                    rows={3}
                    maxLength={3000}
                  />
                </label>
              </>
            )}
          </div>
        </div>
        <FormButtons onClose={onClose} busy={travelBusy} />
      </form>
    </Modal>
  );
}

export function MovementModal({
  data,
  productId,
  onSave,
  onClose,
}: {
  data: Database;
  productId: string;
  onSave: (delta: number, reason: string) => void;
  onClose: () => void;
}) {
  const product = data.products.find((item) => item.id === productId)!;
  const location = data.inventory!.locations.find((item) => item.id === data.inventory!.defaultLocationId)!;
  const physical = stockLocationBalance(data, product.id, location.id);
  const available = stockAvailable(data, product.id, location.id);
  const [direction, setDirection] = useState("entrada");
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
  return (
    <Modal title="Movimentar estoque" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            onSave(
              direction === "entrada" ? quantity : -quantity,
              getText(new FormData(event.currentTarget), "reason"),
            );
            onClose();
          } catch (cause) {
            setError(errorMessage(cause));
          }
        }}
      >
        <div className="modal-body">
          <div className="movement-product">
            <strong>{product.name}</strong>
            <span>
              {product.code} · {location.name} · Físico: {physical} · Disponível: {available}
            </span>
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <div className="segments movement-direction">
            <button
              type="button"
              className={direction === "entrada" ? "selected" : ""}
              onClick={() => setDirection("entrada")}
            >
              <Plus size={16} />
              Entrada
            </button>
            <button
              type="button"
              className={direction === "saida" ? "selected" : ""}
              onClick={() => setDirection("saida")}
            >
              <Minus size={16} />
              Saída
            </button>
          </div>
          <div className="form-grid">
            <label className="field">
              Quantidade *
              <input
                autoFocus
                type="number"
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
                min="1"
                max="1000000"
                step="1"
                required
              />
            </label>
            <div className="balance-preview">
              <small>Saldo após movimentação</small>
              <strong>
                {physical +
                  (direction === "entrada" ? quantity : -quantity)}
              </strong>
            </div>
            <label className="field full">
              Motivo *
              <input
                name="reason"
                placeholder="Compra, consumo na OS, devolução..."
                maxLength={300}
                required
              />
            </label>
          </div>
        </div>
        <FormButtons onClose={onClose} />
      </form>
    </Modal>
  );
}

export function InventoryCountModal({
  data,
  productId,
  onSave,
  onClose,
}: {
  data: Database;
  productId: string;
  onSave: (locationId: string, quantity: number, reason: string) => void;
  onClose: () => void;
}) {
  const product = data.products.find((item) => item.id === productId)!;
  const locations = data.inventory!.locations.filter((item) => item.active);
  const [locationId, setLocationId] = useState(data.inventory!.defaultLocationId);
  const initialLocation = locations.find((item) => item.id === data.inventory!.defaultLocationId) ?? locations[0];
  const [quantity, setQuantity] = useState(stockLocationBalance(data, product.id, initialLocation.id));
  const [error, setError] = useState("");
  const physical = stockLocationBalance(data, product.id, locationId);
  const difference = quantity - physical;
  return (
    <Modal title="Contagem física de estoque" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            onSave(
              locationId,
              quantity,
              getText(new FormData(event.currentTarget), "reason"),
            );
            onClose();
          } catch (cause) {
            setError(errorMessage(cause));
          }
        }}
      >
        <div className="modal-body">
          <div className="movement-product">
            <strong>{product.name}</strong>
            <span>{product.code}</span>
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <div className="form-grid">
            <label className="field full">
              Depósito *
              <select
                value={locationId}
                onChange={(event) => {
                  const nextLocationId = event.target.value;
                  setLocationId(nextLocationId);
                  setQuantity(stockLocationBalance(data, product.id, nextLocationId));
                }}
                required
              >
                {locations.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <div className="balance-preview">
              <small>Saldo no sistema</small>
              <strong>{physical}</strong>
            </div>
            <label className="field">
              Quantidade contada *
              <input
                autoFocus
                type="number"
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
                min="0"
                max="1000000000"
                step="1"
                required
              />
            </label>
            <div className="balance-preview">
              <small>Ajuste a registrar</small>
              <strong className={difference < 0 ? "overdue" : difference > 0 ? "positive" : ""}>
                {difference > 0 ? "+" : ""}{difference}
              </strong>
            </div>
            <label className="field full">
              Justificativa *
              <textarea
                name="reason"
                placeholder="Informe a causa da divergência ou o método da contagem."
                maxLength={700}
                required
              />
            </label>
          </div>
        </div>
        <FormButtons onClose={onClose} />
      </form>
    </Modal>
  );
}
