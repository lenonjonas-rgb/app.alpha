import { z } from "zod";

const optionalCode = (length: number, message: string) =>
  z.string().trim().refine((value) => !value || new RegExp(`^\\d{${length}}$`).test(value), message);

export const nfseTaxSetSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Informe o nome do conjunto.").max(160),
  nationalCode: z.string().trim().regex(/^\d{6}$/, "Informe o código nacional com 6 dígitos."),
  municipalCode: z.string().trim().max(20),
  nbs: optionalCode(9, "Informe o NBS com 9 dígitos."),
  operationIndicator: optionalCode(6, "Informe o indicador de operação com 6 dígitos."),
  issRate: z.number().min(0, "A alíquota de ISS deve estar entre 0 e 100%.").max(100, "A alíquota de ISS deve estar entre 0 e 100%."),
  ibptRate: z.number().min(0, "A alíquota IBPT deve estar entre 0 e 100%.").max(100, "A alíquota IBPT deve estar entre 0 e 100%.").nullable(),
  active: z.boolean(),
  isDefault: z.boolean(),
}).superRefine((set, context) => {
  if (!set.active && set.isDefault)
    context.addIssue({ code: "custom", path: ["isDefault"], message: "Um conjunto inativo não pode ser o padrão." });
});

export const nfseTaxSetsSchema = z.array(nfseTaxSetSchema).max(500).superRefine((sets, context) => {
  if (new Set(sets.map((set) => set.id)).size !== sets.length)
    context.addIssue({ code: "custom", message: "Há conjuntos de tributação com identificadores repetidos." });
  if (new Set(sets.map((set) => set.name.toLocaleLowerCase("pt-BR"))).size !== sets.length)
    context.addIssue({ code: "custom", message: "Já existe um conjunto de tributação com este nome." });
  if (sets.filter((set) => set.isDefault).length > 1)
    context.addIssue({ code: "custom", message: "Somente um conjunto de tributação pode ser o padrão." });
});

export type NfseTaxSet = z.infer<typeof nfseTaxSetSchema>;
