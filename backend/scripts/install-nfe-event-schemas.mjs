import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";

const source = "https://dfe-portal.svrs.rs.gov.br/NFE/DownloadArquivoEstatico/?sistema=NFE&tipoArquivo=2&nomeArquivo=Evento_Canc_PL_v1.01_NT_2018_004.zip";
const expected = "71ccd5fcc48f9604a2a8965146df45e3b73e96e87942ab3391be0d55cc0df718";
const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error(`Portal SVRS indisponivel: HTTP ${response.status}.`);
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length > 10_000_000 || createHash("sha256").update(bytes).digest("hex") !== expected)
  throw new Error("Pacote oficial mudou ou foi corrompido. Revise versao/hash antes de instalar.");
const files = Object.entries(unzipSync(bytes)).filter(([name]) => /^Evento_Canc_PL_v1\.01\/[^/]+\.xsd$/.test(name));
if (files.length !== 8 || !files.some(([name]) => name.endsWith("/envEventoCancNFe_v1.00.xsd")))
  throw new Error("Pacote de cancelamento NF-e incompleto.");
const target = resolve(process.env.SCHEMA_DIR || "schemas", "nfe", "events");
await mkdir(target, { recursive: true });
for (const [name, data] of files) await writeFile(join(target, name.split("/").at(-1)), data, { mode: 0o644 });
console.info(`8 schemas de cancelamento NF-e instalados em ${target}; SHA256 conferido. Validar vigencia antes de operar.`);
