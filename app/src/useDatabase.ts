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

type CompanyCache = {
  companyId: string;
  revision: number;
  data: Database;
};

const companyCacheKey = (userId: string) =>
  `alpha-tec.company-cache.v1.${userId}`;

function readCompanyCache(userId: string): CompanyCache | null {
  try {
    const saved = sessionStorage.getItem(companyCacheKey(userId));
    if (!saved) return null;
    const cache = JSON.parse(saved) as CompanyCache;
    if (
      typeof cache.companyId !== "string" ||
      !cache.companyId ||
      !Number.isInteger(cache.revision) ||
      cache.revision < 0
    )
      throw new Error("Cache local da empresa inválido.");
    return { ...cache, data: validateDatabase(cache.data) };
  } catch (error) {
    console.warn("Não foi possível restaurar o cache temporário da empresa.", error);
    try {
      sessionStorage.removeItem(companyCacheKey(userId));
    } catch (removeError) {
      console.warn("Não foi possível remover o cache temporário inválido.", removeError);
    }
    return null;
  }
}

function writeCompanyCache(
  userId: string,
  companyId: string,
  revision: number,
  data: Database,
) {
  try {
    sessionStorage.setItem(
      companyCacheKey(userId),
      JSON.stringify({ companyId, revision, data }),
    );
  } catch (error) {
    console.warn("Não foi possível atualizar o cache temporário da empresa.", error);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "Armazenamento cheio. Exporte um backup antes de continuar.";
  if (error && typeof error === "object" && "code" in error && error.code === "57014")
    return "O banco excedeu o tempo limite da operação. Tente novamente.";
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
  const [companyScope, setCompanyScope] = useState("");
  const [cloudMode, setCloudMode] = useState<CloudScreenMode>(
    cloudEnabled ? (supabase ? "loading" : "configuration") : "login",
  );
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudSaveVersion, setCloudSaveVersion] = useState(0);
  const [cloudSyncState, setCloudSyncState] = useState<
    "idle" | "loading" | "saving" | "synced" | "error"
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
  const cloudSaveSequence = useRef(0);
  const activeUserId = useRef<string | null>(null);
  const cloudReady = useRef(false);
  const loadSequence = useRef(0);
  const syncBlocked = useRef(false);
  const saveEpoch = useRef(0);

  const loadCompany = useCallback(async (userId: string) => {
    if (!supabase) throw new Error("O cliente Supabase não está configurado.");
    if (activeUserId.current !== userId) return false;
    const loadId = ++loadSequence.current;
    cloudReady.current = false;
    companyId.current = null;
    revision.current = null;
    setState((previous) => ({
      ...previous,
      loading: previous.data === null,
    }));
    const membership = await supabase
      .from("company_memberships")
      .select("company_id, role")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (activeUserId.current !== userId || loadId !== loadSequence.current)
      return false;
    if (membership.error) throw membership.error;
    if (!membership.data) {
      companyId.current = null;
      setCompanyScope("");
      revision.current = null;
      current.current = null;
      setCloudError("");
      setCloudMode("create-company");
      setState({ data: null, error: "", loading: false });
      return false;
    }
    const memberRole = z.enum(["owner", "admin", "manager", "technician"]).parse(membership.data.role);
    setRole(memberRole);
    if (memberRole === "technician") {
      location.replace(`${location.pathname}?tecnico=1`);
      return false;
    }
    if (memberRole !== "owner" && memberRole !== "admin")
      throw new Error("Nível sem acesso ao painel. Solicite ao Master o ajuste do seu usuário.");
    companyId.current = membership.data.company_id;
    setCompanyScope(membership.data.company_id);
    const cache = readCompanyCache(userId);
    if (cache && cache.companyId === membership.data.company_id) {
      current.current = cache.data;
      setCloudSyncState("loading");
      setState({ data: cache.data, error: "", loading: false });
    } else if (cache) {
      try {
        sessionStorage.removeItem(companyCacheKey(userId));
      } catch (error) {
        console.warn("Não foi possível remover o cache de outra empresa.", error);
      }
    }
    let cachedData: { payload: Database; revision: number } | null = null;
    if (cache && cache.companyId === membership.data.company_id) {
      const latest = await supabase
        .from("company_data")
        .select("revision")
        .eq("company_id", membership.data.company_id)
        .single();
      if (activeUserId.current !== userId || loadId !== loadSequence.current)
        return false;
      if (latest.error) throw latest.error;
      if (Number(latest.data.revision) === cache.revision)
        cachedData = { payload: cache.data, revision: cache.revision };
    }
    const result = cachedData
      ? { data: cachedData, error: null }
      : await supabase
          .from("company_data")
          .select("payload, revision")
          .eq("company_id", membership.data.company_id)
          .single();
    if (activeUserId.current !== userId || loadId !== loadSequence.current)
      return false;
    if (result.error) throw result.error;
    const data = validateDatabase(result.data.payload);
    companyId.current = membership.data.company_id;
    revision.current = Number(result.data.revision);
    current.current = data;
    cloudReady.current = true;
    setCloudError("");
    setCloudMode("loading");
    setCloudSyncState("synced");
    setState({ data, error: "", loading: false });
    writeCompanyCache(userId, membership.data.company_id, revision.current, data);
    return true;
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
      if (!active) return;
      if (nextUser && activeUserId.current === nextUser.id) {
        setUser(nextUser);
        return;
      }
      activeUserId.current = nextUser?.id ?? null;
      loadSequence.current += 1;
      saveEpoch.current += 1;
      syncBlocked.current = false;
      setUser(nextUser);
      setRole(null);
      setCompanyScope("");
      setCloudError("");
      setCloudSyncState("idle");
      current.current = null;
      companyId.current = null;
      revision.current = null;
      cloudReady.current = false;
      if (!nextUser) {
        setCloudMode("login");
        setState({ data: null, error: "", loading: false });
        return;
      }
      setState({ data: null, error: "", loading: true });
      setCloudMode("loading");
      setCloudSyncState("loading");
      try {
        await loadCompany(nextUser.id);
      } catch (error) {
        if (!active || activeUserId.current !== nextUser.id) return;
        setCloudError(errorMessage(error));
        setCloudMode("unavailable");
        setState({ data: null, error: "", loading: false });
      }
    };

    let authEventSequence = 0;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (_event === "INITIAL_SESSION" || _event === "SIGNED_IN") {
        const eventId = ++authEventSequence;
        // Supabase can emit SIGNED_IN again when the tab regains focus.
        window.setTimeout(() => {
          if (eventId === authEventSequence)
            void handleSession(session?.user ?? null);
        }, 0);
      } else if (_event === "SIGNED_OUT") {
        authEventSequence += 1;
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
      if (user) {
        try {
          sessionStorage.removeItem(companyCacheKey(user.id));
        } catch (error) {
          console.warn("Não foi possível remover o cache temporário ao sair.", error);
        }
      }
    } catch (error) {
      setCloudError(errorMessage(error));
      setCloudMode("unavailable");
      setState({ data: null, error: "", loading: false });
    } finally {
      setCloudBusy(false);
    }
  }, [user]);

  const retry = useCallback(async () => {
    if (!user) return;
    saveEpoch.current += 1;
    syncBlocked.current = true;
    setCloudMode("loading");
    setCloudError("");
    try {
      if (await loadCompany(user.id)) syncBlocked.current = false;
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
    if (!supabase || !companyId.current || revision.current === null || !cloudReady.current)
      throw new Error("Aguarde a sincronização do banco seguro antes de salvar.");
    if (syncBlocked.current)
      throw new Error("Sincronização pausada. Recarregue os dados antes de editar.");

    const payload = validated;
    const queuedUserId = activeUserId.current;
    const queuedCompanyId = companyId.current;
    const queuedSaveSequence = ++cloudSaveSequence.current;
    const queuedEpoch = saveEpoch.current;
    current.current = payload;
    setCloudSyncState("saving");
    setState({ data: payload, error: "", loading: false });
    saveQueue.current = saveQueue.current
      .then(async () => {
        if (syncBlocked.current || saveEpoch.current !== queuedEpoch) return;
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
        if (saveEpoch.current !== queuedEpoch || activeUserId.current !== queuedUserId)
          return;
        if (saved.error) throw saved.error;
        revision.current = Number(saved.data);
        if (queuedUserId && queuedCompanyId)
          writeCompanyCache(queuedUserId, queuedCompanyId, revision.current, payload);
        setCloudSaveVersion(queuedSaveSequence);
        setCloudSyncState("synced");
      })
      .catch(async (error: unknown) => {
        if (saveEpoch.current !== queuedEpoch || activeUserId.current !== queuedUserId)
          return;
        const recoveryEpoch = ++saveEpoch.current;
        syncBlocked.current = true;
        cloudReady.current = false;
        setCloudSyncState("error");
        const saveError = `Não foi possível confirmar a gravação. ${errorMessage(error)}`;
        setCloudError(`${saveError}\nRecuperando a última versão salva.`);
        if (user) {
          try {
            const loaded = await loadCompany(user.id);
            if (!loaded || saveEpoch.current !== recoveryEpoch) return;
            syncBlocked.current = false;
            setCloudError(`${saveError}\nA última versão salva foi recuperada. Confira os dados antes de tentar novamente: alterações que não chegaram ao servidor foram descartadas.`);
          } catch (reloadError) {
            if (saveEpoch.current !== recoveryEpoch || activeUserId.current !== queuedUserId)
              return;
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
      userId: user?.id ?? null,
      role,
      busy: cloudBusy,
      syncState: cloudSyncState,
      saveVersion: cloudSaveVersion,
      getSaveRequestVersion: () => cloudSaveSequence.current,
      draftScope: cloudEnabled
        ? user && companyScope
          ? `${user.id}.${companyScope}`
          : ""
        : "local",
      error: cloudError,
      signIn,
      createCompany,
      signOut,
      retry,
      dismissError: () => setCloudError(""),
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
