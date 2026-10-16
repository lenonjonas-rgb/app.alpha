import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FiscalTaxParameterFields } from "./FiscalTaxParameterFields";
import { taxParametersFromForm } from "./fiscalTaxParameters";

function fixture(kind: "nfe" | "nfse") {
  const form = new FormData();
  const common = {
    "ibsCbs.cst": "000", "ibsCbs.classification": "000001", "ibsCbs.basePercent": "100",
    "ibsCbs.baseMode": "net", "ibsCbs.stateRate": "0.1", "ibsCbs.municipalRate": "0", "ibsCbs.cbsRate": "0.9",
  };
  Object.entries(common).forEach(([key, value]) => form.set(key, value));
  if (kind === "nfe") {
    Object.entries({ cfop: "5102", "icms.cst": "00", "icms.rate": "17", "icms.basePercent": "100",
      "pis.cst": "01", "pis.rate": "1,65", "pis.basePercent": "0", "pis.baseMode": "net-minus-icms",
      "cofins.cst": "01", "cofins.rate": "7.6", "cofins.basePercent": "0", "cofins.baseMode": "net-minus-icms",
    }).forEach(([key, value]) => form.set(key, value));
  } else {
    Object.entries({ "iss.rate": "5", "iss.basePercent": "100", "iss.incidenceMunicipality": "4205407", "iss.retained": "false",
      "federalWithholding.pisRate": "0", "federalWithholding.cofinsRate": "0", "federalWithholding.csllRate": "0",
      "federalWithholding.inssRate": "0", "federalWithholding.irrfRate": "0",
    }).forEach(([key, value]) => form.set(key, value));
  }
  return form;
}
describe("campos editáveis de parâmetros fiscais", () => {
  it("converte formulário de produto para o payload e mantém zeros/códigos/decimais", () => {
    const parameters = taxParametersFromForm(fixture("nfe"), "nfe");
    expect(parameters.kind).toBe("nfe");
    if (parameters.kind !== "nfe") throw new Error("Modelo incorreto");
    expect(parameters.icms.cst).toBe("00");
    expect(parameters.pis.rate).toBe("1.65");
    expect(parameters.pis.basePercent).toBe("0");
    expect(parameters.ibsCbs.classification).toBe("000001");
    const html = renderToStaticMarkup(<FiscalTaxParameterFields kind="nfe" parameters={parameters} />);
    expect(html).toContain('name="cfop"');
    expect(html).toContain('name="cofins.basePercent"');
    expect(html).toContain('value="000001"');
    expect(html).toContain('value="1.65"');
    expect(html).toContain('name="ibsCbs.cbsRate"');
    expect(html).not.toContain('name="iss.rate"');
  });
  it("salva escolha explícita de ISS retido e retenções federais sem confundir apuração própria", () => {
    const form = fixture("nfse");
    let parameters = taxParametersFromForm(form, "nfse");
    if (parameters.kind !== "nfse") throw new Error("Modelo incorreto");
    expect(parameters.iss.retained).toBe(false);
    expect(parameters.federalWithholding.inssRate).toBe("0");
    form.set("iss.retained", "true"); form.set("federalWithholding.irrfRate", "1.5");
    parameters = taxParametersFromForm(form, "nfse");
    if (parameters.kind !== "nfse") throw new Error("Modelo incorreto");
    expect(parameters.iss.retained).toBe(true);
    expect(parameters.federalWithholding.irrfRate).toBe("1.5");
    const html = renderToStaticMarkup(<FiscalTaxParameterFields kind="nfse" parameters={parameters} />);
    expect(html).toContain('name="iss.incidenceMunicipality"');
    expect(html).toContain('name="federalWithholding.irrfRate"');
    expect(html).not.toContain('name="icms.rate"');
    form.delete("iss.retained");
    expect(() => taxParametersFromForm(form, "nfse")).toThrow();
  });
  it("abre novos parâmetros sem alíquotas sugeridas nem base escolhida automaticamente", () => {
    const html = renderToStaticMarkup(<FiscalTaxParameterFields kind="nfe" />);
    expect(html).not.toContain('value="17"');
    expect(html).not.toContain('value="100"');
    expect(html).toContain("Nenhum valor é sugerido automaticamente");
    expect(html).toContain('value="" selected=""');
  });
});
