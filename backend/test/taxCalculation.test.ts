import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateTaxes } from "../src/taxCalculation.js";
import { productParameters, serviceParameters } from "./taxFixtures.js";

test("NF-e calcula desconto, exclusões de base e cada tributo em centavos exatos", () => {
  const result = calculateTaxes(productParameters, [{ id: "one", gross: "1000.00", discount: "100.00" }]);
  assert.deepEqual(result.totals, { gross: "1000.00", discount: "100.00", net: "900.00", ownTaxes: "228.88", withheld: "0.00", afterWithholding: "900.00" });
  assert.deepEqual(result.items[0]!.taxes.map(({ code, base, amount }) => ({ code, base, amount })), [
    { code: "icms", base: "900.00", amount: "153.00" },
    { code: "pis", base: "747.00", amount: "12.33" },
    { code: "cofins", base: "747.00", amount: "56.77" },
    { code: "ibs-state", base: "677.90", amount: "0.68" },
    { code: "ibs-municipal", base: "677.90", amount: "0.00" },
    { code: "cbs", base: "677.90", amount: "6.10" },
  ]);
});
test("composição integral usa bases independentes sem exclusões implícitas", () => {
  const parameters = structuredClone(productParameters);
  assert.equal(parameters.kind, "nfe");
  if (parameters.kind !== "nfe") return;
  parameters.pis.baseMode = "net"; parameters.cofins.baseMode = "net"; parameters.ibsCbs.baseMode = "net";
  const result = calculateTaxes(parameters, [{ id: "one", gross: "100", discount: "0" }]);
  assert.ok(result.items[0]!.taxes.every((tax) => tax.base === "100.00"));
  assert.equal(result.items[0]!.taxes.find((tax) => tax.code === "pis")!.amount, "1.65");
});
test("NFS-e distingue ISS próprio/retido e retencões federais, sem descontar tributos próprios", () => {
  const parameters = structuredClone(serviceParameters);
  if (parameters.kind !== "nfse") throw new Error("Fixture incorreta");
  parameters.iss.retained = true;
  parameters.federalWithholding = { pisRate: "0.65", cofinsRate: "3", csllRate: "1", inssRate: "11", irrfRate: "1.5" };
  const input = [{ id: "service", gross: "1000", discount: "100" }];
  const result = calculateTaxes(parameters, input);
  assert.deepEqual(result.totals, { gross: "1000.00", discount: "100.00", net: "900.00", ownTaxes: "8.56", withheld: "199.35", afterWithholding: "700.65" });
  assert.deepEqual(result.items[0]!.taxes.map((tax) => tax.amount), ["45.00", "5.85", "27.00", "9.00", "99.00", "13.50", "0.86", "0.00", "7.70"]);
  assert.equal(result.items[0]!.taxes.find((tax) => tax.code === "ibs-state")!.base, "855.00");
  parameters.iss.retained = false;
  const ownIss = calculateTaxes(parameters, input);
  assert.equal(ownIss.totals.withheld, "154.35");
  assert.equal(ownIss.totals.ownTaxes, "53.56");
  assert.equal(ownIss.totals.afterWithholding, "745.65");
  parameters.ibsCbs.baseMode = "net";
  assert.equal(calculateTaxes(parameters, input).items[0]!.taxes.find((tax) => tax.code === "cbs")!.base, "900.00");
});
test("arredonda meio centavo para cima por item e soma os resultados, inclusive quatro casas de taxa", () => {
  const parameters = structuredClone(productParameters);
  if (parameters.kind !== "nfe") throw new Error("Fixture incorreta");
  parameters.icms.rate = "50";
  parameters.pis.rate = "0"; parameters.cofins.rate = "0";
  parameters.ibsCbs.stateRate = "0"; parameters.ibsCbs.cbsRate = "0";
  const result = calculateTaxes(parameters, ["a", "b", "c"].map((id) => ({ id, gross: "0.01", discount: "0" })));
  assert.equal(result.totals.ownTaxes, "0.03");
  assert.equal(result.totals.net, "0.03");
  assert.ok(result.items.every((item) => item.ownTaxes === "0.01"));
  parameters.icms.rate = "0.0001";
  assert.equal(calculateTaxes(parameters, [{ id: "fraction", gross: "5000", discount: "0" }]).items[0]!.taxes[0]!.amount, "0.01");
  parameters.icms.rate = "100.0000";
  assert.equal(calculateTaxes(parameters, [{ id: "full", gross: "0.01", discount: "0" }]).items[0]!.taxes[0]!.amount, "0.01");
});
test("preserva precisão de totais grandes e não altera parâmetros nem itens", () => {
  const parameters = structuredClone(productParameters);
  if (parameters.kind !== "nfe") throw new Error("Fixture incorreta");
  parameters.icms.rate = "0"; parameters.pis.rate = "0"; parameters.cofins.rate = "0";
  parameters.ibsCbs.stateRate = "0"; parameters.ibsCbs.cbsRate = "0";
  const items = Array.from({ length: 200 }, (_, id) => ({ id: String(id), gross: "999999999999.99", discount: "0" }));
  const before = JSON.stringify({ parameters, items });
  const result = calculateTaxes(parameters, items);
  assert.equal(result.totals.net, "199999999999998.00");
  assert.equal(result.totals.ownTaxes, "0.00");
  assert.equal(JSON.stringify({ parameters, items }), before);
});
test("recusa valores inválidos, descontos excessivos e identificadores duplicados", () => {
  for (const gross of ["-1", "1,50", "1.001", "1e3", "NaN", "", " 10", "1000000000000"]) {
    assert.throws(() => calculateTaxes(productParameters, [{ id: "bad", gross, discount: "0" }]));
  }
  for (const [gross, discount] of [["0", "0"], ["10", "10"], ["10", "11"], ["10", "-1"]])
    assert.throws(() => calculateTaxes(productParameters, [{ id: "bad", gross, discount }]));
  assert.throws(() => calculateTaxes(productParameters, []));
  assert.throws(() => calculateTaxes(productParameters, Array.from({ length: 201 }, (_, id) => ({ id: String(id), gross: "1", discount: "0" }))));
  assert.throws(() => calculateTaxes(productParameters, Array(2).fill({ id: "duplicate", gross: "1", discount: "0" })), /duplicados/);
  assert.throws(() => calculateTaxes(productParameters, [{ id: "a", gross: "1", discount: "0", freight: "10" }]));
});
test("bloqueia CST/CFOP/classificações e bases especiais não implementadas, sem tratar como tributação normal", () => {
  const input = [{ id: "one", gross: "100", discount: "0" }];
  const cases = [
    { ...productParameters, cfop: "6102" },
    { ...productParameters, cfop: "5101" },
    { ...productParameters, icms: { cst: "10", rate: "17", basePercent: "100" } },
    { ...productParameters, icms: { cst: "00", rate: "17", basePercent: "80" } },
    { ...productParameters, pis: { cst: "04", rate: "0", basePercent: "100", baseMode: "net" } },
    { ...productParameters, cofins: { cst: "01", rate: "7.6", basePercent: "0", baseMode: "net" } },
    { ...productParameters, ibsCbs: { ...productParameters.ibsCbs, classification: "999999" } },
    { ...serviceParameters, ibsCbs: { ...serviceParameters.ibsCbs, cst: "200" } },
    { ...serviceParameters, iss: { rate: "5", basePercent: "80", retained: false, incidenceMunicipality: "4205407" } },
  ];
  for (const parameters of cases) assert.throws(() => calculateTaxes(parameters, input), /disponível|limitado/);
});
test("recusa base negativa e retenções acima do saldo em vez de zerar silenciosamente", () => {
  const input = [{ id: "one", gross: "100", discount: "0" }];
  assert.throws(() => calculateTaxes({
    ...productParameters, icms: { cst: "00", rate: "100", basePercent: "100" },
    pis: { cst: "01", rate: "1", basePercent: "100", baseMode: "net" },
  }, input), /base negativa/);
  assert.throws(() => calculateTaxes({
    ...serviceParameters,
    federalWithholding: { pisRate: "100", cofinsRate: "100", csllRate: "0", inssRate: "0", irrfRate: "0" },
  }, input), /retenções excedem/);
});
