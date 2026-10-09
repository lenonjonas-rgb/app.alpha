import { manageUsersHandler } from "./handler.ts";

Deno.serve(manageUsersHandler({
  url: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
}));
