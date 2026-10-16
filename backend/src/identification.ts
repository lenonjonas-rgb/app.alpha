import { z } from "zod";

export function validCpfCnpj(value: string): boolean {
  if (!/^(?:\d{11}|\d{14})$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  if (value.length === 11) {
    const digit = (length: number) => {
      const sum = [...value.slice(0, length)].reduce((total, char, index) => total + Number(char) * (length + 1 - index), 0);
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return digit(9) === Number(value[9]) && digit(10) === Number(value[10]);
  }
  const calculate = (source: string, weights: number[]) => {
    const sum = [...source].reduce((total, char, index) => total + Number(char) * weights[index]!, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(value[12]) &&
    calculate(value.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(value[13]);
}

export const states = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17",
  MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27", SE: "28", BA: "29",
  MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41", SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
} as const;
export const documentSchema = z.string().regex(/^(?:\d{11}|\d{14})$/).refine(validCpfCnpj, "CPF/CNPJ com dígitos verificadores inválidos.");
const field = z.string().trim().min(1).max(60);
export const addressSchema = z.object({
  street: field, number: field, complement: z.string().trim().max(60), district: field,
  postalCode: z.string().regex(/^\d{8}$/),
  municipality: z.string().regex(/^\d{7}$/), city: field, state: z.enum(Object.keys(states) as [keyof typeof states, ...(keyof typeof states)[]]),
}).superRefine((address, context) => {
  if (!address.municipality.startsWith(states[address.state]))
    context.addIssue({ code: "custom", path: ["municipality"], message: "Código IBGE incompatível com a UF." });
});
export type FiscalAddress = z.infer<typeof addressSchema>;
