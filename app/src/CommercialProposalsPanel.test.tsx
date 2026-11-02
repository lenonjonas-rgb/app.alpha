import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { changeQuoteStatus, demoDatabase } from "./domain";
import { EditorModal } from "./Forms";
import { QuoteTable } from "./QuoteTable";
import { SalesPanel } from "./SalesPanel";
import { quoteApprovalActor } from "./userAccess";

describe("propostas comerciais em Vendas", () => {
  it("exibe os mesmos orçamentos e mantém pedidos e documentos fiscais na navegação", () => {
    const data = demoDatabase();
    const html = renderToStaticMarkup(
      <SalesPanel data={data} commit={() => {}} initialTab="proposals"
        onCreateProposal={() => {}} onOpenProposal={() => {}} onEditProposal={() => {}} />,
    );
    expect(html).toContain("Propostas comerciais");
    expect(html).toContain("Nova proposta");
    expect(html).toContain("Propostas e orçamentos são os mesmos registros");
    expect(html).toContain(data.quotes[0].code);
    expect(html).toContain(data.clients[0].name);
    expect(html).toContain("Pedidos de venda");
    expect(html).toContain("Notas Fiscais de Saída");
    expect(html).toContain("Notas de Serviço");
  });

  it("usa o mesmo editor de orçamento com título apropriado à origem", () => {
    const data = demoDatabase();
    const renderEditor = (presentation?: "proposal") => renderToStaticMarkup(
      <EditorModal editor={{ kind: "quote", presentation }} data={data} commit={() => {}}
        draftScope="" onClose={() => {}} onSuccess={() => {}} />,
    );
    const proposal = renderEditor("proposal");
    expect(proposal).toContain("Nova proposta comercial");
    expect(proposal).toContain("Cliente");
    expect(proposal).toContain("Validade");
    expect(proposal).toContain("Produto ou serviço");
    expect(renderEditor()).toContain("Novo orçamento");
  });

  it("apresenta o mesmo orçamento nas duas listas e bloqueia edição após aprovação", () => {
    const data = demoDatabase();
    data.quotes[0].status = "Aprovado";
    const renderList = (presentation: "quote" | "proposal") => renderToStaticMarkup(
      <QuoteTable data={data} quotes={data.quotes} presentation={presentation} onOpen={() => {}} onEdit={() => {}} />,
    );
    const quotes = renderList("quote");
    const proposals = renderList("proposal");
    expect(quotes).toContain(data.quotes[0].code);
    expect(proposals).toContain(data.quotes[0].code);
    expect(quotes).toContain("Orçamento aprovado: termos comerciais bloqueados");
    expect(proposals).toContain("Proposta aprovada: termos comerciais bloqueados");
    expect(proposals).toContain("disabled");
  });

  it("registra uma identidade válida ao aprovar proposta no ambiente local", () => {
    const data = demoDatabase();
    const approved = changeQuoteStatus(data, data.quotes[0].id, "Aprovado", quoteApprovalActor(null, ""));
    expect(approved.quotes[0].approval).toMatchObject({ approverUserId: "local", approverName: "Usuário local" });
    expect(quoteApprovalActor("user-1", "")).toEqual({ userId: "user-1", name: "user-1" });
    expect(quoteApprovalActor("user-1", " Operador ")).toEqual({ userId: "user-1", name: "Operador" });
  });
});
