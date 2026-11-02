import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { demoDatabase } from "./domain";
import { FiscalPanel } from "./FiscalPanel";
import { SalesPanel } from "./SalesPanel";

type SalesTab = NonNullable<ComponentProps<typeof SalesPanel>["initialTab"]>;

function renderSales(initialTab?: SalesTab) {
  return renderToStaticMarkup(
    <SalesPanel data={demoDatabase()} commit={() => {}} initialTab={initialTab}
      onCreateProposal={() => {}} onOpenProposal={() => {}} onEditProposal={() => {}} />,
  );
}

function salesNavigation(html: string) {
  return html.match(/<nav[^>]*aria-label="Vendas"[^>]*>(.*?)<\/nav>/)?.[1] ?? "";
}

describe("navegação de vendas", () => {
  it("ordena as abas e abre propostas comerciais por padrão", () => {
    const navigation = salesNavigation(renderSales());
    expect(navigation).toMatch(/Propostas comerciais.*Pedidos de venda.*Notas Fiscais de Saída.*Contratos.*Notas de Serviço.*Cobranças/);
    const active = navigation.match(/<button[^>]*aria-current="page"[^>]*>.*?<\/button>/)?.[0] ?? "";
    expect(active).toContain("Propostas comerciais");
  });

  it.each([
    ["nfe", "Notas fiscais de saída", "NF-e · Produtos", "NFS-e · Serviços", "Incluir nota fiscal"],
    ["nfse", "Notas de serviço", "NFS-e · Serviços", "NF-e · Produtos", "Incluir nota de serviço"],
  ] as const)("exibe somente a listagem de %s sem repetir o menu fiscal", (tab, title, context, otherContext, include) => {
    const html = renderSales(tab);
    expect(html).toContain(`<h2>${title}</h2>`);
    expect(html).toContain(context);
    expect(html).not.toContain(otherContext);
    expect(html).not.toContain('aria-label="Fiscal"');
    expect(html).toContain(include);
    expect(html).toContain("Configuração fiscal");
  });

  it("mantém retorno e acesso às ações fiscais nas telas de inclusão e configuração", () => {
    for (const [kind, view, title, otherAction] of [
      ["nfe", "issue", "Incluir nota fiscal de saída", "Configuração fiscal"],
      ["nfse", "issue", "Incluir nota de serviço", "Configuração fiscal"],
      ["nfe", "settings", "Configuração fiscal", "Incluir nota fiscal"],
      ["nfse", "settings", "Configuração fiscal", "Incluir nota fiscal"],
    ] as const) {
      const html = renderToStaticMarkup(
        <FiscalPanel data={demoDatabase()} commit={() => {}} documentKind={kind} presentation="sales" initialView={view} />,
      );
      expect(html).toContain(`<h2>${title}</h2>`);
      expect(html).toContain("Voltar para notas");
      expect(html).toContain(otherAction);
      expect(html).not.toContain('aria-label="Fiscal"');
    }
  });

  it("preserva o menu fiscal no financeiro", () => {
    const html = renderToStaticMarkup(<FiscalPanel data={demoDatabase()} commit={() => {}} />);
    expect(html).toContain('aria-label="Fiscal"');
    expect(html).toContain("Configuração fiscal");
  });
});
