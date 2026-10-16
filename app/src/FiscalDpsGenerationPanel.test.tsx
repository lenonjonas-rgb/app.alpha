import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase } from "./domain";
import { FiscalDpsGenerationPanel } from "./FiscalDpsGenerationPanel";
import { FiscalNumberingPanel } from "./FiscalNumberingPanel";
import { dpsGenerationFromForm, generatedDpsResponseSchema } from "./fiscalDpsGeneration";
import { numberingFromForm } from "./fiscalNumberingSchema";

function form() {
  const value = new FormData();
  for (const [name, text] of Object.entries({ invoiceId: "invoice", additionalServiceId: "service", series: "1", expectedNumber: "10",
    issuedAt: "2026-10-15T14:00", competence: "2026-10-14", operationIndicator: "100101", personalUse: "0",
    totalFederal: "0", totalState: "0", totalMunicipal: "5,25", confirmScope: "on", confirmUnconditionalDiscount: "on" })) value.set(name, text);
  return value;
}
describe("geração automática DPS", () => {
  it("envia competência, indicador, adicionais e percentuais explícitos sem XML ou valores de itens", () => {
    expect(dpsGenerationFromForm(form())).toEqual({
      invoiceId: "invoice", additionalServiceId: "service", environment: "homologacao", series: 1, expectedNumber: 10,
      issuedAt: "2026-10-15T14:00:00-03:00", competence: "2026-10-14", operationIndicator: "100101", personalUse: "0",
      totalTaxPercent: { federal: "0", state: "0", municipal: "5.25" }, confirmScope: true, confirmUnconditionalDiscount: true,
    });
    const value = form(); value.set("additionalServiceId", "");
    expect(dpsGenerationFromForm(value)).not.toHaveProperty("additionalServiceId");
    value.set("confirmRetentions", "on");
    expect(dpsGenerationFromForm(value).confirmRetentions).toBe(true);
  });
  it("não presume zeros, datas, códigos ou confirmações e rejeita competência posterior à emissão", () => {
    for (const field of ["issuedAt", "competence", "operationIndicator", "personalUse", "totalFederal", "totalState", "totalMunicipal", "confirmScope", "confirmUnconditionalDiscount", "expectedNumber"]) {
      const value = form(); value.delete(field); expect(() => dpsGenerationFromForm(value)).toThrow();
    }
    for (const [field, text] of [["competence", "2026-10-16"], ["issuedAt", "2026-02-30T12:00"], ["issuedAt", "2027-01-01T12:00"],
      ["series", "50000"], ["expectedNumber", "1e2"], ["totalFederal", "100.01"]]) {
      const value = form(); value.set(field!, text!); expect(() => dpsGenerationFromForm(value)).toThrow();
    }
    expect(() => generatedDpsResponseSchema.parse({ id: "id", key: "bad", status: "autorizado" })).toThrow();
  });
  it("sinaliza apuração nacional, bloqueios e geração sem transmissão/produção", () => {
    const html = renderToStaticMarkup(<FiscalDpsGenerationPanel data={demoDatabase()} catalog={[]} numbering={[]}
      busy={false} certificateReady={false} schemaReady={false} act={async () => {}} />);
    for (const text of ["Homologação", "140101", "retenções", "A DPS não é NFS-e autorizada", "gerar não transmite", "A1", "nacional/municipal", "incondicionais"])
      expect(html).toContain(text);
    expect(html).toContain("disabled");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('value="producao"');
  });
  it("contador DPS usa limites próprios sem alterar limites NF-e e exige CAS/confirmação", () => {
    const value = form(); value.set("environment", "homologacao"); value.set("confirmation", "on");
    value.set("series", "49999"); value.set("nextNumber", "999999999999999");
    expect(numberingFromForm(value, [], "nfse")).toMatchObject({ series: 49999, nextNumber: 999999999999999, expectedNextNumber: null });
    expect(() => numberingFromForm(value, [])).toThrow();
    value.set("environment", "producao"); expect(numberingFromForm(value, [], "nfse").environment).toBe("producao");
    const html = renderToStaticMarkup(<FiscalNumberingPanel model="nfse" records={[]} reservations={[]} busy={false} act={async () => {}} />);
    expect(html).toContain("15 dígitos");
    expect(html).toContain("não é o número da NFS-e");
    expect(html).toContain("configurar produção não libera envio");
  });
});
