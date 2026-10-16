import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { FiscalMatrix } from "../src/matrix.js";
import { blingReferences } from "../src/rules.js";
import type { Context } from "../src/auth.js";
import { productParameters } from "./taxFixtures.js";

const context: Context = { tenant: "company-a", actor: "admin-a", role: "admin", token: "fixture" };
const input = { id: "matrix", kind: "nfe", name: "Revenda interna", operation: "Revenda interna de rolamentos; conferir enquadramento",
  ruleId: "bling-sale-reference", validFrom: "2026-01-01", validUntil: "2026-12-31", destinationState: "SC",
  ieIndicator: "9", finalConsumer: true, active: true, reviewed: false, approval: "", parameters: productParameters };
const operation = { kind: "nfe" as const, ruleId: input.ruleId, date: "2026-10-15", destinationState: "SC", ieIndicator: "9" as const, finalConsumer: true };

test("matriz inicia pendente e não pode aprovar referência pendente nem selecionar operação sem revisão", () => {
  const store = new Store(":memory:");
  try {
    const matrix = new FiscalMatrix(store);
    const record = matrix.save(context, blingReferences, input);
    assert.equal(record.reviewed, false);
    assert.throws(() => matrix.select(context, blingReferences, operation), /aprovação/);
    assert.throws(() => matrix.save(context, blingReferences, { ...input, reviewed: true, approval: "Revisão de teste não fiscal" }), /Revise a referência/);
    assert.equal(matrix.list(context).length, 1);
  } finally { store.db.close(); }
});
test("matriz limita UF/perfil/vigência, inclui extremos e invalida referência alterada", () => {
  const store = new Store(":memory:");
  try {
    const matrix = new FiscalMatrix(store);
    const rules = blingReferences.map((rule) => ({ ...rule, reviewed: true }));
    matrix.save(context, rules, { ...input, reviewed: true, approval: "Revisão fictícia para teste automatizado" });
    for (const date of ["2026-01-01", "2026-12-31", operation.date]) assert.equal(matrix.select(context, rules, { ...operation, date }).id, input.id);
    for (const selector of [{ ...operation, date: "2027-01-01" }, { ...operation, destinationState: "SP" },
      { ...operation, ieIndicator: "1" as const }, { ...operation, finalConsumer: false }])
      assert.throws(() => matrix.select(context, rules, selector), /Nenhuma matriz/);
    const changed = structuredClone(rules); changed[0]!.fields.ICMS_percent = "18";
    assert.throws(() => matrix.select(context, changed, operation), /referência alterada/);
    assert.throws(() => matrix.select({ ...context, tenant: "company-b" }, rules, operation), /Nenhuma matriz/);
    const reordered = rules.map((rule) => ({ ...rule, fields: Object.fromEntries(Object.entries(rule.fields).reverse()) }));
    assert.equal(matrix.select(context, reordered, operation).id, input.id);
  } finally { store.db.close(); }
});
test("matriz impede sobreposição, exige período real e CFOP compatível sem inventar interestadual", () => {
  const store = new Store(":memory:");
  try {
    const matrix = new FiscalMatrix(store);
    matrix.save(context, blingReferences, input);
    assert.throws(() => matrix.save(context, blingReferences, { ...input, id: "other" }), /Outra matriz ativa/);
    assert.doesNotThrow(() => matrix.save(context, blingReferences, { ...input, id: "next", validFrom: "2027-01-01", validUntil: "2027-12-31" }));
    for (const invalid of [{ ...input, validFrom: "2026-02-30" }, { ...input, validUntil: "2025-12-31" },
      { ...input, destinationState: "ZZ" }, { ...input, reviewed: true, approval: "" }])
      assert.throws(() => matrix.save(context, blingReferences, invalid));
    const rules = blingReferences.map((rule) => ({ ...rule, reviewed: true }));
    assert.throws(() => matrix.save(context, rules, { ...input, id: "sp", destinationState: "SP", reviewed: true, approval: "Teste fictício para SP" }), /CFOP/);
    matrix.save(context, blingReferences, { ...input, active: false });
    assert.doesNotThrow(() => matrix.save(context, blingReferences, { ...input, id: "replacement" }));
    assert.equal(matrix.list(context).length, 3);
  } finally { store.db.close(); }
});
