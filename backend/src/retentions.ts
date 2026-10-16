import { z } from "zod";
import type { InvoiceCalculationRecord } from "./invoiceCalculation.js";
import { requireValue } from "./errors.js";

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const retentionSchema = z.object({
  calculationId: z.string().regex(/^[a-f0-9]{64}$/),
  invoiceAmount: money, withheld: money, net: money,
  irrf: money, inss: money, csll: money,
  confirmedAt: z.iso.datetime(), confirmedBy: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.withheld <= 0 || value.withheld !== value.irrf + value.inss + value.csll ||
    value.net <= 0 || value.net + value.withheld !== value.invoiceAmount)
    context.addIssue({ code: "custom", message: "Conciliação de retenções inconsistente." });
});
export type Retention = z.infer<typeof retentionSchema>;
const cents = (value: string) => {
  requireValue(/^\d{1,12}\.\d{2}$/.test(value), "Valor inválido na memória de retenções.");
  const [integer, fraction] = value.split(".");
  return Number(integer) * 100 + Number(fraction);
};

export function serviceRetentions(calculation: InvoiceCalculationRecord) {
  requireValue(calculation.kind === "nfse", "Retenções exigem faturamento de serviços.");
  let irrf = 0, inss = 0, csll = 0;
  for (const line of calculation.lines) {
    requireValue(line.matrix.parameters.kind === "nfse", "Parâmetros de outro modelo no serviço.");
    const parameters = line.matrix.parameters;
    requireValue(!parameters.iss.retained, "ISS retido depende da conferência da apuração municipal oficial; ainda não liberado neste fluxo.");
    requireValue(Number(parameters.federalWithholding.pisRate) === 0 && Number(parameters.federalWithholding.cofinsRate) === 0,
      "PIS/COFINS retidos exigem separar retenção de apuração própria no layout nacional; ainda não liberados. Não zerar parâmetros para contornar.");
    const tax = (code: string) => {
      const values = line.calculation.items.flatMap((item) => item.taxes).filter((tax) => tax.code === code && tax.retained);
      requireValue(values.length === 1, `Memória sem retenção individual de ${code}.`);
      return cents(values[0]!.amount);
    };
    irrf += tax("irrf-retained"); inss += tax("inss-retained"); csll += tax("csll-retained");
  }
  const withheld = irrf + inss + csll, net = calculation.invoice.amount - withheld;
  requireValue(Number.isSafeInteger(withheld) && net > 0 && withheld === cents(calculation.totals.withheld) &&
    net === cents(calculation.totals.afterWithholding), "Retenções ou líquido divergentes da memória fiscal; cobrança líquida deve ser positiva.");
  return { calculationId: calculation.id, invoiceAmount: calculation.invoice.amount, withheld, net, irrf, inss, csll };
}
export function assertRetention(calculation: InvoiceCalculationRecord, value: unknown) {
  const expected = serviceRetentions(calculation);
  const actual = retentionSchema.parse(value);
  requireValue(Object.entries(expected).every(([key, value]) => actual[key as keyof Retention] === value),
    "Conciliação financeira obsoleta ou diferente das retenções calculadas. Recalcule, confira e sincronize o líquido antes de gerar.", 409);
  return actual;
}
