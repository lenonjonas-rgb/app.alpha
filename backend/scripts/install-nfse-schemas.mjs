import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";

const source = "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/nfse-esquemas_xsd-v1-01-20260209.zip";
const expected = "e7935cbd9470527c6cc32984c1b2263e614183bf0139ce2733eaaed2de9a8072";
const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error(`Portal oficial indisponivel: HTTP ${response.status}.`);
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length > 10_000_000 || createHash("sha256").update(bytes).digest("hex") !== expected)
  throw new Error("Pacote oficial mudou ou download foi corrompido. Revise a versao/hash antes de instalar.");
const files = unzipSync(bytes);
const schemas = Object.entries(files).filter(([name]) => /^Schemas\/1\.01\/[^/]+\.xsd$/i.test(name));
if (!schemas.some(([name]) => name.endsWith("/DPS_v1.01.xsd"))) throw new Error("DPS_v1.01.xsd ausente do pacote oficial.");
const target = resolve(process.env.SCHEMA_DIR || "schemas", "nfse");
await mkdir(target, { recursive: true });
for (const [name, data] of schemas) await writeFile(join(target, name.split("/").at(-1)), data, { mode: 0o644 });
console.info(`${schemas.length} schemas NFS-e 1.01 instalados em ${target}. SHA256 conferido. Revise novas notas tecnicas antes da producao.`);
