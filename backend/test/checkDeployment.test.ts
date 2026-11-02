import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function run(environment: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/checkDeployment.ts"], {
      cwd: root, env: { ...process.env, ...environment }, windowsHide: true, timeout: 30000,
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

test("diagnostico falha com nomes de campos, sem expor os valores privados", async () => {
  const result = await run({
    SUPABASE_URL: "private-invalid-url", SUPABASE_PUBLISHABLE_KEY: "secret-key-fixture",
    CERTIFICATE_MASTER_KEY: "secret-invalid-master", DATA_DIR: "", SCHEMA_DIR: "", ALLOWED_ORIGINS: "",
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /SUPABASE_URL/);
  assert.match(result.output, /CERTIFICATE_MASTER_KEY/);
  assert.doesNotMatch(result.output, /private-invalid-url|secret-key-fixture|secret-invalid-master/);
});

test("diagnostico verifica Supabase e schemas sem chamar transmissao e remove a prova de gravacao", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-deployment-test-"));
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    assert.equal(request.headers.apikey, "publishable-fixture");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ external: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const schemas = join(directory, "schemas");
    for (const path of [
      join("nfe", "nfe_v4.00.xsd"), join("nfse", "DPS_v1.01.xsd"),
      join("nfe", "events", "envEventoCancNFe_v1.00.xsd"), join("nfse", "pedRegEvento_v1.01.xsd"),
    ]) {
      const file = join(schemas, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "presence-only-fixture");
    }
    const result = await run({
      SUPABASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      SUPABASE_PUBLISHABLE_KEY: "publishable-fixture", SUPABASE_SERVICE_ROLE_KEY: "",
      CERTIFICATE_MASTER_KEY: Buffer.alloc(32, 2).toString("base64"),
      DATA_DIR: join(directory, "data"), SCHEMA_DIR: schemas,
      ALLOWED_ORIGINS: "https://alpha.example", ALLOW_PRODUCTION: "false",
    });
    assert.equal(result.code, 1);
    assert.match(result.output, /OK: Supabase responde/);
    assert.match(result.output, /OK: XSD nfe instalado/);
    assert.match(result.output, /OK: XSD nfse instalado/);
    assert.match(result.output, /FALHA: SUPABASE_SERVICE_ROLE_KEY ausente/);
    assert.match(result.output, /Producao bloqueada/);
    assert.deepEqual(requests, ["/auth/v1/settings"]);
    assert.deepEqual(await readdir(join(directory, "data")), []);
    assert.doesNotMatch(result.output, /publishable-fixture/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
