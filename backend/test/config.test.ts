import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

const environment = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  ALLOWED_ORIGINS: "https://alpha.example,http://127.0.0.1:5173",
  DATA_DIR: "./data",
  SCHEMA_DIR: "./schemas",
  CERTIFICATE_MASTER_KEY: Buffer.alloc(32, 1).toString("base64"),
};

test("configuracao compartilhada preserva bloqueio de producao, porta e origens exatas", () => {
  const config = loadConfig(environment);
  assert.equal(config.PORT, 8080);
  assert.equal(config.ALLOW_PRODUCTION, "false");
  assert.deepEqual([...config.origins], ["https://alpha.example", "http://127.0.0.1:5173"]);
  assert.equal(loadConfig({ ...environment, SUPABASE_SERVICE_ROLE_KEY: "" }).SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(loadConfig({ ...environment, ALLOW_PRODUCTION: "true" }).ALLOW_PRODUCTION, "true");
});

test("configuracao recusa origens inseguras/curingas/paths e chaves mestras invalidas", () => {
  for (const origin of ["*", "http://alpha.example", "https://alpha.example/", "https://alpha.example/path", ""]) {
    assert.throws(() => loadConfig({ ...environment, ALLOWED_ORIGINS: origin }));
  }
  assert.throws(() => loadConfig({ ...environment, CERTIFICATE_MASTER_KEY: "invalid" }));
  assert.throws(() => loadConfig({ ...environment, ALLOW_PRODUCTION: "yes" }));
  assert.throws(() => loadConfig({ ...environment, PORT: "0" }));
  assert.throws(() => loadConfig({ ...environment, SUPABASE_URL: "invalid" }), { name: "ZodError" });
});
