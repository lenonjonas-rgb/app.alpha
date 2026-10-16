import { test } from "node:test";
import assert from "node:assert/strict";
import { SupabaseAuth, type Context, type FinanceChange } from "../src/auth.js";

const context: Context = { tenant: "company", actor: "owner", role: "owner", token: "user-session" };
const change: FinanceChange = { action: "cancel", entry: { id: "entry", invoiceId: "invoice", kind: "Receber",
  party: "Cliente", clientId: "client", amount: 1000, issuedOn: "2026-10-15", dueOn: "2026-11-01", paymentMethod: "Boleto",
  accountId: "bank", canceled: false, settlements: [] },
invoice: { id: "invoice", clientId: "client", kind: "Produtos", amount: 1000, canceled: false } };
test("aprovação financeira usa RPC privada da mesma empresa e não substitui autenticação pela chave privilegiada", async () => {
  const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    assert.ok(init?.signal);
    return String(input).includes("/rpc/") ? new Response(null, { status: 204 }) :
      Response.json([{ payload: { clients: [], finance: { accounts: [], entries: [], invoices: [] } } }]);
  };
  const auth = new SupabaseAuth("https://supabase.example", "public-key", fetcher, "private-test-key");
  await auth.company(context);
  await auth.approveFinanceChange(context, change);
  assert.equal(requests[0]!.headers.get("apikey"), "public-key");
  assert.equal(requests[0]!.headers.get("authorization"), "Bearer user-session");
  const approval = requests[1]!;
  assert.equal(approval.url, "https://supabase.example/rest/v1/rpc/approve_finance_change");
  assert.equal(approval.headers.get("apikey"), "private-test-key");
  assert.equal(approval.headers.get("authorization"), "Bearer private-test-key");
  assert.deepEqual(approval.body, { p_company: context.tenant, p_actor: context.actor, p_entry: change.entry,
    p_invoice: change.invoice, p_action: "cancel", p_retention: null });
});
test("sem configuração/migração/permissão não retorna sucesso nem expõe resposta ou segredo", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response("private-test-key/internal data", { status: 403 }); };
  const missing = new SupabaseAuth("https://supabase.example", "public-key", fetcher);
  await assert.rejects(missing.approveFinanceChange(context, change), /Configure SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(calls, 0);
  const configured = new SupabaseAuth("https://supabase.example", "public-key", fetcher, "private-test-key");
  await assert.rejects(configured.approveFinanceChange(context, change), (error: Error) => {
    assert.match(error.message, /Não foi possível autorizar/);
    assert.doesNotMatch(error.message, /private-test-key|internal data/);
    return true;
  });
});
