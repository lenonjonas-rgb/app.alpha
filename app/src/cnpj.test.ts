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

  it("usa CNPJ.ws automaticamente quando a BrasilAPI falha", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"message":"upstream unavailable"}', { status: 500 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cnpj_raiz: "67029106",
            razao_social: "ALPHA TEC LTDA",
            estabelecimento: {
              cnpj: "67029106000199",
              nome_fantasia: "",
              situacao_cadastral: "Ativa",
              data_inicio_atividade: "2026-05-25",
              tipo_logradouro: "AVENIDA",
              logradouro: "MAR MAX SCHRAMM",
              numero: "2499",
              bairro: "JARDIM ATLANTICO",
              cep: "88095000",
              ddd1: "47",
              telefone1: "92701075",
              email: "contato@example.test",
              cidade: { nome: "Florianópolis" },
              estado: { sigla: "SC" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const company = await lookupCompanyByCnpj("67.029.106/0001-99");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://publica.cnpj.ws/cnpj/67029106000199",
        { signal: undefined },
      );
      expect(company).toMatchObject({
        cnpj: "67029106000199",
        legalName: "ALPHA TEC LTDA",
        registrationStatus: "Ativa",
        address:
          "AVENIDA MAR MAX SCHRAMM 2499 · JARDIM ATLANTICO · Florianópolis - SC · CEP 88095000",
        phone: "4792701075",
        email: "contato@example.test",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("interrompe as tentativas quando a busca é cancelada", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(
        lookupCompanyByCnpj("67029106000199", controller.signal),
      ).rejects.toThrow("Aborted");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
