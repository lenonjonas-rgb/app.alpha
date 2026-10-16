import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { companySchema, type CompanyData, type Context } from "../src/auth.js";
import { InvoiceCalculation } from "../src/invoiceCalculation.js";
import { FiscalCatalog } from "../src/catalog.js";
import { FiscalParties } from "../src/parties.js";
import { FiscalMatrix } from "../src/matrix.js";
import { blingReferences } from "../src/rules.js";
import { productParameters, serviceParameters } from "./taxFixtures.js";
import { issuerFixture, fiscalAddress } from "./partyFixtures.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { CertificateVault } from "../src/certificate.js";
import { FiscalService } from "../src/service.js";
import { createApi } from "../src/api.js";
import { AppError } from "../src/errors.js";

export const calculationContext: Context = { tenant: "a", actor: "admin", role: "admin", token: "test" };
export function calculationFixture(store: Store) {
  const context = calculationContext;
  const rules = structuredClone(blingReferences).map((rule) => ({ ...rule, reviewed: true }));
  const company: CompanyData = {
    products: [{ id: "p", name: "Produto atual" }], services: [{ id: "s", name: "Serviço atual" }],
    clients: [{ id: "client", name: "Cliente", document: "52998224725", address: "Antigo" }],
    finance: { accounts: [], invoices: [
      { id: "products", clientId: "client", kind: "Produtos", amount: 90000, canceled: false,
        orders: [{ orderId: "order", code: "OS-1", amount: 90000, items: [{
          id: "item:p", source: "item", kind: "produto", referenceId: "p", name: "Produto faturado", quantity: 2, price: 50000,
          gross: 100000, itemDiscount: 1000, orderDiscount: 9000,
        }] }] },
      { id: "services", clientId: "client", kind: "Serviços", amount: 10000, canceled: false,
        orders: [{ orderId: "order", code: "OS-1", amount: 10000, items: [
          { id: "item:s", source: "item", kind: "servico", referenceId: "s", name: "Serviço faturado", quantity: 1, price: 8000,
            gross: 8000, itemDiscount: 0, orderDiscount: 0 },
          { id: "toll", source: "toll", kind: "servico", name: "Pedágio", quantity: 1, price: 2000,
            gross: 2000, itemDiscount: 0, orderDiscount: 0 },
        ] }] },
    ], entries: ["products", "services"].map((id) => ({
      id: `entry:${id}`, invoiceId: id, kind: "Receber", clientId: "client", party: "Cliente", amount: id === "products" ? 90000 : 10000,
      dueOn: "2026-11-20", issuedOn: "2026-10-15", paymentMethod: "Boleto", accountId: "bank", canceled: false, settlements: [],
    })) },
  };
  store.put(context.tenant, "settings", "issuer", issuerFixture);
  new FiscalParties(store).save(context, company, { clientId: "client", document: "52998224725", name: "Cliente fiscal",
    address: fiscalAddress, ieIndicator: "9", ie: "", im: "", finalConsumer: true, email: "", phone: "" });
  const catalog = new FiscalCatalog(store);
  catalog.save(context, company, rules, { referenceId: "p", ruleId: "bling-sale-reference", kind: "nfe",
    active: true, notes: "", unit: "UN", ncm: "84821010", origin: "0" });
  const serviceRule = rules.find((rule) => rule.kind === "nfse")!;
  catalog.save(context, company, rules, { referenceId: "s", ruleId: serviceRule.id, kind: "nfse",
    active: true, notes: "", nationalCode: "140101", municipalCode: "", nbs: "120029000" });
  for (const kind of ["nfe", "nfse"] as const) new FiscalMatrix(store).save(context, rules, {
    id: kind, kind, ruleId: rules.find((rule) => rule.kind === kind)!.id, name: `${kind} teste`, operation: "Operação fictícia de teste",
    validFrom: "2026-01-01", validUntil: "2026-12-31", destinationState: "SC", ieIndicator: "9", finalConsumer: true,
    active: true, reviewed: true, approval: "Revisão fictícia automatizada, não fiscal",
    parameters: kind === "nfe" ? productParameters : serviceParameters,
  });
  return { company, rules, context, request: { invoiceId: "products", date: "2026-10-15" } };
}
test("prepara por snapshots faturados, seleciona matriz revisada e persiste memória imutável/idempotente após reinício", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-invoice-calculation-"));
  let store = new Store(directory);
  try {
    const { company, context, rules, request } = calculationFixture(store);
    const parsed = companySchema.parse(company);
    assert.equal(parsed.finance.invoices[0]!.orders![0]!.items![0]!.name, "Produto faturado");
    let calculation = new InvoiceCalculation(store);
    const before = JSON.stringify(company);
    const saved = calculation.prepare(context, parsed, rules, request);
    assert.equal(saved.lines[0]!.item.quantity, 2);
    assert.equal(saved.lines[0]!.item.name, "Produto faturado");
    assert.equal(saved.lines[0]!.classification.kind, "nfe");
    assert.equal(saved.lines[0]!.matrix.id, "nfe");
    assert.equal(saved.totals.net, "900.00");
    assert.equal(saved.totals.ownTaxes, "228.88");
    assert.deepEqual(calculation.prepare(context, parsed, rules, request), saved);
    assert.equal(store.list(context.tenant, "invoiceCalculations").length, 1);
    assert.equal(store.documents(context.tenant).length, 0);
    assert.equal(JSON.stringify(company), before);
    store.db.close(); store = new Store(directory); calculation = new InvoiceCalculation(store);
    assert.deepEqual(calculation.get(context, saved.id), saved);
    assert.equal(calculation.list(context)[0]!.id, saved.id);
    assert.deepEqual(calculation.list({ ...context, tenant: "b" }), []);
    assert.deepEqual(calculation.prepare(context, parsed, rules, request), saved);
    company.finance.invoices[0]!.orders![0]!.items![0]!.name = "Outra composição";
    const revised = calculation.prepare(context, company, rules, request);
    assert.notEqual(revised.id, saved.id);
    assert.equal(calculation.get(context, saved.id).lines[0]!.item.name, "Produto faturado");
    assert.throws(() => calculation.get({ ...context, tenant: "b" }, saved.id), /não encontrada/);
  } finally { store.db.close(); await rm(directory, { recursive: true }); }
});
test("adicionais exigem classificação explícita; serviços não alteram cobrança nem duplicam pedágio", () => {
  const store = new Store(":memory:");
  try {
    const { company, context, rules, request } = calculationFixture(store);
    const calculation = new InvoiceCalculation(store);
    assert.throws(() => calculation.prepare(context, company, rules, { ...request, invoiceId: "services" }), /Classifique/);
    const saved = calculation.prepare(context, company, rules, { ...request, invoiceId: "services", additionalServiceId: "s" });
    assert.equal(saved.lines.length, 2);
    assert.equal(saved.totals.net, "100.00");
    assert.equal(saved.lines[1]!.item.source, "toll");
    assert.equal(saved.lines[1]!.classification.referenceId, "s");
    assert.equal(saved.totals.ownTaxes, "5.95");
    assert.equal(company.finance.entries[1]!.amount, 10000);
  } finally { store.db.close(); }
});
test("agrupa várias OS sem colidir IDs de itens e totaliza valores arredondados por item", () => {
  const store = new Store(":memory:");
  try {
    const { company, context, rules, request } = calculationFixture(store);
    const invoice = company.finance.invoices[0]!;
    const second = structuredClone(invoice.orders![0]!);
    second.orderId = "second-order"; second.code = "OS-2";
    invoice.orders!.push(second); invoice.amount *= 2;
    company.finance.entries[0]!.amount = invoice.amount;
    const saved = new InvoiceCalculation(store).prepare(context, company, rules, request);
    assert.equal(saved.lines.length, 2);
    assert.equal(saved.totals.net, "1800.00");
    assert.equal(saved.totals.ownTaxes, "457.76");
    assert.notEqual(saved.lines[0]!.calculation.items[0]!.id, saved.lines[1]!.calculation.items[0]!.id);
  } finally { store.db.close(); }
});
test("bloqueia snapshots ausentes/adulterados, totais, conta/cliente e itens de outro grupo", () => {
  const store = new Store(":memory:");
  try {
    const { company, context, rules, request } = calculationFixture(store);
    const calculation = new InvoiceCalculation(store);
    const bad = (mutate: (data: CompanyData) => void) => {
      const copy = structuredClone(company); mutate(copy);
      assert.throws(() => calculation.prepare(context, copy, rules, request));
    };
    bad((data) => { delete data.finance.invoices[0]!.orders; });
    bad((data) => { delete data.finance.invoices[0]!.orders![0]!.items; });
    bad((data) => { data.finance.invoices[0]!.orders![0]!.items![0]!.gross++; });
    bad((data) => { data.finance.invoices[0]!.orders![0]!.items![0]!.orderDiscount++; });
    bad((data) => { data.finance.invoices[0]!.orders![0]!.items![0]!.kind = "servico"; });
    bad((data) => {
      const item = data.finance.invoices[0]!.orders![0]!.items![0]!;
      item.orderDiscount = item.gross - item.itemDiscount;
      data.finance.invoices[0]!.orders![0]!.amount = 0;
      data.finance.invoices[0]!.amount = 0; data.finance.entries[0]!.amount = 0;
    });
    bad((data) => { data.finance.invoices[0]!.orders![0]!.items!.push(data.finance.invoices[0]!.orders![0]!.items![0]!); });
    bad((data) => { data.finance.invoices[0]!.canceled = true; });
    bad((data) => { data.finance.entries[0]!.amount++; });
    bad((data) => { data.clients[0]!.document = "11111111111"; });
    bad((data) => { data.products = []; });
    assert.throws(() => calculation.prepare({ ...context, tenant: "b" }, company, rules, request));
    assert.equal(store.list(context.tenant, "invoiceCalculations").length, 0);
  } finally { store.db.close(); }
});
test("bloqueia matriz pendente/vencida/alterada e classificação desatualizada antes de salvar memória", () => {
  const store = new Store(":memory:");
  try {
    const { company, context, rules, request } = calculationFixture(store);
    const calculation = new InvoiceCalculation(store);
    assert.throws(() => calculation.prepare(context, company, rules, { ...request, date: "2027-01-01" }), /Nenhuma matriz/);
    assert.throws(() => calculation.prepare(context, company, rules, { ...request, date: "2026-02-30" }));
    const changed = structuredClone(rules); changed[0]!.fields.NCM = "00000000";
    assert.throws(() => calculation.prepare(context, company, changed, request), /referência alterada/);
    new FiscalMatrix(store).save(context, changed, { ...new FiscalMatrix(store).list(context).find((item) => item.kind === "nfe")! });
    assert.throws(() => calculation.prepare(context, company, changed, request), /Classificação diverge/);
    const matrix = new FiscalMatrix(store).list(context).find((item) => item.kind === "nfe")!;
    new FiscalMatrix(store).save(context, rules, { ...matrix, reviewed: false });
    assert.throws(() => calculation.prepare(context, company, rules, request), /aprovação/);
    assert.equal(store.list(context.tenant, "invoiceCalculations").length, 0);
  } finally { store.db.close(); }
});
test("API calcula usando empresa canônica e permite recuperar memória somente autenticada na mesma empresa", async () => {
  const store = new Store(":memory:");
  const { company, context, rules, request } = calculationFixture(store);
  const service = new FiscalService(store, new CertificateVault(store, randomBytes(32)),
    { ready: async () => ({ nfe: false, nfse: false }), validate: async () => {} },
    { transmit: async () => { throw new Error("Não transmitir"); }, consult: async () => { throw new Error("Não consultar"); } }, false);
  for (const rule of rules) service.saveRule(context, rule);
  const server = createServer(createApi(service, {
    authenticate: async (header) => {
      if (header === "Bearer test") return context;
      if (header === "Bearer other") return { ...context, tenant: "other" };
      throw new AppError(401, "Sessão necessária.");
    }, company: async () => companySchema.parse(company),
  }, new Set()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, body?: unknown, token = "test") => fetch(base + path, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    assert.equal((await call("/invoices/calculate", request, "invalid")).status, 401);
    assert.equal((await call("/invoices/calculate", { ...request, items: [] })).status, 422);
    const response = await call("/invoices/calculate", request);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json() as { id: string; totals: { net: string } };
    assert.equal(result.totals.net, "900.00");
    assert.deepEqual(await (await call(`/invoice-calculations/${result.id}`)).json(), result);
    assert.equal((await call(`/invoice-calculations/${result.id}`, undefined, "other")).status, 404);
    assert.equal((await call(`/invoice-calculations/${result.id}`, undefined, "invalid")).status, 401);
    const status = await (await call("/status")).json() as { calculations: Array<{ id: string; lines?: unknown }> };
    assert.equal(status.calculations[0]!.id, result.id);
    assert.equal(status.calculations[0]!.lines, undefined);
    company.finance.invoices[0]!.canceled = true;
    assert.equal((await call("/invoices/calculate", request)).status, 422);
    assert.equal(store.documents(context.tenant).length, 0);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); store.db.close(); }
});
