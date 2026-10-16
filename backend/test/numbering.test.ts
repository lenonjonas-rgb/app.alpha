import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";
import { Store } from "../src/store.js";
import { FiscalNumbering } from "../src/numbering.js";
import type { Context } from "../src/auth.js";

const cnpj = "12345678000195";
const context: Context = { tenant: "a", actor: "owner", role: "owner", token: "test" };
const config = { environment: "homologacao" as const, series: 1, nextNumber: 1, expectedNextNumber: null, confirmation: true };
function document(number: number, invoiceId = `invoice-${number}`, series = 1, issuer = cnpj) {
  return { kind: "nfe" as const, environment: "homologacao" as const, invoiceId, xml: "<test/>",
    key: `NFe422610${issuer}55${String(series).padStart(3, "0")}${String(number).padStart(9, "0")}1123456780` };
}
test("configuração exige Master, confirmação, séries normais e CAS; contador nunca retrocede", () => {
  const store = new Store(":memory:");
  try {
    const numbering = new FiscalNumbering(store);
    assert.throws(() => numbering.configure({ ...context, role: "admin" }, cnpj, config), /Somente Master/);
    for (const invalid of [{ ...config, series: 890 }, { ...config, nextNumber: 0 }, { ...config, confirmation: false },
      { ...config, nextNumber: 1.5 }, { ...config, series: -1 }])
      assert.throws(() => numbering.configure(context, cnpj, invalid));
    numbering.configure(context, cnpj, config);
    assert.throws(() => numbering.configure(context, cnpj, config), /Atualize/);
    numbering.configure(context, cnpj, { ...config, expectedNextNumber: 1, nextNumber: 10 });
    assert.throws(() => numbering.configure(context, cnpj, { ...config, expectedNextNumber: 10, nextNumber: 9 }), /reduzir/);
    assert.equal(numbering.list(context, cnpj)[0]!.nextNumber, 10);
  } finally { store.db.close(); }
});
test("documento e consumo são atômicos; duplicidade, número divergente e falhas não deixam efeito parcial", () => {
  const store = new Store(":memory:");
  try {
    const numbering = new FiscalNumbering(store);
    assert.throws(() => numbering.createDocument(context, document(1)), /Configure/);
    assert.equal(store.documents(context.tenant).length, 0);
    numbering.configure(context, cnpj, config);
    assert.throws(() => numbering.createDocument(context, document(2)), /diferente/);
    assert.equal(store.documents(context.tenant).length, 0);
    const first = numbering.createDocument(context, document(1));
    assert.equal(numbering.list(context, cnpj)[0]!.nextNumber, 2);
    assert.equal(numbering.reservations(context, cnpj)[0]!.documentId, first.id);
    assert.throws(() => numbering.createDocument(context, document(2, first.invoiceId)), /ativo/);
    assert.equal(numbering.list(context, cnpj)[0]!.nextNumber, 2);
    store.saveDocument(context.tenant, { ...first, status: "cancelado" });
    assert.throws(() => numbering.createDocument(context, document(1, "another")), /já foi utilizado/);
    const second = numbering.createDocument(context, document(2, first.invoiceId));
    assert.equal(second.status, "rascunho");
    assert.equal(numbering.list(context, cnpj)[0]!.nextNumber, 3);
    const auditCount = store.db.prepare("SELECT count(*) AS count FROM audit").get()!.count;
    store.db.exec("CREATE TRIGGER fail_number BEFORE INSERT ON records WHEN NEW.collection='nfeNumbers' BEGIN SELECT RAISE(ABORT,'forced failure'); END");
    assert.throws(() => numbering.createDocument(context, document(3)), /forced failure/);
    assert.equal(numbering.list(context, cnpj)[0]!.nextNumber, 3);
    assert.equal(store.documents(context.tenant).length, 2);
    assert.equal(numbering.reservations(context, cnpj).length, 2);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM audit").get()!.count, auditCount);
  } finally { store.db.close(); }
});
test("histórico anterior, inclusive descartado, impede configurar número já usado; escopos são isolados", () => {
  const store = new Store(":memory:");
  try {
    const numbering = new FiscalNumbering(store);
    const legacy = store.createDocument(context.tenant, document(30));
    store.saveDocument(context.tenant, { ...legacy, status: "cancelado" });
    assert.throws(() => numbering.configure(context, cnpj, { ...config, nextNumber: 30 }), /superar/);
    numbering.configure(context, cnpj, { ...config, nextNumber: 31 });
    numbering.configure(context, cnpj, { ...config, environment: "producao" });
    numbering.configure(context, cnpj, { ...config, series: 2 });
    numbering.configure({ ...context, tenant: "b" }, cnpj, config);
    numbering.configure(context, "98765432000198", config);
    assert.equal(numbering.list(context, cnpj).length, 3);
    assert.equal(numbering.list({ ...context, tenant: "b" }, cnpj)[0]!.nextNumber, 1);
    assert.equal(numbering.list(context, "98765432000198")[0]!.nextNumber, 1);
  } finally { store.db.close(); }
});
test("último número persiste após reinício e esgotamento bloqueia novas reservas sem voltar a um", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-numbering-"));
  let store = new Store(directory);
  try {
    let numbering = new FiscalNumbering(store);
    numbering.configure(context, cnpj, { ...config, nextNumber: 999999999 });
    numbering.createDocument(context, document(999999999));
    store.db.close(); store = new Store(directory); numbering = new FiscalNumbering(store);
    assert.equal(numbering.list(context, cnpj)[0]!.nextNumber, 1000000000);
    assert.equal(numbering.reservations(context, cnpj)[0]!.number, 999999999);
    assert.throws(() => numbering.configure(context, cnpj, { ...config, expectedNextNumber: 1000000000, nextNumber: 1 }), /reduzir/);
    assert.throws(() => numbering.createDocument(context, document(1)), /diferente/);
  } finally { store.db.close(); await rm(directory, { recursive: true }); }
});
test("duas conexões concorrentes disputam o mesmo número; somente uma persiste", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-numbering-concurrent-"));
  const store = new Store(directory);
  try {
    new FiscalNumbering(store).configure(context, cnpj, config);
    const source = `
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { register } = await import('tsx/esm/api');
        register();
        const { Store } = await import(workerData.storeUrl);
        const { FiscalNumbering } = await import(workerData.numberingUrl);
        const store = new Store(workerData.directory);
        try {
          new FiscalNumbering(store).createDocument(workerData.context, workerData.document);
          parentPort.postMessage('saved');
        } catch(error) { parentPort.postMessage(error.message); }
        finally { store.db.close(); }
      })().catch(error => { throw error; });
    `;
    const run = (invoiceId: string) => new Promise<string>((resolve, reject) => {
      let result: string | undefined;
      const worker = new Worker(source, { eval: true, workerData: { directory, context, document: document(1, invoiceId),
        storeUrl: new URL("../src/store.ts", import.meta.url).href,
        numberingUrl: new URL("../src/numbering.ts", import.meta.url).href } });
      worker.once("message", (message: string) => { result = message; }); worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0 || result === undefined) reject(new Error(`Worker exited ${code} without a valid result`));
        else resolve(result);
      });
    });
    const results = await Promise.all([run("one"), run("two")]);
    assert.equal(results.filter((result) => result === "saved").length, 1);
    assert.equal(store.documents(context.tenant).length, 1);
    assert.equal(new FiscalNumbering(store).list(context, cnpj)[0]!.nextNumber, 2);
  } finally { store.db.close(); await rm(directory, { recursive: true }); }
});
