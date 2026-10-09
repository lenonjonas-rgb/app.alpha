import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "./supabase";
import { errorMessage } from "./useDatabase";

const techniciansSchema = z.array(
  z.object({
    userId: z.uuid(),
    name: z.string(),
    email: z.email(),
  }),
);
export type TechnicianAccount = z.infer<typeof techniciansSchema>[number];

export function useTechnicians(enabled = true) {
  const [accounts, setAccounts] = useState<TechnicianAccount[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(supabase) && enabled);
  const refresh = useCallback(async () => {
    if (!supabase || !enabled) return;
    setLoading(true);
    setError("");
    try {
      const result = await supabase.rpc("list_company_technicians");
      if (result.error) throw result.error;
      setAccounts(techniciansSchema.parse(result.data));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [enabled]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);
  return { accounts, loading, error, refresh };
}
