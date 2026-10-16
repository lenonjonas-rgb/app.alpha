import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FiscalCatalog, fiscalItemSchema } from "../src/catalog.js";
import { Store } from "../src/store.js";
import { blingReferences } from "../src/rules.js";
import type { Context, CompanyData } from "../src/auth.js";

const context: Context = { tenant: "company-a", actor: "admin-a", role: "admin", token: "fixture" };
const company: CompanyData = {
  products: [{ id: "product", name: "Rolamento" }], services: [{ id: "service", name: "Montagem" }],
  clients: [], finance: { accounts: [], entries: [], invoices: [] },
};
const product = { kind: "nfe", referenceId: "product", ruleId: "bling-sale-reference", unit: "UN", ncm: "84821010", origin: "0", active: true, notes: "" };
const service = { kind: "nfse", referenceId: "service", ruleId: "bling-service-reference", nationalCode: "140101",
  municipalCode: "", nbs: "120029000", active: true, notes: "Revisar com contabilidade" };

test("catálogo fiscal edita e inativa sem duplicar, preserva zeros e não aprova referências", () => {
  const store = new Store(":memory:");
  try {
    const catalog = new FiscalCatalog(store);
    catalog.save(context, company, blingReferences, product);
    catalog.save(context, company, blingReferences, service);
    const saved = catalog.save(context, company, blingReferences, { ...product, unit: "PC", active: false, notes: "Item fora de uso" });
    assert.equal(saved.active, false);
    assert.equal(catalog.list(context).length, 2);
    assert.equal(saved.updatedBy, context.actor);
    assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
    assert.ok(blingReferences.every((rule) => !rule.reviewed));
    const withZero = fiscalItemSchema.parse({ ...product, ncm: "01012100" });
    assert.equal(withZero.kind === "nfe" && withZero.ncm, "01012100");
    assert.equal(store.db.prepare("SELECT COUNT(*) AS total FROM audit").get()!.total, 3);
  } finally { store.db.close(); }
});
test("catálogo fiscal recusa item fora da empresa, modelo e classificação divergentes e formatos inválidos", () => {
  const store = new Store(":memory:");
  try {
    const catalog = new FiscalCatalog(store);
    const save = (input: unknown) => catalog.save(context, company, blingReferences, input);
    assert.throws(() => save({ ...product, referenceId: "foreign-item" }), /catálogo/);
    assert.throws(() => save({ ...product, ruleId: "bling-service-reference" }), /modelo/);
    assert.throws(() => save({ ...product, ruleId: "missing" }), /modelo/);
    assert.throws(() => save({ ...product, ncm: "00000000" }), /NCM/);
    assert.throws(() => save({ ...product, origin: "1" }), /origem/);
    assert.throws(() => save({ ...service, nationalCode: "140102" }), /cTribNac/);
    assert.throws(() => save({ ...service, nbs: "000000000" }), /cNBS/);
    for (const input of [{ ...product, unit: "" }, { ...product, origin: "9" }, { ...product, ncm: "8482" },
      { ...product, active: "true" }, { ...service, nationalCode: "14.01.01" }, { ...service, nbs: "1200" }]) {
      assert.throws(() => save(input));
    }
    assert.equal(catalog.list(context).length, 0);
  } finally { store.db.close(); }
});
test("catálogo fiscal é isolado por tenant e persiste ao reiniciar o backend", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-catalog-test-"));
  let store = new Store(directory);
  try {
    new FiscalCatalog(store).save(context, company, blingReferences, product);
    store.db.close();
    store = new Store(directory);
    const catalog = new FiscalCatalog(store);
    assert.equal(catalog.list(context).length, 1);
    const other = { ...context, tenant: "company-b" };
    assert.deepEqual(catalog.list(other), []);
    catalog.save(other, company, blingReferences, { ...product, active: false });
    assert.equal(catalog.list(context)[0]!.active, true);
    assert.equal(catalog.list(other)[0]!.active, false);
  } finally { store.db.close(); await rm(directory, { recursive: true }); }
});
