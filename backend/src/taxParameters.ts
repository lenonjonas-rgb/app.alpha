import { z } from "zod";

const percentage = z.string().regex(/^(?:0|[1-9]\d?|100)(?:\.\d{1,4})?$/, "Use percentual de 0 a 100, com até 4 casas decimais e ponto.")
  .refine((value) => Number(value) <= 100, "Percentual não pode exceder 100.");
const contribution = z.object({
  cst: z.string().regex(/^\d{2}$/), rate: percentage, basePercent: percentage,
  baseMode: z.enum(["net", "net-minus-icms"]),
});
const ibsCbs = z.object({
  cst: z.string().regex(/^\d{3}$/), classification: z.string().regex(/^\d{6}$/),
  basePercent: percentage,
  baseMode: z.enum(["net", "net-minus-icms-pis-cofins", "net-minus-iss"]),
  stateRate: percentage, municipalRate: percentage, cbsRate: percentage,
});
export const taxParametersSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("nfe"), cfop: z.string().regex(/^[56]\d{3}$/),
    icms: z.object({ cst: z.string().regex(/^\d{2}$/), rate: percentage, basePercent: percentage }),
    pis: contribution, cofins: contribution, ibsCbs: ibsCbs.refine((value) => value.baseMode !== "net-minus-iss", "NF-e não pode deduzir ISS nesta base."),
  }),
  z.object({
    kind: z.literal("nfse"),
    iss: z.object({
      rate: percentage, basePercent: percentage, retained: z.boolean(), incidenceMunicipality: z.string().regex(/^\d{7}$/),
    }),
    federalWithholding: z.object({ pisRate: percentage, cofinsRate: percentage, csllRate: percentage, inssRate: percentage, irrfRate: percentage }),
    ibsCbs: ibsCbs.refine((value) => value.baseMode !== "net-minus-icms-pis-cofins", "NFS-e não pode deduzir ICMS nesta base."),
  }),
]);
export type TaxParameters = z.infer<typeof taxParametersSchema>;
