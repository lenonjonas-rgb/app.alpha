import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  SUPABASE_URL: z.url().pipe(z.string().refine((url) => new URL(url).protocol === "https:" || new URL(url).hostname === "127.0.0.1")),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess((value) => value === "" ? undefined : value, z.string().min(10).optional()),
  ALLOWED_ORIGINS: z.string().min(1),
  DATA_DIR: z.string().min(1),
  SCHEMA_DIR: z.string().min(1),
  CERTIFICATE_MASTER_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  ALLOW_PRODUCTION: z.enum(["true", "false"]).default("false"),
});

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const config = configSchema.parse(environment);
  const origins = new Set(config.ALLOWED_ORIGINS.split(",").map((origin) => {
    const url = new URL(origin.trim());
    if (url.origin !== origin.trim() || (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)))
      throw new Error("ALLOWED_ORIGINS exige origens HTTPS exatas, sem path.");
    return url.origin;
  }));
  return { ...config, origins };
}
