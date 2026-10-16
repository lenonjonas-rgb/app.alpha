import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taxParametersSchema } from "../src/taxParameters.js";
import { FiscalMatrix } from "../src/matrix.js";
import { Store } from "../src/store.js";
import { blingReferences } from "../src/rules.js";
import { productParameters, serviceParameters } from "./taxFixtures.js";
import type { Context } from "../src/auth.js";

test("parâmetros preservam códigos com zeros, taxas/bases zero e casas decimais sem converter em default", () => {
  const product = taxParametersSchema.parse(productParameters);
  assert.equal(product.kind, "nfe");
  if (product.kind === "nfe") {
    assert.equal(product.icms.cst, "00");
    assert.equal(product.ibsCbs.classification, "000001");
    assert.equal(product.pis.rate, "1.65");
  }
  const service = taxParametersSchema.parse(serviceParameters);
  if (service.kind === "nfse") assert.equal(service.federalWithholding.pisRate, "0");
  assert.doesNotThrow(() => taxParametersSchema.parse({ ...productParameters, icms: { cst: "00", rate: "0", basePercent: "0" } }));
  assert.doesNotThrow(() => taxParametersSchema.parse({ ...productParameters, icms: { cst: "00", rate: "17.1234", basePercent: "100" } }));
});
test("parâmetros recusam percentuais impossíveis, fórmulas de outro modelo, campos omitidos e código incorreto", () => {
  for (const rate of ["", "-1", "100.0001", "101", "NaN", "1,65", "1.12345", "1e2", " 17 ", "0017"]) {
    assert.throws(() => taxParametersSchema.parse({ ...productParameters, icms: { cst: "00", rate, basePercent: "100" } }));
  }
  for (const input of [
    { ...productParameters, ibsCbs: { ...productParameters.ibsCbs, baseMode: "net-minus-iss" } },
    { ...serviceParameters, ibsCbs: { ...serviceParameters.ibsCbs, baseMode: "net-minus-icms-pis-cofins" } },
    { ...productParameters, ibsCbs: { ...productParameters.ibsCbs, classification: "" } },
    { ...productParameters, pis: undefined }, { ...serviceParameters, federalWithholding: undefined },
    { ...serviceParameters, iss: { rate: "5", basePercent: "100", retained: "false", incidenceMunicipality: "4205407" } },
  ]) assert.throws(() => taxParametersSchema.parse(input));
});
test("matriz salva/edita parâmetros isolados e preserva-os após reinício sem alterar a referência consultada", async () => {
  const context: Context = { tenant: "a", actor: "admin", role: "admin", token: "test" };
  const directory = await mkdtemp(join(tmpdir(), "alpha-tax-parameters-"));
  let store = new Store(directory);
  const input = { id: "matrix", kind: "nfe", name: "Parâmetros manuais", operation: "Operação de teste automatizado",
    ruleId: "bling-sale-reference", validFrom: "2026-01-01", validUntil: "2026-12-31", destinationState: "SC",
    ieIndicator: "9", finalConsumer: true, active: true, reviewed: false, approval: "", parameters: productParameters };
  try {
    let matrices = new FiscalMatrix(store);
    matrices.save(context, blingReferences, input);
    const revised = { ...productParameters, icms: { cst: "00", rate: "18.5", basePercent: "80" } };
    matrices.save(context, blingReferences, { ...input, parameters: revised });
    store.db.close(); store = new Store(directory); matrices = new FiscalMatrix(store);
    assert.deepEqual(matrices.list(context)[0]!.parameters, revised);
    assert.equal(matrices.list(context).length, 1);
    assert.equal(blingReferences[0]!.fields.ICMS_percent, "17");
    assert.equal(blingReferences[0]!.reviewed, false);
    assert.deepEqual(matrices.list({ ...context, tenant: "b" }), []);
    assert.throws(() => matrices.save(context, blingReferences, { ...input, parameters: serviceParameters }), /Parâmetros de outro modelo/);
  } finally { store.db.close(); await rm(directory, { recursive: true }); }
});
