import { describe, expect, it } from "vitest";
import { searchClients } from "./clientSearch";

const clients = [
  { id: "1", name: "Academia Horizonte", document: "67.029.106/0001-99", active: true },
  { id: "2", name: "Academia São José", document: "11222333000181", active: true },
  { id: "3", name: "Horizonte Serviços", document: "529.982.247-25", active: true },
  { id: "4", name: "Academia Antiga", document: "", active: false },
];

describe("busca de clientes na tarefa", () => {
  it("refina nomes parciais ignorando acentos e maiúsculas", () => {
    expect(searchClients(clients, "ACA").map((client) => client.id)).toEqual(["1", "2"]);
    expect(searchClients(clients, "aca sao").map((client) => client.id)).toEqual(["2"]);
    expect(searchClients(clients, "jose")).toEqual([clients[1]]);
  });

  it("busca documentos parciais com ou sem pontuação", () => {
    expect(searchClients(clients, "67.029")).toEqual([clients[0]]);
    expect(searchClients(clients, "67029106")).toEqual([clients[0]]);
    expect(searchClients(clients, "982.247")).toEqual([clients[2]]);
  });

  it("coloca nomes exatos e prefixos antes de correspondências internas", () => {
    expect(searchClients(clients, "Horizonte").map((client) => client.id)).toEqual(["3", "1"]);
    expect(searchClients(clients, "Horizonte Serviços")).toEqual([clients[2]]);
  });

  it("preserva um cliente inativo já vinculado sem oferecê-lo para novas tarefas", () => {
    expect(searchClients(clients, "")).toHaveLength(3);
    expect(searchClients(clients, "antiga")).toEqual([]);
    expect(searchClients(clients, "antiga", "4")).toEqual([clients[3]]);
  });

  it("retorna vazio para uma busca sem correspondência", () => {
    expect(searchClients(clients, "inexistente")).toEqual([]);
  });
});
