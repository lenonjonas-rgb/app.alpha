import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Minus, Plus, Save, Trash2 } from "lucide-react";
import {
  currency,
  localDay,
  makeId,
  nextCode,
  orderDetailsSchema,
  getOrderDetails,
  serviceLocationSchema,
  shiftDay,
  subtotal,
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
import { addQuestionnaire, orderEquipmentQuestionnaires } from "./questionnaires";
import type { OrderEquipmentSelection } from "./questionnaires";
import { ServiceLocationFields } from "./ServiceLocationFields";
import { EquipmentModelPicker, EquipmentSelections } from "./EquipmentModelPicker";
import { generateEquipmentCode, selectEquipmentModel } from "./equipmentCatalogData";

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
};
const getText = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
const getNumber = (form: FormData, key: string) => Number(getText(form, key));
const getMoney = (form: FormData, key: string) =>
  Math.round(getNumber(form, key) * 100);

function FormButtons({ onClose }: { onClose: () => void }) {
  return (
    <footer className="modal-footer">
      <button type="button" className="button secondary" onClick={onClose}>
        Cancelar
      </button>
      <button className="button primary" type="submit">
        <Save size={17} />
        Salvar
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
  onClose,
  onSuccess,
  onClientEquipment,
}: {
  editor: Editor;
  data: Database;
  commit: (update: Database | ((data: Database) => Database)) => void;
  onClose: () => void;
  onSuccess: (text: string) => void;
  onClientEquipment?: (clientId: string) => void;
}) {
  const [error, setError] = useState("");
  const technicians = useTechnicians(editor.kind === "order");
  const [assignedTechnicianId, setAssignedTechnicianId] = useState(() =>
    editor.kind === "order"
      ? (data.orders.find((record) => record.id === editor.id)?.technicianUserId ?? "")
      : "",
  );
  const [clientId, setClientId] = useState(() =>
    editor.kind === "order"
      ? (data.orders.find((record) => record.id === editor.id)?.clientId ?? editor.clientId ?? "")
      : "",
  );
  const [lines, setLines] = useState<Line[]>(
    () => data.quotes.find((record) => record.id === editor.id)?.items ?? [],
  );
  const [discount, setDiscount] = useState(
    () =>
      (data.quotes.find((record) => record.id === editor.id)?.discount ?? 0) /
      100,
  );
  const [catalogId, setCatalogId] = useState("");
  const [orderType, setOrderType] = useState<Order["type"]>(() => data.orders.find((record) => record.id === editor.id)?.type ?? "Corretiva");
  const [questionnaireId, setQuestionnaireId] = useState(() => editor.id ? "" : data.orderTypeQuestionnaires.find((item) => item.type === "Corretiva")?.questionnaireId ?? "");
  const client = data.clients.find((record) => record.id === editor.id);
  const equipment = data.equipment.find((record) => record.id === editor.id);
  const product = data.products.find((record) => record.id === editor.id);
  const service = data.services.find((record) => record.id === editor.id);
  const order = data.orders.find((record) => record.id === editor.id);
  const quote = data.quotes.find((record) => record.id === editor.id);
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [orderEquipment, setOrderEquipment] = useState<OrderEquipmentSelection[]>(() => {
    const ids = order ? [order.equipmentId, ...getOrderDetails(order).equipmentIds] : [editor.equipmentId ?? ""];
    return [...new Set(ids.filter(Boolean))].map((equipmentId) => ({ equipmentId, questionnaireId: "" }));
  });
  const clientEquipment = data.equipment.filter((item) => item.clientId === clientId);
  const equipmentQuestionnaires = data.questionnaires.filter((item) => !item.archived && item.display.equipment);
  const previousEquipmentIds = order ? [order.equipmentId, ...getOrderDetails(order).equipmentIds].filter(Boolean) : [];
  function equipmentSelection(equipmentId: string): OrderEquipmentSelection {
    const defaultId = data.orderTypeQuestionnaires.find((item) => item.type === orderType)?.questionnaireId;
    return { equipmentId, questionnaireId: equipmentQuestionnaires.find((item) => item.id === defaultId)?.id ?? "" };
  }
  const [modelId, setModelId] = useState(equipment?.model?.modelId ?? "");
  const [equipmentName, setEquipmentName] = useState(equipment?.name ?? "");
  const [equipmentCategory, setEquipmentCategory] = useState(equipment?.category ?? "Cardio");
  const [selectedModels, setSelectedModels] = useState<EquipmentSelection[]>(() =>
    editor.kind === "order" && order ? getOrderDetails(order).equipmentModels : quote?.equipmentModels ?? [],
  );
  const titles: Record<FormKind, string> = {
    client: "cliente",
    equipment: "equipamento",
    product: "produto",
    service: "serviço",
    order: "ordem de serviço",
    quote: "orçamento",
    movement: "movimentação de estoque",
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
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
            const useClientAddress = form.get("useClientAddress") === "on";
            const selectedClient = current.clients.find((item) => item.id === getText(form, "clientId"));
            if (useClientAddress && !selectedClient?.address.trim())
              throw new Error("O cliente não possui endereço cadastrado. Informe o endereço de atendimento ou atualize o cadastro do cliente.");
            const serviceLocation = serviceLocationSchema.parse({
              useClientAddress,
              postalCode: getText(form, "service_postalCode").replace(/\D/g, ""),
              street: getText(form, "service_street"),
              number: getText(form, "service_number"),
              complement: getText(form, "service_complement"),
              neighborhood: getText(form, "service_neighborhood"),
              city: getText(form, "service_city"),
              state: getText(form, "service_state").toUpperCase(),
            });
            const details = {
              ...previousDetails,
              equipmentModels: selectedModels,
              equipmentIds: equipmentLinks.equipmentIds,
              serviceLocation,
              responsibleName: getText(form, "responsibleName"),
              responsiblePhone: getText(form, "responsiblePhone"),
              ...(existing ? {} : { questionnaireRequired: current.orderTypeQuestionnaires.find((item) => item.type === orderType)?.required ?? false }),
              checklists: template && (existing || orderEquipment.length === 0) ? addQuestionnaire(equipmentLinks.checklists, template) : equipmentLinks.checklists,
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
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      if (editor.kind === "order" && orderEquipment.length > 0) setEquipmentOpen(true);
    }
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
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
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
                  Custo (R$)
                  <input
                    type="number"
                    name="cost"
                    defaultValue={(product?.cost ?? 0) / 100}
                    min="0"
                    max="1000000"
                    step="0.01"
                    required
                  />
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
                    setOrderEquipment([]);
                    setEquipmentOpen(false);
                  }}
                />
                <ServiceLocationFields
                  key={clientId}
                  client={data.clients.find((item) => item.id === clientId)}
                  details={order?.clientId === clientId ? getOrderDetails(order) : undefined}
                />
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
                      return <div className="order-equipment-option" key={item.id}>
                        <label className="check">
                          <input type="checkbox" checked={Boolean(selection)} onChange={(event) => setOrderEquipment(event.target.checked
                            ? [...orderEquipment, equipmentSelection(item.id)] : orderEquipment.filter((entry) => entry.equipmentId !== item.id))} />
                          <span>{item.name} · {item.assetCode ?? item.serial}{item.model && <small>{item.model.brand} · {item.model.line || "Sem linha cadastrada"}</small>}</span>
                        </label>
                        {selection && <label className="field">
                          Questionário para {item.name} · {item.assetCode ?? item.serial}
                          <select aria-label={`Questionário do equipamento ${item.assetCode ?? item.serial}`} value={selection.questionnaireId}
                            required={existingChecklists.length === 0 && !previousEquipmentIds.includes(item.id)}
                            onChange={(event) => setOrderEquipment(orderEquipment.map((entry) => entry.equipmentId === item.id ? { ...entry, questionnaireId: event.target.value } : entry))}>
                            <option value="">{previousEquipmentIds.includes(item.id) ? "Preservar vínculo atual, sem adicionar questionário" : "Selecione um questionário"}</option>
                            {equipmentQuestionnaires.filter((template) => !existingChecklists.some((checklist) => checklist.templateId === template.id))
                              .map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
                          </select>
                          {existingChecklists.length > 0 && <small>Vinculados: {existingChecklists.map((checklist) => checklist.title).join(", ")}. As respostas serão preservadas.</small>}
                        </label>}
                      </div>;
                    })}
                    {equipmentQuestionnaires.length === 0 && <p role="alert">Não há questionários ativos com resposta por equipamento. Habilite essa opção no cadastro do questionário.</p>}
                    <small>Cada unidade selecionada terá seu próprio questionário e respostas. A seleção de equipamentos é opcional.</small>
                  </div>}
                  {!equipmentOpen && orderEquipment.length > 0 && <small>Abra Equipamentos para conferir o questionário de cada unidade.</small>}
                </section>}
                <EquipmentSelections data={data} value={selectedModels} onChange={setSelectedModels} />
                <label className="field">
                  Data *
                  <input
                    type="date"
                    name="date"
                    defaultValue={order?.date ?? editor.date ?? localDay()}
                    required
                  />
                </label>
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
                  {order ? "Adicionar questionário à tarefa" : "Questionário"}
                  <select aria-label={order ? "Adicionar questionário à tarefa" : "Questionário"} value={questionnaireId} onChange={(event) => setQuestionnaireId(event.target.value)}>
                    <option value="">{order ? "Preservar questionários atuais, sem adicionar" : "Sem questionário"}</option>
                    {data.questionnaires.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                  </select>
                  <small>{order ? "Os questionários vinculados são atualizados automaticamente enquanto a tarefa não estiver finalizada ou arquivada. Não é necessário adicioná-los novamente." : "O padrão do tipo é selecionado automaticamente e pode ser substituído. As respostas são exclusivas desta tarefa."}</small>
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
                          min="0.01"
                          max="10000"
                          step="0.01"
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
        <FormButtons onClose={onClose} />
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
              {product.code} · Saldo atual: {product.stock}
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
                {product.stock +
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
