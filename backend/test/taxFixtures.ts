import type { TaxParameters } from "../src/taxParameters.js";

export const productParameters: TaxParameters = {
  kind: "nfe", cfop: "5102", icms: { cst: "00", rate: "17", basePercent: "100" },
  pis: { cst: "01", rate: "1.65", basePercent: "100", baseMode: "net-minus-icms" },
  cofins: { cst: "01", rate: "7.6", basePercent: "100", baseMode: "net-minus-icms" },
  ibsCbs: { cst: "000", classification: "000001", basePercent: "100", baseMode: "net-minus-icms-pis-cofins",
    stateRate: "0.1", municipalRate: "0", cbsRate: "0.9" },
};
export const serviceParameters: TaxParameters = {
  kind: "nfse", iss: { rate: "5", basePercent: "100", retained: false, incidenceMunicipality: "4205407" },
  federalWithholding: { pisRate: "0", cofinsRate: "0", csllRate: "0", inssRate: "0", irrfRate: "0" },
  ibsCbs: { cst: "000", classification: "000001", basePercent: "100", baseMode: "net-minus-iss",
    stateRate: "0.1", municipalRate: "0", cbsRate: "0.9" },
};
