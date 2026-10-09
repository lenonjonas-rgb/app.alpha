import { useState } from "react";
import { supabase } from "./supabase";
import { errorMessage } from "./useDatabase";

export function PasswordSettings() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  return <details className="settings-section">
    <summary>Alterar minha senha</summary>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <form onSubmit={async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      setError(""); setMessage(""); setBusy(true);
      try {
        if (!supabase) throw new Error("Supabase não configurado.");
        const password = String(fields.get("password"));
        if (password.length < 12 || password.length > 128) throw new Error("Use uma senha de 12 a 128 caracteres.");
        if (password !== fields.get("confirm")) throw new Error("As senhas não coincidem.");
        const result = await supabase.auth.updateUser({ password });
        if (result.error) throw result.error;
        form.reset();
        setMessage("Senha alterada.");
      } catch (cause) { setError(errorMessage(cause)); }
      finally { setBusy(false); }
    }}>
      <label className="field">Nova senha<input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></label>
      <label className="field">Confirmar nova senha<input name="confirm" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></label>
      <button className="button primary" disabled={busy}>{busy ? "Salvando…" : "Alterar senha"}</button>
    </form>
  </details>;
}
