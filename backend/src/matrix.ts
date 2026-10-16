import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context } from "./auth.js";
import type { TaxRule } from "./rules.js";
import type { Store } from "./store.js";
import { requireValue } from "./errors.js";
import { states } from "./identification.js";
import { taxParametersSchema } from "./taxParameters.js";
import { calculateTaxes, calculationItemsSchema } from "./taxCalculation.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Data de vigência inválida.");
export const matrixSchema = z.object({
  id: z.string().min(1).max(200).default(() => randomUUID()),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["nfe", "nfse"]),
  operation: z.string().trim().min(10).max(500),
  ruleId: z.string().min(1).max(200),
  validFrom: day, validUntil: day,
  destinationState: z.string().refine((value) => Object.hasOwn(states, value), "UF inválida."),
  ieIndicator: z.enum(["1", "2", "9"]),
  finalConsumer: z.boolean(),
  active: z.boolean(),
  reviewed: z.boolean(),
  approval: z.string().trim().max(1000),
  parameters: taxParametersSchema,
}).superRefine((matrix, context) => {
  if (matrix.parameters.kind !== matrix.kind) context.addIssue({ code: "custom", path: ["parameters"], message: "Parâmetros de outro modelo fiscal." });
  if (matrix.parameters.kind === "nfe" && matrix.parameters.cfop[0] !== (matrix.destinationState === "SC" ? "5" : "6"))
    context.addIssue({ code: "custom", path: ["parameters", "cfop"], message: "CFOP incompatível com UF da saída interna/interestadual." });
  if (matrix.validUntil < matrix.validFrom) context.addIssue({ code: "custom", path: ["validUntil"], message: "Vigência final anterior à inicial." });
  if (matrix.reviewed && matrix.approval.length < 10)
    context.addIssue({ code: "custom", path: ["approval"], message: "Identifique a revisão contábil e o fundamento da operação." });
});
export type TaxMatrix = z.infer<typeof matrixSchema> & { ruleSnapshot: TaxRule; updatedAt: string; updatedBy: string };
const snapshotMatches = (a: TaxRule, b: TaxRule) => a.id === b.id && a.kind === b.kind &&
  a.reviewed === b.reviewed && a.scope === b.scope &&
  JSON.stringify(Object.entries(a.fields).sort(([x], [y]) => x.localeCompare(y))) ===
  JSON.stringify(Object.entries(b.fields).sort(([x], [y]) => x.localeCompare(y)));

export class FiscalMatrix {
  constructor(private store: Store) {}
  list(context: Context) { return this.store.list<TaxMatrix>(context.tenant, "taxMatrix"); }
  simulate(context: Context, input: unknown) {
    const request = z.object({
      matrixId: z.string().min(1).max(200), updatedAt: z.string(), items: calculationItemsSchema,
    }).strict().parse(input);
    const matrix = this.list(context).find((item) => item.id === request.matrixId);
    requireValue(matrix, "Matriz não encontrada nesta empresa.", 404);
    requireValue(matrix.updatedAt === request.updatedAt, "Matriz alterada. Atualize a tela antes de simular novamente.", 409);
    requireValue(matrix.parameters?.kind === matrix.kind, "Complete os parâmetros do modelo fiscal antes de simular.");
    requireValue(matrix.kind !== "nfe" || matrix.destinationState === "SC", "Simulação NF-e limitada a operações internas em SC.");
    return { simulation: true as const, matrixId: matrix.id, updatedAt: matrix.updatedAt,
      warning: "Prévia aritmética dos parâmetros salvos, inclusive matrizes pendentes/inativas/fora de vigência. Não valida enquadramento, limites legais, dispensas ou mínimos de retenção; não gera XML, cobrança nem autorização. Tributos próprios não são somados ao preço nem descontados do saldo. Retenções federais usam o valor após desconto como base, sem deduções especiais. A composição da base IBS/CBS é a escolhida, sem apuração de créditos, compensações ou regras de transição.",
      result: calculateTaxes(matrix.parameters, request.items) };
  }
  save(context: Context, rules: TaxRule[], input: unknown) {
    const matrix = matrixSchema.parse(input);
    const rule = rules.find((item) => item.id === matrix.ruleId && item.kind === matrix.kind);
    requireValue(rule, "Matriz exige referência tributária do mesmo modelo.", 422);
    requireValue(!matrix.reviewed || rule.reviewed, "Revise a referência tributária antes de aprovar a matriz.", 422);
    if (matrix.kind === "nfe" && matrix.reviewed) {
      const cfop = rule.fields.CFOP ?? rule.fields["prod.CFOP"];
      requireValue(cfop && /^[56]\d{3}$/.test(cfop) && cfop[0] === (matrix.destinationState === "SC" ? "5" : "6"),
        "CFOP da referência incompatível com saída interna/interestadual. Operações exteriores não suportadas.", 422);
    }
    if (matrix.active) for (const existing of this.list(context)) {
      if (existing.id !== matrix.id && existing.active && existing.ruleId === matrix.ruleId && existing.kind === matrix.kind &&
        existing.destinationState === matrix.destinationState && existing.ieIndicator === matrix.ieIndicator && existing.finalConsumer === matrix.finalConsumer &&
        existing.validFrom <= matrix.validUntil && matrix.validFrom <= existing.validUntil)
        requireValue(false, "Outra matriz ativa da mesma referência/perfil já cobre esta vigência. Ajuste as datas ou inative a anterior.", 409);
    }
    const saved: TaxMatrix = { ...matrix, ruleSnapshot: structuredClone(rule), updatedAt: new Date().toISOString(), updatedBy: context.actor };
    this.store.put(context.tenant, "taxMatrix", matrix.id, saved);
    this.store.audit(context.tenant, context.actor, matrix.reviewed ? "matrix.review" : "matrix.save", matrix.id);
    return saved;
  }
  select(context: Context, rules: TaxRule[], operation: {
    kind: "nfe" | "nfse"; ruleId: string; date: string; destinationState: string; ieIndicator: "1" | "2" | "9"; finalConsumer: boolean;
  }) {
    day.parse(operation.date);
    const matches = this.list(context).filter((item) => item.active && item.kind === operation.kind && item.ruleId === operation.ruleId &&
      item.validFrom <= operation.date && item.validUntil >= operation.date && item.destinationState === operation.destinationState &&
      item.ieIndicator === operation.ieIndicator && item.finalConsumer === operation.finalConsumer);
    requireValue(matches.length === 1, matches.length ? "Matriz tributária ambígua." : "Nenhuma matriz cobre a operação/vigência.", 422);
    const matrix = matches[0]!;
    const parameters = taxParametersSchema.safeParse(matrix.parameters);
    requireValue(parameters.success && parameters.data.kind === matrix.kind, "Complete os parâmetros fiscais da matriz antes de aplicar.", 422);
    const rule = rules.find((item) => item.id === matrix.ruleId);
    requireValue(matrix.reviewed && rule?.reviewed && snapshotMatches(matrix.ruleSnapshot, rule),
      "Matriz pendente de aprovação ou referência alterada; reconfira a tributação.", 422);
    return matrix;
  }
}
