export type CompanyRegistration = {
  cnpj: string;
  legalName: string;
  tradeName: string;
  registrationStatus: string;
  openingDate: string;
  address: string;
  phone: string;
  email: string;
  addressDetails?: CompanyAddressRegistration;
  stateRegistrations?: StateRegistration[];
  mainCnae?: string;
  mainCnaeDescription?: string;
  secondaryCnaes?: string[];
  legalNature?: string;
  companySize?: string;
  simpleNationalOptIn?: boolean | null;
  meiOptIn?: boolean | null;
  raw: Record<string, unknown>;
};

export type StateRegistration = {
  state: string;
  number: string;
  active: boolean | null;
};

export type CompanyAddressRegistration = {
  street: string;
  number: string;
  complement: string;
  district: string;
  postalCode: string;
  municipality: string;
  city: string;
  state: string;
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
  codigo_municipio?: unknown;
  uf?: unknown;
  cep?: unknown;
  ddd_telefone_1?: unknown;
  ddd_telefone_2?: unknown;
  email?: unknown;
  cnae_fiscal?: unknown;
  cnae_fiscal_descricao?: unknown;
  cnaes_secundarios?: unknown;
  opcao_pelo_simples?: unknown;
  opcao_pelo_mei?: unknown;
};

type CnpjWsResponse = {
  cnpj?: unknown;
  razao_social?: unknown;
  estabelecimento?: unknown;
  natureza_juridica?: unknown;
  porte?: unknown;
  simples?: unknown;
  mei?: unknown;
};

type CnpjWsEstablishment = {
  cnpj?: unknown;
  nome_fantasia?: unknown;
  situacao_cadastral?: unknown;
  data_inicio_atividade?: unknown;
  tipo_logradouro?: unknown;
  logradouro?: unknown;
  numero?: unknown;
  complemento?: unknown;
  bairro?: unknown;
  cep?: unknown;
  ddd1?: unknown;
  telefone1?: unknown;
  ddd2?: unknown;
  telefone2?: unknown;
  email?: unknown;
  cnae_fiscal?: unknown;
  cnae_fiscal_descricao?: unknown;
  cnae_fiscal_secundaria?: unknown;
  inscricoes_estaduais?: unknown;
  cidade?: unknown;
  estado?: unknown;
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

function scalar(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function companyOnlyData(raw: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(raw);
  for (const key of ["socios", "qsa", "representantes", "responsaveis"]) delete result[key];
  const establishment = result.estabelecimento;
  if (establishment && typeof establishment === "object" && !Array.isArray(establishment)) {
    const data = { ...object(establishment) };
    for (const key of ["socios", "qsa", "representantes", "responsaveis"]) delete data[key];
    result.estabelecimento = data;
  }
  return result;
}

function joinPhone(ddd: unknown, phone: unknown): string {
  const number = text(phone);
  return number ? `${text(ddd)}${number}` : "";
}

function verifiedCnpj(value: unknown, requestedCnpj: string): string {
  const returnedCnpj = normalizeCnpj(text(value));
  if (returnedCnpj && returnedCnpj !== requestedCnpj)
    throw new Error("A fonte retornou um CNPJ diferente do consultado.");
  return returnedCnpj || requestedCnpj;
}

function nullableBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase("pt-BR");
    if (["sim", "true", "1"].includes(normalized)) return true;
    if (["não", "nao", "false", "0"].includes(normalized)) return false;
  }
  return null;
}

function stateRegistrations(value: unknown): StateRegistration[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const registration = object(item);
    const state = object(registration.estado);
    const number = text(registration.inscricao_estadual);
    const abbreviation = text(state.sigla || registration.estado);
    if (!number || !abbreviation) return [];
    return [{
      state: abbreviation,
      number,
      active: nullableBoolean(registration.ativo),
    }];
  });
}

function mapSecondaryCnaes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" || typeof item === "number") return [String(item)];
    const cnae = object(item);
    const number = cnae.codigo ?? cnae.id ?? cnae.cnae_fiscal;
    const description = text(cnae.descricao);
    if (number === undefined || number === null) return [];
    return [`${number}${description ? ` - ${description}` : ""}`];
  });
}

function mapBrasilApiResponse(
  result: BrasilApiCnpjResponse,
  raw: Record<string, unknown>,
  normalizedCnpj: string,
): CompanyRegistration {
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
  const addressDetails: CompanyAddressRegistration = {
    street: text(result.logradouro),
    number: text(result.numero),
    complement: text(result.complemento),
    district: text(result.bairro),
    postalCode: text(result.cep),
    municipality: scalar(result.codigo_municipio),
    city: text(result.municipio),
    state: text(result.uf),
  };

  return {
    cnpj: verifiedCnpj(result.cnpj, normalizedCnpj),
    legalName,
    tradeName,
    registrationStatus: text(result.descricao_situacao_cadastral),
    openingDate: text(result.data_inicio_atividade),
    address: addressParts.join(" · "),
    addressDetails,
    phone: [text(result.ddd_telefone_1), text(result.ddd_telefone_2)]
      .filter(Boolean)
      .join(" / "),
    email: text(result.email),
    stateRegistrations: stateRegistrations(raw.inscricoes_estaduais),
    mainCnae: scalar(result.cnae_fiscal),
    mainCnaeDescription: text(result.cnae_fiscal_descricao),
    secondaryCnaes: mapSecondaryCnaes(result.cnaes_secundarios),
    simpleNationalOptIn: nullableBoolean(result.opcao_pelo_simples),
    meiOptIn: nullableBoolean(result.opcao_pelo_mei),
    raw: companyOnlyData(raw),
  };
}

function mapCnpjWsResponse(
  result: CnpjWsResponse,
  raw: Record<string, unknown>,
  normalizedCnpj: string,
): CompanyRegistration {
  const establishment = object(result.estabelecimento) as CnpjWsEstablishment;
  const legalName = text(result.razao_social);
  const tradeName = text(establishment.nome_fantasia);
  if (!legalName && !tradeName)
    throw new Error("A consulta não retornou os dados cadastrais da empresa.");

  const city = object(establishment.cidade);
  const state = object(establishment.estado);
  const legalNature = object(result.natureza_juridica);
  const companySize = object(result.porte);
  const simpleNational = object(result.simples);
  const mei = object(result.mei);
  const addressParts = [
    [
      text(establishment.tipo_logradouro),
      text(establishment.logradouro),
      text(establishment.numero),
    ]
      .filter(Boolean)
      .join(" "),
    text(establishment.complemento),
    text(establishment.bairro),
    [text(city.nome), text(state.sigla)].filter(Boolean).join(" - "),
    text(establishment.cep) ? `CEP ${text(establishment.cep)}` : "",
  ].filter(Boolean);
  const addressDetails: CompanyAddressRegistration = {
    street: [text(establishment.tipo_logradouro), text(establishment.logradouro)].filter(Boolean).join(" "),
    number: text(establishment.numero),
    complement: text(establishment.complemento),
    district: text(establishment.bairro),
    postalCode: text(establishment.cep),
    municipality: scalar(city.id),
    city: text(city.nome),
    state: text(state.sigla),
  };

  return {
    cnpj: verifiedCnpj(establishment.cnpj || result.cnpj, normalizedCnpj),
    legalName,
    tradeName,
    registrationStatus: text(establishment.situacao_cadastral),
    openingDate: text(establishment.data_inicio_atividade),
    address: addressParts.join(" · "),
    addressDetails,
    phone:
      [
        joinPhone(establishment.ddd1, establishment.telefone1),
        joinPhone(establishment.ddd2, establishment.telefone2),
      ]
        .filter(Boolean)
        .join(" / "),
    email: text(establishment.email),
    stateRegistrations: stateRegistrations(establishment.inscricoes_estaduais),
    mainCnae: scalar(establishment.cnae_fiscal),
    mainCnaeDescription: text(establishment.cnae_fiscal_descricao),
    secondaryCnaes: mapSecondaryCnaes(establishment.cnae_fiscal_secundaria),
    legalNature: text(legalNature.descricao),
    companySize: text(companySize.descricao),
    simpleNationalOptIn: nullableBoolean(simpleNational.simples_optante),
    meiOptIn: nullableBoolean(mei.optante),
    raw: companyOnlyData(raw),
  };
}

export async function lookupCompanyByCnpj(
  cnpj: string,
  signal?: AbortSignal,
): Promise<CompanyRegistration> {
  const normalizedCnpj = normalizeCnpj(cnpj);
  if (!isValidCnpj(normalizedCnpj))
    throw new Error("Informe um CNPJ válido para consultar.");

  const endpoints = [
    {
      name: "CNPJ.ws",
      url: `https://publica.cnpj.ws/cnpj/${encodeURIComponent(normalizedCnpj)}`,
      map: mapCnpjWsResponse,
    },
    {
      name: "BrasilAPI",
      url: `https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(normalizedCnpj)}`,
      map: mapBrasilApiResponse,
    },
  ];
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, { signal });
      if (!response.ok) {
        failures.push(`${endpoint.name}: HTTP ${response.status}`);
        continue;
      }

      const raw: unknown = await response.json();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        failures.push(`${endpoint.name}: resposta cadastral inválida`);
        continue;
      }
      return endpoint.map(
        raw as BrasilApiCnpjResponse & CnpjWsResponse,
        raw as Record<string, unknown>,
        normalizedCnpj,
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push(
        `${endpoint.name}: ${
          error instanceof Error ? error.message : "falha de conexão"
        }`,
      );
    }
  }

  if (failures.some((failure) => failure.includes("HTTP 404")))
    throw new Error(
      "CNPJ não encontrado nas fontes públicas. Confira o número e tente novamente.",
    );
  if (failures.some((failure) => failure.includes("HTTP 429")))
    throw new Error(
      "As fontes públicas estão limitando consultas. Aguarde um pouco e tente novamente.",
    );
  throw new Error(
    "Não foi possível consultar o CNPJ nas fontes públicas. Os serviços podem estar temporariamente indisponíveis; tente novamente.",
  );
}
