import { supabase } from "./supabase";
import { servicePointSchema } from "./travel";

export async function lookupServicePoint(address: string, signal: AbortSignal) {
  if (!supabase) throw new Error("A localização automática exige login no banco seguro e a função travel-route atualizada.");
  const result = await supabase.functions.invoke("travel-route", {
    body: { action: "geocode", address }, signal,
  });
  if (result.error) {
    if ("context" in result.error && result.error.context instanceof Response) {
      const body: unknown = await result.error.context.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string")
        throw new Error(body.error);
    }
    throw new Error("Não foi possível localizar o endereço. Confira a conexão e a publicação da função travel-route.");
  }
  const point = servicePointSchema.parse(result.data);
  if (point.address !== address || point.source !== "Google Maps")
    throw new Error("A consulta retornou outro endereço. Tente localizar novamente.");
  return point;
}
