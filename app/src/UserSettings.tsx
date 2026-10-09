import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "./supabase";
import { errorMessage } from "./useDatabase";
import { roleLabels } from "./userAccess";
import { TechnicianSettings } from "./TechnicianSettings";

const usersSchema = z.array(z.object({
  userId: z.uuid(), name: z.string(), login: z.string(),
  role: z.enum(["owner", "admin", "technician", "manager"]),
}));
const createdSchema = z.object({ username: z.string(), userId: z.uuid() });

export function UserSettings() {
  const [users, setUsers] = useState<z.infer<typeof usersSchema>>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const refresh = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const result = await supabase.rpc("list_company_users");
      if (result.error) throw result.error;
      setUsers(usersSchema.parse(result.data));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh).catch((cause) => setError(errorMessage(cause))); }, [refresh]);
  return <section className="settings-section">
    <h2>Usuários e níveis</h2>
    <p><strong>Master:</strong> acesso completo e gestão de usuários. <strong>Administrativo:</strong> agenda, clientes, orçamentos, relatórios e operação do painel, sem criar usuários ou alterar níveis. <strong>Técnico:</strong> apenas seus atendimentos no portal/app.</p>
    <p>O login usa o primeiro nome: joao.aupha, joao2.aupha… A conta Master existente continua entrando com seu e-mail. Entregue a senha inicial em um canal privado; cada usuário pode alterá-la depois.</p>
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
    <form onSubmit={async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      setBusy(true); setError(""); setMessage("");
      try {
        if (!supabase) throw new Error("Supabase não configurado.");
        const result = await supabase.functions.invoke("manage-users", { body: {
          name: String(fields.get("name")).trim(), role: fields.get("role"),
          password: fields.get("password"), requestId: requestId.current,
        } });
        if (result.error) {
          let detail = "";
          if ("context" in result.error && result.error.context instanceof Response) {
            const body: unknown = await result.error.context.json();
            if (body && typeof body === "object" && "error" in body && typeof body.error === "string") detail = body.error;
          }
          throw new Error(detail || "Não foi possível confirmar o cadastro. Atualize a lista antes de tentar novamente.");
        }
        const account = createdSchema.parse(result.data);
        form.reset(); requestId.current = crypto.randomUUID();
        setMessage(`Usuário criado: ${account.username}. Informe o login e a senha inicial ao usuário.`);
        await refresh();
      } catch (cause) { setError(errorMessage(cause)); }
      finally { setBusy(false); }
    }}>
      <div className="form-grid">
        <label className="field">Nome completo<input name="name" required maxLength={100} disabled={busy} onChange={() => { requestId.current = crypto.randomUUID(); }} /></label>
        <label className="field">Nível<select name="role" disabled={busy} onChange={() => { requestId.current = crypto.randomUUID(); }}><option value="technician">Técnico</option><option value="admin">Administrativo</option></select></label>
        <label className="field">Senha inicial<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy} onChange={() => { requestId.current = crypto.randomUUID(); }} /></label>
      </div>
      <button className="button primary" disabled={busy || loading}>{busy ? "Criando…" : "Criar usuário"}</button>
      <button type="button" className="button secondary" disabled={busy} onClick={() => { void refresh().catch((cause) => setError(errorMessage(cause))); }}>Atualizar lista</button>
      {error && <button type="button" className="button secondary" disabled={busy} onClick={() => {
        if (!window.confirm("Confira primeiro se o usuário já aparece na lista. Uma nova tentativa pode criar outra conta se o cadastro anterior tiver sido concluído. Iniciar nova tentativa?")) return;
        requestId.current = crypto.randomUUID(); setError("");
      }}>Iniciar nova tentativa</button>}
    </form>
    {loading ? <p>Carregando usuários…</p> : <div className="table-wrap"><table>
      <thead><tr><th>Nome</th><th>Login</th><th>Nível</th></tr></thead>
      <tbody>{users.map((user) => <tr key={user.userId}><td>{user.name}</td><td>{user.login}</td><td>
        {user.role === "owner" ? "Master (protegido)" : <select aria-label={`Nível de ${user.name}`} value={user.role} disabled={busy} onChange={async (event) => {
          const role = event.target.value;
          if (role !== "admin" && role !== "technician") return;
          if (!window.confirm(`Alterar ${user.name} para ${roleLabels[role]}? Isso muda o acesso aos dados da empresa.`)) return;
          setBusy(true); setError(""); setMessage("");
          try {
            if (!supabase) throw new Error("Supabase não configurado.");
            const result = await supabase.rpc("set_company_user_role", { p_user_id: user.userId, p_role: role });
            if (result.error) throw result.error;
            await refresh(); setMessage("Nível atualizado. O usuário deve recarregar ou entrar novamente para atualizar a interface.");
          } catch (cause) { setError(errorMessage(cause)); }
          finally { setBusy(false); }
        }}>
          {user.role === "manager" && <option value="manager">Gestor legado</option>}
          <option value="technician">Técnico</option><option value="admin">Administrativo</option>
        </select>}
      </td></tr>)}</tbody>
    </table></div>}
    <details><summary>Vincular conta já existente no Supabase</summary><TechnicianSettings /></details>
  </section>;
}
