import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FiscalOutgoingDocuments } from "./FiscalOutgoingDocuments";
import type { FiscalDocumentRecord } from "./fiscalDocuments";
import { localDay } from "./domain";

const document: FiscalDocumentRecord = {
  id: "one", invoiceId: "invoice", kind: "nfe", environment: "homologacao", key: "test",
  status: "autorizado", createdAt: `${localDay()}T12:00:00Z`, issuedAt: `${localDay()}T23:30:00-03:00`,
  number: "17", amount: 25980, recipientName: "Cliente do XML", destinationState: "SC",
};
const props = { invoices: [], clients: [], busy: false, loading: false,
  renderActions: () => null, onInclude: vi.fn(), onRefresh: vi.fn(), onTransmit: vi.fn(), onExport: vi.fn() };

describe("listagem fiscal de vendas", () => {
  it("abre com filtros recolhidos, colunas e ações fiscais, sem inventar funções comerciais", () => {
    const html = renderToStaticMarkup(<FiscalOutgoingDocuments {...props} fixedKind="nfe" documents={[document, { ...document, id: "nfse", kind: "nfse", recipientName: "Outro modelo" }]} />);
    for (const label of ["Data emissão", "Nome", "Situação", "Valor (R$)", "Cliente do XML", "000017",
      "Enviar NF-es selecionadas", "Imprimir NF-es selecionadas", "Enviar notas pendentes", "Gerar PDF DANFE", "Exportar XML", "Informações"])
      expect(html).toContain(label);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('id="fiscal-list-filters"');
    expect(html).not.toContain("Outro modelo");
    expect(html).not.toContain("loja virtual");
    expect(html).not.toContain("Data de criação</button>");
    expect(html).toContain('disabled=""');
  });
  it("preserva separação das notas de serviço e exibe número final de NFS-e quando disponível", () => {
    const html = renderToStaticMarkup(<FiscalOutgoingDocuments {...props} fixedKind="nfse"
      documents={[document, { ...document, id: "nfse", kind: "nfse", number: "83", recipientName: "Cliente de serviços" }]} />);
    expect(html).toContain("Notas de serviço");
    expect(html).toContain("000083");
    expect(html).toContain("Gerar PDF DANFSe");
    expect(html).not.toContain("Cliente do XML");
  });
  it("limita a página a 25 notas, preservando a contagem e o total de todas as filtradas", () => {
    const html = renderToStaticMarkup(<FiscalOutgoingDocuments {...props} fixedKind="nfe"
      documents={Array.from({ length: 26 }, (_, i) => ({ ...document, id: String(i), number: String(i + 1) }))} />);
    expect(html.match(/aria-label="Selecionar documento /g)).toHaveLength(25);
    expect(html).toContain("de 26");
    expect(html).toContain(">Próxima</button>");
  });
});
