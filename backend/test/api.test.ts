import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { Store } from "../src/store.js";
import { CertificateVault } from "../src/certificate.js";
import { FiscalService } from "../src/service.js";
import { createApi } from "../src/api.js";
import { AppError } from "../src/errors.js";
import type { Context, CompanyData } from "../src/auth.js";
import { fiscalAddress, issuerFixture } from "./partyFixtures.js";
import { productParameters } from "./taxFixtures.js";
import { authorizedNfe } from "./collectionFixtures.js";
import { unzipSync, strFromU8 } from "fflate";

test("API exige sessão/origem, valida banco canônico, persiste remessa e devolve o mesmo arquivo sem duplicar", async () => {
  const store = new Store(":memory:");
  const context: Context = { tenant: "company-a", actor: "admin-a", role: "admin", token: "fixture" };
  const company: CompanyData = {
    products: [{ id: "product", name: "Rolamento" }], services: [{ id: "service", name: "Montagem" }],
    clients: [{ id: "client", name: "CLIENTE TESTE", document: "52998224725", address: "ENDERECO" }],
    finance: {
      accounts: [{ id: "bank", name: "ITAU", bank: "Itaú", agency: "1234", account: "12345-6", active: true }],
      invoices: [{ id: "invoice", clientId: "client", kind: "Produtos", amount: 10000, canceled: false }],
      entries: [{ id: "entry", invoiceId: "invoice", clientId: "client", kind: "Receber", party: "CLIENTE TESTE", amount: 10000,
        dueOn: "2026-11-20", issuedOn: "2026-10-15", paymentMethod: "Boleto", accountId: "bank", canceled: false, settlements: [] }],
    },
  };
  const service = new FiscalService(store, new CertificateVault(store, randomBytes(32)), { ready: async () => ({ nfe: false, nfse: false }), validate: async () => {} },
    { transmit: async () => { throw new Error("Rede fiscal não permitida no teste"); }, consult: async () => { throw new Error("Rede fiscal não permitida no teste"); } }, false);
  service.saveProfile(context, issuerFixture);
  const server = createServer(createApi(service, {
    authenticate: async (header) => {
      if (header === "Bearer owner") return { ...context, role: "owner" };
      if (header === "Bearer fixture") return context;
      if (header === "Bearer other") return { ...context, tenant: "company-b" };
      throw new AppError(401, "Autenticação necessária.");
    }, company: async () => structuredClone(company),
  }, new Set(["https://alpha.example"])));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, method = "GET", data?: unknown, token = "fixture") => fetch(base + path, {
    method, headers: { Origin: "https://alpha.example", Authorization: `Bearer ${token}`, ...(data ? { "Content-Type": "application/json" } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  try {
    assert.equal((await fetch(base + "/health")).status, 200);
    assert.equal((await call("/status", "GET", undefined, "invalid")).status, 401);
    assert.equal((await fetch(base + "/status", { headers: { Origin: "https://evil.example" } })).status, 403);
    assert.equal((await call("/certificate", "POST", { pfxBase64: "invalid", password: "never-log-this" })).status, 403);
    const numbering = { environment: "homologacao", series: 1, nextNumber: 20, expectedNextNumber: null, confirmation: true };
    assert.equal((await call("/numbering", "PUT", numbering)).status, 403);
    assert.equal((await call("/numbering", "PUT", numbering, "owner")).status, 200);
    assert.equal((await call("/numbering", "PUT", numbering, "owner")).status, 409);
    assert.equal((await call("/numbering", "PUT", { ...numbering, expectedNextNumber: 20, nextNumber: 19 }, "owner")).status, 409);
    const numberingStatus = await (await call("/status")).json() as { numbering: Array<{ nextNumber: number }>; numberReservations: unknown[] };
    assert.equal(numberingStatus.numbering[0]!.nextNumber, 20);
    assert.deepEqual(numberingStatus.numberReservations, []);
    const otherNumbering = await (await call("/status", "GET", undefined, "other")).json() as { numbering: unknown[] };
    assert.deepEqual(otherNumbering.numbering, []);
    const fiscalItem = { kind: "nfe", referenceId: "product", ruleId: "bling-sale-reference", unit: "UN", ncm: "84821010", origin: "0", active: true, notes: "" };
    assert.equal((await call("/catalog", "PUT", { ...fiscalItem, referenceId: "foreign-item" })).status, 422);
    assert.equal((await call("/catalog", "PUT", fiscalItem)).status, 200);
    const status = await (await call("/status")).json() as { catalog: Array<{ referenceId: string }>; rules: Array<{ reviewed: boolean }> };
    assert.equal(status.catalog[0]!.referenceId, "product");
    assert.ok(status.rules.every((rule) => !rule.reviewed));
    const otherStatus = await (await call("/status", "GET", undefined, "other")).json() as { catalog: unknown[] };
    assert.deepEqual(otherStatus.catalog, []);
    const recipient = { clientId: "client", document: "52998224725", name: "CLIENTE TESTE", address: fiscalAddress,
      ieIndicator: "9", ie: "", im: "", finalConsumer: true, email: "", phone: "" };
    assert.equal((await call("/recipients", "PUT", { ...recipient, clientId: "foreign-client" })).status, 422);
    assert.equal((await call("/recipients", "PUT", recipient)).status, 200);
    const withParty = await (await call("/status")).json() as { recipients: Array<{ document: string }>; issuer: { address: { municipality: string } } };
    assert.equal(withParty.recipients[0]!.document, recipient.document);
    assert.equal(withParty.issuer.address.municipality, "4205407");
    const otherParties = await (await call("/status", "GET", undefined, "other")).json() as { recipients: unknown[] };
    assert.deepEqual(otherParties.recipients, []);
    assert.equal((await call("/issuer", "PUT", { ...issuerFixture, address: { ...fiscalAddress, state: "SP" } })).status, 422);
    const matrix = { id: "matrix", kind: "nfe", name: "Referência SC", operation: "Operação interna de teste",
      ruleId: "bling-sale-reference", validFrom: "2026-01-01", validUntil: "2026-12-31", destinationState: "SC",
      ieIndicator: "9", finalConsumer: true, active: true, reviewed: false, approval: "", parameters: productParameters };
    assert.equal((await call("/matrices", "PUT", matrix)).status, 200);
    assert.equal((await call("/matrices", "PUT", { ...matrix, reviewed: true, approval: "Teste sem revisão real" })).status, 422);
    const withMatrix = await (await call("/status")).json() as { matrices: Array<{ reviewed: boolean; updatedAt: string; parameters: typeof productParameters }> };
    assert.equal(withMatrix.matrices[0]!.reviewed, false);
    assert.deepEqual(withMatrix.matrices[0]!.parameters, productParameters);
    const simulationInput = { matrixId: matrix.id, updatedAt: withMatrix.matrices[0]!.updatedAt,
      items: [{ id: "one", gross: "1000.00", discount: "100" }] };
    const simulated = await call("/matrices/simulate", "POST", simulationInput);
    assert.equal(simulated.status, 200);
    const preview = await simulated.json() as { simulation: boolean; result: { totals: { ownTaxes: string; afterWithholding: string } } };
    assert.equal(preview.simulation, true);
    assert.equal(preview.result.totals.ownTaxes, "228.88");
    assert.equal(preview.result.totals.afterWithholding, "900.00");
    assert.equal(service.store.documents(context.tenant).length, 0);
    assert.equal(company.finance.invoices[0]!.amount, 10000);
    assert.equal(company.finance.entries[0]!.amount, 10000);
    assert.equal((await call("/matrices/simulate", "POST", simulationInput, "other")).status, 404);
    assert.equal((await call("/matrices/simulate", "POST", { ...simulationInput, updatedAt: "stale" })).status, 409);
    assert.equal((await call("/matrices/simulate", "POST", { ...simulationInput, items: [{ id: "one", gross: "1", discount: "2" }] })).status, 422);
    const changedParameters = { ...productParameters, icms: { cst: "00", rate: "18", basePercent: "80" } };
    assert.equal((await call("/matrices", "PUT", { ...matrix, parameters: changedParameters })).status, 200);
    const editedMatrix = await (await call("/status")).json() as { matrices: Array<{ updatedAt: string; parameters: typeof changedParameters }> };
    assert.equal(editedMatrix.matrices.length, 1);
    assert.deepEqual(editedMatrix.matrices[0]!.parameters, changedParameters);
    assert.equal((await call("/matrices/simulate", "POST", simulationInput)).status, 409);
    assert.equal((await call("/matrices/simulate", "POST", { ...simulationInput, updatedAt: editedMatrix.matrices[0]!.updatedAt })).status, 422);
    assert.equal((await call("/matrices", "PUT", { ...matrix, parameters: { ...changedParameters, icms: { cst: "00", rate: "101", basePercent: "80" } } })).status, 422);
    const otherMatrix = await (await call("/status", "GET", undefined, "other")).json() as { matrices: unknown[] };
    assert.deepEqual(otherMatrix.matrices, []);
    const config = { accountId: "bank", agencia: "1234", conta: "12345", dac: "6", carteira: "109", codigoCarteira: "I",
      primeiroNossoNumero: "00000001", sequenciaInicialArquivo: 1 };
    assert.equal((await call("/remittances/config", "PUT", { ...config, conta: "99999" })).status, 422);
    assert.equal((await call("/remittances/config", "PUT", config)).status, 200);
    const saved = await (await call("/remittances/config?accountId=bank")).json() as { nextNossoNumero: number };
    assert.equal(saved.nextNossoNumero, 1);
    const input = { accountId: "bank", entryIds: ["entry"], addresses: { client: { logradouro: "RUA TESTE 1", bairro: "CENTRO", cep: "88010000", cidade: "FLORIANOPOLIS", uf: "SC" } } };
    const blocked = await call("/remittances", "POST", input);
    assert.equal(blocked.status, 409);
    assert.equal((await (await call("/remittances/config?accountId=bank")).json() as { nextNossoNumero: number }).nextNossoNumero, 1);
    const fiscalDocument = authorizedNfe(store, context, company, "invoice");
    const fiscalStatus = await (await call("/status")).json() as {
      documents: Array<{ id: string; issuedAt: string; number: string; amount: number; xml?: string }>;
    };
    assert.equal(fiscalStatus.documents[0]!.issuedAt, "2026-10-15T12:00:00-03:00");
    assert.equal(fiscalStatus.documents[0]!.number, "1");
    assert.equal(fiscalStatus.documents[0]!.amount, 10000);
    assert.equal(fiscalStatus.documents[0]!.xml, undefined);
    assert.deepEqual((await (await call("/status", "GET", undefined, "other")).json() as { documents: unknown[] }).documents, []);
    const exportBody = { ids: [fiscalDocument.id], format: "xml" };
    const exported = await call("/documents/export", "POST", exportBody);
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get("content-type"), "application/zip");
    const exportedFiles = Object.entries(unzipSync(new Uint8Array(await exported.arrayBuffer())));
    assert.equal(exportedFiles.length, 1);
    assert.ok(exportedFiles[0]![0].includes("producao"));
    assert.equal(strFromU8(exportedFiles[0]![1]), fiscalDocument.artifact);
    assert.equal((await call("/documents/export", "POST", exportBody, "invalid")).status, 401);
    assert.equal((await call("/documents/export", "POST", exportBody, "other")).status, 404);
    assert.equal((await call("/documents/export", "POST", { ...exportBody, ids: [] })).status, 422);
    assert.equal((await call("/documents/export", "POST", { ...exportBody, ids: [fiscalDocument.id, fiscalDocument.id] })).status, 422);
    assert.equal((await call("/documents/export", "POST", { ...exportBody, ids: Array(51).fill(fiscalDocument.id) })).status, 422);
    store.saveDocument(context.tenant, { ...fiscalDocument, status: "incerto" });
    for (const format of ["pdf", "print"]) {
      const blockedExport = await call("/documents/export", "POST", { ...exportBody, format });
      assert.equal(blockedExport.status, 409);
      assert.equal(blockedExport.headers.get("content-type"), "application/json; charset=utf-8");
    }
    store.saveDocument(context.tenant, fiscalDocument);
    const created = await call("/remittances", "POST", input);
    assert.equal(created.status, 201, await created.clone().text());
    const record = await created.json() as { id: string; file?: string };
    assert.equal(record.file, undefined);
    const first = await call(`/remittances/${record.id}/file`);
    const file = await first.text();
    assert.match(first.headers.get("content-disposition")!, /ITAU-000001\.REM/);
    assert.equal(file, await (await call(`/remittances/${record.id}/file`)).text());
    assert.ok(file.endsWith("\r\n"));
    assert.ok(file.trimEnd().split("\r\n").every((line) => line.length === 400));
    assert.equal((await call("/remittances", "POST", input)).status, 409);
    const history = await (await call("/remittances")).json() as Array<{ file?: string }>;
    assert.equal(history.length, 1);
    assert.equal(history[0]!.file, undefined);
    assert.deepEqual(await (await call("/remittances", "GET", undefined, "other")).json(), []);
    assert.equal((await call(`/remittances/${record.id}/file`, "GET", undefined, "other")).status, 404);
    company.finance.accounts[0]!.active = false;
    assert.equal((await call("/remittances", "POST", input)).status, 422);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.db.close();
  }
});
