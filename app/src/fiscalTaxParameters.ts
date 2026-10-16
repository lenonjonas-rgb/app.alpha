import { z } from "zod";

const contribution = z.object({ cst: z.string(), rate: z.string(), basePercent: z.string(), baseMode: z.enum(["net", "net-minus-icms"]) });
const ibsCbs = z.object({ cst: z.string(), classification: z.string(), basePercent: z.string(),
  baseMode: z.enum(["net", "net-minus-icms-pis-cofins", "net-minus-iss"]), stateRate: z.string(), municipalRate: z.string(), cbsRate: z.string() });
export const fiscalTaxParametersSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("nfe"), cfop: z.string(), icms: z.object({ cst: z.string(), rate: z.string(), basePercent: z.string() }),
    pis: contribution, cofins: contribution, ibsCbs }),
  z.object({ kind: z.literal("nfse"), iss: z.object({ rate: z.string(), basePercent: z.string(), retained: z.boolean(), incidenceMunicipality: z.string() }),
    federalWithholding: z.object({ pisRate: z.string(), cofinsRate: z.string(), csllRate: z.string(), inssRate: z.string(), irrfRate: z.string() }), ibsCbs }),
]);
export type FiscalTaxParameters = z.infer<typeof fiscalTaxParametersSchema>;
export function taxParametersFromForm(form: FormData, kind: "nfe" | "nfse"): FiscalTaxParameters {
  const value = (name: string) => String(form.get(name) ?? "").trim().replace(",", ".");
  const baseMode = form.get("ibsCbs.baseMode");
  const ibs = {
    cst: value("ibsCbs.cst"), classification: value("ibsCbs.classification"), basePercent: value("ibsCbs.basePercent"),
    baseMode, stateRate: value("ibsCbs.stateRate"), municipalRate: value("ibsCbs.municipalRate"), cbsRate: value("ibsCbs.cbsRate"),
  };
  if (kind === "nfe") {
    const contributionFromForm = (name: string) => ({ cst: value(`${name}.cst`), rate: value(`${name}.rate`),
      basePercent: value(`${name}.basePercent`), baseMode: form.get(`${name}.baseMode`) });
    return fiscalTaxParametersSchema.parse({ kind, cfop: value("cfop"),
      icms: { cst: value("icms.cst"), rate: value("icms.rate"), basePercent: value("icms.basePercent") },
      pis: contributionFromForm("pis"), cofins: contributionFromForm("cofins"), ibsCbs: ibs });
  }
  const retained = z.enum(["true", "false"]).parse(form.get("iss.retained"));
  return fiscalTaxParametersSchema.parse({ kind,
    iss: { rate: value("iss.rate"), basePercent: value("iss.basePercent"), retained: retained === "true", incidenceMunicipality: value("iss.incidenceMunicipality") },
    federalWithholding: { pisRate: value("federalWithholding.pisRate"), cofinsRate: value("federalWithholding.cofinsRate"),
      csllRate: value("federalWithholding.csllRate"), inssRate: value("federalWithholding.inssRate"), irrfRate: value("federalWithholding.irrfRate") },
    ibsCbs: ibs,
  });
}
