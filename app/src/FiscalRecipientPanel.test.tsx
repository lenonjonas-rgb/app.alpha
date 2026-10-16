import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FiscalRecipientPanel } from "./FiscalRecipientPanel";
import { FiscalAddressFields } from "./FiscalAddressFields";
import { addressFromForm, fiscalIssuerSchema } from "./fiscalPartySchema";
import { demoDatabase } from "./domain";

const address = { street: "RUA TESTE", number: "10", complement: "", district: "CENTRO", postalCode: "88010000",
  municipality: "4205407", city: "FLORIANOPOLIS", state: "SC" };
describe("dados fiscais de emitente e clientes", () => {
  it("renderiza endereço estruturado do emitente com município e UF do conector", () => {
    const html = renderToStaticMarkup(<FiscalAddressFields issuer />);
    expect(html).toContain('value="4205407"');
    expect(html).toContain("readOnly");
    expect(html).toContain('name="postalCode"');
    expect(html).toContain('value="SC"');
    expect(html).not.toContain('value="SP"');
  });
  it("converte todos os campos do formulário e permite ler emitente legado sem endereço", () => {
    const form = new FormData();
    Object.entries(address).forEach(([key, value]) => form.set(key, value));
    expect(addressFromForm(form)).toEqual(address);
    form.delete("street");
    expect(() => addressFromForm(form)).toThrow();
    expect(fiscalIssuerSchema.parse({ cnpj: "12345678000195", name: "LEGADO", ie: "123", im: "123" }).address).toBeUndefined();
  });
  it("sinaliza documento alterado e cliente ausente sem esconder registros", () => {
    const data = demoDatabase();
    const recipient = { clientId: data.clients[0].id, name: "CLIENTE FISCAL", document: "52998224725", address,
      ieIndicator: "9" as const, ie: "", im: "", finalConsumer: true, email: "", phone: "", updatedAt: "2026-10-15T20:00:00Z" };
    data.clients[0].document = "12345678000195";
    const html = renderToStaticMarkup(<FiscalRecipientPanel data={data} recipients={[recipient, { ...recipient, clientId: "missing" }]}
      busy={false} act={async () => {}} />);
    expect(html).toContain("documento alterado: reconferir");
    expect(html).toContain("cliente ausente");
    expect(html).toContain("4205407");
    expect(html).toContain("Conferir / editar cliente");
    expect(html).toContain("não são suportados");
  });
});
