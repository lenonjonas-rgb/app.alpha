type Environment = { url: string; serviceKey: string };
type Reservation = { username: string; userId: string | null };
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function firstNameBase(name: string): string {
  const base = name.trim().split(/\s+/)[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!/^[a-z][a-z0-9]{0,39}$/.test(base)) throw new Error("Informe um primeiro nome com letras (até 40 caracteres).");
  return base;
}

export function manageUsersHandler(env: Environment, fetcher: typeof fetch = fetch) {
  const response = (status: number, body: object) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  async function api(path: string, token: string, method = "GET", body?: object) {
    const result = await fetcher(`${env.url}${path}`, {
      method, headers: { apikey: env.serviceKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await result.json();
    if (!result.ok) throw new Error(typeof data.message === "string" ? data.message : typeof data.msg === "string" ? data.msg : "Falha no serviço de usuários.");
    return data;
  }
  const rpc = (name: string, body: object) => api(`/rest/v1/rpc/${name}`, env.serviceKey, "POST", body);
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return response(405, { error: "Método não permitido." });
    if (!env.url || !env.serviceKey) return response(503, { error: "Serviço de usuários não configurado." });
    const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return response(401, { error: "Entre na conta Master para continuar." });
    let master: string;
    try {
      const user = await api("/auth/v1/user", token);
      if (typeof user.id !== "string" || !uuid.test(user.id)) throw new Error("Sessão inválida.");
      master = user.id;
    } catch {
      return response(401, { error: "Não foi possível validar a sessão. Entre novamente." });
    }
    try {
      // Authorization uses the caller's JWT, never a role supplied by the browser.
      await api("/rest/v1/rpc/list_company_users", token, "POST", {});
    } catch {
      return response(403, { error: "Somente o Master pode criar usuários." });
    }
    let fields: Record<string, unknown>;
    let base: string;
    try {
      const raw = await request.text();
      if (raw.length > 4096) throw new Error("Cadastro excede o tamanho permitido.");
      fields = JSON.parse(raw);
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("Cadastro inválido.");
      if (typeof fields.name !== "string" || !fields.name.trim() || fields.name.trim().length > 100
        || typeof fields.password !== "string" || fields.password.length < 12 || fields.password.length > 128
        || (fields.role !== "technician" && fields.role !== "admin")
        || typeof fields.requestId !== "string" || !uuid.test(fields.requestId)) {
        throw new Error("Informe nome, nível e senha de 12 a 128 caracteres.");
      }
      base = firstNameBase(fields.name);
    } catch (cause) {
      return response(400, { error: cause instanceof Error ? cause.message : "Cadastro inválido." });
    }
    let reservation: Reservation;
    try {
      reservation = await rpc("reserve_company_user", {
        p_master: master, p_request_id: fields.requestId, p_base: base,
        p_name: fields.name, p_role: fields.role,
      });
      if (reservation.userId) return response(200, reservation);
    } catch (cause) {
      return response(409, { error: cause instanceof Error ? cause.message : "Não foi possível reservar o login." });
    }
    let createdId: string | null = null;
    try {
      const created = await api("/auth/v1/admin/users", env.serviceKey, "POST", {
        email: `${reservation.username}@users.aupha.invalid`, password: fields.password,
        email_confirm: true, user_metadata: { display_name: fields.name, username: reservation.username },
      });
      if (typeof created.id !== "string" || !uuid.test(created.id)) throw new Error("Resposta de criação inválida.");
      createdId = created.id;
      const completed = await rpc("complete_company_user", {
        p_master: master, p_request_id: fields.requestId, p_user_id: createdId,
      });
      return response(201, completed);
    } catch (cause) {
      // A timeout may occur after a successful database commit. Confirm before removing Auth.
      try {
        const completed: Reservation = await rpc("reserve_company_user", {
          p_master: master, p_request_id: fields.requestId, p_base: base,
          p_name: fields.name, p_role: fields.role,
        });
        if (completed.userId) return response(200, completed);
      } catch {
        // A non-complete reservation is expected here; deletion is FK-protected if it committed.
      }
      const cleanupErrors: string[] = [];
      if (!createdId) cleanupErrors.push("Se a resposta Auth foi interrompida, confira no Supabase se a conta foi criada antes de repetir.");
      if (createdId) {
        try { await api(`/auth/v1/admin/users/${createdId}`, env.serviceKey, "DELETE"); }
        catch { cleanupErrors.push("Não foi possível confirmar a remoção da conta Auth; o Master deve conferir o Supabase."); }
      }
      try { await rpc("fail_company_user", { p_master: master, p_request_id: fields.requestId }); }
      catch { cleanupErrors.push("Não foi possível finalizar a reserva; confira o cadastro antes de tentar novamente."); }
      return response(502, { error: [
        "Não foi possível confirmar o cadastro.",
        cause instanceof Error ? cause.message : "Falha no serviço de usuários.",
        ...cleanupErrors,
      ].join(" ") });
    }
  };
}
