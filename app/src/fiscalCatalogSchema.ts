import { z } from "zod";

const common = { referenceId: z.string(), ruleId: z.string(), active: z.boolean(), notes: z.string(), updatedAt: z.string() };
export const fiscalCatalogSchema = z.array(z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("nfe"), unit: z.string(), ncm: z.string(), origin: z.string() }),
  z.object({ ...common, kind: z.literal("nfse"), nationalCode: z.string(), municipalCode: z.string(), nbs: z.string() }),
]));
export type FiscalCatalogItem = z.infer<typeof fiscalCatalogSchema>[number];
