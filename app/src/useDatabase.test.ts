import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { demoDatabase } from "./domain";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  index: 0,
  effect: null as (() => (() => void) | void) | null,
}));
// Run the hook's async orchestration without a DOM renderer.
vi.mock("react", () => ({
  useState<T>(initial: T | (() => T)) {
    const index = hooks.index++;
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [hooks.slots[index], (next: T | ((value: T) => T)) => {
      hooks.slots[index] = typeof next === "function"
        ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
    }];
  },
  useRef<T>(value: T) {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: value };
    return hooks.slots[index];
  },
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => (() => void) | void) => { hooks.effect = effect; },
}));
const server = vi.hoisted(() => ({
  data: {} as unknown,
  revision: 0,
  error: null as unknown,
  auth: null as ((event: string, session: { user: User } | null) => void) | null,
  reads: [] as string[],
  rpc: vi.fn(),
}));
vi.mock("./supabase", () => ({
  cloudEnabled: true,
  cloudConfigurationError: "",
  supabase: {
    auth: {
      onAuthStateChange: (callback: typeof server.auth) => {
        server.auth = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    from: (table: string) => {
      let selection = "";
      const query = {
        select: (value: string) => { selection = value; return query; },
        eq: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: { company_id: "company", role: "owner" }, error: null }),
        single: async () => {
          server.reads.push(`${table}:${selection}`);
          return { data: { revision: server.revision, payload: structuredClone(server.data) }, error: server.error };
        },
      };
      return query;
    },
    rpc: server.rpc,
  },
}));
import { errorMessage, useDatabase } from "./useDatabase";

const user: User = {
  id: "owner", email: "owner@example.test", aud: "authenticated",
  created_at: "2026-01-01T12:00:00Z", app_metadata: {}, user_metadata: {},
};
let cleanup: (() => void) | void;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
function render() {
  hooks.index = 0;
  // oxlint-disable-next-line react-hooks/rules-of-hooks -- Hook execution is supplied by the test harness.
  return useDatabase();
}
function auth(event: string, nextUser: User | null = user) {
  server.auth?.(event, nextUser ? { user: nextUser } : null);
}
async function start() {
  render();
  cleanup = hooks.effect?.();
  auth("INITIAL_SESSION");
  await vi.waitFor(() => expect(render().data).not.toBeNull());
}
beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
  hooks.effect = null;
  server.data = demoDatabase();
  server.revision = 0;
  server.error = null;
  server.reads = [];
  server.rpc.mockReset();
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", { setTimeout });
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

describe("sincronização da empresa", () => {
  it("não recarrega dados ou perde alterações quando SIGNED_IN se repete ao voltar à aba", async () => {
    await start();
    const pending = deferred<{ data: number; error: null }>();
    server.rpc.mockReturnValue(pending.promise);
    const next = demoDatabase();
    next.settings.company = "Alteracao em andamento";
    render().commit(next);
    await vi.waitFor(() => expect(server.rpc).toHaveBeenCalledTimes(1));
    auth("SIGNED_IN");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.reads).toHaveLength(1);
    expect(render().data?.settings.company).toBe(next.settings.company);
    expect(render().cloud.syncState).toBe("saving");
    pending.resolve({ data: 1, error: null });
    await vi.waitFor(() => expect(render().cloud.syncState).toBe("synced"));
  });

  it("valida a revisão do cache sem baixar novamente o documento, inclusive na revisão zero", async () => {
    sessionStorage.setItem("alpha-tec.company-cache.v1.owner",
      JSON.stringify({ companyId: "company", revision: 0, data: server.data }));
    await start();
    await vi.waitFor(() => expect(render().cloud.syncState).toBe("synced"));
    expect(server.reads).toEqual(["company_data:revision"]);
  });

  it("baixa a versão nova quando a revisão do servidor mudou", async () => {
    sessionStorage.setItem("alpha-tec.company-cache.v1.owner",
      JSON.stringify({ companyId: "company", revision: 0, data: demoDatabase() }));
    const updated = demoDatabase();
    updated.settings.company = "Empresa atualizada";
    server.data = updated;
    server.revision = 1;
    await start();
    await vi.waitFor(() => expect(render().data?.settings.company).toBe(updated.settings.company));
    expect(server.reads).toEqual(["company_data:revision", "company_data:payload, revision"]);
  });

  it("recupera após timeout, cancela gravações antigas na fila e permite uma nova tentativa explícita", async () => {
    await start();
    const failed = deferred<{ data: null; error: { code: string; message: string } }>();
    server.rpc.mockReturnValueOnce(failed.promise).mockResolvedValue({ data: 1, error: null });
    const next = demoDatabase();
    next.settings.company = "Nao salvo";
    render().commit(next);
    render().commit({ ...next, settings: { ...next.settings, company: "Fila obsoleta" } });
    failed.resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    await vi.waitFor(() => expect(render().cloud.error).toContain("última versão salva foi recuperada"));
    expect(render().cloud.mode).toBe("loading");
    expect(render().cloud.syncState).toBe("synced");
    expect(render().cloud.saveVersion).toBe(0);
    expect(render().data?.settings.company).toBe(demoDatabase().settings.company);
    expect(server.rpc).toHaveBeenCalledTimes(1);
    render().commit(next);
    await vi.waitFor(() => expect(render().cloud.saveVersion).toBe(3));
    expect(server.rpc).toHaveBeenCalledTimes(2);
    expect(server.rpc.mock.calls[1][1].p_expected_revision).toBe(0);
  });

  it("bloqueia se a recuperação também falhar, sem substituir dados por demonstração", async () => {
    await start();
    server.error = { message: "Servidor indisponivel" };
    server.rpc.mockResolvedValue({ error: { code: "57014" }, data: null });
    render().commit(demoDatabase());
    await vi.waitFor(() => expect(render().cloud.mode).toBe("unavailable"));
    expect(render().data).toBeNull();
    expect(render().cloud.error).toContain("Falha ao recarregar");
    expect(() => render().commit(demoDatabase())).toThrow();
    server.error = null;
    await render().cloud.retry();
    expect(render().cloud.syncState).toBe("synced");
  });

  it("recupera a gravação que chegou ao servidor quando apenas a resposta foi perdida, sem reenviar", async () => {
    await start();
    const next = demoDatabase();
    next.settings.company = "Salvo apesar da resposta perdida";
    server.rpc.mockImplementationOnce(async () => {
      server.data = next;
      server.revision = 1;
      return { data: null, error: { message: "Failed to fetch" } };
    });
    render().commit(next);
    await vi.waitFor(() => expect(render().cloud.error).toContain("última versão salva foi recuperada"));
    expect(render().data?.settings.company).toBe(next.settings.company);
    expect(render().cloud.syncState).toBe("synced");
    expect(render().cloud.saveVersion).toBe(0);
    expect(server.rpc).toHaveBeenCalledTimes(1);
  });

  it("ignora respostas de gravação de uma sessão encerrada", async () => {
    await start();
    const pending = deferred<{ data: number; error: null }>();
    server.rpc.mockReturnValue(pending.promise);
    render().commit(demoDatabase());
    await vi.waitFor(() => expect(server.rpc).toHaveBeenCalledTimes(1));
    auth("SIGNED_OUT", null);
    pending.resolve({ data: 1, error: null });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(render().data).toBeNull();
    expect(render().cloud.mode).toBe("login");
    expect(render().cloud.saveVersion).toBe(0);
  });

  it("não reabre uma sessão após logout quando SIGNED_IN já estava agendado", async () => {
    await start();
    auth("SIGNED_IN");
    auth("SIGNED_OUT", null);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(render().cloud.mode).toBe("login");
    expect(render().data).toBeNull();
    expect(server.reads).toHaveLength(1);
  });

  it("explica o timeout sem atribuí-lo incorretamente ao carregamento", () => {
    expect(errorMessage({ code: "57014", message: "canceling statement due to statement timeout" }))
      .toContain("tempo limite da operação");
  });
});
