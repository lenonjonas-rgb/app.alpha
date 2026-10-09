import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
const TechnicianApp = lazy(() => import("./TechnicianApp"));

export function ApplicationRoot({ administrator }: { administrator: ReactNode }) {
  return new URLSearchParams(location.search).get("tecnico") === "1"
    ? <Suspense fallback={<p>Carregando app técnico…</p>}><TechnicianApp /></Suspense>
    : administrator;
}
