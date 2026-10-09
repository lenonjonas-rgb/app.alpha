import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import SignaturePad from "signature_pad";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { ArrowLeft, CalendarDays, Check, Clock3, FileText, Home, MapPin, Navigation, RefreshCw, LogOut, Camera, Pause, Play, X } from "lucide-react";
import { supabase } from "./supabase";
import { activityTotals, allowedActivities, currency, displayDate, getOrderDetails, localDay, orderDetailsSchema, orderPending, orderValues, validateOrderDetails } from "./domain";
import type { Activity, Order, OrderDetails } from "./domain";
import { errorMessage } from "./useDatabase";
import { captureLocation, durationText, mobileSnapshotSchema, openRoute, prepareAttachment, shareAttachment } from "./mobile";
import type { MobileSnapshot } from "./mobile";
import "./TechnicianApp.css";

export default function TechnicianApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);
  const [snapshot, setSnapshot] = useState<MobileSnapshot | null>(null);
  const [selected, setSelected] = useState("");
  const [page, setPage] = useState<"home" | "agenda">("home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [syncedAt, setSyncedAt] = useState("");
  const syncing = useRef(false);
  const hasDraft = useRef(false);
  const taskWorking = useRef(false);
  const updateDraftStatus = useCallback((dirty: boolean) => { hasDraft.current = dirty; }, []);
  const updateWorkingStatus = useCallback((working: boolean) => { taskWorking.current = working; }, []);
  const accept = useCallback((data: unknown) => {
    setSnapshot(mobileSnapshotSchema.parse(data));
    setSyncedAt(new Date().toLocaleTimeString("pt-BR"));
  }, []);
  const sync = useCallback(async () => {
    if (!supabase || syncing.current) return;
    if (taskWorking.current) { setError("Aguarde o registro ou a preparação do arquivo."); return; }
    syncing.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await supabase.rpc("mobile_company_data");
      if (result.error) throw result.error;
      accept(result.data);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      syncing.current = false;
      setBusy(false);
    }
  }, [accept]);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data, error: cause }) => {
      if (!alive) return;
      if (cause) setError(errorMessage(cause));
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) { setSnapshot(null); setSelected(""); }
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);
  const userId = session?.user.id;
  useEffect(() => { if (userId) void Promise.resolve().then(sync); }, [userId, sync]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener("backButton", () => {
      if (syncing.current || taskWorking.current) return;
      if (selected) {
        if (!hasDraft.current || window.confirm("Descartar as alterações não salvas?")) setSelected("");
      } else {
        void NativeApp.exitApp();
      }
    });
    return () => { void listener.then((handle) => handle.remove()); };
  }, [selected]);

  async function mutate(order: Order, action: string, payload: object) {
    if (!supabase || !snapshot) throw new Error("Sincronize sua conta antes de continuar.");
    if (syncing.current) throw new Error("Aguarde a sincronização em andamento.");
    syncing.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await supabase.rpc("mobile_update_order", {
        p_order_id: order.id, p_action: action, p_data: payload,
        p_expected_revision: snapshot.revision,
      });
      if (result.error) throw result.error;
      accept(result.data);
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    } finally {
      syncing.current = false;
      setBusy(false);
    }
  }

  if (!ready) return <main className="tech-app"><p role="status">Carregando…</p></main>;
  if (!session) return (
    <main className="tech-app tech-login">
      <div className="tech-logo">ALPHA<span>TEC</span></div><h1>Portal do técnico</h1>
      <p>Entre com a conta vinculada pela sua empresa.</p>
      {!supabase && <p role="alert">Configuração Supabase ausente. Contate o administrador.</p>}
      {error && <p role="alert" className="tech-error">{error}</p>}
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (!supabase) return;
        const data = new FormData(event.currentTarget);
        setBusy(true); setError("");
        const result = await supabase.auth.signInWithPassword({ email: String(data.get("email")).trim(), password: String(data.get("password")) });
        if (result.error) setError(errorMessage(result.error));
        setBusy(false);
      }}>
        <label>E-mail<input name="email" type="email" autoComplete="username" required /></label>
        <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
        <button disabled={busy || !supabase}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
      <small>Internet necessária. A localização só é solicitada na entrada e na saída.</small>
    </main>
  );
  const orders = snapshot?.payload.orders.filter((order) => !getOrderDetails(order).archived) ?? [];
  const order = orders.find((item) => item.id === selected);
  const today = localDay();
  const todayOrders = orders.filter((item) => item.date === today);
  const current = orders.filter((item) => item.status === "Em atendimento" || item.status === "Pausada");
  return (
    <main className="tech-app">
      <header className="tech-header">
        {order ? <button className="tech-icon" aria-label="Voltar" disabled={busy} onClick={() => { if (!taskWorking.current && (!hasDraft.current || window.confirm("Descartar as alterações não salvas?"))) setSelected(""); }}><ArrowLeft /></button> : <div className="tech-logo">ALPHA<span>TEC</span></div>}
        <button className="tech-icon" aria-label="Sincronizar" disabled={busy} onClick={() => {
          if (hasDraft.current) { setError("Salve as alterações antes de sincronizar."); return; }
          void sync();
        }}><RefreshCw className={busy ? "tech-spin" : ""} /></button>
        <button className="tech-icon" aria-label="Sair" disabled={busy} onClick={async () => {
          if (taskWorking.current) { setError("Aguarde o registro ou a preparação do arquivo."); return; }
          if (hasDraft.current && !window.confirm("Descartar as alterações e sair?")) return;
          const result = await supabase!.auth.signOut();
          if (result.error) setError(errorMessage(result.error));
        }}><LogOut /></button>
      </header>
      {error && <div className="tech-error" role="alert">{error}<button disabled={busy} onClick={() => {
        if (hasDraft.current && !window.confirm("Sincronizar descartará as alterações não salvas. Continuar?")) return;
        void sync();
      }}>Sincronizar</button></div>}
      {!snapshot ? <p role="status">{busy ? "Buscando suas tarefas…" : "Nenhuma tarefa carregada. Sincronize para continuar."}</p> : order ? (
        <Task key={order.id} order={order} snapshot={snapshot} busy={busy} mutate={mutate} onDraftChange={updateDraftStatus} onWorkingChange={updateWorkingStatus} />
      ) : (
        <>
          <h1>Olá, {snapshot.name.split(" ")[0]}!</h1>
          <p className="tech-muted">Bom trabalho! Sincronizado às {syncedAt}</p>
          <div className="tech-summary">
            <button onClick={() => setPage("agenda")}><CalendarDays /><strong>{todayOrders.length}</strong><span>Tarefas hoje</span></button>
            <button onClick={() => setPage("agenda")}><Clock3 /><strong>{orders.filter((item) => item.date < today && item.status !== "Finalizada").length}</strong><span>Atrasadas</span></button>
            <button onClick={() => setPage("agenda")}><Play /><strong>{current.length}</strong><span>Em execução</span></button>
            <button onClick={() => setPage("agenda")}><Check /><strong>{todayOrders.filter((item) => item.status === "Finalizada").length}</strong><span>Concluídas hoje</span></button>
          </div>
          <h2>{page === "home" ? "Sua agenda de hoje" : "Todas as suas tarefas"}</h2>
          <div className="tech-list">{(page === "home" ? todayOrders : orders).toSorted((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).map((item) => (
            <button className="tech-task-card" key={item.id} onClick={() => setSelected(item.id)}>
              <span className="tech-status">{item.status}</span><strong>{snapshot.payload.clients.find((client) => client.id === item.clientId)?.name}</strong>
              <span>{item.code} · {item.title}</span><small>{displayDate(item.date)} às {item.time}</small>
            </button>
          ))}</div>
          {(page === "home" ? todayOrders : orders).length === 0 && <p>Nenhuma tarefa neste período.</p>}
          <nav className="tech-bottom"><button onClick={() => setPage("home")} className={page === "home" ? "active" : ""}><Home />Início</button><button onClick={() => setPage("agenda")} className={page === "agenda" ? "active" : ""}><CalendarDays />Agenda</button></nav>
        </>
      )}
    </main>
  );
}

function Task({ order, snapshot, busy, mutate, onDraftChange, onWorkingChange }: {
  order: Order; snapshot: MobileSnapshot; busy: boolean;
  mutate: (order: Order, action: string, payload: object) => Promise<void>;
  onDraftChange: (dirty: boolean) => void;
  onWorkingChange: (working: boolean) => void;
}) {
  const original = getOrderDetails(order);
  const [draft, setDraft] = useState(original);
  const [baseOrder, setBaseOrder] = useState(order);
  const [tab, setTab] = useState<"details" | "report" | "pending">("details");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [locating, setLocating] = useState(false);
  const [routes, setRoutes] = useState(false);
  const [signing, setSigning] = useState(false);
  const [preparingFile, setPreparingFile] = useState(false);
  const [sharingFile, setSharingFile] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  if (baseOrder !== order) {
    setBaseOrder(order);
    setDraft(getOrderDetails(order));
  }
  const client = snapshot.payload.clients.find((item) => item.id === order.clientId)!;
  const totals = activityTotals(original.activities, now);
  const pending = orderPending({ ...order, details: draft });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    onDraftChange(dirty);
    return () => { onDraftChange(false); };
  }, [dirty, onDraftChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save() {
    setError(""); setNotice("");
    try {
      const details = orderDetailsSchema.parse(draft);
      validateOrderDetails({ ...order, details }, snapshot.payload);
      await mutate(order, "report", {
        report: details.report, distanceKm: details.distanceKm,
        attachments: details.attachments, checklists: details.checklists,
        signature: details.signature, pending: details.pending,
      });
      setNotice("Relatório salvo e sincronizado.");
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function activity(kind: Activity["kind"]) {
    setError(""); setNotice(""); setLocating(true); onWorkingChange(true);
    try {
      if (dirty) throw new Error("Salve o relatório antes de registrar uma atividade.");
      const location = kind === "Check-in" || kind === "Check-out" ? await captureLocation() : undefined;
      await mutate(order, kind, { ...(location ? { location } : {}), reason });
      setReason(""); setNotice(`${kind} registrado e sincronizado.`);
    } catch (cause) {
      setError(`Não foi possível confirmar o registro: ${errorMessage(cause)}${kind === "Check-in" || kind === "Check-out" ? " Verifique a permissão de localização e a conexão; sincronize antes de tentar novamente." : ""}`);
    } finally { setLocating(false); onWorkingChange(false); }
  }
  async function files(input: HTMLInputElement) {
    setError("");
    setPreparingFile(true);
    onWorkingChange(true);
    try {
      const file = input.files?.[0];
      if (!file) return;
      const attachment = await prepareAttachment(file);
      const details = orderDetailsSchema.parse({
        ...draft, attachments: [...draft.attachments, attachment],
      });
      setDraft(details);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { input.value = ""; setPreparingFile(false); onWorkingChange(false); }
  }
  const blocked = busy || locating || preparingFile || sharingFile;
  function answer(checklistId: string, questionId: string, value: string | string[]) {
    setDraft((details) => ({
      ...details, checklists: details.checklists.map((list) => list.id === checklistId ? {
        ...list, questions: list.questions.map((question) => question.id === questionId ? { ...question, answer: value } : question),
      } : list),
    }));
  }
  return (
    <article>
      <h1>{client.name}</h1><p>{order.code} · {order.title}</p>
      <span className="tech-status">{order.status}</span>
      <div className="tech-timer"><Clock3 /><strong>{durationText(totals.work)}</strong><span>Atendimento</span><small>Pausas: {durationText(totals.pause)}</small></div>
      <div className="tech-tabs">{(["details", "report", "pending"] as const).map((value) => <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{value === "details" ? "Detalhes" : value === "report" ? "Relatório" : `Pendências (${pending.length})`}</button>)}</div>
      {error && <div role="alert" className="tech-error">{error}</div>}
      {notice && <p role="status" className="tech-success">{notice}</p>}
      {tab === "details" && <>
        <section className="tech-panel"><h2><MapPin />Endereço do cliente</h2><p>{client.address || "Endereço não cadastrado."}</p>
          <button disabled={!client.address} onClick={() => setRoutes(!routes)}><Navigation />Navegar até o local</button>
          {routes && <div className="tech-actions">{(["google", "waze"] as const).map((provider) => <button key={provider} onClick={async () => {
            try { await openRoute(client.address, provider); } catch (cause) { setError(errorMessage(cause)); }
          }}>{provider === "google" ? "Google Maps" : "Waze"}</button>)}</div>}
          {client.phone && <a href={`tel:${client.phone.replace(/[^\d+]/g, "")}`}>Ligar: {client.phone}</a>}
        </section>
        <section className="tech-panel"><h2>Informações da tarefa</h2><p>{displayDate(order.date)} às {order.time}</p><p>{order.type} · Prioridade {order.priority}</p><p>Técnico: {order.technician}</p><h3>Orientações</h3><p className="tech-preserve">{order.notes || "Nenhuma orientação."}</p>
          {original.tags.length > 0 && <p>Tags: {original.tags.join(", ")}</p>}
          <h3>Equipamentos</h3>{snapshot.payload.equipment.filter((item) => [order.equipmentId, ...original.equipmentIds].includes(item.id)).map((item) => <p key={item.id}>{item.name} · {item.serial}<br />{item.notes}</p>)}
        </section>
        <section className="tech-panel"><h2>Valores e orçamentos</h2><p>Valor da OS: {currency(orderValues(original).total)}</p>{snapshot.payload.quotes.filter((quote) => quote.orderId === order.id).map((quote) => <p key={quote.id}>{quote.code} · {quote.status}<br />{quote.notes}</p>)}</section>
      </>}
      {tab === "report" && <fieldset disabled={blocked} className="tech-fields">
        <section className="tech-panel"><h2><FileText />Relato do atendimento</h2><textarea maxLength={10000} rows={6} value={draft.report} onChange={(event) => setDraft({ ...draft, report: event.target.value })} placeholder="Descreva o atendimento realizado" />
          <label>Quilometragem (km)<input type="number" min="0" max="100000" step="0.1" value={draft.distanceKm} onChange={(event) => setDraft({ ...draft, distanceKm: Number(event.target.value) })} /></label>
        </section>
        <section className="tech-panel"><h2><Camera />Fotos e anexos</h2><p>PNG, JPG, WebP, PDF ou TXT, até 500 KB armazenados por arquivo. Fotos de até 15 MB são reduzidas automaticamente.</p>
          <label className="tech-upload">Adicionar foto<input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={(event) => void files(event.currentTarget)} /></label>
          <label className="tech-upload">Adicionar arquivo<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain" onChange={(event) => void files(event.currentTarget)} /></label>
          {draft.attachments.map((file) => <div key={file.id} className="tech-attachment">{file.mime.startsWith("image/") && <img src={file.data} alt={file.name} />}{Capacitor.isNativePlatform() ? <button onClick={async () => {
            setError(""); setSharingFile(true); onWorkingChange(true);
            try { await shareAttachment(file); }
            catch (cause) { setError(errorMessage(cause)); }
            finally { setSharingFile(false); onWorkingChange(false); }
          }}>Compartilhar: {file.name}</button> : <a href={file.data} download={file.name}>{file.name}</a>}<button className="tech-icon" aria-label={`Remover ${file.name}`} onClick={() => setDraft({ ...draft, attachments: draft.attachments.filter((item) => item.id !== file.id) })}><X /></button></div>)}
        </section>
        {draft.checklists.map((list) => <section key={list.id} className="tech-panel"><h2>{list.title}</h2>{list.questions.map((question) => <label key={question.id}>{question.label}{question.required ? " *" : ""}
          {question.kind === "Assinatura" ? <button onClick={() => setSigning(true)}>{draft.signature ? "Assinatura coletada" : "Coletar assinatura"}</button> :
          question.kind === "Foto" ? <select value={String(question.answer)} onChange={(event) => answer(list.id, question.id, event.target.value)}><option value="">Selecione uma foto adicionada</option>{draft.attachments.filter((file) => file.mime.startsWith("image/")).map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}</select> :
          question.kind === "Multipla escolha" ? <div className="tech-options">{question.options.map((option) => <label key={option}><input type="checkbox" checked={Array.isArray(question.answer) && question.answer.includes(option)} onChange={(event) => answer(list.id, question.id, event.target.checked ? [...(Array.isArray(question.answer) ? question.answer : []), option] : (Array.isArray(question.answer) ? question.answer : []).filter((item) => item !== option))} />{option}</label>)}</div> :
          question.kind === "Escolha" || question.kind === "Check" ? <select value={String(question.answer)} onChange={(event) => answer(list.id, question.id, event.target.value)}><option value="">Selecione</option>{(question.kind === "Check" ? ["Sim", "Nao"] : question.options).map((option) => <option key={option}>{option}</option>)}</select> :
          <input type={question.kind === "Data" ? "date" : question.kind === "Hora" ? "time" : question.kind === "Numero" || question.kind === "Monetaria" ? "number" : "text"} step="any" maxLength={10000} value={String(question.answer)} onChange={(event) => answer(list.id, question.id, event.target.value)} />}
        </label>)}</section>)}
        <section className="tech-panel"><h2>Assinatura do cliente</h2>{draft.signature && <><img className="tech-signature-preview" src={draft.signature.image} alt={`Assinatura de ${draft.signature.signer}`} /><p>{draft.signature.signer}</p></>}
          <button onClick={() => setSigning(true)}>{draft.signature ? "Substituir assinatura" : "Coletar assinatura"}</button>
          <small>A assinatura é salva na OS. Envio de link/e-mail ao cliente ainda não está disponível.</small>
        </section>
      </fieldset>}
      {tab === "pending" && <section className="tech-panel"><h2>Pendências do atendimento</h2>{pending.length === 0 && <p>Tudo preenchido.</p>}{pending.map((item) => <p key={item.id}>{item.title} · {item.source}</p>)}
        {draft.pending.map((item) => <label className="tech-check" key={item.id}><input disabled={blocked} type="checkbox" checked={item.resolved} onChange={(event) => setDraft({ ...draft, pending: draft.pending.map((record) => record.id === item.id ? { ...record, resolved: event.target.checked } : record) })} />{item.title}</label>)}
      </section>}
      {dirty && <button disabled={blocked} onClick={() => void save()}><Check />Salvar alterações antes de continuar</button>}
      <section className="tech-panel"><h2>Controle do atendimento</h2>
        {order.status !== "Finalizada" && allowedActivities(original.activities).includes("Pausa") && <label>Motivo da pausa<input disabled={blocked} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></label>}
        <div className="tech-actions">{order.status !== "Finalizada" && allowedActivities(original.activities).filter((kind) => kind !== "Deslocamento").map((kind) => <button key={kind} disabled={blocked || dirty || (kind === "Pausa" && !reason.trim()) || (kind === "Check-out" && pending.length > 0)} onClick={() => void activity(kind)}>{kind === "Pausa" ? <Pause /> : kind === "Check-out" ? <Check /> : <Play />}{locating ? "Registrando…" : kind}</button>)}</div>
        <small>Entrada e saída exigem GPS e internet. O tempo exibido exclui as pausas.</small>
        {original.activities.map((item) => <p key={item.id}><b>{item.kind}</b> · {new Date(item.at).toLocaleString("pt-BR")}<br />{item.reason}{item.location && <small>GPS: {item.location.latitude.toFixed(5)}, {item.location.longitude.toFixed(5)} · precisão {Math.round(item.location.accuracy)} m</small>}</p>)}
      </section>
      {signing && <Signature onClose={() => setSigning(false)} onApply={(signature) => { setDraft({ ...draft, signature }); setSigning(false); }} />}
    </article>
  );
}

function Signature({ onClose, onApply }: { onClose: () => void; onApply: (signature: NonNullable<OrderDetails["signature"]>) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pad = useRef<SignaturePad | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = canvas.current!;
    const bounds = element.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    element.width = bounds.width * ratio; element.height = bounds.height * ratio;
    element.getContext("2d")?.scale(ratio, ratio);
    pad.current = new SignaturePad(element);
    return () => pad.current?.off();
  }, []);
  return <div className="tech-dialog" role="dialog" aria-modal="true" aria-label="Assinatura do cliente"><form onSubmit={(event) => {
    event.preventDefault();
    if (!pad.current || pad.current.isEmpty()) { setError("Desenhe a assinatura."); return; }
    onApply({ signer: String(new FormData(event.currentTarget).get("signer")).trim(), image: pad.current.toDataURL("image/png"), at: new Date().toISOString() });
  }}><h2>Assinatura do cliente</h2>{error && <p role="alert">{error}</p>}<label>Nome de quem assina<input name="signer" required maxLength={120} /></label><canvas ref={canvas} /><div className="tech-actions"><button type="button" onClick={() => pad.current?.clear()}>Limpar</button><button type="button" onClick={onClose}>Cancelar</button><button>Aplicar</button></div></form></div>;
}
