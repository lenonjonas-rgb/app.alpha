import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { demoDatabase, STORAGE_KEY, validateDatabase } from "./domain";
import type { Database } from "./domain";

export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "Armazenamento cheio. Exporte um backup antes de continuar.";
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";
}

function load(): { data: Database | null; error: string } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const data = saved ? validateDatabase(JSON.parse(saved)) : demoDatabase();
    if (!saved) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return { data, error: "" };
  } catch (error) {
    return { data: null, error: errorMessage(error) };
  }
}

export function useDatabase() {
  const [state, setState] = useState(load);
  const current = useRef(state.data);
  function commit(update: Database | ((data: Database) => Database)) {
    const next =
      typeof update === "function" ? update(current.current!) : update;
    const validated = validateDatabase(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
    current.current = validated;
    setState({ data: validated, error: "" });
  }
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;
      try {
        const data = event.newValue
          ? validateDatabase(JSON.parse(event.newValue))
          : null;
        current.current = data;
        setState({
          data,
          error: data ? "" : "Os dados foram removidos em outra aba.",
        });
      } catch (error) {
        current.current = null;
        setState({ data: null, error: errorMessage(error) });
      }
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return { ...state, commit };
}

export function downloadFile(
  name: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
