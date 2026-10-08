export type CompanyRegistration = {
  cnpj: string;
  legalName: string;
  tradeName: string;
  registrationStatus: string;
  openingDate: string;
  address: string;
  phone: string;
  email: string;
  raw: Record<string, unknown>;
};

type BrasilApiCnpjResponse = {
  cnpj?: unknown;
  razao_social?: unknown;
  nome_fantasia?: unknown;
  descricao_situacao_cadastral?: unknown;
  data_inicio_atividade?: unknown;
  logradouro?: unknown;
  numero?: unknown;
  complemento?: unknown;
  bairro?: unknown;
  municipio?: unknown;
  uf?: unknown;
  cep?: unknown;
  ddd_telefone_1?: unknown;
  ddd_telefone_2?: unknown;
  email?: unknown;
};

const firstDigitWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const secondDigitWeights = [6, ...firstDigitWeights];

export function normalizeCnpj(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function calculateDigit(value: string, weights: number[]): number {
  const sum = [...value].reduce(
    (total, character, index) =>
      total + (character.charCodeAt(0) - 48) * weights[index],
    0,
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^([A-Z0-9])\1{13}$/.test(cnpj))
    return false;

  const firstDigit = calculateDigit(cnpj.slice(0, 12), firstDigitWeights);
  const secondDigit = calculateDigit(
    cnpj.slice(0, 13),
    secondDigitWeights,
  );
  return cnpj.endsWith(`${firstDigit}${secondDigit}`);
}

export function formatCnpj(value: string): string {
  const cnpj = normalizeCnpj(value).slice(0, 14);
  if (cnpj.length <= 2) return cnpj;
  if (cnpj.length <= 5) return `${cnpj.slice(0, 2)}.${cnpj.slice(2)}`;
  if (cnpj.length <= 8)
    return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5)}`;
  if (cnpj.length <= 12)
    return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8)}`;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function lookupCompanyByCnpj(
  cnpj: string,
  signal?: AbortSignal,
): Promise<CompanyRegistration> {
  const normalizedCnpj = normalizeCnpj(cnpj);
  if (!isValidCnpj(normalizedCnpj))
    throw new Error("Informe um CNPJ válido para consultar.");

  const response = await fetch(
    `https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(normalizedCnpj)}`,
    { signal },
  );
  if (!response.ok) {
    if (response.status === 404)
      throw new Error("CNPJ não encontrado na consulta pública.");
    if (response.status === 429)
      throw new Error("Muitas consultas. Aguarde um pouco e tente novamente.");
    throw new Error(
      `Não foi possível consultar o CNPJ (erro ${response.status}). Tente novamente.`,
    );
  }

  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("A consulta retornou uma resposta cadastral inválida.");
  const result = raw as BrasilApiCnpjResponse;
  const legalName = text(result.razao_social);
  const tradeName = text(result.nome_fantasia);
  if (!legalName && !tradeName)
    throw new Error("A consulta não retornou os dados cadastrais da empresa.");

  const addressParts = [
    [text(result.logradouro), text(result.numero)].filter(Boolean).join(", "),
    text(result.complemento),
    text(result.bairro),
    [text(result.municipio), text(result.uf)].filter(Boolean).join(" - "),
    text(result.cep) ? `CEP ${text(result.cep)}` : "",
  ].filter(Boolean);

  return {
    cnpj: normalizeCnpj(text(result.cnpj)) || normalizedCnpj,
    legalName,
    tradeName,
    registrationStatus: text(result.descricao_situacao_cadastral),
    openingDate: text(result.data_inicio_atividade),
    address: addressParts.join(" · "),
    phone: [text(result.ddd_telefone_1), text(result.ddd_telefone_2)]
      .filter(Boolean)
      .join(" / "),
    email: text(result.email),
    raw: raw as Record<string, unknown>,
  };
}
