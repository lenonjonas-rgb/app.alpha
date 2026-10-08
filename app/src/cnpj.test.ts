import { describe, expect, it, vi } from "vitest";
import {
  formatCnpj,
  isValidCnpj,
  lookupCompanyByCnpj,
  normalizeCnpj,
} from "./cnpj";

describe("consulta de CNPJ", () => {
  it("normaliza e formata o CNPJ digitado", () => {
    expect(normalizeCnpj("11.222.333/0001-34")).toBe("11222333000134");
    expect(formatCnpj("11222333000134")).toBe("11.222.333/0001-34");
  });

  it("valida CNPJs numéricos e rejeita dígitos verificadores inválidos", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
    expect(isValidCnpj("00.000.000/0000-00")).toBe(false);
  });

  it("valida CNPJs alfanuméricos com dígitos verificadores numéricos", () => {
    expect(isValidCnpj("ABCDEF12345680")).toBe(true);
    expect(isValidCnpj("ABCDEF123456")).toBe(false);
  });

  it("consulta e normaliza os dados cadastrais públicos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          cnpj: "11222333000181",
          razao_social: "Empresa Exemplo LTDA",
          nome_fantasia: "Exemplo",
          descricao_situacao_cadastral: "Ativa",
          data_inicio_atividade: "2020-01-02",
          logradouro: "Rua das Flores",
          numero: "10",
          bairro: "Centro",
          municipio: "São Paulo",
          uf: "SP",
          cep: "01001000",
          ddd_telefone_1: "1133334444",
          email: "contato@example.test",
          cnae_fiscal: 1234567,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const company = await lookupCompanyByCnpj("11.222.333/0001-81");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://brasilapi.com.br/api/cnpj/v1/11222333000181",
        { signal: undefined },
      );
      expect(company).toMatchObject({
        cnpj: "11222333000181",
        legalName: "Empresa Exemplo LTDA",
        tradeName: "Exemplo",
        registrationStatus: "Ativa",
        address: "Rua das Flores, 10 · Centro · São Paulo - SP · CEP 01001000",
        phone: "1133334444",
        email: "contato@example.test",
        raw: { cnae_fiscal: 1234567 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
