import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../src/errors.js";
import { RemittanceService } from "../src/remittance.js";
import type { CompanyData, Context } from "../src/auth.js";
import { Store } from "../src/store.js";
import { authorizedNfe, authorizedNfse } from "./collectionFixtures.js";

const context: Context = { tenant: "tenant-a", actor: "actor-a", role: "admin", token: "not-used" };
const configInput = {
  accountId: "account-1",
  agencia: "1234",
  conta: "56789",
  dac: "0",
  carteira: "109",
  codigoCarteira: "I",
  primeiroNossoNumero: "00001234",
  sequenciaInicialArquivo: 17,
};

function setup(withNotes = true) {
  const store = new Store(":memory:");
  const service = new RemittanceService(store);
  store.put(context.tenant, "settings", "issuer", {
    cnpj: "11222333000181", name: "Empresa Árvore",
  });
  service.saveConfig(context, configInput);
  if (withNotes) {
    const data = company();
    authorizedNfe(store, context, data, "invoice-product");
    authorizedNfse(store, context, data, "invoice-service");
  }
  return { store, service };
}

function company(overrides: Partial<CompanyData> = {}): CompanyData {
  return {
    services: [{ id: "service-fixture", name: "Servico" }],
    clients: [
      { id: "client-cpf", name: "João da Silva", document: "529.982.247-25", address: "ignorado" },
      { id: "client-cnpj", name: "Oficina Ltda", document: "11.222.333/0001-81", address: "ignorado" },
    ],
    finance: {
      invoices: [
        { id: "invoice-product", clientId: "client-cpf", kind: "Produtos", amount: 12345, canceled: false },
        { id: "invoice-service", clientId: "client-cnpj", kind: "Serviços", amount: 900, canceled: false,
          orders: [{ orderId: "order-invoice-service", code: "OS1", amount: 900, items: [{
            id: "line", source: "item", kind: "servico", referenceId: "service-fixture", name: "Servico",
            quantity: 1, price: 900, gross: 900, itemDiscount: 0, orderDiscount: 0,
          }] }] },
      ],
      entries: [
        {
          id: "entry-product", invoiceId: "invoice-product", kind: "Receber", clientId: "client-cpf", party: "ignored",
          amount: 12345, dueOn: "2026-11-30", issuedOn: "2026-10-01", paymentMethod: "Boleto",
          accountId: "account-1", canceled: false, settlements: [],
        },
        {
          id: "entry-service", invoiceId: "invoice-service", kind: "Receber", clientId: "client-cnpj", party: "ignored",
          amount: 900, dueOn: "2026-12-01", issuedOn: "2026-10-02", paymentMethod: "Boleto",
          accountId: "account-1", canceled: false, settlements: [],
        },
        {
          id: "entry-pix", kind: "Receber", clientId: "client-cpf", party: "ignored",
          amount: 100, dueOn: "2026-12-01", issuedOn: "2026-10-02", paymentMethod: "Pix",
          accountId: "account-1", canceled: false, settlements: [],
        },
        {
          id: "entry-payable", kind: "Pagar", clientId: "client-cpf", party: "ignored",
          amount: 100, dueOn: "2026-12-01", issuedOn: "2026-10-02", paymentMethod: "Boleto",
          accountId: "account-1", canceled: false, settlements: [],
        },
        {
          id: "entry-other-account", kind: "Receber", clientId: "client-cpf", party: "ignored",
          amount: 100, dueOn: "2026-12-01", issuedOn: "2026-10-02", paymentMethod: "Boleto",
          accountId: "another-account", canceled: false, settlements: [],
        },
      ],
    },
    ...overrides,
  };
}

const addresses = {
  "client-cpf": { logradouro: "Rua São João, 12", bairro: "Centro", cep: "88010000", cidade: "Florianópolis", uf: "sc" },
  "client-cnpj": { logradouro: "Avenida Brasil, 10", bairro: "Trindade", cep: "88036000", cidade: "São José", uf: "SC" },
};

function create(service: RemittanceService, data = company(), entryIds = ["entry-product", "entry-service"]) {
  return service.create(context, data, { accountId: "account-1", entryIds, addresses });
}

test("nenhum título sem nota autorizada em produção entra, inclusive serviço sem retenção e lote misto", () => {
  const { store, service } = setup(false);
  try {
    const data = company();
    assert.throws(() => create(service, data, ["entry-product"]), /NF-e autorizada em produção/);
    assert.throws(() => create(service, data, ["entry-service"]), /NFS-e autorizada em produção/);
    const product = authorizedNfe(store, context, data, "invoice-product");
    assert.throws(() => create(service, data), /NFS-e autorizada em produção/);
    assert.equal(service.config(context, "account-1")!.nextNossoNumero, 1234);
    assert.equal(service.config(context, "account-1")!.nextFileSequence, 17);
    assert.equal(service.list(context).length, 0);
    store.saveDocument(context.tenant, { ...product, status: "cancelado" });
    assert.throws(() => create(service, data, ["entry-product"]), /NF-e autorizada em produção/);
  } finally { store.db.close(); }
});

test("gera CNAB400 base com posições, registros ASCII, centavos e contadores", () => {
  const { store, service } = setup();
  const remittance = create(service);
  const lines = remittance.file.split("\r\n");
  assert.equal(lines.at(-1), "");
  const records = lines.slice(0, -1);
  assert.equal(records.length, 4);
  assert.ok(records.every((record) => Buffer.byteLength(record, "ascii") === 400));
  assert.equal(remittance.file.endsWith("\r\n"), true);

  const [header, product, serviceDetail, trailer] = records as [string, string, string, string];
  assert.equal(header.slice(0, 11), "01REMESSA01");
  assert.equal(header.slice(11, 26), "COBRANCA".padEnd(15));
  assert.equal(header.slice(26, 30), "1234");
  assert.equal(header.slice(46, 76), "EMPRESA ARVORE".padEnd(30));
  assert.equal(header.slice(76, 79), "341");
  assert.equal(header.slice(79, 94), "BANCO ITAU SA  ");
  assert.equal(header.slice(394), "000001");

  assert.equal(product[0], "1");
  assert.equal(product.slice(1, 3), "02");
  assert.equal(product.slice(3, 17), "11222333000181");
  assert.equal(product.slice(17, 21), "1234");
  assert.equal(product.slice(23, 28), "56789");
  assert.equal(product.slice(62, 70), "00001234");
  assert.equal(product.slice(83, 86), "109");
  assert.equal(product[107], "I");
  assert.equal(product.slice(108, 110), "01");
  assert.match(product.slice(110, 120), /^R[A-F0-9]{9}$/);
  assert.equal(product.slice(120, 126), "301126");
  assert.equal(product.slice(126, 139), "0000000012345");
  assert.equal(product.slice(139, 142), "341");
  assert.equal(product.slice(147, 149), "01");
  assert.equal(product[149], "N");
  assert.equal(product.slice(150, 156), "011026");
  assert.equal(product.slice(218, 220), "01");
  assert.equal(product.slice(220, 234), "00052998224725");
  assert.equal(product.slice(234, 264), "JOAO DA SILVA".padEnd(30));
  assert.equal(product.slice(274, 314), "RUA SAO JOAO, 12".padEnd(40));
  assert.equal(product.slice(326, 334), "88010000");
  assert.equal(product.slice(349, 351), "SC");
  assert.equal(product.slice(394), "000002");

  assert.equal(serviceDetail.slice(147, 149), "08");
  assert.equal(serviceDetail.slice(218, 220), "02");
  assert.equal(serviceDetail.slice(220, 234), "11222333000181");
  assert.equal(serviceDetail.slice(126, 139), "0000000000900");
  assert.equal(serviceDetail.slice(394), "000003");
  assert.equal(trailer[0], "9");
  assert.equal(trailer.slice(394), "000004");

  assert.deepEqual(remittance.entryIds, ["entry-product", "entry-service"]);
  assert.deepEqual(remittance.entries.map((item) => [item.fiscalKind, item.amount]), [["nfe", 12345], ["nfse", 900]]);
  for (const item of remittance.entries) {
    assert.ok(item.fiscalDocumentId);
    assert.match(item.fiscalCheckId!, /^[a-f0-9]{64}$/);
    assert.equal(item.fiscalAccessKey!.length, item.fiscalKind === "nfe" ? 44 : 50);
  }
  assert.equal(remittance.entries[0]!.fiscalProtocol, "142260000000001");
  assert.equal(remittance.entries[1]!.nfseCheckId, remittance.entries[1]!.fiscalCheckId);
  assert.equal(remittance.fileSequence, 17);
  assert.equal(service.download(context, remittance.id).file, remittance.file);
  assert.equal(service.config(context, "account-1")?.nextNossoNumero, 1236);
  assert.equal(service.config(context, "account-1")?.nextFileSequence, 18);
  assert.equal(store.list(context.tenant, "remittances").length, 1);
});

test("remessa recusa retenções conciliadas sem enviar bruto ou líquido presumido ao banco", () => {
  const { store, service } = setup(false);
  try {
    const data = company();
    data.finance.entries[1]!.retention = { calculationId: "a".repeat(64), invoiceAmount: 900, withheld: 90, net: 810,
      irrf: 90, csll: 0, inss: 0, confirmedAt: "2026-10-15T12:00:00Z", confirmedBy: context.actor };
    assert.throws(() => create(service, data, ["entry-service"]), /NFS-e autorizada em produção/);
    assert.equal(service.list(context).length, 0);
    assert.equal(service.config(context, configInput.accountId)!.nextFileSequence, 17);
  } finally { store.db.close(); }
});

test("não cria parcialmente com baixa ativa, data inválida ou campos excedentes", () => {
  const { service } = setup();
  const initial = service.config(context, "account-1");
  const partiallySettled = company();
  partiallySettled.finance.entries[1]!.settlements.push({ amount: 1, reversed: false });
  assert.throws(() => create(service, partiallySettled), /baixa ativa/);
  const badDate = company();
  badDate.finance.entries[0]!.dueOn = "2026-02-30";
  assert.throws(() => create(service, badDate), /data válida/);
  const longAddress = {
    ...addresses,
    "client-cpf": { ...addresses["client-cpf"], logradouro: "R".repeat(41) },
  };
  assert.throws(() => service.create(context, company(), {
    accountId: "account-1", entryIds: ["entry-product", "entry-service"], addresses: longAddress,
  }), /<=40 characters/);
  assert.equal(service.list(context).length, 0);
  assert.equal(service.config(context, "account-1")?.nextNossoNumero, initial?.nextNossoNumero);
  assert.equal(service.config(context, "account-1")?.nextFileSequence, initial?.nextFileSequence);
});

test("bloqueia duplicidade, valor parcial, boleto repetido e IDs duplicados", () => {
  const { service } = setup();
  const data = company();
  data.finance.entries[0]!.settlements.push({ amount: 1, reversed: true });
  create(service, data, ["entry-product"]);
  assert.throws(() => create(service, company(), ["entry-product"]), /já consta de outra remessa/);

  const duplicateIds = company();
  duplicateIds.finance.entries.push({ ...duplicateIds.finance.entries[0]! });
  assert.throws(() => create(service, duplicateIds), /IDs de lançamentos duplicados/);
  assert.throws(() => service.saveConfig(context, { ...configInput, primeiroNossoNumero: "00001235" }), /não pode regredir/);
  assert.equal(service.list(context).length, 1);
});

test("cria remessas sucessivas de títulos distintos mantendo o título anterior aberto", () => {
  const { service } = setup();
  const data = company();
  const first = create(service, data, ["entry-product"]);
  const second = create(service, data, ["entry-service"]);
  assert.deepEqual(first.entryIds, ["entry-product"]);
  assert.deepEqual(second.entryIds, ["entry-service"]);
  assert.equal(first.fileSequence, 17);
  assert.equal(second.fileSequence, 18);
  assert.equal(service.config(context, "account-1")?.nextNossoNumero, 1236);
  assert.equal(service.config(context, "account-1")?.nextFileSequence, 19);
  assert.throws(() => create(service, data, ["entry-product"]), /já consta de outra remessa/);
  assert.equal(service.list(context).length, 2);
});

test("trocar ID da conta ou introduzir conta adicional não duplica cobrança do mesmo faturamento", () => {
  const { store, service } = setup();
  try {
    const data = company();
    create(service, data, ["entry-product"]);
    data.finance.entries[0]!.id = "replacement";
    assert.throws(() => create(service, data, ["replacement"]), /Faturamento já consta/);
    const duplicated = company();
    duplicated.finance.entries.push({ ...duplicated.finance.entries[1]!, id: "duplicate" });
    assert.throws(() => create(service, duplicated, ["entry-service", "duplicate"]), /única conta/);
    assert.equal(service.config(context, "account-1")!.nextNossoNumero, 1235);
    assert.equal(service.list(context).length, 1);
    assert.ok(store.documents(context.tenant).every((item) => item.status === "autorizado"));
  } finally { store.db.close(); }
});

test("serviço sem retenção exige produção, conferência atual e o mesmo emitente do cedente", () => {
  const { store, service } = setup();
  try {
    const data = company();
    const document = store.documents(context.tenant).find((item) => item.kind === "nfse")!;
    store.saveDocument(context.tenant, { ...document, environment: "homologacao" });
    assert.throws(() => create(service, data, ["entry-service"]), /homologação não libera/);
    store.saveDocument(context.tenant, document);
    data.finance.entries[1]!.dueOn = "2026-12-10";
    assert.throws(() => create(service, data, ["entry-service"]), /conferência explícita e atual/);
    data.finance.entries[1]!.dueOn = "2026-12-01";
    store.put(context.tenant, "settings", "issuer", { cnpj: "12345678000195", name: "Outro cedente" });
    assert.throws(() => create(service, data, ["entry-service"]), /Emitente da NFS-e diferente/);
    assert.equal(service.list(context).length, 0);
    assert.equal(service.config(context, "account-1")!.nextNossoNumero, 1234);
    assert.equal(service.config(context, "account-1")!.nextFileSequence, 17);
  } finally { store.db.close(); }
});

test("exige seleção única e rejeita qualquer título selecionado que não seja elegível", () => {
  const { service } = setup();
  const initial = service.config(context, "account-1");
  assert.throws(() => create(service, company(), []), /Too small/);
  assert.throws(() => create(service, company(), ["entry-product", "entry-product"]), /IDs de cobrança duplicados/);
  assert.throws(() => create(service, company(), ["missing-entry"]), /não encontrada/);
  assert.throws(() => create(service, company(), ["entry-pix"]), /não é um boleto ativo/);
  assert.throws(() => create(service, company(), ["entry-other-account"]), /outra conta/);
  const canceled = company();
  canceled.finance.entries[0]!.canceled = true;
  assert.throws(() => create(service, canceled, ["entry-product"]), /não é um boleto ativo/);
  const settled = company();
  settled.finance.entries[0]!.settlements.push({ amount: 1, reversed: false });
  assert.throws(() => create(service, settled, ["entry-product"]), /baixa ativa/);
  assert.equal(service.list(context).length, 0);
  assert.equal(service.config(context, "account-1")?.nextNossoNumero, initial?.nextNossoNumero);
  assert.equal(service.config(context, "account-1")?.nextFileSequence, initial?.nextFileSequence);
});

test("conta legada sem clientId exige origem preservada correspondente ao cliente da nota", () => {
  const { service } = setup();
  const data = company();
  delete data.finance.entries[0]!.clientId;
  assert.throws(() => create(service, data, ["entry-product"]), /origem comercial/);
  const { store, service: legacyService } = setup(false);
  authorizedNfe(store, context, data, "invoice-product");
  const remittance = create(legacyService, data, ["entry-product"]);
  assert.deepEqual(remittance.entryIds, ["entry-product"]);
});

test("configuração, remessas e download ficam isolados por tenant", () => {
  const { store, service } = setup();
  const remittance = create(service);
  const other: Context = { ...context, tenant: "tenant-b", actor: "actor-b" };
  store.put(other.tenant, "settings", "issuer", { cnpj: "11222333000181", name: "Outra Empresa" });
  assert.equal(service.config(other, "account-1"), null);
  assert.equal(service.list(other).length, 0);
  assert.throws(() => service.download(other, remittance.id), (error: unknown) =>
    error instanceof AppError && error.status === 404);
  service.saveConfig(other, { ...configInput, accountId: "account-1", primeiroNossoNumero: "00001234" });
  assert.equal(service.config(other, "account-1")?.nextNossoNumero, 1234);
  assert.equal(service.config(context, "account-1")?.nextNossoNumero, 1236);
});

test("valida documento e rejeita conta/cartiera não configurada", () => {
  const { service } = setup();
  const badDocument = company();
  badDocument.clients[0]!.document = "11111111111";
  assert.throws(() => create(service, badDocument), /Documento do sacado.*inválido/);
  assert.throws(() => service.saveConfig(context, { ...configInput, codigoCarteira: "S" }), /Invalid input/);
  assert.throws(() => service.create(context, company(), { accountId: "missing", entryIds: ["entry-product"], addresses }), /Cadastre a configuração/);
  assert.equal(service.list(context).length, 0);
});
