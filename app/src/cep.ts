import { z } from "zod";

const postalAddressSchema = z.object({
  logradouro: z.string(),
  bairro: z.string(),
  localidade: z.string().trim().min(1),
  uf: z.string().regex(/^[A-Z]{2}$/),
});

export async function lookupPostalCode(value: string, signal?: AbortSignal) {
  const postalCode = value.replace(/\D/g, "");
  if (!/^\d{8}$/.test(postalCode)) throw new Error("Informe um CEP com 8 dígitos.");
  const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("Não foi possível consultar o CEP. Tente novamente ou preencha o endereço manualmente.");
  const result: unknown = await response.json();
  if (result && typeof result === "object" && "erro" in result && result.erro)
    throw new Error("CEP não encontrado. Confira o número informado.");
  const parsed = postalAddressSchema.safeParse(result);
  if (!parsed.success) throw new Error("A consulta do CEP retornou um endereço inválido.");
  return {
    street: parsed.data.logradouro, neighborhood: parsed.data.bairro,
    city: parsed.data.localidade, state: parsed.data.uf,
  };
}
