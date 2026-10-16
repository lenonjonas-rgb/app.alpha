import { z } from "zod";

const amount = z.string().regex(/^\d+\.\d{2}$/);
const totals = z.object({ gross: amount, discount: amount, net: amount, ownTaxes: amount, withheld: amount, afterWithholding: amount });
export const fiscalTaxSimulationSchema = z.object({
  simulation: z.literal(true), matrixId: z.string(), updatedAt: z.string(), warning: z.string(),
  result: z.object({
    kind: z.enum(["nfe", "nfse"]), rounding: z.literal("half-up-per-item"),
    totals,
    items: z.array(totals.extend({
      id: z.string(),
      taxes: z.array(z.object({ code: z.string(), label: z.string(), base: amount, rate: z.string(), amount, retained: z.boolean() })),
    })).min(1),
  }),
});
export type FiscalTaxSimulation = z.infer<typeof fiscalTaxSimulationSchema>;
export const invoiceCalculationMetadataSchema = z.object({
  id: z.string(), invoiceId: z.string(), kind: z.enum(["nfe", "nfse"]), date: z.string(), createdAt: z.string(),
});
export const invoiceCalculationSchema = z.object({
  id: z.string(), invoiceId: z.string(), kind: z.enum(["nfe", "nfse"]), date: z.string(), createdAt: z.string(), warning: z.string(),
  totals: fiscalTaxSimulationSchema.shape.result.shape.totals,
  lines: z.array(z.object({
    orderCode: z.string(), item: z.object({ name: z.string(), quantity: z.number(), referenceId: z.string().optional() }),
    matrix: z.object({ name: z.string() }),
    calculation: fiscalTaxSimulationSchema.shape.result,
  })).min(1),
});
const inputMoney = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, "Use valor sem separador de milhar, com até 2 casas decimais.");
export function taxSimulationFromForm(form: FormData, matrix: { id: string; updatedAt: string }) {
  const gross = inputMoney.parse(String(form.get("gross") ?? "").trim().replace(",", "."));
  const discount = inputMoney.parse(String(form.get("discount") ?? "").trim().replace(",", "."));
  return { matrixId: matrix.id, updatedAt: matrix.updatedAt, items: [{ id: "preview", gross, discount }] };
}
export function formatTaxMoney(value: string) {
  const [integer, fraction] = value.split(".");
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
}
