/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeOrderStatus, changeQuoteStatus, countStock, demoDatabase, getOrderDetails, instantiateQuestionnaire,
  availablePurchaseReturnItems, createStockLocation, localDay, reversibleConsumptionItems,
  reverseOrderConsumption, returnPurchaseStock, stockAvailable, stockLocationBalance, transferStock, validateDatabase } from "./domain";
import { saveQuestionnaire } from "./questionnaires";
import { questionnaireDisplaySchema } from "./questionnaireSchema";
import { linkClientEquipment, saveEquipmentBrand, saveEquipmentModel, selectEquipmentModel } from "./equipmentCatalogData";
import { mobileSnapshotSchema, technicianAgendaOrders } from "./mobile";
import { distanceMeters } from "./serviceDistance";
import { saveFinanceInstallments } from "./financeInstallments";
import { settleFinanceEntry } from "./finance";
import { generateRecurringEntries, previewRecurringEntries, saveFinanceRecurrence } from "./financeRecurrences";
import { cancelPurchaseOrder, previewPurchaseSchedule, purchasing, receivePurchaseOrder, savePurchaseOrder, saveSupplier } from "./purchasing";
import { purchaseTotal } from "./purchasingValidation";
import type { PurchaseOrder, Supplier } from "./financeSchema";
import { addMaintenanceContractCharge, saveMaintenanceContract } from "./maintenanceContracts";

const owner = "00000000-0000-4000-8000-000000000001";
const tech = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
const company = "10000000-0000-4000-8000-000000000001";
const db = new PGlite();
const payload = demoDatabase();
payload.finance.accounts.push({ id: "private-bank", name: "Banco financeiro privado", bank: "Teste", agency: "1234", account: "99999", kind: "Corrente", active: true });
payload.finance.management = { categories: [{ id: "private-category", name: "Receita privada", kind: "Receber", active: true }],
  costCenters: [], classifications: [], openingBalances: [{ accountId: "private-bank", date: "2026-10-01", amount: 10000 }] };
payload.finance.banking = { transactions: [{ id: "private-transaction", accountId: "private-bank", externalId: "private-ref",
  date: "2026-10-01", description: "Extrato privado", amount: 10000, importedAt: "2026-10-01T12:00:00Z", fileName: "private.csv" }], matches: [] };
payload.finance.accounts.push({ id: "private-destination", name: "Destino privado", bank: "Teste", agency: "", account: "", kind: "Caixa", active: true });
payload.finance.transfers = [{ id: "private-transfer", fromAccountId: "private-bank", toAccountId: "private-destination",
  date: "2026-10-01", amount: 1000, description: "Transferencia privada", createdAt: "2026-10-01T12:00:00Z" }];
payload.finance.banking.transactions.push({ id: "private-transfer-transaction", accountId: "private-bank", externalId: "private-transfer-ref",
  date: "2026-10-01", description: "Extrato da transferencia privada", amount: -1000, importedAt: "2026-10-01T12:00:00Z", fileName: "private.csv" });
payload.finance.banking.transferMatches = [{ id: "private-transfer-match", transactionId: "private-transfer-transaction",
  transferId: "private-transfer", leg: "outgoing", createdAt: "2026-10-01T12:00:00Z", reversed: false }];
payload.finance = saveFinanceInstallments(payload, { id: "private-plan", kind: "Pagar", party: "Fornecedor privado",
  description: "Parcelamento privado", amount: 10000, issuedOn: "2026-10-01", dueOn: "2026-10-31", accountId: "private-bank",
  paymentMethod: "Pix", canceled: false, settlements: [] }, ["2026-10-31", "2026-11-30", "2026-12-31"], true).finance;
payload.finance = settleFinanceEntry(payload, "private-plan:1", { id: "private-adjusted-settlement", amount: 1000,
  date: "2026-10-01", accountId: "private-bank", adjustment: { interest: 100, fine: 50, discount: 10,
    reason: "Ajuste financeiro privado", confirmedAt: "2026-10-01T12:00:00Z" } }, true).finance;
payload.finance = saveFinanceRecurrence(payload, { id: "private-recurrence", kind: "Pagar", party: "Fornecedor privado",
  description: "Recorrencia privada", amount: 5000, accountId: "private-bank", paymentMethod: "Pix",
  firstDueOn: "2026-10-31", endsOn: "2026-12-31", createdAt: "2026-10-01T12:00:00Z", events: [] }, true).finance;
payload.finance = generateRecurringEntries(payload, payload.finance.recurrences![0], "2026-10", "2026-10",
  previewRecurringEntries(payload, "private-recurrence", "2026-10", "2026-10"), true).finance;
payload.finance = saveSupplier(payload, { id: "private-supplier", name: "Fornecedor de compra privado", document: "",
  phone: "11999999999", email: "private@example.test", address: "Endereco privado", active: true }).finance;
for (const [id, name] of [["quote-supplier-2", "Fornecedor cotado 2"], ["quote-supplier-3", "Fornecedor cotado 3"]]) {
  payload.finance = saveSupplier(payload, { id, name, document: "", phone: "", email: "", address: "", active: true }).finance;
}
payload.finance = savePurchaseOrder(payload, { id: "private-purchase", supplierId: "private-supplier",
  supplierName: "Fornecedor de compra privado", supplierDocument: "", description: "Pedido privado",
  orderedOn: "2026-10-01", createdAt: "2026-10-01T12:00:00Z", accountId: "private-bank", paymentMethod: "Pix",
  items: [{ description: "Peca privada", quantity: 1, unitCost: 1000 }],
  schedule: [{ dueOn: "2026-10-31", amount: 1000 }],
  procurement: approvedQuotes({ id: "private-purchase", supplierId: "private-supplier", orderedOn: "2026-10-01",
    items: [{ description: "Peca privada", quantity: 1, unitCost: 1000 }] }, purchasing(payload).suppliers),
}, true).finance;
const purchaseReceived = receivePurchaseOrder(payload, purchasing(payload).orders[0], {
  date: "2026-10-01", reference: "NF privada", notes: "Conferencia privada completa" }, true);
payload.finance = purchaseReceived.finance;
payload.products = purchaseReceived.products;
payload.movements = purchaseReceived.movements;
payload.inventory = purchaseReceived.inventory;
payload.orders[0].technicianUserId = tech;
payload.orders[0].status = "Aberta";
payload.orders[0].details = getOrderDetails(payload.orders[0]);
payload.orders[1].technicianUserId = other;

async function identity(user: string, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`set role ${role}`);
}
async function snapshot() {
  const result = await db.query<{ data: unknown }>("select public.mobile_company_data() as data");
  return mobileSnapshotSchema.parse(result.rows[0].data);
}
async function mutate(action: string, data: object, revision: number, orderId = payload.orders[0].id) {
  return db.query("select public.mobile_update_order($1,$2,$3::jsonb,$4) as data", [orderId, action, JSON.stringify(data), revision]);
}
const gps = { latitude: -23.5, longitude: -46.6, accuracy: 12 };
function approvedQuotes(order: Pick<PurchaseOrder, "id" | "supplierId" | "orderedOn" | "items">,
  suppliers: Supplier[], approverId = owner) {
  const selected = suppliers.find((supplier) => supplier.id === order.supplierId)!;
  const alternatives = suppliers.filter((supplier) => supplier.id !== selected.id).slice(0, 2);
  const candidates = [selected, ...alternatives];
  const amount = purchaseTotal(order);
  const quotes = candidates.map((supplier, index) => ({
    id: `${order.id}-quote-${index}`, supplierId: supplier.id, supplierName: supplier.name,
    amount: amount + index * 100, quotedOn: order.orderedOn,
    reference: `COT-${order.id}-${index}`, terms: `Prazo comercial ${index + 1}`,
  }));
  return {
    quotes, selectedQuoteId: quotes[0].id,
    approval: { at: new Date().toISOString(), approverUserId: approverId, approverName: "Admin", approverRole: "owner" as const,
      reason: "Melhor condição total para o pedido." },
  };
}

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
  `);
  for (const file of ["20261008010000_tenant_auth_and_company_data.sql", "20261009010000_android_technicians.sql", "20261009020000_technician_link_validation.sql", "20261010010000_questionnaires.sql", "20261011010000_questionnaire_checkout_requirement.sql", "20261011020000_yes_no_question_justification.sql", "20261015010000_service_distance.sql", "20261015020000_travel_route_limits.sql", "20261015030000_address_lookup_limits.sql", "20261015040000_finance_history_guards.sql", "20261017010000_inventory_guards.sql", "20261018010000_purchase_return_finance.sql"]) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.query("insert into auth.users values ($1,'owner@example.test'),($2,'tech@example.test'),($3,'other@example.test')", [owner, tech, other]);
  await db.query("insert into public.companies (id,name,created_by) values ($1,'Alpha Tec',$2)", [company, owner]);
  await db.query("insert into public.company_memberships (user_id,company_id,role,display_name) values ($1,$4,'owner','Admin'),($2,$4,'technician','Técnico'),($3,$4,'technician','Outro')", [owner, tech, other, company]);
  const initial = { ...payload, finance: { ...payload.finance,
    entries: payload.finance.entries.map((entry) => ({ ...entry, settlements: [] })) } };
  await db.query("insert into public.company_data(company_id,payload) values ($1,$2)", [company, JSON.stringify(initial)]);
  await db.query("update public.company_data set payload=$1 where company_id=$2", [JSON.stringify(payload), company]);
  await db.exec(await readFile(new URL("../../supabase/migrations/20261016070000_purchase_guards.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261019010000_purchase_approval_guards.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261021010000_skip_unchanged_company_guards.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261022010000_quote_approval_guards.sql", import.meta.url), "utf8"));
}, 30000);
afterAll(async () => { await db.close(); });

describe("validações por alterações relevantes", () => {
  it("serializa reservas concorrentes com revisão otimista e não permite sobre-reserva", async () => {
    const raceOwner = "00000000-0000-4000-8000-000000000004";
    const raceCompany = "10000000-0000-4000-8000-000000000004";
    await db.exec("reset role; begin");
    try {
      await db.query("insert into auth.users values ($1,'reservation-race@example.test')", [raceOwner]);
      await db.query("insert into public.companies(id,name,created_by) values ($1,'Reserva concorrente',$2)", [raceCompany, raceOwner]);
      await db.query("insert into public.company_memberships(user_id,company_id,role) values ($1,$2,'owner')", [raceOwner, raceCompany]);
      const initial = demoDatabase();
      await db.query("insert into public.company_data(company_id,payload) values ($1,$2)", [raceCompany, JSON.stringify(initial)]);
      await identity(raceOwner);

      const product = initial.products[0], locationId = initial.inventory!.defaultLocationId;
      const quantity = Math.floor(stockAvailable(initial, product.id, locationId) / 2) + 1;
      const openOrders = initial.orders.filter((order) => order.status === "Aberta").slice(0, 2);
      expect(openOrders).toHaveLength(2);
      expect(stockAvailable(initial, product.id, locationId)).toBeGreaterThan(1);

      const reservations = openOrders.map((order, index) => {
        const candidate = structuredClone(initial);
        const target = candidate.orders.find((item) => item.id === order.id)!;
        target.details = { ...getOrderDetails(target), activities: [], items: [{
          id: `race-line-${index}`, kind: "produto", referenceId: product.id, name: product.name,
          quantity, price: 1000, discount: 0,
        }] };
        return changeOrderStatus(validateDatabase(candidate), target.id, "Em atendimento");
      });
      const saved = (await db.query<{ revision: number }>("select revision from public.company_data where company_id=$1", [raceCompany])).rows[0];
      await db.query("select public.save_company_data($1::jsonb,$2)", [JSON.stringify(reservations[0]), saved.revision]);

      await db.exec("savepoint stale_reservation");
      await expect(db.query("select public.save_company_data($1::jsonb,$2)",
        [JSON.stringify(reservations[1]), saved.revision])).rejects.toThrow("another session");
      await db.exec("rollback to savepoint stale_reservation");

      const persisted = (await db.query<{ payload: ReturnType<typeof validateDatabase>; revision: number }>(
        "select payload,revision from public.company_data where company_id=$1", [raceCompany])).rows[0];
      expect(persisted.revision).toBe(saved.revision + 1);
      expect(persisted.payload.inventory!.reservations.filter((item) => item.events.at(-1)?.status === "Reservada"))
        .toHaveLength(1);
      expect(persisted.payload.inventory!.reservations[0].items[0].quantity).toBe(quantity);
      expect(quantity * 2).toBeGreaterThan(stockAvailable(initial, product.id, locationId));
    } finally {
      await db.exec("reset role; rollback");
      await db.exec("reset role");
    }
  });

  it("não revalida estoque/compras ao salvar contrato, mas revalida produtos e OS", async () => {
    await identity(owner);
    const original = (await db.query<{ payload: unknown }>(
      "select payload from public.company_data where company_id=$1", [company])).rows[0].payload;
    await db.exec("reset role");
    const data = validateDatabase(original);
    data.maintenanceContracts.push({
      id: "sql-contract", name: "Contrato de teste", clientId: data.clients[0].id,
      equipmentIds: [data.equipment[0].id], equipmentTypeIds: [], coverage: "Manutencao preventiva",
      startsOn: "2026-10-01", endsOn: "2027-10-01", monthlyAmount: 10000,
      visitInterval: { kind: "Mensal" }, createdAt: "2026-10-01T12:00:00Z", events: [],
    });
    async function triggers(next: unknown) {
      await db.exec("begin");
      try {
        const result = await db.query<{ "QUERY PLAN": string }>(
          "explain analyze update public.company_data set payload=$1 where company_id=$2",
          [JSON.stringify(next), company]);
        return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
      } finally {
        await db.exec("rollback");
      }
    }
    const plan = await triggers(data);
    expect(plan).not.toMatch(/Trigger guard_inventory/);
    expect(plan).not.toMatch(/Trigger guard_purchase_approvals/);
    expect(plan).not.toMatch(/Trigger guard_purchase_return_finance/);
    const products = structuredClone(data);
    products.products[0].name += " atualizado";
    expect(await triggers(products)).toMatch(/Trigger guard_inventory/);
    const orders = structuredClone(data);
    orders.orders[0].notes += " atualizado";
    expect(await triggers(orders)).toMatch(/Trigger guard_inventory/);
  });
});

describe("aprovação e cotações de compras no banco", () => {
  it("recusa pedidos novos sem aprovação válida, cotações distintas ou justificativa de exceção", async () => {
    await identity(owner);
    const original = (await db.query<{ payload: unknown; revision: number }>(
      "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
    const data = validateDatabase(original.payload), supplier = purchasing(data).suppliers[0], product = data.products[0];
    const orderData = savePurchaseOrder(data, {
      id: "sql-approval-guard-test", supplierId: supplier.id, supplierName: supplier.name,
      supplierDocument: supplier.document, description: "Pedido de teste de aprovação",
      orderedOn: localDay(), createdAt: new Date().toISOString(), accountId: "private-bank",
      paymentMethod: "Pix", items: [{ description: product.name, productId: product.id, quantity: 1, unitCost: 100 }],
      schedule: [{ dueOn: localDay(), amount: 100 }],
      procurement: approvedQuotes({ id: "sql-approval-guard-test", supplierId: supplier.id, orderedOn: localDay(),
        items: [{ description: product.name, quantity: 1, unitCost: 100 }] }, purchasing(data).suppliers),
    }, true);
    const proposed = structuredClone(data) as ReturnType<typeof validateDatabase>;
    proposed.finance.purchasing!.orders.push(
      purchasing(orderData).orders.find((order) => order.id === "sql-approval-guard-test")!);
    const reject = async (candidate: ReturnType<typeof validateDatabase>, actor = owner) => {
      await identity(actor);
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(candidate), original.revision])).rejects.toThrow();
    };

    const withoutApproval = structuredClone(proposed) as ReturnType<typeof validateDatabase>;
    delete withoutApproval.finance.purchasing!.orders.at(-1)!.procurement;
    await reject(withoutApproval);

    const tooFewQuotes = structuredClone(proposed) as ReturnType<typeof validateDatabase>;
    const tooFewProcurement = tooFewQuotes.finance.purchasing!.orders.at(-1)!.procurement!;
    tooFewProcurement.quotes = tooFewProcurement.quotes.slice(0, 2);
    delete tooFewProcurement.quoteExceptionReason;
    await reject(tooFewQuotes);

    const duplicateSupplier = structuredClone(proposed) as ReturnType<typeof validateDatabase>;
    const duplicateProcurement = duplicateSupplier.finance.purchasing!.orders.at(-1)!.procurement!;
    duplicateProcurement.quotes[1].supplierId = duplicateProcurement.quotes[0].supplierId;
    duplicateProcurement.quotes[1].supplierName = duplicateProcurement.quotes[0].supplierName;
    await reject(duplicateSupplier);

    const changedActor = structuredClone(proposed) as ReturnType<typeof validateDatabase>;
    changedActor.finance.purchasing!.orders.at(-1)!.procurement!.approval.approverUserId = tech;
    await reject(changedActor);

    const localApproval = structuredClone(proposed) as ReturnType<typeof validateDatabase>;
    localApproval.finance.purchasing!.orders.at(-1)!.procurement!.approval.approverRole = "local";
    await reject(localApproval);

    const unauthorizedTenantActor = structuredClone(proposed) as ReturnType<typeof validateDatabase>;
    unauthorizedTenantActor.finance.purchasing!.orders.at(-1)!.procurement!.approval.approverUserId = other;
    await reject(unauthorizedTenantActor, other);
  });
});

describe("RPC Android e isolamento de dados", () => {
  it("sincroniza e atualiza OS de contrato sem enviar o contrato ou seu anexo ao técnico", async () => {
    await identity(owner);
    const original = (await db.query<{ payload: unknown; revision: number }>(
      "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
    await db.exec("begin");
    try {
      const data = validateDatabase(original.payload), order = data.orders[0];
      const linked = saveMaintenanceContract(data, {
        id: "mobile-private-contract", name: "Contrato privado",
        clientId: order.clientId, equipmentIds: [order.equipmentId], equipmentTypeIds: [],
        coverage: "Clausulas privadas", startsOn: order.date, endsOn: order.date,
        monthlyAmount: 25000, visitInterval: { kind: "Mensal" },
        createdAt: "2026-10-01T12:00:00Z", events: [],
        signedAttachment: { id: "signed-contract", name: "contrato.pdf", mime: "application/pdf",
          size: 3, data: "data:application/pdf;base64,YWJj", at: "2026-10-01T12:00:00Z" },
      }, true);
      order.details = addMaintenanceContractCharge(getOrderDetails(order), linked.maintenanceContracts[0]);
      linked.orders[0] = order;
      await db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(validateDatabase(linked)), original.revision]);
      await identity(tech);
      const result = await db.query<{ data: unknown }>("select public.mobile_company_data() as data");
      expect(JSON.stringify(result.rows[0].data)).not.toContain("Clausulas privadas");
      expect(JSON.stringify(result.rows[0].data)).not.toContain("contrato.pdf");
      const mobile = mobileSnapshotSchema.parse(result.rows[0].data);
      expect(mobile.payload.maintenanceContracts).toEqual([]);
      const assigned = mobile.payload.orders.find((item) => item.id === order.id)!;
      expect(getOrderDetails(assigned).maintenanceContract?.id).toBe("mobile-private-contract");
      const details = getOrderDetails(assigned);
      await mutate("report", {
        report: "Atendimento do contrato atualizado", distanceKm: details.distanceKm,
        attachments: details.attachments, checklists: details.checklists,
        signature: details.signature, pending: details.pending,
      }, mobile.revision, assigned.id);
      const updated = await snapshot();
      expect(getOrderDetails(updated.payload.orders.find((item) => item.id === order.id)!).report)
        .toBe("Atendimento do contrato atualizado");
      await identity(owner);
      const saved = validateDatabase((await db.query<{ payload: unknown }>(
        "select payload from public.company_data where company_id=$1", [company])).rows[0].payload);
      expect(saved.maintenanceContracts[0].signedAttachment?.name).toBe("contrato.pdf");
      expect(getOrderDetails(saved.orders[0]).maintenanceContract?.monthlyAmount).toBe(25000);
    } finally {
      await db.exec("rollback");
      await identity(owner);
    }
  });

  it("limita geocodificação a 30 por minuto por empresa, permite renovar a janela e bloqueia acesso direto", async () => {
    await identity(tech);
    await expect(db.query("select public.reserve_address_lookup()")).rejects.toThrow("administração");
    await identity(owner);
    for (let count = 0; count < 30; count++) await db.query("select public.reserve_address_lookup()");
    await expect(db.query("select public.reserve_address_lookup()")).rejects.toThrow("30 consultas");
    await expect(db.query("delete from public.address_lookup_requests")).rejects.toThrow("permission");
    await identity(owner, "anon");
    await expect(db.query("select public.reserve_address_lookup()")).rejects.toThrow("permission");
    await db.exec("reset role");
    await db.query("update public.address_lookup_requests set window_started_at=clock_timestamp()-interval '61 seconds' where company_id=$1", [company]);
    await identity(owner);
    await db.query("select public.reserve_address_lookup()");
    await db.exec("reset role");
    const rows = await db.query<{ requests: number }>("select requests from public.address_lookup_requests where company_id=$1", [company]);
    expect(rows.rows[0].requests).toBe(1);
  });
  it("reserva rotas apenas para administradores e limita chamadas por empresa", async () => {
    await identity(tech);
    await expect(db.query("select public.reserve_travel_route()")).rejects.toThrow("administração");
    await identity(owner);
    await db.query("select public.reserve_travel_route()");
    await expect(db.query("select public.reserve_travel_route()")).rejects.toThrow("10 segundos");
    await expect(db.query("delete from public.travel_route_requests")).rejects.toThrow("permission");
    await identity(owner, "anon");
    await expect(db.query("select public.reserve_travel_route()")).rejects.toThrow("permission");
    await db.exec("reset role");
    await db.query("update public.travel_route_requests set requested_at=clock_timestamp()-interval '11 seconds' where company_id=$1", [company]);
    await identity(owner);
    await db.query("select public.reserve_travel_route()");
    await db.exec("reset role");
  });
  describe("distância do GPS ao ponto confirmado do atendimento", () => {
    let baseline: { payload: unknown; revision: number };
    beforeAll(async () => {
      await db.exec("reset role");
      baseline = (await db.query<{ payload: unknown; revision: number }>("select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
    });
    afterAll(async () => {
      await db.exec("reset role");
      await db.query("update public.company_data set payload=$1,revision=$2 where company_id=$3", [JSON.stringify(baseline.payload), baseline.revision, company]);
    });
    async function fixture(stale = false, specific = false) {
      await identity(owner);
      const state = await snapshot();
      const data = structuredClone(payload);
      const client = data.clients.find((item) => item.id === data.orders[0].clientId)!;
      const address = specific ? "Rua Teste, 10 · Centro · Florianópolis - SC · CEP 88000000" : client.address;
      data.orders[0].details = {
        ...getOrderDetails(data.orders[0]), activities: [], pending: [], checklists: [],
        ...(specific ? { serviceLocation: {
          useClientAddress: false, postalCode: "88000000", street: "Rua Teste", number: "10",
          complement: "", neighborhood: "Centro", city: "Florianópolis", state: "SC",
        } } : {}),
        servicePoint: { latitude: gps.latitude, longitude: gps.longitude, address: stale ? "Endereço antigo" : address },
      };
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(data), state.revision]);
      await identity(tech);
      return snapshot();
    }
    it("calcula no servidor, ignora distância enviada pelo aparelho e preserva o ponto histórico", async () => {
      let state = await fixture();
      await mutate("Check-in", { location: gps, serviceDistance: { meters: 999999 } }, state.revision);
      state = await snapshot();
      const first = getOrderDetails(state.payload.orders[0]).activities[0];
      expect(first.serviceDistance?.meters).toBe(0);
      expect(first.location?.accuracy).toBe(12);
      const checkoutGps = { ...gps, latitude: gps.latitude + 0.01 };
      await mutate("Check-out", { location: checkoutGps }, state.revision);
      state = await snapshot();
      expect(getOrderDetails(state.payload.orders[0]).activities.at(-1)?.serviceDistance?.meters).toBe(distanceMeters(checkoutGps, gps));
      await identity(owner);
      const stored = (await db.query<{ payload: unknown }>("select payload from public.company_data where company_id=$1", [company])).rows[0].payload;
      const changed = validateDatabase(stored);
      changed.orders[0].details!.servicePoint!.latitude += 1;
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(changed), state.revision]);
      expect(getOrderDetails((await snapshot()).payload.orders[0]).activities[0].serviceDistance).toEqual(first.serviceDistance);
    });
    it("usa o endereço específico do atendimento, não o endereço do cliente", async () => {
      const state = await fixture(false, true);
      await mutate("Check-in", { location: gps }, state.revision);
      expect(getOrderDetails((await snapshot()).payload.orders[0]).activities[0].serviceDistance).toMatchObject({
        meters: 0, address: "Rua Teste, 10 · Centro · Florianópolis - SC · CEP 88000000",
      });
    });
    it("não usa ponto desatualizado nem aceita edição de referência pelo técnico", async () => {
      const state = await fixture(true);
      await mutate("Check-in", { location: gps }, state.revision);
      const after = await snapshot();
      const details = getOrderDetails(after.payload.orders[0]);
      expect(details.activities[0].serviceDistance).toBeUndefined();
      await expect(mutate("report", { ...details, servicePoint: { latitude: 0, longitude: 0 } }, after.revision)).rejects.toThrow("Campos");
      await expect(db.query("select public.mobile_update_order_without_service_distance($1,'Check-in',$2::jsonb,$3)", [payload.orders[0].id, JSON.stringify({ location: gps }), after.revision])).rejects.toThrow("permission");
    });
  });

  it("só projeta tarefas e clientes atribuídos, sem documento completo", async () => {
    await identity(tech);
    const data = await snapshot();
    expect(data.payload.orders.map((order) => order.id)).toEqual([payload.orders[0].id]);
    expect(data.payload.clients.map((client) => client.id)).toEqual([payload.orders[0].clientId]);
    expect(data.payload.settings.registrationData).toEqual({});
    expect(data.payload.finance).toEqual({ accounts: [], entries: [], invoices: [] });
    const raw = await db.query("select * from public.company_data");
    expect(raw.rows).toEqual([]);
    await expect(db.query("select public.list_company_technicians()")).rejects.toThrow();
    await expect(db.query("select public.save_company_data($1,0)", [JSON.stringify(payload)])).rejects.toThrow();
    await expect(mutate("Check-in", { location: gps }, 0, payload.orders[1].id)).rejects.toThrow("Tarefa não atribuída");
  });

  async function questionnaireFixture(checklists: ReturnType<typeof getOrderDetails>["checklists"], required = true) {
    await identity(owner);
    const current = await snapshot();
    const raw = await db.query<{ payload: unknown }>("select payload from public.company_data where company_id=$1", [company]);
    const full = validateDatabase(raw.rows[0].payload);
    full.orders[0].status = "Aberta";
    full.orders[0].details = {
      ...getOrderDetails(full.orders[0]), activities: [], attachments: [],
      signature: null, pending: [], checklists, questionnaireRequired: required,
    };
    await db.query("select public.save_company_data($1,$2)", [JSON.stringify(full), current.revision]);
    await identity(tech);
    const data = await snapshot();
    await mutate("Check-in", { location: gps }, data.revision);
    const details = getOrderDetails((await snapshot()).payload.orders[0]);
    return {
      report: details.report, distanceKm: details.distanceKm, attachments: details.attachments,
      checklists: details.checklists, signature: details.signature, pending: details.pending,
    };
  }

  describe("Snapshots dos questionários e assinaturas por pergunta no servidor", () => {
    let baseline: { payload: unknown; revision: number };
    beforeAll(async () => {
      await db.exec("reset role");
      const saved = await db.query<{ payload: unknown; revision: number }>("select payload,revision from public.company_data where company_id=$1", [company]);
      baseline = saved.rows[0];
      await identity(tech);
    });
    afterAll(async () => {
      await db.exec("reset role");
      await db.query("update public.company_data set payload=$1,revision=$2 where company_id=$3", [JSON.stringify(baseline.payload), baseline.revision, company]);
      await identity(tech);
    });
    const signature = { signer: "Cliente", image: "data:image/png;base64,YWJj", at: "1900-01-01T00:00:00.000Z" };
    const list = {
      id: "snapshot", title: "Inspeção vinculada", equipmentId: "",
      templateId: "template", templateRevision: 2, header: "Cabeçalho", footer: "Rodapé",
      display: { showOnOrder: true, columns: 2, inlineAnswers: false, showUnanswered: true, equipment: true },
      questions: [
        { id: "sign-1", label: "Técnico", kind: "Assinatura" as const, required: true, options: [], answer: "", signature: null },
        { id: "sign-2", label: "Cliente", kind: "Assinatura" as const, required: true, options: [], answer: "", signature: null },
        { id: "text", label: "Observações", kind: "Area de texto" as const, required: false, options: [], answer: "", description: "Informe detalhes", photoMetadata: false },
      ],
    };

    it("entrega a edição do questionário e o local de atendimento ao técnico e rejeita envio sobre a estrutura antiga", async () => {
      const model = {
        id: "live-template", title: "Inspeção", revision: 1, archived: false, requiredForCheckout: true,
        header: "", footer: "", display: questionnaireDisplaySchema.parse({}),
        questions: [{ id: "live-q", label: "Relato", kind: "Texto" as const, required: true, options: [] }],
      };
      await questionnaireFixture([instantiateQuestionnaire(model)]);
      const old = await snapshot();
      await identity(owner);
      const stored = await db.query<{ payload: unknown }>("select payload from public.company_data where company_id=$1", [company]);
      let full = validateDatabase(stored.rows[0].payload);
      full = saveEquipmentBrand(full, { id: "brand", name: "Marca teste", archived: false });
      full = saveEquipmentModel(full, { id: "model", brandId: "brand", name: "Esteira X", line: "Cardio", category: "Esteiras", notes: "", archived: false });
      full = linkClientEquipment(full, full.orders[0].clientId, [{ modelId: "model", quantity: 2 }]);
      const assignedUnits = full.equipment.slice(-2);
      full = linkClientEquipment(full, full.clients[1].id, [{ modelId: "model", quantity: 1 }]);
      const otherUnit = full.equipment.at(-1)!;
      const modelSelection = selectEquipmentModel(full, "model");
      full.equipment[0].model = modelSelection;
      full.quotes[0].equipmentModels = [modelSelection];
      full.questionnaires = [model];
      full.orders[0].details = {
        ...getOrderDetails(full.orders[0]),
        serviceLocation: { useClientAddress: false, postalCode: "01001000", street: "Praça da Sé", number: "10", complement: "", neighborhood: "Sé", city: "São Paulo", state: "SP" },
        responsibleName: "Maria", responsiblePhone: "11999998888",
        equipmentModels: [{ ...modelSelection, quantity: 2, purpose: "Montagem" }],
        equipmentIds: assignedUnits.map((item) => item.id),
      };
      full = saveQuestionnaire(full, { ...model, title: "Inspeção atualizada", questions: [...model.questions, { ...model.questions[0], id: "new-q", label: "Novo teste" }] });
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(full), old.revision]);
      await identity(tech);
      const current = await snapshot();
      const details = getOrderDetails(current.payload.orders[0]);
      expect(details).toMatchObject({ responsibleName: "Maria", responsiblePhone: "11999998888", serviceLocation: { street: "Praça da Sé", number: "10" } });
      expect(details.checklists).toHaveLength(1);
      expect(details.checklists[0].title).toBe("Inspeção atualizada");
      expect(details.checklists[0].questions.map((q) => q.id)).toEqual(["live-q", "new-q"]);
      expect(details.equipmentModels[0]).toMatchObject({ name: "Esteira X", brand: "Marca teste", quantity: 2, purpose: "Montagem" });
      expect(current.payload.equipmentBrands).toEqual([]);
      expect(current.payload.equipmentModels).toEqual([]);
      expect(current.payload.equipment[0].model).toMatchObject({ modelId: "model", brand: "Marca teste" });
      expect(current.payload.equipment.filter((item) => assignedUnits.some((unit) => unit.id === item.id))).toHaveLength(2);
      expect(current.payload.equipment.find((item) => item.id === assignedUnits[0].id)).toMatchObject({ assetCode: assignedUnits[0].assetCode, model: { line: "Cardio" } });
      expect(current.payload.equipment.some((item) => item.id === otherUnit.id)).toBe(false);
      await expect(mutate("report", {}, old.revision)).rejects.toThrow("Sincronize");
      await mutate("report", {
        report: details.report, distanceKm: details.distanceKm, attachments: details.attachments,
        checklists: details.checklists.map((checklist) => ({ ...checklist, questions: checklist.questions.map((q) => ({ ...q, answer: "Feito" })) })),
        signature: details.signature, pending: details.pending,
      }, current.revision);
      expect(getOrderDetails((await snapshot()).payload.orders[0])).toMatchObject({ responsibleName: "Maria", serviceLocation: { number: "10" } });
      expect(getOrderDetails((await snapshot()).payload.orders[0]).equipmentModels).toEqual(details.equipmentModels);
    });

    it("exige duas assinaturas independentes; carimba no servidor e preserva o horário ao salvar novamente", async () => {
      const report = await questionnaireFixture([structuredClone(list)]);
      let current = await snapshot();
      report.signature = signature;
      await mutate("report", report, current.revision);
      current = await snapshot();
      await expect(mutate("Check-out", { location: gps }, current.revision)).rejects.toThrow("obrigatórios");
      report.checklists[0].questions[0].signature = { ...signature, signer: "Técnico" };
      await mutate("report", report, current.revision);
      current = await snapshot();
      const saved = getOrderDetails(current.payload.orders[0]).checklists[0].questions[0].signature!;
      expect(saved.signer).toBe("Técnico");
      expect(Date.parse(saved.at)).toBeGreaterThan(Date.now() - 60000);
      expect(getOrderDetails(current.payload.orders[0]).checklists[0].questions[1].signature).toBeNull();
      await expect(mutate("Check-out", { location: gps }, current.revision)).rejects.toThrow("obrigatórios");
      report.checklists[0].questions[0].signature = { ...saved, at: "2099-01-01T00:00:00.000Z" };
      report.checklists[0].questions[1].signature = signature;
      await mutate("report", report, current.revision);
      current = await snapshot();
      let questions = getOrderDetails(current.payload.orders[0]).checklists[0].questions;
      expect(questions[0].signature?.at).toBe(saved.at);
      expect(questions[1].signature?.at).not.toBe(signature.at);
      const withoutOwn = structuredClone(report);
      delete withoutOwn.checklists[0].questions[1].signature;
      await expect(mutate("report", withoutOwn, current.revision)).rejects.toThrow("Estrutura");
      report.checklists[0].questions[1].signature = null;
      await mutate("report", report, current.revision);
      current = await snapshot();
      questions = getOrderDetails(current.payload.orders[0]).checklists[0].questions;
      expect(questions[0].signature?.at).toBe(saved.at);
      expect(questions[1].signature).toBeNull();
      await expect(mutate("Check-out", { location: gps }, current.revision)).rejects.toThrow("obrigatórios");
      report.checklists[0].questions[1].signature = signature;
      await mutate("report", report, current.revision);
      current = await snapshot();
      await mutate("Check-out", { location: gps }, current.revision);
      expect((await snapshot()).payload.orders[0].status).toBe("Finalizada");
    });

    it("não permite modificar estrutura, opções, descrição, carimbo nem metadados de exibição/revisão", async () => {
      const report = await questionnaireFixture([structuredClone(list)]);
      const current = await snapshot();
      for (const change of [
        (value: typeof report) => { value.checklists[0].title = "Fraude"; },
        (value: typeof report) => { value.checklists[0].templateId = "outro"; },
        (value: typeof report) => { value.checklists[0].templateRevision = 99; },
        (value: typeof report) => { value.checklists[0].requiredForCheckout = false; },
        (value: typeof report) => { value.checklists[0].header = ""; },
        (value: typeof report) => { delete value.checklists[0].footer; },
        (value: typeof report) => { value.checklists[0].display!.columns = 4; },
        (value: typeof report) => { value.checklists[0].equipmentId = "outro"; },
        (value: typeof report) => { value.checklists[0].questions[0].required = false; },
        (value: typeof report) => { value.checklists[0].questions[0].kind = "Texto"; },
        (value: typeof report) => { value.checklists[0].questions[0].options = ["A", "B"]; },
        (value: typeof report) => { value.checklists[0].questions[2].description = "Outra descrição"; },
        (value: typeof report) => { value.checklists[0].questions[2].photoMetadata = true; },
        (value: typeof report) => { value.checklists[0].questions[2].label = "Outra pergunta"; },
        (value: typeof report) => { value.checklists[0].questions.reverse(); },
      ]) {
        const altered = structuredClone(report);
        change(altered);
        await expect(mutate("report", altered, current.revision)).rejects.toThrow(/alterado|Estrutura/);
      }
      const duplicate = structuredClone(report);
      duplicate.checklists[0].questions[1] = structuredClone(duplicate.checklists[0].questions[0]);
      await expect(mutate("report", duplicate, current.revision)).rejects.toThrow("duplicados");
      const badSignature = structuredClone(report);
      badSignature.checklists[0].questions[0].signature = { ...signature, signer: " " };
      await expect(mutate("report", badSignature, current.revision)).rejects.toThrow("Assinatura inválida");
      badSignature.checklists[0].questions[2].signature = signature;
      badSignature.checklists[0].questions[0].signature = null;
      await expect(mutate("report", badSignature, current.revision)).rejects.toThrow("outro tipo");
      expect((await snapshot()).revision).toBe(current.revision);
    });

    it("permite check-out com questionário opcional vazio sem ignorar pendências manuais", async () => {
      const report = await questionnaireFixture([{ ...structuredClone(list), requiredForCheckout: false }]);
      let current = await snapshot();
      expect(getOrderDetails(current.payload.orders[0]).checklists[0].requiredForCheckout).toBe(false);
      await mutate("report", report, current.revision);
      current = await snapshot();
      const altered = structuredClone(report);
      altered.checklists[0].requiredForCheckout = true;
      await expect(mutate("report", altered, current.revision)).rejects.toThrow("alterado");
      delete altered.checklists[0].requiredForCheckout;
      await expect(mutate("report", altered, current.revision)).rejects.toThrow("alterado");
      await identity(owner);
      const raw = await db.query<{ payload: unknown }>("select payload from public.company_data where company_id=$1", [company]);
      const full = validateDatabase(raw.rows[0].payload);
      full.orders[0].details!.pending = [{ id: "manual", title: "Conferir funcionamento", resolved: false }];
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(full), current.revision]);
      await identity(tech);
      current = await snapshot();
      await expect(mutate("Check-out", { location: gps }, current.revision)).rejects.toThrow("pendências");
      report.pending = [{ id: "manual", title: "Conferir funcionamento", resolved: true }];
      await mutate("report", report, current.revision);
      current = await snapshot();
      await mutate("Check-out", { location: gps }, current.revision);
      expect((await snapshot()).payload.orders[0].status).toBe("Finalizada");
    });

    it("em tarefas com vários questionários, só exige os configurados para check-out", async () => {
      const optional = { ...structuredClone(list), id: "optional", requiredForCheckout: false };
      const required = { ...structuredClone(list), id: "required", requiredForCheckout: true };
      const report = await questionnaireFixture([optional, required]);
      let current = await snapshot();
      await expect(mutate("Check-out", { location: gps }, current.revision)).rejects.toThrow("obrigatórios");
      await expect(mutate("Check-out", { location: gps, checklists: [optional] }, current.revision)).rejects.toThrow("obrigatórios");
      report.checklists[1].questions[0].signature = signature;
      report.checklists[1].questions[1].signature = signature;
      await mutate("report", report, current.revision);
      current = await snapshot();
      await mutate("Check-out", { location: gps }, current.revision);
      const finished = (await snapshot()).payload.orders[0];
      expect(finished.status).toBe("Finalizada");
      expect(getOrderDetails(finished).checklists[0].questions[0].signature).toBeNull();
    });

    it.each(["Sim", "Nao"] as const)("exige justificativa na resposta %s, mas nunca exige foto", async (justificationOn) => {
      const report = await questionnaireFixture([{
        ...structuredClone(list), questions: [{
          id: "yes-no", label: "Funcionando?", kind: "Sim ou Não", required: false, options: [],
          justificationOn, answer: "", justification: "", justificationPhotoId: "",
        }],
      }]);
      let current = await snapshot();
      const altered = structuredClone(report);
      altered.checklists[0].questions[0].justificationOn = justificationOn === "Sim" ? "Nao" : "Sim";
      await expect(mutate("report", altered, current.revision)).rejects.toThrow("Estrutura");
      report.checklists[0].questions[0].answer = justificationOn;
      report.checklists[0].questions[0].justification = "   ";
      await mutate("report", report, current.revision);
      current = await snapshot();
      await expect(mutate("Check-out", { location: gps }, current.revision)).rejects.toThrow("justificativa");
      await expect(mutate("Check-out", { location: gps, justification: "Ignorar" }, current.revision)).rejects.toThrow("justificativa");
      report.checklists[0].questions[0].justification = "Equipamento precisa de ajuste.";
      await mutate("report", report, current.revision);
      current = await snapshot();
      expect(getOrderDetails(current.payload.orders[0]).checklists[0].questions[0].justification).toBe("Equipamento precisa de ajuste.");
      await mutate("Check-out", { location: gps }, current.revision);
      expect((await snapshot()).payload.orders[0].status).toBe("Finalizada");
    });

    it("aceita foto opcional e troca de resposta sem justificativa fora da condição", async () => {
      const report = await questionnaireFixture([{
        ...structuredClone(list), questions: [{
          id: "yes-no", label: "Funcionando?", kind: "Sim ou Não", required: true, options: [],
          justificationOn: "Nao", answer: "", justification: "", justificationPhotoId: "",
        }],
      }]);
      let current = await snapshot();
      const q = report.checklists[0].questions[0];
      q.answer = "Nao"; q.justification = "Motor parado."; q.justificationPhotoId = "photo";
      await expect(mutate("report", report, current.revision)).rejects.toThrow("Foto da justificativa");
      report.attachments = [{ id: "photo", name: "foto.png", mime: "image/png", size: 3, data: "data:image/png;base64,YWJj", at: signature.at }];
      await mutate("report", report, current.revision);
      current = await snapshot();
      expect(getOrderDetails(current.payload.orders[0]).checklists[0].questions[0].justificationPhotoId).toBe("photo");
      q.answer = "Sim";
      await expect(mutate("report", report, current.revision)).rejects.toThrow("sem resposta correspondente");
      q.justification = ""; q.justificationPhotoId = "";
      await mutate("report", report, current.revision);
      current = await snapshot();
      await mutate("Check-out", { location: gps }, current.revision);
      expect((await snapshot()).payload.orders[0].status).toBe("Finalizada");
    });

    it("valida formatos da justificativa e preserva a regra de questionário opcional", async () => {
      const report = await questionnaireFixture([{
        ...structuredClone(list), requiredForCheckout: false, questions: [{
          id: "yes-no", label: "Funcionando?", kind: "Sim ou Não", required: true, options: [],
          justificationOn: "Sim", answer: "Sim", justification: "", justificationPhotoId: "",
        }],
      }], false);
      let current = await snapshot();
      for (const change of [
        { answer: "Talvez" }, { justification: 42 }, { justification: "x".repeat(10001) },
        { justificationPhotoId: 42 }, { justificationPhotoId: "missing" },
      ]) {
        const invalid = structuredClone(report);
        Object.assign(invalid.checklists[0].questions[0], change);
        await expect(mutate("report", invalid, current.revision)).rejects.toThrow();
      }
      await mutate("report", report, current.revision);
      current = await snapshot();
      await mutate("Check-out", { location: gps }, current.revision);
      expect((await snapshot()).payload.orders[0].status).toBe("Finalizada");
    });

    it("valida tipos e conteúdo de respostas incluindo área de texto, número, data, hora, check, CPF/CNPJ e foto", async () => {
      const kinds = ["Area de texto", "Numero", "Monetaria", "Data", "Hora", "Check", "CPF/CNPJ", "Escolha", "Multipla escolha", "Foto"] as const;
      const report = await questionnaireFixture([{
        id: "types", title: "Tipos", equipmentId: "",
        questions: kinds.map((kind) => ({
          id: kind, label: kind, kind, required: false,
          options: ["Escolha", "Multipla escolha"].includes(kind) ? ["A", "B"] : [],
          answer: kind === "Multipla escolha" ? [] : "",
        })),
      }]);
      const current = await snapshot();
      for (const [index, value, message] of [
        [0, ["texto"], "inválida"], [1, "NaN", "numérica"], [2, "Infinity", "numérica"],
        [3, "2026-02-30", "Data"], [4, "25:60", "Hora"], [5, "Talvez", "check"],
        [6, "111.111.111-11", "CPF/CNPJ"], [7, "C", "Opção"], [8, ["A", "C"], "Opções"],
        [8, ["A", "A"], "Opções"], [9, "ausente", "Foto"],
      ] as [number, string | string[], string][]) {
        const altered = structuredClone(report);
        altered.checklists[0].questions[index].answer = value;
        await expect(mutate("report", altered, current.revision)).rejects.toThrow(message);
      }
      const file = { id: "photo", name: "foto.jpg", mime: "image/jpeg" as const, size: 3, data: "data:image/jpeg;base64,YWJj", at: signature.at };
      report.attachments = [file];
      ["Linha 1\nLinha 2", "-1.25", "1.2e3", "2024-02-29", "23:59", "Nao", "529.982.247-25", "A", ["A", "B"], "photo"].forEach((value, index) => {
        report.checklists[0].questions[index].answer = value;
      });
      await mutate("report", report, current.revision);
      let saved = await snapshot();
      expect(getOrderDetails(saved.payload.orders[0]).checklists[0].questions[0].answer).toBe("Linha 1\nLinha 2");
      report.checklists[0].questions[5].answer = "Não";
      report.checklists[0].questions[6].answer = "12.345.678/0001-95";
      const legacyCheck = await mutate("report", report, saved.revision);
      const rawCheck = (legacyCheck.rows[0] as { data: unknown }).data as { revision: number; payload: { orders: { details: { checklists: { questions: { answer: unknown }[] }[] } }[] } };
      expect(rawCheck.payload.orders[0].details.checklists[0].questions[5].answer).toBe("Não");
      report.checklists[0].questions[5].answer = "Nao";
      await mutate("report", report, rawCheck.revision);
      saved = await snapshot();
      report.checklists[0].questions[6].answer = "12.ABC.345/01DE-35";
      await mutate("report", report, saved.revision);
      saved = await snapshot();
      await expect(mutate("report", { ...report, attachments: [] }, saved.revision)).rejects.toThrow("Foto");
      await mutate("Check-out", { location: gps }, saved.revision);
    });

    it("bloqueia checkout sem snapshot obrigatório e ignora catálogo/mapeamentos na projeção mobile", async () => {
      await questionnaireFixture([]);
      let current = await snapshot();
      await expect(mutate("Check-out", { location: gps }, current.revision)).rejects.toThrow("Questionário obrigatório");
      await expect(mutate("Check-out", { location: gps, questionnaireRequired: false, checklists: [] }, current.revision)).rejects.toThrow("Questionário obrigatório");
      await identity(owner);
      const raw = await db.query<{ payload: unknown }>("select payload from public.company_data where company_id=$1", [company]);
      const full = validateDatabase(raw.rows[0].payload);
      full.questionnaires = [{
        id: "secret-catalog", title: "Catálogo privado", revision: 1, archived: false, requiredForCheckout: true,
        header: "", footer: "", display: list.display,
        questions: [{ id: "q", label: "Privada", kind: "Texto", required: false, options: [] }],
      }];
      full.orderTypeQuestionnaires = [{ type: "Corretiva", questionnaireId: "secret-catalog", required: false }];
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(full), current.revision]);
      await identity(tech);
      const projected = await db.query<{ data: { payload: Record<string, unknown> } }>("select public.mobile_company_data() as data");
      expect(projected.rows[0].data.payload).not.toHaveProperty("questionnaires");
      expect(projected.rows[0].data.payload).not.toHaveProperty("orderTypeQuestionnaires");
      current = await snapshot();
      expect(getOrderDetails(current.payload.orders[0]).questionnaireRequired).toBe(true);
      await expect(mutate("Check-out", { location: gps }, current.revision)).rejects.toThrow("Questionário obrigatório");
    });

    it("restaura backups legados com defaults ausentes e assinatura compartilhada sem migrar silenciosamente", async () => {
      const report = await questionnaireFixture([{
        id: "legacy", title: "Backup", equipmentId: "",
        questions: [
          { id: "legacy-1", label: "Primeira", kind: "Assinatura", required: true, options: [], answer: "" },
          { id: "legacy-2", label: "Segunda", kind: "Assinatura", required: true, options: [], answer: "" },
        ],
      }]);
      await identity(owner);
      let current = await snapshot();
      const raw = await db.query<{ payload: unknown }>("select payload from public.company_data where company_id=$1", [company]);
      const backup = validateDatabase(raw.rows[0].payload);
      const details = getOrderDetails(backup.orders[0]);
      delete (details.checklists[0] as unknown as Record<string, unknown>).equipmentId;
      for (const question of details.checklists[0].questions) {
        delete (question as unknown as Record<string, unknown>).options;
        delete (question as unknown as Record<string, unknown>).answer;
      }
      backup.orders[0].details = details;
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(backup), current.revision]);
      await identity(tech);
      current = await snapshot();
      report.signature = signature;
      await mutate("report", report, current.revision);
      current = await snapshot();
      const saved = getOrderDetails(current.payload.orders[0]);
      expect(saved.checklists[0].questions.every((question) => question.signature === undefined)).toBe(true);
      expect(saved.signature?.signer).toBe("Cliente");
      report.signature = saved.signature;
      report.checklists[0].questions[0].signature = null;
      await mutate("report", report, current.revision);
      current = await snapshot();
      await expect(mutate("Check-out", { location: gps }, current.revision)).rejects.toThrow("obrigatórios");
      report.checklists[0].questions[0].signature = { ...signature, signer: "Primeira própria" };
      await mutate("report", report, current.revision);
      current = await snapshot();
      expect(getOrderDetails(current.payload.orders[0]).checklists[0].questions[1].signature).toBeUndefined();
      expect(getOrderDetails(current.payload.orders[0]).signature?.at).toBe(saved.signature?.at);
      await mutate("Check-out", { location: gps }, current.revision);
    });
  });
  it("nega acesso anônimo e vinculação por técnicos", async () => {
    await expect(db.query("select public.link_company_technician('other@example.test','Outro')")).rejects.toThrow();
    await identity("", "anon");
    await expect(db.query("select public.mobile_company_data()")).rejects.toThrow();
    await identity(tech);
  });
  it("exige GPS válido, sequência e revisão; utiliza hora do servidor", async () => {
    await expect(mutate("Check-in", {}, 0)).rejects.toThrow("Localização");
    await expect(mutate("Check-in", { location: { ...gps, latitude: 99 } }, 0)).rejects.toThrow("Localização");
    await expect(mutate("Check-out", { location: gps }, 0)).rejects.toThrow("Sequência");
    await mutate("Check-in", { location: gps, at: "1900-01-01", technician: "Impostor" }, 0);
    let data = await snapshot();
    expect(data.payload.orders[0].status).toBe("Em atendimento");
    expect(technicianAgendaOrders(data.payload.orders, "running", "2026-10-10", "2026-10-10")).toHaveLength(1);
    const first = getOrderDetails(data.payload.orders[0]).activities[0];
    expect(first.technician).toBe("Técnico");
    expect(Date.parse(first.at)).toBeGreaterThan(Date.now() - 60000);
    expect(first.location?.capturedAt).toBe(first.at);
    await expect(mutate("Pausa", { reason: "Intervalo" }, 0)).rejects.toThrow("Sincronize");
    await expect(mutate("Check-in", { location: gps }, data.revision)).rejects.toThrow("Sequência");
    await expect(mutate("Pausa", {}, data.revision)).rejects.toThrow("motivo");
    await mutate("Pausa", { reason: "Intervalo" }, data.revision);
    data = await snapshot();
    expect(data.payload.orders[0].status).toBe("Pausada");
    expect(technicianAgendaOrders(data.payload.orders, "running", "2026-10-10", "2026-10-10")).toHaveLength(1);
    await expect(mutate("Check-out", { location: gps }, data.revision)).rejects.toThrow("Sequência");
    await mutate("Retorno", {}, data.revision);
    data = await snapshot();
    expect(data.payload.orders[0].status).toBe("Em atendimento");
    await mutate("Check-out", { location: gps }, data.revision);
    data = await snapshot();
    expect(data.payload.orders[0].status).toBe("Finalizada");
    expect(technicianAgendaOrders(data.payload.orders, "running", "2026-10-10", "2026-10-10")).toEqual([]);
    expect(technicianAgendaOrders(data.payload.orders, "overdue", "2099-01-01", "2099-01-01")).toEqual([]);
    expect(getOrderDetails(data.payload.orders[0]).activities).toHaveLength(4);
    await expect(mutate("Check-in", { location: gps }, data.revision)).rejects.toThrow("finalizada");
  });
  it("salva relato sem permitir reatribuir tarefa ou alterar financeiro", async () => {
    const data = await snapshot();
    const report = { report: "Atendimento concluído", distanceKm: 8, attachments: [], checklists: [], signature: null, pending: [] };
    await expect(mutate("report", { ...report, technicianUserId: other }, data.revision)).rejects.toThrow("Campos");
    await expect(mutate("report", { ...report, items: [] }, data.revision)).rejects.toThrow("Campos");
    await mutate("report", report, data.revision);
    expect(getOrderDetails((await snapshot()).payload.orders[0]).report).toBe("Atendimento concluído");
  });
  it("administrador lista equipe e valida vínculos nas gravações do painel", async () => {
    await identity(owner);
    const result = await db.query<{ data: { userId: string }[] }>("select public.list_company_technicians() as data");
    expect(result.rows[0].data).toHaveLength(3);
    await db.query("select public.link_company_technician('tech@example.test','Técnico')");
    await expect(db.query("select public.link_company_technician('missing@example.test','Novo')")).rejects.toThrow("Crie primeiro");
    const current = await snapshot();
    const invalid = structuredClone(payload);
    invalid.orders[0].technicianUserId = "00000000-0000-4000-8000-999999999999";
    await expect(db.query("select public.save_company_data($1,$2)", [JSON.stringify(invalid), current.revision])).rejects.toThrow("não vinculada");
  });
  it("não vincula gestores silenciosamente nem usuários de outra empresa", async () => {
    await identity(owner);
    await db.exec("reset role");
    const foreign = "00000000-0000-4000-8000-000000000004";
    const foreignCompany = "10000000-0000-4000-8000-000000000002";
    await db.query("insert into auth.users values ($1,'foreign@example.test')", [foreign]);
    await db.query("insert into public.companies(id,name,created_by) values ($1,'Outra empresa',$2)", [foreignCompany, foreign]);
    await db.query("insert into public.company_memberships(user_id,company_id,role) values ($1,$2,'technician')", [foreign, foreignCompany]);
    await db.query("update public.company_memberships set role='manager' where user_id=$1", [other]);
    await identity(owner);
    await expect(db.query("select public.link_company_technician('foreign@example.test','Externo')")).rejects.toThrow("outra empresa");
    await expect(db.query("select public.link_company_technician('other@example.test','Gestor')")).rejects.toThrow("perfil de gestor");
    await db.exec("reset role");
    await db.query("update public.company_memberships set role='technician' where user_id=$1", [other]);
    await identity(owner);
  });
  it("exige respostas e pendências resolvidas, preservando os modelos", async () => {
    await identity(owner);
    const before = await snapshot();
    const data = structuredClone(payload);
    const details = getOrderDetails(data.orders[0]);
    details.pending = [{ id: "manual", title: "Verificar motor", resolved: false }];
    details.checklists = [{
      id: "checklist", title: "Inspeção", equipmentId: "",
      questions: [
        { id: "text", label: "Relato obrigatório", kind: "Texto", required: true, options: [], answer: "" },
        { id: "choice", label: "Situação", kind: "Escolha", required: true, options: ["OK", "Falha"], answer: "" },
        { id: "sign", label: "Assinar", kind: "Assinatura", required: true, options: [], answer: "" },
      ],
    }];
    data.orders[0].details = details;
    await db.query("select public.save_company_data($1,$2)", [JSON.stringify(data), before.revision]);
    await identity(tech);
    let current = await snapshot();
    await mutate("Check-in", { location: gps }, current.revision);
    current = await snapshot();
    const report = {
      report: "Inspeção", distanceKm: 1, attachments: [],
      checklists: details.checklists, signature: null,
      pending: [{ ...details.pending[0], resolved: true }],
    };
    await expect(mutate("report", { ...report, pending: [] }, current.revision)).rejects.toThrow("remover pendências");
    const altered = structuredClone(report);
    altered.checklists[0].questions[0].required = false;
    await expect(mutate("report", altered, current.revision)).rejects.toThrow("inválida");
    const answered = structuredClone(report);
    answered.checklists[0].questions[0].answer = " ";
    answered.checklists[0].questions[1].answer = "Inventado";
    await expect(mutate("report", answered, current.revision)).rejects.toThrow("Opção");
    answered.checklists[0].questions[1].answer = "OK";
    await mutate("report", answered, current.revision);
    current = await snapshot();
    await expect(mutate("Check-out", { location: gps }, current.revision)).rejects.toThrow("obrigatórios");
    answered.checklists[0].questions[0].answer = "Concluído";
    await mutate("report", {
      ...answered, signature: { signer: "Cliente", image: "data:image/png;base64,YWJj", at: "client-clock" },
    }, current.revision);
    current = await snapshot();
    const signature = getOrderDetails(current.payload.orders[0]).signature;
    expect(signature?.at).not.toBe("client-clock");
    await mutate("report", { ...answered, signature }, current.revision);
    current = await snapshot();
    expect(getOrderDetails(current.payload.orders[0]).signature?.at).toBe(signature?.at);
    await mutate("Check-out", { location: gps }, current.revision);
    expect((await snapshot()).payload.orders[0].status).toBe("Finalizada");
  });
  it("permite novo atendimento somente depois de o administrador reabrir a OS", async () => {
    await identity(owner);
    const current = await snapshot();
    const raw = await db.query<{ payload: unknown }>("select payload from public.company_data where company_id=$1", [company]);
    const full = validateDatabase(raw.rows[0].payload);
    full.orders[0].status = "Aberta";
    await db.query("select public.save_company_data($1,$2)", [JSON.stringify(full), current.revision]);
    await identity(tech);
    const before = await snapshot();
    await mutate("Check-in", { location: gps }, before.revision);
    const after = await snapshot();
    expect(after.payload.orders[0].status).toBe("Em atendimento");
    expect(getOrderDetails(after.payload.orders[0]).activities.at(-1)?.kind).toBe("Check-in");
  });
  it("reserva no check-in e registra o consumo no checkout do técnico", async () => {
    await identity(owner);
    const raw = await db.query<{ payload: unknown; revision: number }>(
      "select payload,revision from public.company_data where company_id=$1", [company]);
    const original = raw.rows[0];
    try {
      const data = validateDatabase(original.payload), order = data.orders[0], product = data.products[0];
      order.status = "Aberta";
      order.details = { ...getOrderDetails(order), activities: [], pending: [], checklists: [], items: [{
        id: "mobile-stock-line", kind: "produto", referenceId: product.id, name: product.name,
        quantity: 2, price: 1000, discount: 0,
      }] };
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(data), original.revision]);
      await identity(tech);
      let current = await snapshot();
      await mutate("Check-in", { location: gps }, current.revision);
      await identity(owner);
      let stored = validateDatabase((await db.query<{ payload: unknown }>(
        "select payload from public.company_data where company_id=$1", [company])).rows[0].payload);
      expect(stored.inventory!.reservations.at(-1)?.events.at(-1)?.status).toBe("Reservada");
      expect(stored.products.find((item) => item.id === product.id)?.stock).toBe(product.stock);
      await identity(tech);
      current = await snapshot();
      await mutate("Check-out", { location: gps }, current.revision);
      await identity(owner);
      stored = validateDatabase((await db.query<{ payload: unknown }>(
        "select payload from public.company_data where company_id=$1", [company])).rows[0].payload);
      expect(stored.products.find((item) => item.id === product.id)?.stock).toBe(product.stock - 2);
      expect(stored.inventory!.reservations.at(-1)?.events.at(-1)?.status).toBe("Consumida");
      expect(stored.movements[0].source).toMatchObject({
        type: "consumption", referenceId: stored.inventory!.reservations.at(-1)!.id, lineId: "mobile-stock-line",
      });
    } finally {
      await db.exec("reset role");
      await db.exec("alter table public.company_data disable trigger guard_inventory");
      await db.exec("alter table public.company_data disable trigger guard_purchases");
      await db.query("update public.company_data set payload=$1,revision=$2 where company_id=$3",
        [JSON.stringify(original.payload), original.revision, company]);
      await db.exec("alter table public.company_data enable trigger guard_inventory");
      await db.exec("alter table public.company_data enable trigger guard_purchases");
      await identity(tech);
    }
  });
  it("valida a contagem física no banco e impede reescrever sua auditoria", async () => {
    await identity(owner);
    const raw = await db.query<{ payload: unknown; revision: number }>(
      "select payload,revision from public.company_data where company_id=$1", [company]);
    const original = raw.rows[0];
    try {
      const data = validateDatabase(original.payload);
      const product = data.products[0], locationId = data.inventory!.defaultLocationId;
      const countedQuantity = stockLocationBalance(data, product.id, locationId) + 1;
      const count = countStock(data, product.id, locationId,
        countedQuantity, "Conferência cíclica de teste.");
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(count), original.revision]);
      const savedRaw = await db.query<{ payload: unknown; revision: number }>(
        "select payload,revision from public.company_data where company_id=$1", [company]);
      const saved = validateDatabase(savedRaw.rows[0].payload);
      expect(saved.inventory!.counts[0]).toMatchObject({
        productId: product.id, countedQuantity,
      });
      expect(saved.movements[0].source).toMatchObject({
        type: "inventory", referenceId: saved.inventory!.counts[0].id,
      });
      const altered = structuredClone(saved) as ReturnType<typeof validateDatabase>;
      altered.inventory!.counts[0].reason += " alterada";
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(altered), savedRaw.rows[0].revision])).rejects.toThrow("Historico de estoque");
    } finally {
      await db.exec("reset role");
      await db.exec("alter table public.company_data disable trigger guard_inventory");
      await db.exec("alter table public.company_data disable trigger guard_purchases");
      await db.query("update public.company_data set payload=$1,revision=$2 where company_id=$3",
        [JSON.stringify(original.payload), original.revision, company]);
      await db.exec("alter table public.company_data enable trigger guard_inventory");
      await db.exec("alter table public.company_data enable trigger guard_purchases");
      await identity(tech);
    }
  });
  it("protege movimentos append-only e os vínculos do recebimento contra gravação direta", async () => {
    await identity(owner);
    const stored = await db.query<{ payload: unknown; revision: number }>(
      "select payload,revision from public.company_data where company_id=$1", [company]);
    const alteredMovement = structuredClone(stored.rows[0].payload) as ReturnType<typeof validateDatabase>;
    alteredMovement.movements[0].reason += " alterado";
    await expect(db.query("select public.save_company_data($1,$2)",
      [JSON.stringify(alteredMovement), stored.rows[0].revision])).rejects.toThrow("estoque");
    const alteredReceipt = structuredClone(stored.rows[0].payload) as ReturnType<typeof validateDatabase>;
    const purchase = alteredReceipt.finance.purchasing!.orders.find((item) => item.receipt?.stockItems?.length)!;
    purchase.receipt!.stockItems![0].productId = "produto-inexistente";
    await expect(db.query("select public.save_company_data($1,$2)",
      [JSON.stringify(alteredReceipt), stored.rows[0].revision])).rejects.toThrow();
    const alteredAverage = structuredClone(stored.rows[0].payload) as ReturnType<typeof validateDatabase>;
    const costedMovement = alteredAverage.movements.find((item) => item.averageCostAfter !== undefined)!;
    alteredAverage.products.find((item) => item.id === costedMovement.productId)!.cost += 1;
    await expect(db.query("select public.save_company_data($1,$2)",
      [JSON.stringify(alteredAverage), stored.rows[0].revision])).rejects.toThrow("Custo medio atual");
  });
  it("aceita entrega parcial no SQL e protege quantidade, histórico e cancelamento do saldo", async () => {
    await identity(owner);
    const original = (await db.query<{ payload: unknown; revision: number }>(
      "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
    try {
      const data = validateDatabase(original.payload);
      const supplier = purchasing(data).suppliers[0], product = data.products[0];
      const order = savePurchaseOrder(data, {
        id: "sql-partial-purchase", supplierId: supplier.id, supplierName: supplier.name,
        supplierDocument: supplier.document, description: "Compra parcial para teste",
        orderedOn: localDay(), createdAt: new Date().toISOString(), accountId: "private-bank",
        paymentMethod: "Pix", items: [{ description: product.name, productId: product.id, quantity: 2, unitCost: 100 }],
        schedule: [{ dueOn: localDay(), amount: 200 }],
        procurement: approvedQuotes({ id: "sql-partial-purchase", supplierId: supplier.id, orderedOn: localDay(),
          items: [{ description: product.name, quantity: 2, unitCost: 100 }] }, purchasing(data).suppliers),
      }, true);
      const pending = purchasing(order).orders.find((item) => item.id === "sql-partial-purchase")!;
      const partial = receivePurchaseOrder(order, pending, {
        date: localDay(), reference: "NF parcial", notes: "Conferência parcial SQL",
        quantities: { [pending.items[0].id!]: 1 },
      }, true);
      expect(partial.finance.entries.filter((entry) => entry.purchaseId === pending.id)).toEqual([]);
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(partial), original.revision]);
      const savedRaw = (await db.query<{ payload: unknown; revision: number }>(
        "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
      const saved = validateDatabase(savedRaw.payload);
      expect(saved.inventory!.purchaseReceipts.at(-1)?.items[0].quantity).toBe(1);
      const altered = structuredClone(saved) as ReturnType<typeof validateDatabase>;
      altered.inventory!.purchaseReceipts.at(-1)!.items[0].quantity = 2;
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(altered), savedRaw.revision])).rejects.toThrow("Historico de estoque");
      const cancelled = structuredClone(saved) as ReturnType<typeof validateDatabase>;
      cancelled.finance.purchasing!.orders.find((item) => item.id === pending.id)!.cancellation = {
        at: new Date().toISOString(), reason: "Cancelar saldo parcialmente entregue",
      };
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(cancelled), savedRaw.revision])).rejects.toThrow();
      const removed = structuredClone(saved) as ReturnType<typeof validateDatabase>;
      removed.inventory!.purchaseReceipts.pop();
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(removed), savedRaw.revision])).rejects.toThrow("Historico de estoque");
    } finally {
      await db.exec("reset role");
      await db.exec("alter table public.company_data disable trigger guard_inventory");
      await db.exec("alter table public.company_data disable trigger guard_purchases");
      await db.query("update public.company_data set payload=$1,revision=$2 where company_id=$3",
        [JSON.stringify(original.payload), original.revision, company]);
      await db.exec("alter table public.company_data enable trigger guard_inventory");
      await db.exec("alter table public.company_data enable trigger guard_purchases");
      await identity(tech);
    }
  });
  it("valida devoluções de compra no SQL, limita recebimentos e protege o histórico append-only", async () => {
    await identity(owner);
    const original = (await db.query<{ payload: unknown; revision: number }>(
      "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
    try {
      const data = validateDatabase(original.payload), supplier = purchasing(data).suppliers[0], product = data.products[0];
      const savedOrderData = savePurchaseOrder(data, {
        id: "sql-purchase-return", supplierId: supplier.id, supplierName: supplier.name,
        supplierDocument: supplier.document, description: "Compra para devolução SQL",
        orderedOn: localDay(), createdAt: new Date().toISOString(), accountId: "private-bank",
        paymentMethod: "Pix", items: [{ description: product.name, productId: product.id, quantity: 2, unitCost: 100 }],
        schedule: [{ dueOn: localDay(), amount: 200 }],
        procurement: approvedQuotes({ id: "sql-purchase-return", supplierId: supplier.id, orderedOn: localDay(),
          items: [{ description: product.name, quantity: 2, unitCost: 100 }] }, purchasing(data).suppliers),
      }, true);
      const order = purchasing(savedOrderData).orders.find((item) => item.id === "sql-purchase-return")!;
      const partial = receivePurchaseOrder(savedOrderData, order, {
        date: localDay(), reference: "NF parcial", notes: "Primeira parte recebida",
        quantities: { [order.items[0].id!]: 1 },
      }, true);
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(partial), original.revision]);
      const partialRaw = (await db.query<{ payload: unknown; revision: number }>(
        "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
      const partialSaved = validateDatabase(partialRaw.payload), locationId = partialSaved.inventory!.defaultLocationId;
      const available = availablePurchaseReturnItems(partialSaved, order.id, locationId)[0];
      expect(available.returnableQuantity).toBe(1);
      const returned = returnPurchaseStock(partialSaved, order.id, locationId, { [available.lineId]: 1 }, {
        date: localDay(), reference: "DEV SQL", reason: "Devolução de teste SQL",
      }, true);
      const firstReturn = returned.inventory!.purchaseReturns.at(-1)!;
      const firstCredit = returned.finance.entries.find((entry) => entry.purchaseReturnCreditId === firstReturn.id);
      expect(firstReturn.financial).toMatchObject({ amount: 100, payableOffsets: [] });
      expect(firstCredit).toMatchObject({ kind: "Receber", amount: 100, purchaseReturnCreditId: firstReturn.id });
      const invalidCredit = structuredClone(returned) as ReturnType<typeof validateDatabase>;
      invalidCredit.inventory!.purchaseReturns.at(-1)!.financial!.amount += 1;
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(invalidCredit), partialRaw.revision])).rejects.toThrow();
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(returned), partialRaw.revision]);
      const creditRaw = (await db.query<{ payload: unknown; revision: number }>(
        "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
      const creditSaved = validateDatabase(creditRaw.payload);
      const completed = receivePurchaseOrder(creditSaved, order, {
        date: localDay(), reference: "NF final", notes: "Saldo recebido",
        quantities: { [order.items[0].id!]: 1 },
      }, true);
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(completed), creditRaw.revision]);
      const completedRaw = (await db.query<{ payload: unknown; revision: number }>(
        "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
      const completedSaved = validateDatabase(completedRaw.payload);
      const remaining = availablePurchaseReturnItems(completedSaved, order.id, locationId)[0];
      const returnedAgain = returnPurchaseStock(completedSaved, order.id, locationId, { [remaining.lineId]: 1 }, {
        date: localDay(), reference: "DEV SQL 2", reason: "Segunda devolução SQL",
      }, true);
      const secondReturn = returnedAgain.inventory!.purchaseReturns.at(-1)!;
      expect(secondReturn.financial).toMatchObject({ amount: 100, payableOffsets: [{ amount: 100 }] });
      const payable = returnedAgain.finance.entries.find((entry) => entry.purchaseId === order.id)!;
      expect(payable.purchaseReturnOffsets).toContainEqual({ returnId: secondReturn.id, amount: 100 });
      const secondLocationData = createStockLocation(completedSaved, "Depósito alternativo SQL");
      const secondLocationId = secondLocationData.inventory!.locations.at(-1)!.id;
      const transferred = transferStock(secondLocationData, product.id, locationId, secondLocationId, 1, "Teste SQL");
      const crossLocation = structuredClone(returnedAgain);
      crossLocation.inventory!.locations = transferred.inventory!.locations;
      crossLocation.inventory!.purchaseReturns.at(-1)!.items[0].locationId = secondLocationId;
      const crossLocationMovement = crossLocation.movements.find((movement) =>
        movement.source?.type === "purchaseReturn" && movement.source.referenceId === secondReturn.id)!;
      crossLocationMovement.locationId = secondLocationId;
      crossLocationMovement.balance = stockLocationBalance(transferred, product.id, secondLocationId) - 1;
      crossLocation.movements = [crossLocationMovement, ...transferred.movements];
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(crossLocation), completedRaw.revision])).rejects.toThrow();
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(returnedAgain), completedRaw.revision]);
      const savedRaw = (await db.query<{ payload: unknown; revision: number }>(
        "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
      const saved = validateDatabase(savedRaw.payload);
      expect(saved.inventory!.purchaseReturns.at(-1)?.items[0].quantity).toBe(1);
      const altered = structuredClone(saved) as ReturnType<typeof validateDatabase>;
      altered.inventory!.purchaseReturns.at(-1)!.items[0].quantity = 2;
      const alteredMovement = altered.movements.find((movement) =>
        movement.source?.type === "purchaseReturn" && movement.source.referenceId === secondReturn.id)!;
      alteredMovement.delta = -2;
      alteredMovement.balance -= 1;
      altered.products.find((item) => item.id === product.id)!.stock -= 1;
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(altered), savedRaw.revision])).rejects.toThrow();
      const removed = structuredClone(saved) as ReturnType<typeof validateDatabase>;
      removed.inventory!.purchaseReturns.pop();
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(removed), savedRaw.revision])).rejects.toThrow();
      const cancelSupplier = purchasing(saved).suppliers[0];
      const newOrderData = savePurchaseOrder(saved, {
        id: "sql-partial-cancel", supplierId: cancelSupplier.id, supplierName: cancelSupplier.name,
        supplierDocument: cancelSupplier.document, description: "Compra cancelada parcialmente",
        orderedOn: localDay(), createdAt: new Date().toISOString(), accountId: "private-bank",
        paymentMethod: "Pix", items: [{ description: product.name, productId: product.id, quantity: 10, unitCost: 100 }],
        schedule: previewPurchaseSchedule(1000, 3, localDay()),
        procurement: approvedQuotes({ id: "sql-partial-cancel", supplierId: cancelSupplier.id, orderedOn: localDay(),
          items: [{ description: product.name, quantity: 10, unitCost: 100 }] }, purchasing(saved).suppliers),
      }, true);
      const newOrder = purchasing(newOrderData).orders.find((item) => item.id === "sql-partial-cancel")!;
      const partialPurchase = receivePurchaseOrder(newOrderData, newOrder, {
        date: localDay(), reference: "NF parcial SQL", notes: "Uma unidade recebida",
        quantities: { [newOrder.items[0].id!]: 2 },
      }, true);
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(partialPurchase), savedRaw.revision]);
      const partialPurchaseRaw = (await db.query<{ payload: unknown; revision: number }>(
        "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
      const partialPurchaseSaved = validateDatabase(partialPurchaseRaw.payload);
      const canceledPurchase = cancelPurchaseOrder(partialPurchaseSaved,
        purchasing(partialPurchaseSaved).orders.find((item) => item.id === newOrder.id)!, "Fornecedor sem saldo", true);
      const canceledEntries = canceledPurchase.finance.entries.filter((entry) => entry.purchaseId === newOrder.id);
      expect(canceledEntries.map((entry) => entry.amount)).toEqual([67, 67, 66]);
      await db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(canceledPurchase), partialPurchaseRaw.revision]);
      const canceledRaw = (await db.query<{ payload: unknown; revision: number }>(
        "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
      const canceledSaved = validateDatabase(canceledRaw.payload);
      const canceledReturnable = availablePurchaseReturnItems(canceledSaved, newOrder.id, locationId)[0];
      const returnedAfterCancel = returnPurchaseStock(canceledSaved, newOrder.id, locationId,
        { [canceledReturnable.lineId]: 2 }, {
          date: localDay(), reference: "DEV cancelamento SQL", reason: "Devolução após cancelar saldo",
        }, true);
      expect(returnedAfterCancel.inventory!.purchaseReturns.at(-1)?.financial?.payableOffsets)
        .toHaveLength(canceledEntries.length);
      await db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(returnedAfterCancel), canceledRaw.revision]);
      const returnedCanceledRaw = (await db.query<{ payload: unknown; revision: number }>(
        "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
      const alteredCancellation = structuredClone(returnedAfterCancel) as ReturnType<typeof validateDatabase>;
      alteredCancellation.finance.purchasing!.orders.find((item) => item.id === newOrder.id)!
        .cancellation!.receivedAmount = 101;
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(alteredCancellation), returnedCanceledRaw.revision])).rejects.toThrow();
    } finally {
      await db.exec("reset role");
      await db.exec("alter table public.company_data disable trigger guard_inventory");
      await db.exec("alter table public.company_data disable trigger guard_finance_history");
      await db.exec("alter table public.company_data disable trigger guard_purchases");
      await db.exec("alter table public.company_data disable trigger guard_purchase_return_finance");
      await db.query("update public.company_data set payload=$1,revision=$2 where company_id=$3",
        [JSON.stringify(original.payload), original.revision, company]);
      await db.exec("alter table public.company_data enable trigger guard_inventory");
      await db.exec("alter table public.company_data enable trigger guard_finance_history");
      await db.exec("alter table public.company_data enable trigger guard_purchases");
      await db.exec("alter table public.company_data enable trigger guard_purchase_return_finance");
      await identity(tech);
    }
  });
  it("valida no SQL os estornos parciais de peças consumidas e impede excesso ou reescrita", async () => {
    await identity(owner);
    const original = (await db.query<{ payload: unknown; revision: number }>(
      "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
    try {
      const data = validateDatabase(original.payload), order = data.orders[0], product = data.products[0];
      order.status = "Aberta";
      order.details = { ...getOrderDetails(order), activities: [], items: [{
        id: "sql-reversal-line", kind: "produto", referenceId: product.id, name: product.name,
        quantity: 2, price: 1000, discount: 0,
      }] };
      const finalized = changeOrderStatus(validateDatabase(data), order.id, "Finalizada");
      const line = reversibleConsumptionItems(finalized, order.id)[0];
      const reversed = reverseOrderConsumption(finalized, order.id, { [line.id]: 1 },
        "Peça não utilizada.", true);
      await db.query("select public.save_company_data($1,$2)", [JSON.stringify(reversed), original.revision]);
      const savedRaw = (await db.query<{ payload: unknown; revision: number }>(
        "select payload,revision from public.company_data where company_id=$1", [company])).rows[0];
      const saved = validateDatabase(savedRaw.payload);
      expect(saved.inventory!.consumptionReversals.at(-1)?.items[0].quantity).toBe(1);
      const altered = structuredClone(saved) as ReturnType<typeof validateDatabase>;
      altered.inventory!.consumptionReversals.at(-1)!.items[0].quantity = 2;
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(altered), savedRaw.revision])).rejects.toThrow();
      const removed = structuredClone(saved) as ReturnType<typeof validateDatabase>;
      removed.inventory!.consumptionReversals.pop();
      await expect(db.query("select public.save_company_data($1,$2)",
        [JSON.stringify(removed), savedRaw.revision])).rejects.toThrow("Historico de estoque");
    } finally {
      await db.exec("reset role");
      await db.exec("alter table public.company_data disable trigger guard_inventory");
      await db.exec("alter table public.company_data disable trigger guard_purchases");
      await db.query("update public.company_data set payload=$1,revision=$2 where company_id=$3",
        [JSON.stringify(original.payload), original.revision, company]);
      await db.exec("alter table public.company_data enable trigger guard_inventory");
      await db.exec("alter table public.company_data enable trigger guard_purchases");
      await identity(tech);
    }
  });
  it("confere bytes reais dos anexos e limite total, preservando a data original", async () => {
    const current = await snapshot();
    const details = getOrderDetails(current.payload.orders[0]);
    const report = {
      report: details.report, distanceKm: details.distanceKm,
      attachments: details.attachments, checklists: details.checklists,
      signature: details.signature, pending: details.pending,
    };
    const file = { id: "file", name: "nota.txt", mime: "text/plain", size: 3, data: "data:text/plain;base64,YWJj", at: "untrusted-clock" };
    await expect(mutate("report", { ...report, attachments: [{ ...file, size: 1 }] }, current.revision)).rejects.toThrow("Tamanho");
    const large = Buffer.alloc(500000).toString("base64");
    const oversized = Array.from({ length: 8 }, (_, index) => ({ ...file, id: `file-${index}`, size: 500000, data: `data:text/plain;base64,${large}` }));
    await expect(mutate("report", { ...report, attachments: oversized }, current.revision)).rejects.toThrow("5 MB");
    expect((await snapshot()).revision).toBe(current.revision);
    await mutate("report", { ...report, attachments: [file] }, current.revision);
    let saved = await snapshot();
    const attachment = getOrderDetails(saved.payload.orders[0]).attachments[0];
    expect(attachment.at).not.toBe("untrusted-clock");
    await mutate("report", { ...report, attachments: [attachment] }, saved.revision);
    saved = await snapshot();
    expect(getOrderDetails(saved.payload.orders[0]).attachments[0].at).toBe(attachment.at);
  });
  it("grava aprovação auditável, rejeita ator falso e congela os termos no banco", async () => {
    const quoteOwner = "00000000-0000-4000-8000-000000000005";
    const quoteCompany = "10000000-0000-4000-8000-000000000005";
    await db.exec("reset role");
    await db.query("insert into auth.users values ($1,'quote-owner@example.test')", [quoteOwner]);
    await db.query("insert into public.companies(id,name,created_by) values ($1,'Aprovação de orçamento',$2)",
      [quoteCompany, quoteOwner]);
    await db.query("insert into public.company_memberships(user_id,company_id,role,display_name) values ($1,$2,'owner','Responsável de teste')",
      [quoteOwner, quoteCompany]);

    const initial = demoDatabase();
    initial.quotes = initial.quotes.map((quote) => {
      const draft = structuredClone(quote);
      delete draft.approval;
      return { ...draft, status: "Rascunho" as const };
    });
    await db.query("insert into public.company_data(company_id,payload) values ($1,$2)",
      [quoteCompany, JSON.stringify(initial)]);
    await identity(quoteOwner);
    const wrongActor = changeQuoteStatus(initial, initial.quotes[0].id, "Aprovado", {
      userId: other,
      name: "Outro usuário",
    });
    await expect(db.query("select public.save_company_data($1::jsonb,0)", [JSON.stringify(wrongActor)]))
      .rejects.toThrow("usuário autenticado");

    const approved = changeQuoteStatus(initial, initial.quotes[0].id, "Aprovado", {
      userId: quoteOwner,
      name: "Nome informado pelo cliente",
    }, "2000-01-01T00:00:00.000Z");
    await db.query("select public.save_company_data($1::jsonb,0)", [JSON.stringify(approved)]);
    const storedResult = await db.query<{ payload: typeof approved }>(
      "select payload from public.company_data where company_id=$1", [quoteCompany]);
    const stored = storedResult.rows[0].payload;
    expect(stored.quotes[0].approval).toMatchObject({
      approverUserId: quoteOwner,
      approverName: "Responsável de teste",
    });
    expect(stored.quotes[0].approval!.at).not.toBe(approved.quotes[0].approval!.at);

    const altered = structuredClone(stored);
    altered.quotes[0].discount += 1;
    await expect(db.query("select public.save_company_data($1::jsonb,1)", [JSON.stringify(altered)]))
      .rejects.toThrow("imutáveis");
  });
});
