import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { FiscalParties, recipientSchema } from "../src/parties.js";
import { addressSchema, validCpfCnpj } from "../src/identification.js";
import { FiscalService, issuerSchema } from "../src/service.js";
import { CertificateVault } from "../src/certificate.js";
import { Store } from "../src/store.js";
import type { CompanyData, Context } from "../src/auth.js";
import { fiscalAddress, issuerFixture } from "./partyFixtures.js";

const context: Context = { tenant: "company-a", actor: "owner-a", role: "owner", token: "fixture" };
const company: CompanyData = { clients: [{ id: "client", name: "Cliente", document: "529.982.247-25", address: "Endereço livre" }],
  finance: { accounts: [], entries: [], invoices: [] } };
const party = { clientId: "client", document: "52998224725", name: "CLIENTE TESTE", address: fiscalAddress,
  ieIndicator: "9", ie: "", im: "", finalConsumer: true, email: "", phone: "" };

test("documentos fiscais verificam CPF/CNPJ e recusam repetidos, letras, tamanho e DV inválidos", () => {
  for (const document of ["52998224725", "12345678000195", "11222333000181"]) assert.equal(validCpfCnpj(document), true);
  for (const document of ["11111111111", "00000000000000", "52998224724", "12345678000194", "", "1", "123456780001950", "AB345678000195"])
    assert.equal(validCpfCnpj(document), false);
});
test("endereços exigem estrutura nacional e município coerente com a UF", () => {
  assert.equal(addressSchema.parse(fiscalAddress).state, "SC");
  for (const address of [
    { ...fiscalAddress, street: " " }, { ...fiscalAddress, number: "" }, { ...fiscalAddress, postalCode: "88010-000" },
    { ...fiscalAddress, municipality: "420540" }, { ...fiscalAddress, state: "SP" }, { ...fiscalAddress, state: "XX" },
  ]) assert.throws(() => addressSchema.parse(address));
});
test("destinatário respeita indicador IE, documento e consumidor final sem presumir enquadramento", () => {
  assert.doesNotThrow(() => recipientSchema.parse(party));
  const business = { ...party, document: "12345678000195", finalConsumer: false };
  assert.doesNotThrow(() => recipientSchema.parse({ ...business, ieIndicator: "1", ie: "123456789" }));
  assert.doesNotThrow(() => recipientSchema.parse({ ...business, ieIndicator: "2" }));
  for (const input of [
    { ...party, ieIndicator: "1", ie: "1234" }, { ...party, finalConsumer: false },
    { ...business, ieIndicator: "1" }, { ...business, ieIndicator: "2", ie: "1234" },
    { ...party, ie: "ISENTO" }, { ...party, document: "52998224724" },
    { ...party, phone: "(48)99999" }, { ...party, email: "invalid" },
  ]) assert.throws(() => recipientSchema.parse(input));
});
test("destinatário confere cliente canônico, edita sem duplicar e rejeita documento alterado ou tenant sem cliente", () => {
  const store = new Store(":memory:");
  try {
    const parties = new FiscalParties(store);
    const saved = parties.save(context, company, party);
    assert.equal(saved.updatedBy, context.actor);
    parties.save(context, company, { ...party, name: "NOVO NOME FISCAL", phone: "48999999999" });
    assert.equal(parties.list(context).length, 1);
    assert.equal(parties.list(context)[0]!.name, "NOVO NOME FISCAL");
    assert.equal(company.clients[0]!.name, "Cliente");
    assert.throws(() => parties.save(context, company, { ...party, document: "12345678000195" }), /diferente/);
    assert.throws(() => parties.save(context, { ...company, clients: [] }, party), /não encontrado/);
    const changed = structuredClone(company); changed.clients[0]!.document = "12345678000195";
    assert.throws(() => parties.save(context, changed, party), /diferente/);
    assert.deepEqual(parties.list({ ...context, tenant: "company-b" }), []);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS total FROM audit").get()!.total, 2);
  } finally { store.db.close(); }
});
test("emitente exige CNPJ válido, endereço SC/Florianópolis e preserva o certificado correspondente", () => {
  assert.doesNotThrow(() => issuerSchema.parse(issuerFixture));
  for (const issuer of [{ ...issuerFixture, cnpj: party.document }, { ...issuerFixture, cnpj: "12345678000194" },
    { ...issuerFixture, address: undefined }, { ...issuerFixture, ie: "ISENTO" },
    { ...issuerFixture, address: { ...fiscalAddress, municipality: "4209102" } }])
    assert.throws(() => issuerSchema.parse(issuer));
  const store = new Store(":memory:");
  try {
    const vault = new CertificateVault(store, randomBytes(32));
    const service = new FiscalService(store, vault, { ready: async () => ({}), validate: async () => {} },
      { transmit: async () => { throw new Error("Não transmitir"); }, consult: async () => { throw new Error("Não consultar"); } }, false);
    store.put(context.tenant, "settings", "issuer", { cnpj: issuerFixture.cnpj, name: "LEGADO", ie: "123", im: "123" });
    service.saveProfile(context, issuerFixture);
    assert.deepEqual(service.profile(context)?.address, fiscalAddress);
    vault.metadata = () => ({ cnpj: "11222333000181", subject: "", expiresAt: "", fingerprint: "" });
    assert.throws(() => service.saveProfile(context, issuerFixture), /certificado/);
  } finally { store.db.close(); }
});
test("destinatários e endereços persistem ao reiniciar e mantêm isolamento", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-parties-test-"));
  let store = new Store(directory);
  try {
    new FiscalParties(store).save(context, company, party);
    store.db.close(); store = new Store(directory);
    assert.deepEqual(new FiscalParties(store).list(context)[0]!.address, fiscalAddress);
    assert.deepEqual(new FiscalParties(store).list({ ...context, tenant: "company-b" }), []);
  } finally { store.db.close(); await rm(directory, { recursive: true }); }
});
