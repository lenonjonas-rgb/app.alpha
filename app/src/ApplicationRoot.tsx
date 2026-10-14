import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { z } from "zod";
import { supabase } from "./supabase";
import { administratorPortalUrl } from "./userAccess";
import { errorMessage } from "./useDatabase";
const TechnicianApp = lazy(() => import("./TechnicianApp"));

export function ApplicationRoot({ administrator }: { administrator: ReactNode }) {
  return new URLSearchParams(location.search).get("tecnico") === "1"
    ? <TechnicianPortal />
    : administrator;
}

function TechnicianPortal() {
  const [checking, setChecking] = useState(Boolean(supabase) && !Capacitor.isNativePlatform());
  const [error, setError] = useState("");
  useEffect(() => {
    const client = supabase;
    if (!client || Capacitor.isNativePlatform()) return;
    let active = true;
    let sequence = 0;
    let checkedUserId: string | null = null;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event !== "INITIAL_SESSION" && event !== "SIGNED_IN" && event !== "SIGNED_OUT") return;
      if (session && session.user.id === checkedUserId) return;
      if (!session) checkedUserId = null;
      const request = ++sequence;
      setError("");
      setChecking(Boolean(session));
      if (!session) return;
      void Promise.resolve().then(async () => {
        if (!active || request !== sequence) return;
        try {
          const membership = await client.from("company_memberships")
            .select("role").eq("user_id", session.user.id)
            .order("created_at", { ascending: true }).limit(1).maybeSingle();
          if (!active || request !== sequence) return;
          if (membership.error) throw membership.error;
          if (!membership.data) throw new Error("Conta sem vínculo com uma empresa. Contate o administrador.");
          const role = z.enum(["owner", "admin", "manager", "technician"]).parse(membership.data.role);
          checkedUserId = session.user.id;
          const target = administratorPortalUrl(role, false, location.href);
          if (target) {
            location.replace(target);
            return;
          }
          setChecking(false);
        } catch (cause) {
          if (active && request === sequence) {
            setError(errorMessage(cause));
            setChecking(false);
          }
        }
      });
    });
    return () => { active = false; sequence += 1; data.subscription.unsubscribe(); };
  }, []);
  if (error) return <main><p role="alert">{error}</p><button onClick={() => location.reload()}>Tentar novamente</button></main>;
  if (checking) return <p role="status">Verificando acesso…</p>;
  return <Suspense fallback={<p>Carregando app técnico…</p>}><TechnicianApp /></Suspense>;
}
