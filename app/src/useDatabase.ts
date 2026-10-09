import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import {
  demoDatabase,
  emptyDatabase,
  STORAGE_KEY,
  validateDatabase,
} from "./domain";
import type { Database } from "./domain";
import type { CompanyRegistration } from "./cnpj";
import {
  cloudConfigurationError,
  cloudEnabled,
  supabase,
} from "./supabase";
import type { CloudScreenMode } from "./CloudAccess";
import { displayLogin, loginEmail } from "./userAccess";
import type { CompanyRole } from "./userAccess";

type DatabaseState = {
  data: Database | null;
  error: string;
  loading: boolean;
};

export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "Armazenamento cheio. Exporte um backup antes de continuar.";
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";
}

function load(): { data: Database | null; error: string } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const data = saved ? validateDatabase(JSON.parse(saved)) : demoDatabase();
    if (!saved) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return { data, error: "" };
  } catch (error) {
    return { data: null, error: errorMessage(error) };
  }
}

export function useDatabase() {
  const [state, setState] = useState<DatabaseState>(() =>
    cloudEnabled
      ? { data: null, error: "", loading: true }
      : { ...load(), loading: false },
  );
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<CompanyRole | null>(null);
  const [cloudMode, setCloudMode] = useState<CloudScreenMode>(
    cloudEnabled ? (supabase ? "loading" : "configuration") : "login",
  );
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudSyncState, setCloudSyncState] = useState<
    "idle" | "saving" | "synced" | "error"
  >("idle");
  const [cloudError, setCloudError] = useState(
    cloudEnabled
      ? cloudConfigurationError ||
          (!supabase
            ? "Configure as credenciais públicas do projeto Supabase."
            : "")
      : "",
  );
  const current = useRef(state.data);
  const companyId = useRef<string | null>(null);
  const revision = useRef<number | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const activeUserId = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const syncBlocked = useRef(false);

  const loadCompany = useCallback(async (userId: string) => {
    if (!supabase) throw new Error("O cliente Supabase não está configurado.");
    if (activeUserId.current !== userId) return;
    const loadId = ++loadSequence.current;
    setState({ data: null, error: "", loading: true });
    const membership = await supabase
      .from("company_memberships")
      .select("company_id, role")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (activeUserId.current !== userId || loadId !== loadSequence.current)
      return;
    if (membership.error) throw membership.error;
    if (!membership.data) {
      companyId.current = null;
      revision.current = null;
      current.current = null;
      setCloudError("");
      setCloudMode("create-company");
      setState({ data: null, error: "", loading: false });
      return;
    }
    const memberRole = z.enum(["owner", "admin", "manager", "technician"]).parse(membership.data.role);
    setRole(memberRole);
    if (memberRole === "technician") {
      location.replace(`${location.pathname}?tecnico=1`);
      return;
    }
    if (memberRole !== "owner" && memberRole !== "admin")
      throw new Error("Nível sem acesso ao painel. Solicite ao Master o ajuste do seu usuário.");
    const result = await supabase
      .from("company_data")
      .select("payload, revision")
      .eq("company_id", membership.data.company_id)
      .single();
    if (activeUserId.current !== userId || loadId !== loadSequence.current)
      return;
    if (result.error) throw result.error;
    const data = validateDatabase(result.data.payload);
    companyId.current = membership.data.company_id;
    revision.current = Number(result.data.revision);
    current.current = data;
    setCloudError("");
    setCloudMode("loading");
    setCloudSyncState("synced");
    setState({ data, error: "", loading: false });
  }, []);

  useEffect(() => {
    if (!cloudEnabled) {
      function sync(event: StorageEvent) {
        if (event.key !== STORAGE_KEY) return;
        try {
          const data = event.newValue
            ? validateDatabase(JSON.parse(event.newValue))
            : null;
          current.current = data;
          setState({
            data,
            error: data ? "" : "Os dados foram removidos em outra aba.",
            loading: false,
          });
        } catch (error) {
          current.current = null;
          setState({
            data: null,
            error: errorMessage(error),
            loading: false,
          });
        }
      }
      window.addEventListener("storage", sync);
      return () => window.removeEventListener("storage", sync);
    }

    if (!supabase) return;

    let active = true;
    const handleSession = async (nextUser: User | null) => {
      activeUserId.current = nextUser?.id ?? null;
      loadSequence.current += 1;
      syncBlocked.current = false;
      setUser(nextUser);
      setRole(null);
      setCloudError("");
      setCloudSyncState("idle");
      current.current = null;
      companyId.current = null;
      revision.current = null;
      if (!nextUser) {
        setCloudMode("login");
        setState({ data: null, error: "", loading: false });
        return;
      }
      setCloudMode("loading");
      try {
        await loadCompany(nextUser.id);
      } catch (error) {
        if (!active || activeUserId.current !== nextUser.id) return;
        setCloudError(errorMessage(error));
        setCloudMode("unavailable");
        setState({ data: null, error: "", loading: false });
      }
    };

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (_event === "INITIAL_SESSION" || _event === "SIGNED_IN") {
        void handleSession(session?.user ?? null);
      } else if (_event === "SIGNED_OUT") {
        void handleSession(null);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [loadCompany]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return;
    setCloudBusy(true);
    setCloudError("");
    try {
      const result = await supabase.auth.signInWithPassword({ email: loginEmail(email), password });
      if (result.error) throw result.error;
    } catch (error) {
      setCloudError(errorMessage(error));
    } finally {
      setCloudBusy(false);
    }
  }, []);

  const createCompany = useCallback(
    async (registration: CompanyRegistration) => {
      if (!supabase || !user?.email) return;
      setCloudBusy(true);
      setCloudError("");
      try {
        const companyName =
          registration.tradeName || registration.legalName;
        const payload = emptyDatabase(companyName, user.email, registration);
        const result = await supabase.rpc("create_company_for_current_user", {
          p_company_name: companyName,
          p_payload: payload,
        });
        if (result.error) throw result.error;
        await loadCompany(user.id);
      } catch (error) {
        setCloudError(errorMessage(error));
      } finally {
        setCloudBusy(false);
      }
    },
    [loadCompany, user],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setCloudBusy(true);
    setCloudError("");
    try {
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
    } catch (error) {
      setCloudError(errorMessage(error));
      setCloudMode("unavailable");
      setState({ data: null, error: "", loading: false });
    } finally {
      setCloudBusy(false);
    }
  }, []);

  const retry = useCallback(async () => {
    if (!user) return;
    syncBlocked.current = false;
    setCloudMode("loading");
    setCloudError("");
    try {
      await loadCompany(user.id);
    } catch (error) {
      setCloudError(errorMessage(error));
      setCloudMode("unavailable");
      setState({ data: null, error: "", loading: false });
    }
  }, [loadCompany, user]);

  function commit(update: Database | ((data: Database) => Database)) {
    const previous = current.current;
    if (!previous)
      throw new Error("Não há uma empresa carregada para salvar alterações.");
    const next =
      typeof update === "function" ? update(previous) : update;
    const validated = validateDatabase(next);

    if (!cloudEnabled) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
      current.current = validated;
      setState({ data: validated, error: "", loading: false });
      return;
    }
    if (!supabase || !companyId.current || revision.current === null)
      throw new Error("Sessão ou empresa indisponível para salvar dados.");
    if (syncBlocked.current)
      throw new Error("Sincronização pausada. Recarregue os dados antes de editar.");

    const payload = validated;
    const queuedUserId = activeUserId.current;
    const queuedCompanyId = companyId.current;
    current.current = payload;
    setCloudSyncState("saving");
    setState({ data: payload, error: "", loading: false });
    saveQueue.current = saveQueue.current
      .then(async () => {
        if (syncBlocked.current) return;
        if (
          activeUserId.current !== queuedUserId ||
          companyId.current !== queuedCompanyId
        )
          return;
        if (!supabase || revision.current === null)
          throw new Error("Sessão expirada antes de salvar as alterações.");
        const saved = await supabase.rpc("save_company_data", {
          p_payload: payload,
          p_expected_revision: revision.current,
        });
        if (saved.error) throw saved.error;
        revision.current = Number(saved.data);
        setCloudSyncState("synced");
      })
      .catch(async (error: unknown) => {
        syncBlocked.current = true;
        setCloudSyncState("error");
        const saveError = errorMessage(error);
        setCloudError(`${saveError}\nAs alterações locais foram descartadas.`);
        setCloudMode("unavailable");
        if (user) {
          try {
            await loadCompany(user.id);
            setCloudError(`${saveError}\nOs dados foram recarregados do servidor.`);
            setCloudMode("unavailable");
          } catch (reloadError) {
            setCloudError(
              `${saveError}\nFalha ao recarregar os dados: ${errorMessage(reloadError)}`,
            );
            setCloudMode("unavailable");
            setState({ data: null, error: "", loading: false });
          }
        }
      });
  }

  return {
    ...state,
    commit,
    cloud: {
      enabled: cloudEnabled,
      mode: cloudMode,
      email: displayLogin(user?.email ?? ""),
      role,
      busy: cloudBusy,
      syncState: cloudSyncState,
      error: cloudError,
      signIn,
      createCompany,
      signOut,
      retry,
    },
  };
}

export function downloadFile(
  name: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
