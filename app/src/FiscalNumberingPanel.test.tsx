import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FiscalNumberingPanel } from "./FiscalNumberingPanel";
import { numberingFromForm, type FiscalNumberingRecord } from "./fiscalNumberingSchema";

const record: FiscalNumberingRecord = { cnpj: "12345678000195", environment: "homologacao", series: 1,
  nextNumber: 42, updatedAt: "2026-10-15", updatedBy: "owner" };
const form = () => {
  const value = new FormData();
  value.set("environment", "homologacao"); value.set("series", "1"); value.set("nextNumber", "43"); value.set("confirmation", "on");
  return value;
};
describe("séries e numeração fiscal", () => {
  it("envia controle otimista e exige confirmação sem inventar próximo número", () => {
    expect(numberingFromForm(form(), [record])).toEqual({ environment: "homologacao", series: 1, nextNumber: 43,
      expectedNextNumber: 42, confirmation: true });
    const input = form(); input.set("environment", "producao");
    expect(numberingFromForm(input, [record]).expectedNextNumber).toBeNull();
    input.delete("confirmation"); expect(() => numberingFromForm(input, [record])).toThrow();
    for (const invalid of ["", "-1", "1.5", "1e2", "1000000000", "01"]) {
      const input = form(); input.set("nextNumber", invalid);
      expect(() => numberingFromForm(input, [])).toThrow();
    }
  });
  it("mostra limites e histórico sem apresentar reserva como autorização", () => {
    const html = renderToStaticMarkup(<FiscalNumberingPanel records={[record, { ...record, series: 2, nextNumber: 1000000000 }]}
      reservations={[{ cnpj: record.cnpj, environment: "homologacao", series: 1, number: 41, invoiceId: "invoice",
        documentId: "document", createdAt: "2026-10-15" }]} busy={false} act={async () => {}} />);
    for (const text of ["Somente Master", "Bling", "Esgotada", "não devolvem números", "não comprovam autorização", "número 41"])
      expect(html).toContain(text);
    expect(html).not.toContain('value="1" name="nextNumber"');
  });
});
