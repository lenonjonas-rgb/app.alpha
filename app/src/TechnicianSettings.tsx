import { useState } from "react";
import { supabase } from "./supabase";
import { useTechnicians } from "./useTechnicians";
import { errorMessage } from "./useDatabase";
import { displayLogin } from "./userAccess";

export function TechnicianSettings() {
  const { accounts, loading, error, refresh } = useTechnicians();
  const [message, setMessage] = useState("");
  const [linkError, setLinkError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="settings-section">
      <div className="section-heading"><h2>Contas dos técnicos</h2></div>
      <p>Crie primeiro a conta no Supabase Auth. Depois vincule o e-mail abaixo. O técnico verá no APK apenas as tarefas atribuídas à sua conta.</p>
      {error && <div role="alert" className="error-message">{error}</div>}
      {linkError && <div role="alert" className="error-message">{linkError}</div>}
      {message && <p role="status">{message}</p>}
      <form onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        setBusy(true);
        setMessage("");
        setLinkError("");
        try {
          if (!supabase) throw new Error("Supabase não configurado.");
          const result = await supabase.rpc("link_company_technician", {
            p_email: String(fields.get("email")).trim(),
            p_name: String(fields.get("name")).trim(),
          });
          if (result.error) throw result.error;
          form.reset();
          setMessage("Técnico vinculado à empresa.");
          await refresh();
        } catch (cause) {
          setLinkError(errorMessage(cause));
        } finally {
          setBusy(false);
        }
      }}>
        <div className="form-grid">
          <label className="field">Nome do técnico<input name="name" required maxLength={100} /></label>
          <label className="field">E-mail da conta<input name="email" type="email" required maxLength={320} /></label>
        </div>
        <button className="button primary" disabled={busy}>{busy ? "Vinculando…" : "Vincular técnico"}</button>
      </form>
      {loading ? <p>Carregando equipe…</p> : <ul>{accounts.map((account) => <li key={account.userId}>{account.name} — {displayLogin(account.email)}</li>)}</ul>}
    </section>
  );
}
