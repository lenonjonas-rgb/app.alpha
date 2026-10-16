import { supabase } from "./supabase";

const configured = import.meta.env.VITE_FISCAL_API_URL?.trim() ?? "";
export const fiscalConfigured = Boolean(configured);
function baseUrl() {
  if (!configured) throw new Error("Configure VITE_FISCAL_API_URL para conectar o backend fiscal.");
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    throw new Error("O backend fiscal exige HTTPS (exceto no servidor local).");
  return configured.replace(/\/$/, "");
}
export async function fiscalRequest(path: string, method = "GET", body?: unknown) {
  if (!supabase) throw new Error("O fiscal exige autenticação na nuvem; não opera sobre a base demo.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("Entre novamente na sua conta para acessar o fiscal.");
  const response = await fetch(`${baseUrl()}${path}`, {
    method, headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(`Backend fiscal retornou HTTP ${response.status}; confira o proxy e tente consultar a situação antes de repetir.`);
    const payload: unknown = await response.json();
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : `Backend fiscal retornou ${response.status}.`;
    throw new Error(message);
  }
  return response;
}
export async function fileBase64(file: File) {
  if (file.size > 2_000_000) throw new Error("Arquivo maior que 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
