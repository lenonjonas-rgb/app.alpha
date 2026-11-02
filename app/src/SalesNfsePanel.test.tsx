import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase } from "./domain";
import { NfseEditor } from "./NfseEditor";
import { SalesNfsePanel } from "./SalesNfsePanel";
import { blankNfse, nfseRecipientFromClient } from "./serviceInvoices";
import { NfseTaxSetManager } from "./NfseTaxSetManager";

function sample() {
  const data = demoDatabase();
  const nfse = blankNfse(data);
  return { data, nfse: { ...nfse, recipient: nfseRecipientFromClient(data.clients[0]),
    service: { ...nfse.service, description: "Manutenção", amount: 100000 },
    taxes: { ...nfse.taxes, retainInss: true, retainFederal: true } } };
}

describe("tela de notas de serviço", () => {
  it("lista as notas com situação, valor líquido e menu de ações", () => {
    const { data, nfse } = sample();
    const html = renderToStaticMarkup(<SalesNfsePanel data={{ ...data, serviceInvoices: [nfse] }} commit={() => {}} />);
    expect(html).toContain("<h2>Notas de serviço</h2>");
    expect(html).toContain("000001");
    expect(html).toContain(data.clients[0].name);
    expect(html).toContain("843,50");
    expect(html).toContain(`aria-label="Ações da nota de serviço 000001"`);
    expect(html).toContain("Incluir nota de serviço");
    expect(html).toContain("Configuração fiscal");
  });

  it("mostra todas as seções do editor com a tabela de retenções", () => {
    const { data, nfse } = sample();
    const html = renderToStaticMarkup(<NfseEditor data={data} initial={nfse} onSave={() => undefined} onSaveTaxSet={() => undefined} onCancel={() => {}} />);
    for (const section of ["Dados gerais", "Cliente", "Serviços", "Impostos", "Totais", "Vendedor", "Pagamento", "Informações complementares"])
      expect(html).toContain(section);
    for (const label of ["Número RPS", "Compra governamental", "UF da prestação", "NBS", "Reter ISS", "Descontar ISS do total", "Reter INSS (11%)"])
      expect(html).toContain(label);
    expect(html).toContain("Total impostos");
    expect(html).toContain("156,50");
    expect(html).toContain("Gerar parcelas");
    expect(html).toContain("Conjunto de tributações");
    expect(html).toContain("Gerenciar tributos");
    expect(html).toContain("Outro código / valor existente");
  });

  it("preserva indicadores e classificações antigos no editor e oferece cadastro separado", () => {
    const { data, nfse } = sample();
    const legacy = { ...nfse, service: { ...nfse.service, taxSet: "14.01", operationIndicator: "050104", cst: "999", classification: "antiga" } };
    const html = renderToStaticMarkup(<NfseEditor data={data} initial={legacy} onSave={() => undefined} onSaveTaxSet={() => undefined} onCancel={() => {}} />);
    expect(html).toContain('value="14.01"');
    expect(html).toContain('value="050104"');
    expect(html).toContain('value="999"');
    expect(html).toContain('value="antiga"');
    const manager = renderToStaticMarkup(<NfseTaxSetManager sets={[]} onSave={() => undefined} onClose={() => {}} />);
    expect(manager).toContain("Nenhum conjunto cadastrado");
    expect(manager).toContain("não alteram o cadastro fiscal avançado");
    expect(manager).toContain("Informe inclusive quando for zero");
  });
});
