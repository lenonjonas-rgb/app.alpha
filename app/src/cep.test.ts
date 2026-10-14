import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupPostalCode } from "./cep";

afterEach(() => { vi.unstubAllGlobals(); });

describe("consulta de CEP", () => {
  it("normaliza o CEP e retorna apenas os campos do endereço", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP", complemento: "lado ímpar",
    })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await lookupPostalCode("01001-000")).toEqual({
      street: "Praça da Sé", neighborhood: "Sé", city: "São Paulo", state: "SP",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://viacep.com.br/ws/01001000/json/");
  });
  it("aceita CEP geral sem logradouro para preenchimento manual", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      logradouro: "", bairro: "", localidade: "Cidade", uf: "SP",
    }))));
    expect((await lookupPostalCode("12345678")).street).toBe("");
  });
  it("rejeita CEP incompleto sem consultar", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupPostalCode("123")).rejects.toThrow("8 dígitos");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [{ erro: true }, "não encontrado"],
    [{ localidade: "Cidade", uf: "SP" }, "inválido"],
    [null, "inválido"],
  ])("informa erros do provedor: %j", async (body, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(lookupPostalCode("01001000")).rejects.toThrow(message);
  });
  it("informa indisponibilidade e propaga cancelamento", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(lookupPostalCode("01001000")).rejects.toThrow("consultar");
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, options: RequestInit) => {
      options.signal!.throwIfAborted();
    }));
    await expect(lookupPostalCode("01001000", controller.signal)).rejects.toThrow();
  });
});
