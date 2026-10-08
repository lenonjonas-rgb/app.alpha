import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Building2,
  CheckCircle2,
  Cloud,
  LoaderCircle,
  LogIn,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  formatCnpj,
  isValidCnpj,
  lookupCompanyByCnpj,
  normalizeCnpj,
} from "./cnpj";
import type { CompanyRegistration } from "./cnpj";
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
  onCreateCompany: (registration: CompanyRegistration) => void;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  const [cnpj, setCnpj] = useState("");
  const [lookup, setLookup] = useState<{
    cnpj: string;
    attempt: number;
    status: "idle" | "loading" | "success" | "error";
    registration: CompanyRegistration | null;
    error: string;
  }>({
    cnpj: "",
    attempt: 0,
    status: "idle",
    registration: null,
    error: "",
  });
  const [loginEmail, setLoginEmail] = useState(email);
  const [password, setPassword] = useState("");
  const isLogin = mode === "login";
  const isSetup = mode === "create-company";
  const activeLookup =
    lookup.cnpj === cnpj ? lookup : { ...lookup, status: "idle" as const };
  const registration = activeLookup.registration;
  const lookupBusy = activeLookup.status === "loading";
  const lookupError =
    activeLookup.status === "error" ? activeLookup.error : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLogin) onLogin(loginEmail.trim(), password);
    if (isSetup && registration) onCreateCompany(registration);
  }

  useEffect(() => {
    const normalizedCnpj = normalizeCnpj(cnpj);
    const attempt = lookup.attempt;
    if (!isValidCnpj(normalizedCnpj)) return;

    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15000);
    void lookupCompanyByCnpj(normalizedCnpj, controller.signal)
      .then((result) => {
        window.clearTimeout(timeout);
        setLookup((current) =>
          current.cnpj === normalizedCnpj && current.attempt === attempt
            ? {
                ...current,
                status: "success",
                registration: result,
                error: "",
              }
            : current,
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted && !timedOut) return;
        window.clearTimeout(timeout);
        const message = timedOut
          ? "A consulta demorou demais. Tente novamente."
          : error instanceof Error
            ? error.message
            : "Não foi possível consultar este CNPJ.";
        setLookup((current) =>
          current.cnpj === normalizedCnpj && current.attempt === attempt
            ? {
                ...current,
                status: "error",
                registration: null,
                error: message,
              }
            : current,
        );
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [cnpj, lookup.attempt]);

  function retryLookup() {
    setLookup((current) => ({
      cnpj,
      attempt: current.attempt + 1,
      status: "loading",
      registration: null,
      error: "",
    }));
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

        {isSetup && (
          <form className="cloud-form" onSubmit={submit}>
            <label>
              CNPJ *
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                value={cnpj}
                onChange={(event) => {
                  const nextCnpj = normalizeCnpj(event.target.value).slice(
                    0,
                    14,
                  );
                  setCnpj(nextCnpj);
                  setLookup((current) => ({
                    cnpj: nextCnpj,
                    attempt: current.attempt,
                    status: isValidCnpj(nextCnpj) ? "loading" : "idle",
                    registration: null,
                    error: "",
                  }));
                }}
                placeholder="00.000.000/0000-00"
                maxLength={14}
                aria-describedby="cnpj-lookup-status"
                required
              />
            </label>
            <div
              className="cnpj-lookup-status"
              id="cnpj-lookup-status"
              aria-live="polite"
            >
              {lookupBusy ? (
                <>
                  <LoaderCircle size={16} className="cnpj-spinner" />
                  Consultando os dados cadastrais…
                </>
              ) : registration ? (
                <>
                  <CheckCircle2 size={16} />
                  Dados encontrados automaticamente.
                </>
              ) : lookupError ? (
                <span role="alert">{lookupError}</span>
              ) : cnpj.length === 14 && !isValidCnpj(cnpj) ? (
                <span>Confira os caracteres e dígitos do CNPJ.</span>
              ) : (
                <span>
                  A consulta dos dados começa assim que você digitar um CNPJ
                  válido.
                </span>
              )}
            </div>
            {registration && (
              <div className="cnpj-result">
                <span>{formatCnpj(registration.cnpj)}</span>
                <strong>
                  {registration.tradeName || registration.legalName}
                </strong>
                {registration.tradeName &&
                  registration.legalName !== registration.tradeName && (
                    <span>{registration.legalName}</span>
                  )}
                {registration.address && <span>{registration.address}</span>}
                {registration.phone && <span>{registration.phone}</span>}
                {registration.email && <span>{registration.email}</span>}
                {registration.openingDate && (
                  <span>Início das atividades: {registration.openingDate}</span>
                )}
                {registration.registrationStatus && (
                  <span>Situação: {registration.registrationStatus}</span>
                )}
              </div>
            )}
            {lookupError && (
              <button
                className="text-button cnpj-retry"
                type="button"
                onClick={retryLookup}
                disabled={lookupBusy}
              >
                Tentar consulta novamente
              </button>
            )}
            <button
              className="button primary"
              type="submit"
              disabled={busy || lookupBusy || !registration}
            >
              <Building2 size={17} />
              {busy ? "Criando…" : "Criar empresa"}
            </button>
            <small>
              Sua conta será administradora. Os dados públicos cadastrais
              encontrados serão salvos no perfil da empresa.
            </small>
          </form>
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
