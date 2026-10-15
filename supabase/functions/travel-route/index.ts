import { travelRouteHandler } from "./handler.ts";

Deno.serve(travelRouteHandler({
  url: Deno.env.get("SUPABASE_URL") ?? "",
  publicKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  googleKey: Deno.env.get("GOOGLE_MAPS_ROUTES_API_KEY") ?? "",
}));
