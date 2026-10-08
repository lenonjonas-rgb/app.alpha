import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  "";

export const cloudEnabled =
  import.meta.env.PROD || Boolean(url || publishableKey);
export const cloudConfigurationError =
  Boolean(url) === Boolean(publishableKey)
    ? ""
    : "Configure VITE_SUPABASE_URL e uma chave publicável/anon juntas.";
export const supabase =
  url && publishableKey && !cloudConfigurationError
    ? createClient(url, publishableKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      })
    : null;
