import { createServer } from "node:http";
import { Store } from "./store.js";
import { SupabaseAuth } from "./auth.js";
import { CertificateVault } from "./certificate.js";
import { SchemaValidator } from "./xml.js";
import { DirectAuthority } from "./authority.js";
import { FiscalService } from "./service.js";
import { createApi } from "./api.js";
import { loadConfig } from "./config.js";

process.umask(0o077);
const config = loadConfig();
const store = new Store(config.DATA_DIR);
const vault = new CertificateVault(store, Buffer.from(config.CERTIFICATE_MASTER_KEY, "base64"));
const service = new FiscalService(store, vault, new SchemaValidator(config.SCHEMA_DIR), new DirectAuthority(), config.ALLOW_PRODUCTION === "true");
const auth = new SupabaseAuth(config.SUPABASE_URL.replace(/\/$/, ""), config.SUPABASE_PUBLISHABLE_KEY, fetch, config.SUPABASE_SERVICE_ROLE_KEY);
const server = createServer({ maxHeaderSize: 16384, requestTimeout: 65000, headersTimeout: 15000 }, createApi(service, auth, config.origins));
server.listen(config.PORT, "0.0.0.0", () => console.info(`Alpha Fiscal escutando na porta ${config.PORT}; produção ${config.ALLOW_PRODUCTION}.`));
const shutdown = () => {
  server.close(() => { store.db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
