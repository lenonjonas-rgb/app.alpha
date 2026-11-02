import { describe, expect, it } from "vitest";
import { demoDatabase, validateDatabase } from "./domain";
import { nfseTaxOptions } from "./nfseTaxCatalog";
import type { NfseTaxSet } from "./nfseTaxSetSchema";
import {
  applyNfseTaxSet, changeNfseCst, changeNfseOperation, detachNfseTaxSet, nfseTaxSetDiffers, saveNfseTaxSet,
} from "./nfseTaxSets";
import { blankNfse, cloneNfse, nfseRecipientFromClient, nfseWarnings, saveNfse } from "./serviceInvoices";

const taxSet: NfseTaxSet = {
  id: "set-a", name: "Serviço A", nationalCode: "140101", municipalCode: "14.01", nbs: "120029000",
  operationIndicator: "050101", issRate: 3, ibptRate: null, active: true, isDefault: true,
};

describe("conjuntos de tributação da NFS-e", () => {
  it("começa sem configurações presumidas e preserva notas antigas ao carregar", () => {
    const data = demoDatabase();
    expect(data.settings.nfseTaxSets).toEqual([]);
    const blank = blankNfse(data);
    expect(blank.service).toMatchObject({ taxSetId: "", taxSet: "", nationalCode: "", nbs: "", cst: "", classification: "" });
    expect(blank.taxes.issRate).toBe(0);
    const { taxSetId: _legacyId, ...legacyService } = blank.service;
    const old = {
      ...blank,
      recipient: nfseRecipientFromClient(data.clients[0]),
      service: { ...legacyService, description: "Serviço", amount: 10000, taxSet: "14.01", cst: "000 - Tributação integral", classification: "código antigo" },
    };
    const restored = validateDatabase({
      ...data, settings: { ...data.settings, nfseTaxSets: undefined }, serviceInvoices: [old],
    });
    expect(restored.settings.nfseTaxSets).toEqual([]);
    expect(restored.serviceInvoices[0].service).toMatchObject({
      taxSetId: "", taxSet: "14.01", cst: "000 - Tributação integral", classification: "código antigo",
    });
  });

  it("salva conjuntos, mantém apenas um padrão e rejeita dados inconsistentes", () => {
    const first = saveNfseTaxSet(demoDatabase(), taxSet);
    const secondSet = { ...taxSet, id: "set-b", name: "Serviço B", nationalCode: "010101", isDefault: true };
    const second = saveNfseTaxSet(first, secondSet);
    expect(second.settings.nfseTaxSets.map((set) => [set.id, set.isDefault])).toEqual([["set-a", false], ["set-b", true]]);
    expect(() => saveNfseTaxSet(second, { ...taxSet, id: "set-c", name: "serviço a" })).toThrow("Já existe");
    expect(() => saveNfseTaxSet(second, { ...taxSet, nationalCode: "14" })).toThrow();
    expect(() => saveNfseTaxSet(second, { ...taxSet, issRate: 101 })).toThrow();
    expect(() => saveNfseTaxSet(second, { ...taxSet, active: false, isDefault: true })).toThrow();
    const inactive = saveNfseTaxSet(second, { ...secondSet, active: false, isDefault: false });
    expect(blankNfse(inactive).service.taxSetId).toBe("");
    expect(validateDatabase(JSON.parse(JSON.stringify(second))).settings.nfseTaxSets).toEqual(second.settings.nfseTaxSets);
  });

  it("aplica o padrão apenas a novas notas e conserva o retrato já salvo", () => {
    let data = saveNfseTaxSet(demoDatabase(), taxSet);
    const draft = blankNfse(data);
    expect(draft.service).toMatchObject({
      taxSetId: "set-a", taxSet: "Serviço A", nationalCode: "140101", municipalCode: "14.01",
      nbs: "120029000", operationIndicator: "050101", cst: "", classification: "",
    });
    expect(draft.taxes.issRate).toBe(3);
    expect(blankNfse(data, { applyDefaultTaxSet: false }).service.taxSetId).toBe("");
    const filled = { ...draft, recipient: nfseRecipientFromClient(data.clients[0]),
      service: { ...draft.service, description: "Serviço", amount: 10000, cst: "000", classification: "000001" } };
    data = saveNfse(data, filled);
    data = saveNfseTaxSet(data, { ...taxSet, name: "Serviço revisado", nationalCode: "010101", issRate: 5 });
    const persisted = data.serviceInvoices.find((invoice) => invoice.id === draft.id)!;
    expect(persisted.service).toMatchObject({ taxSet: "Serviço A", nationalCode: "140101", cst: "000", classification: "000001" });
    expect(persisted.taxes.issRate).toBe(3);
    expect(nfseTaxSetDiffers(persisted, data.settings.nfseTaxSets[0])).toBe(true);
    expect(cloneNfse(data, persisted.id).service).toEqual(persisted.service);
    expect(blankNfse(data).service.nationalCode).toBe("010101");
  });

  it("troca de conjunto e mantém o IBPT manual quando o conjunto não o informa", () => {
    const base = blankNfse(demoDatabase());
    const previous = { ...base, taxes: { ...base.taxes, ibptRate: 7 }, service: { ...base.service, cst: "200", classification: "200001" } };
    const applied = applyNfseTaxSet(previous, taxSet);
    expect(applied.taxes).toMatchObject({ issRate: 3, ibptRate: 7 });
    expect(nfseTaxSetDiffers(applied, taxSet)).toBe(false);
    expect(applied.service).toMatchObject({ cst: "", classification: "" });
    expect(applyNfseTaxSet(previous, { ...taxSet, ibptRate: 0 }).taxes.ibptRate).toBe(0);
    expect(() => applyNfseTaxSet(previous, { ...taxSet, active: false, isDefault: false })).toThrow("ativo");
    expect(detachNfseTaxSet(applied).service).toMatchObject({ taxSetId: "", taxSet: "", nationalCode: "140101", nbs: "120029000" });
  });

  it("limpa somente os campos dependentes ao alterar indicador ou CST", () => {
    const draft = applyNfseTaxSet(blankNfse(demoDatabase()), taxSet);
    const filled = { ...draft, service: { ...draft.service, cst: "000 - Tributação integral", classification: "000001" } };
    expect(changeNfseOperation(filled, "050101")).toBe(filled);
    expect(changeNfseOperation(filled, "050102").service).toMatchObject({ operationIndicator: "050102", cst: "", classification: "" });
    const legacy = { ...filled, service: { ...filled.service, operationIndicator: "050101 - descrição antiga" } };
    expect(changeNfseOperation(legacy, "050101").service).toMatchObject({ cst: "000 - Tributação integral", classification: "000001" });
    expect(changeNfseCst(filled, "000").service.classification).toBe("000001");
    expect(changeNfseCst(filled, "200").service).toMatchObject({ cst: "200", classification: "" });
  });

  it("avisa sobre códigos manuais inconsistentes sem impedir a leitura de valores antigos", () => {
    const blank = blankNfse(demoDatabase());
    const invalid = { ...blank, service: { ...blank.service, operationIndicator: "erro", cst: "000", classification: "200001" } };
    expect(nfseWarnings(invalid)).toEqual(expect.arrayContaining([
      "Confira o indicador de operação: são 6 dígitos.",
      "A classificação tributária informada não corresponde ao CST; revise os campos.",
    ]));
    const legacy = { ...blank, service: { ...blank.service, operationIndicator: "050101", cst: "000 - Tributação integral", classification: "000001" } };
    expect(nfseWarnings(legacy)).not.toContain("Confira o CST IBS/CBS: são 3 dígitos.");
  });
});

describe("sugestões oficiais da NFS-e", () => {
  const input = {
    nationalCode: "14.01.01", nbs: "1.2002.90.00", operationIndicator: "050101",
    cst: "000 - Tributação integral", issueDate: "2026-11-02",
  };

  it("sugere pelo serviço e NBS sem impedir outras opções", () => {
    const options = nfseTaxOptions(input);
    expect(options.indicators).toHaveLength(28);
    expect(options.indicators.filter((item) => item.suggested).map((item) => item.code)).toEqual(["050101", "050102"]);
    expect(options.csts.find((item) => item.code === "000")?.suggested).toBe(true);
    expect(options.classifications.find((item) => item.code === "000001")?.suggested).toBe(true);
    expect(options.classifications.find((item) => item.code === "000006")?.suggested).toBe(false);
    expect(options.indicators.some((item) => !item.suggested)).toBe(true);
  });

  it("não sugere outra correlação para código nacional diferente e respeita a vigência", () => {
    const other = nfseTaxOptions({ ...input, nationalCode: "990201" });
    expect(other.indicators.every((item) => !item.suggested)).toBe(true);
    expect(other.indicators).toHaveLength(28);
    const old = nfseTaxOptions({ ...input, issueDate: "2025-12-31" });
    expect(old.csts).toEqual([]);
    expect(old.classifications).toEqual([]);
  });
});
