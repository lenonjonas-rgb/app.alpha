import type { Database } from "./domain";
import { supabase } from "./supabase";
import { sameTravelEndpoint, travelEndpoint, travelRouteSchema } from "./travel";
import type { TravelRoute } from "./travel";

export function assistanceEndpoint(data: Database) {
  const settings = data.settings;
  return travelEndpoint(settings.assistanceAddress || settings.assistancePoint?.address || settings.address, settings.assistancePoint);
}

export async function calculateTravelRoute(data: Database, destination: TravelRoute["destination"], orderId?: string) {
  if (!supabase) throw new Error("O cálculo Google Maps exige login no banco seguro e a função travel-route publicada.");
  const origin = assistanceEndpoint(data);
  if (!origin.address.trim() || !destination.address.trim())
    throw new Error("Cadastre o endereço completo da assistência nas Configurações e o endereço do atendimento na OS.");
  if (data.settings.fuelPrice <= 0 || data.settings.kilometersPerLiter <= 0)
    throw new Error("Cadastre preço do combustível e rendimento do veículo maiores que zero nas Configurações.");
  const result = await supabase.functions.invoke("travel-route", {
    body: orderId ? { orderId } : { action: "preview-route", destination },
  });
  if (result.error) {
    if (result.error.context instanceof Response) {
      const body: unknown = await result.error.context.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") throw new Error(body.error);
    }
    throw new Error("Não foi possível calcular a rota e os pedágios. Confira a conexão e a publicação da função travel-route.");
  }
  const route = travelRouteSchema.parse(result.data);
  if (!sameTravelEndpoint(route.origin, origin) || !sameTravelEndpoint(route.destination, destination))
    throw new Error("Os endereços ou pontos salvos diferem deste rascunho. Salve as alterações e calcule novamente.");
  return route;
}
