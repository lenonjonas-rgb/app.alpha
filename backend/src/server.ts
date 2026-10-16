import { createServer } from "node:http";
import { z } from "zod";
import { Store } from "./store.js";
import { SupabaseAuth } from "./auth.js";
import { CertificateVault } from "./certificate.js";
import { SchemaValidator } from "./xml.js";
import { DirectAuthority } from "./authority.js";
import { FiscalService } from "./service.js";
import { createApi } from "./api.js";

process.umask(0o077);
const config = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  SUPABASE_URL: z.url().refine((url) => new URL(url).protocol === "https:" || new URL(url).hostname === "127.0.0.1"),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess((value) => value === "" ? undefined : value, z.string().min(10).optional()),
  ALLOWED_ORIGINS: z.string().min(1),
  DATA_DIR: z.string().min(1),
  SCHEMA_DIR: z.string().min(1),
  CERTIFICATE_MASTER_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  ALLOW_PRODUCTION: z.enum(["true", "false"]).default("false"),
}).parse(process.env);
const origins = new Set(config.ALLOWED_ORIGINS.split(",").map((origin) => {
  const url = new URL(origin.trim());
  if (url.origin !== origin.trim() || (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)))
    throw new Error("ALLOWED_ORIGINS exige origens HTTPS exatas, sem path.");
  return url.origin;
}));
const store = new Store(config.DATA_DIR);
const vault = new CertificateVault(store, Buffer.from(config.CERTIFICATE_MASTER_KEY, "base64"));
const service = new FiscalService(store, vault, new SchemaValidator(config.SCHEMA_DIR), new DirectAuthority(), config.ALLOW_PRODUCTION === "true");
const auth = new SupabaseAuth(config.SUPABASE_URL.replace(/\/$/, ""), config.SUPABASE_PUBLISHABLE_KEY, fetch, config.SUPABASE_SERVICE_ROLE_KEY);
const server = createServer({ maxHeaderSize: 16384, requestTimeout: 65000, headersTimeout: 15000 }, createApi(service, auth, origins));
server.listen(config.PORT, "0.0.0.0", () => console.info(`Alpha Fiscal escutando na porta ${config.PORT}; produção ${config.ALLOW_PRODUCTION}.`));
const shutdown = () => {
  server.close(() => { store.db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
