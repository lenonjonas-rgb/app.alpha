import { describe, expect, it } from "vitest";
import {
  filterFiscalDocuments,
  fiscalDocumentNumber,
  fiscalDocumentStatusLabel,
  fiscalSelection,
  type FiscalDocumentRecord,
} from "./fiscalDocuments";
import type { Invoice } from "./financeSchema";

const accessKey = `42${"2610"}${"1".repeat(14)}55${"001"}${"000000123"}1${"2".repeat(8)}0`;
const documents: FiscalDocumentRecord[] = [
  { id: "doc-1", invoiceId: "inv-1", kind: "nfe", environment: "homologacao", key: `NFe${accessKey}`,
    accessKey, status: "autorizado", createdAt: "2026-10-10T12:00:00.000Z", protocol: "proto-1" },
  { id: "doc-2", invoiceId: "inv-2", kind: "nfe", environment: "producao", key: "NFe-uncertain",
    status: "incerto", createdAt: "2026-10-17T12:00:00.000Z", message: "Consulta necessária" },
];
const invoices: Invoice[] = [
  { id: "inv-1", clientId: "client-1", clientName: "Comércio São José", createdOn: "2026-10-10", amount: 25980, canceled: false,
    kind: "Produtos", orders: [{ orderId: "os-1", code: "OS-101", title: "Venda", amount: 25980 }] },
  { id: "inv-2", clientId: "client-2", clientName: "Cliente de São Paulo", createdOn: "2026-10-17", amount: 110000, canceled: false,
    kind: "Produtos", orders: [{ orderId: "os-2", code: "OS-102", title: "Venda", amount: 110000 }] },
];
const filters = { query: "", status: "", kind: "", environment: "", from: "", to: "" } as const;

describe("filtros de documentos fiscais de saída", () => {
  it("extrai o número da chave NF-e sem tratar uma chave inválida como número", () => {
    expect(fiscalDocumentNumber(documents[0]!)).toBe("000000123");
    expect(fiscalDocumentNumber(documents[1]!)).toBe("");
  });
  it("usa metadados fiscais sem substituir a emissão pela criação, inclusive no limite do fuso", () => {
    const withMetadata = [{ ...documents[0]!, issuedAt: "2026-10-09T23:30:00-03:00", number: "17",
      recipientName: "Destinatário histórico", recipientDocument: "99988877766", destinationState: "SC", products: ["Peça de reposição"] }];
    expect(filterFiscalDocuments(withMetadata, invoices, { ...filters, dateField: "issuedAt", from: "2026-10-09", to: "2026-10-09" })).toHaveLength(1);
    expect(filterFiscalDocuments(withMetadata, invoices, { ...filters, dateField: "issuedAt", from: "2026-10-10" })).toEqual([]);
    expect(filterFiscalDocuments(documents, invoices, { ...filters, dateField: "issuedAt", from: "2026-10-10" })).toEqual([]);
    expect(filterFiscalDocuments(withMetadata, [], { ...filters, product: "peca", destinationState: "SC", query: "historico" })).toHaveLength(1);
    expect(filterFiscalDocuments(withMetadata, [], { ...filters, destinationState: "SP" })).toEqual([]);
    expect(filterFiscalDocuments(withMetadata, [], { ...filters, product: "inexistente" })).toEqual([]);
    expect(filterFiscalDocuments(withMetadata, [], { ...filters, query: "999.888.777-66" })).toHaveLength(1);
    expect(fiscalDocumentNumber(withMetadata[0]!)).toBe("000017");
    expect(fiscalDocumentNumber({ ...documents[0]!, kind: "nfse", number: "83" })).toBe("000083");
  });
  it("opera somente sobre selecionados ainda visíveis, separando rascunhos e autorizadas", () => {
    const mixed = [...documents, { ...documents[0]!, id: "draft", status: "rascunho" as const }];
    const selection = fiscalSelection(mixed, ["doc-1", "doc-2", "draft", "hidden"]);
    expect(selection.selected.map((item) => item.id)).toEqual(["doc-1", "doc-2", "draft"]);
    expect(selection.drafts.map((item) => item.id)).toEqual(["draft"]);
    expect(selection.authorized.map((item) => item.id)).toEqual(["doc-1"]);
  });

  it("distingue rascunho descartado internamente de cancelamento fiscal", () => {
    expect(fiscalDocumentStatusLabel({
      ...documents[1]!, status: "cancelado", message: "Rascunho descartado internamente. Nunca transmitido ao fisco.",
    })).toBe("Rascunho descartado");
    expect(fiscalDocumentStatusLabel({ ...documents[1]!, status: "cancelado", message: "Cancelamento registrado." }))
      .toBe("Cancelada no fisco");
  });

  it("filtra por cliente sem diferenciar acentos e por número de pedido", () => {
    expect(filterFiscalDocuments(documents, invoices, { ...filters, query: "comercio sao jose" }).map((item) => item.id))
      .toEqual(["doc-1"]);
    expect(filterFiscalDocuments(documents, invoices, { ...filters, query: "OS-102" }).map((item) => item.id))
      .toEqual(["doc-2"]);
  });

  it("combina situação, ambiente e limites de data", () => {
    expect(filterFiscalDocuments(documents, invoices, {
      ...filters, status: "autorizado", environment: "homologacao", from: "2026-10-10", to: "2026-10-10",
    }).map((item) => item.id)).toEqual(["doc-1"]);
    expect(filterFiscalDocuments(documents, invoices, { ...filters, to: "2026-10-09" })).toEqual([]);
  });

  it("filtra por modelo fiscal e pesquisa CPF/CNPJ ou item faturado", () => {
    const mixedModels = [documents[0]!, { ...documents[1]!, kind: "nfse" as const }];
    const detailedInvoices = [{
      ...invoices[0]!,
      orders: [{ ...invoices[0]!.orders[0]!, items: [{
        id: "item-1", source: "item" as const, kind: "produto" as const,
        name: "Esteira profissional", quantity: 1, price: 25980, gross: 25980,
        itemDiscount: 0, orderDiscount: 0,
      }] }],
    }];
    expect(filterFiscalDocuments(mixedModels, detailedInvoices,
      { ...filters, kind: "nfe" }, [{ id: "client-1", document: "12.345.678/0001-90" }]))
      .toHaveLength(1);
    expect(filterFiscalDocuments(mixedModels, detailedInvoices,
      { ...filters, query: "12345678000190" }, [{ id: "client-1", document: "12.345.678/0001-90" }])
      .map((item) => item.id)).toEqual(["doc-1"]);
    expect(filterFiscalDocuments(mixedModels, detailedInvoices,
      { ...filters, query: "esteira profissional" }).map((item) => item.id)).toEqual(["doc-1"]);
  });
});
