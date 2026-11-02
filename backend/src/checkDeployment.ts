import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { SchemaValidator } from "./xml.js";

const execute = promisify(execFile);
let failed = false;
async function check(name: string, operation: () => Promise<void>) {
  try {
    await operation();
    console.info(`OK: ${name}`);
  } catch {
    failed = true;
    console.error(`FALHA: ${name}`);
  }
}

async function main() {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (cause) {
    const fields = cause instanceof z.ZodError ? cause.issues.map((issue) => issue.path.join(".")).join(", ") : "ALLOWED_ORIGINS";
    console.error(`FALHA: configuracao invalida. Confira ${fields}. Nenhum valor de segredo foi exibido.`);
    process.exitCode = 1;
    return;
  }
  console.info("Diagnostico de infraestrutura. Nao transmite documentos nem comprova homologacao.");
  await check("Node.js >= 24.13", async () => {
    const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
    if (major < 24 || (major === 24 && minor < 13)) throw new Error("Runtime incompatível.");
  });
  await check("OpenSSL disponivel no PATH", async () => {
    await execute("openssl", ["version"], { timeout: 10000, maxBuffer: 65536 });
  });
  await check("xmllint disponivel no PATH", async () => {
    await execute("xmllint", ["--version"], { timeout: 10000, maxBuffer: 65536 });
  });
  await check("Diretorio privado de dados permite gravacao", async () => {
    await mkdir(config.DATA_DIR, { recursive: true, mode: 0o700 });
    const probe = await mkdtemp(join(config.DATA_DIR, ".deployment-check-"));
    const file = join(probe, "write-test");
    try {
      await writeFile(file, "deployment-check", { mode: 0o600, flag: "wx" });
    } finally {
      await rm(file, { force: true });
      await rmdir(probe);
    }
  });
  const schemas = await new SchemaValidator(config.SCHEMA_DIR).ready();
  for (const name of ["nfe", "nfse", "nfeCancellation", "nfseCancellation"]) {
    await check(`XSD ${name} instalado (presenca, nao vigencia)`, async () => {
      if (!schemas[name]) throw new Error("Schema ausente.");
    });
  }
  await check("Supabase responde e aceita a chave publicavel", async () => {
    const response = await fetch(`${config.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Supabase indisponível ou chave inválida.");
    const settings: unknown = await response.json();
    if (!settings || typeof settings !== "object" || !("external" in settings)) throw new Error("Resposta Supabase inesperada.");
  });
  if (!config.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("FALHA: SUPABASE_SERVICE_ROLE_KEY ausente; aprovacoes financeiras protegidas indisponiveis.");
    failed = true;
  }
  if (config.ALLOW_PRODUCTION === "true") console.warn("ATENCAO: producao habilitada. Este diagnostico nao autoriza emissao real.");
  else console.info("Producao bloqueada; validar NF-e e NFS-e separadamente em homologacao.");
  console.info("Confira ainda: DNS/HTTPS, origem do frontend, volume persistente/backups, migracoes, sessao/empresa, A1, cadastros e resposta fiscal real.");
  if (failed) process.exitCode = 1;
}

void main().catch(() => {
  console.error("FALHA: diagnostico interrompido. Confira permissoes e configuracao do servidor; nenhum segredo foi exibido.");
  process.exitCode = 1;
});
