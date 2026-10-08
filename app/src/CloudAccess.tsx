import { useState } from "react";
import type { FormEvent } from "react";
import { Building2, Cloud, LogIn, RefreshCw, ShieldCheck } from "lucide-react";
import "./CloudAccess.css";

export type CloudScreenMode =
  | "configuration"
  | "login"
  | "create-company"
  | "loading"
  | "unavailable";

export function CloudAccess({
  mode,
  email,
  error,
  busy,
  onLogin,
  onCreateCompany,
  onRetry,
  onSignOut,
}: {
  mode: CloudScreenMode;
  email: string;
  error: string;
  busy: boolean;
  onLogin: (email: string, password: string) => void;
  onCreateCompany: (name: string) => void;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  const [company, setCompany] = useState("");
  const [loginEmail, setLoginEmail] = useState(email);
  const [password, setPassword] = useState("");
  const isLogin = mode === "login";
  const isSetup = mode === "create-company";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLogin) onLogin(loginEmail.trim(), password);
    if (isSetup) onCreateCompany(company.trim());
  }

  return (
    <main className="cloud-screen">
      <section className="cloud-card">
        <div className="cloud-mark">
          <Cloud size={23} />
        </div>
        <p className="cloud-eyebrow">ALPHA TEC / AMBIENTE SEGURO</p>
        <h1>
          {mode === "configuration"
            ? "Configuração necessária"
            : isLogin
              ? "Entrar na sua conta"
              : isSetup
                ? "Criar empresa"
                : mode === "loading"
                  ? "Conectando"
                  : "Não foi possível carregar"}
        </h1>
        <p className="cloud-description">
          {mode === "configuration"
            ? "Este deploy está protegido contra uso sem banco configurado."
            : isLogin
              ? "Entre com seu usuário autorizado do Alpha Tec."
              : isSetup
                ? `Nenhuma empresa está vinculada a ${email}. Crie uma empresa para iniciar com uma base vazia.`
                : mode === "loading"
                  ? "Validando sua sessão e carregando os dados da empresa."
                  : "Verifique a conexão antes de continuar. Os dados não foram substituídos por uma demonstração."}
        </p>

        {mode === "configuration" && (
          <div className="cloud-help">
            <ShieldCheck size={19} />
            <p>
              Configure <code>VITE_SUPABASE_URL</code> e{" "}
              <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (ou a chave anon
              legada) nas variáveis de ambiente do deploy. Nunca coloque a
              chave <code>service_role</code> no frontend.
            </p>
          </div>
        )}

        {error && (
          <div className="cloud-error" role="alert">
            {error}
          </div>
        )}

        {isLogin && (
          <form className="cloud-form" onSubmit={submit}>
            <label>
              E-mail
              <input
                type="email"
                autoComplete="username"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button className="button primary" type="submit" disabled={busy}>
              <LogIn size={17} />
              {busy ? "Entrando…" : "Entrar"}
            </button>
            <small>
              As contas devem ser criadas ou convidadas por um administrador
              pelo painel de autenticação do Supabase.
            </small>
          </form>
        )}

        {isSetup && (
          <form className="cloud-form" onSubmit={submit}>
            <label>
              Nome da empresa *
              <input
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                maxLength={100}
                required
              />
            </label>
            <button className="button primary" type="submit" disabled={busy}>
              <Building2 size={17} />
              {busy ? "Criando…" : "Criar empresa"}
            </button>
            <small>
              Sua conta será administradora. Os registros de demonstração não
              serão copiados para a base compartilhada.
            </small>
          </form>
        )}

        {mode === "unavailable" && (
          <div className="cloud-buttons">
            <button className="button primary" onClick={onRetry} disabled={busy}>
              <RefreshCw size={17} />
              Tentar novamente
            </button>
            <button
              className="button secondary"
              onClick={onSignOut}
              disabled={busy}
            >
              Sair da conta
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
