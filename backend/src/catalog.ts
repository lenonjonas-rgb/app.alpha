import { z } from "zod";
import type { CompanyData, Context } from "./auth.js";
import type { TaxRule } from "./rules.js";
import type { Store } from "./store.js";
import { requireValue } from "./errors.js";

const common = {
  referenceId: z.string().trim().min(1).max(200),
  ruleId: z.string().trim().min(1).max(200),
  active: z.boolean(),
  notes: z.string().trim().max(1000),
};
export const fiscalItemSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("nfe"), unit: z.string().trim().min(1).max(6),
    ncm: z.string().regex(/^\d{8}$/), origin: z.string().regex(/^[0-8]$/) }),
  z.object({ ...common, kind: z.literal("nfse"), nationalCode: z.string().regex(/^\d{6}$/),
    municipalCode: z.string().trim().max(20), nbs: z.string().regex(/^\d{9}$/) }),
]);
export type FiscalItem = z.infer<typeof fiscalItemSchema>;
export type FiscalCatalogItem = FiscalItem & { updatedAt: string; updatedBy: string };

export class FiscalCatalog {
  constructor(private store: Store) {}
  list(context: Context) { return this.store.list<FiscalCatalogItem>(context.tenant, "fiscalCatalog"); }
  save(context: Context, company: CompanyData, rules: TaxRule[], input: unknown) {
    const item = fiscalItemSchema.parse(input);
    const records = item.kind === "nfe" ? company.products : company.services;
    requireValue(records?.some((record) => record.id === item.referenceId), "Item não encontrado no catálogo da empresa. Aguarde Sincronizado.", 422);
    const rule = rules.find((record) => record.id === item.ruleId);
    requireValue(rule && rule.kind === item.kind, "Selecione uma referência tributária do mesmo modelo fiscal.", 422);
    assertClassificationMatches(item, rule);
    const saved: FiscalCatalogItem = { ...item, updatedAt: new Date().toISOString(), updatedBy: context.actor };
    const id = `${item.kind}:${item.referenceId}`;
    this.store.put(context.tenant, "fiscalCatalog", id, saved);
    this.store.audit(context.tenant, context.actor, "fiscalCatalog.save", id);
    return saved;
  }
}
export function assertClassificationMatches(item: FiscalItem, rule: TaxRule) {
  const match = (keys: string[], actual: string) => {
    for (const key of keys) {
      const expected = rule.fields[key];
      requireValue(!expected || expected === actual, `Classificação diverge da referência tributária (${key}). Revise os dados ou selecione outra referência.`, 422);
    }
  };
  if (item.kind === "nfe") {
    match(["NCM", "prod.NCM"], item.ncm);
    match(["origem"], item.origin);
    for (const [key, expected] of Object.entries(rule.fields))
      if (key.startsWith("ICMS.") && key.endsWith(".orig")) requireValue(expected === item.origin, "Origem diverge da referência tributária.", 422);
  } else {
    match(["cTribNac"], item.nationalCode);
    match(["cTribMun"], item.municipalCode);
    match(["cNBS"], item.nbs);
  }
}
