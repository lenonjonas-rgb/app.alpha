import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { demoDatabase, getOrderDetails } from "../src/domain.ts";

const db = new PGlite();
const userId = "00000000-0000-4000-8000-000000000002";
const ownerId = "00000000-0000-4000-8000-000000000001";
const companyId = "10000000-0000-4000-8000-000000000001";
const migration = await readFile(new URL("../../supabase/migrations/20261009010000_android_technicians.sql", import.meta.url), "utf8");
await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as
    'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
  grant usage on schema auth to anon,authenticated;
  grant execute on function auth.uid() to anon,authenticated;
`);
await db.exec(await readFile(new URL("../../supabase/migrations/20261008010000_tenant_auth_and_company_data.sql", import.meta.url), "utf8"));
await db.exec(migration);
await db.exec(await readFile(new URL("../../supabase/migrations/20261009020000_technician_link_validation.sql", import.meta.url), "utf8"));
await db.query("insert into auth.users values ($1,'admin@example.test'),($2,'tecnico@example.test')", [ownerId, userId]);
await db.query("insert into public.companies(id,name,created_by) values ($1,'Alpha Tec Teste',$2)", [companyId, ownerId]);
await db.query("insert into public.company_memberships(user_id,company_id,role,display_name) values ($1,$3,'owner','Admin'),($2,$3,'technician','Técnico Teste')", [ownerId, userId, companyId]);
const payload = demoDatabase();
payload.orders[0].technicianUserId = userId;
payload.orders[0].status = "Aberta";
payload.orders[0].details = {
  ...getOrderDetails(payload.orders[0]),
  pending: [{ id: "pending", title: "Conferir funcionamento", resolved: false }],
  checklists: [{ id: "questions", title: "Verificação", equipmentId: "", questions: [
    { id: "result", label: "Resultado do teste", kind: "Texto", required: true, options: [], answer: "" },
  ] }],
};
await db.query("insert into public.company_data(company_id,payload) values ($1,$2)", [companyId, JSON.stringify(payload)]);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
await db.exec("set role authenticated");
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "tecnico@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const encoded = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated", role: "authenticated" })}.test-signature`;
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Content-Type", "application/json");
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204); response.end();
    } else if (request.url === "/link-migration") {
      response.setHeader("Content-Type", "text/plain");
      response.end(await readFile(new URL("../../supabase/migrations/20261009020000_technician_link_validation.sql", import.meta.url), "utf8"));
    } else if (request.url === "/order-migration") {
      response.setHeader("Content-Type", "text/plain");
      const source = await readFile(new URL("../../supabase/migrations/20261009010000_android_technicians.sql", import.meta.url), "utf8");
      const start = source.indexOf("create function public.mobile_update_order(");
      const end = source.indexOf("\nrevoke all on function", start);
      if (start < 0 || end < 0) throw new Error("Definição da RPC não encontrada.");
      response.end(`begin;\n${source.slice(start, end).replace("create function", "create or replace function")}\ncommit;`);
    } else if (request.url === "/migration") {
      response.setHeader("Content-Type", "text/plain");
      response.end(migration);
    } else if (request.url === "/login") {
      response.end(JSON.stringify({ user, access_token: token, refresh_token: "test-refresh", expires_in: 3600, token_type: "bearer" }));
    } else if (request.url === "/user") {
      response.end(JSON.stringify(user));
    } else if (request.url === "/snapshot") {
      const result = await db.query<{ data: unknown }>("select public.mobile_company_data() as data");
      response.end(JSON.stringify(result.rows[0].data));
    } else if (request.url === "/action" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      const result = await db.query<{ data: unknown }>("select public.mobile_update_order($1,$2,$3::jsonb,$4) as data", [input.p_order_id, input.p_action, JSON.stringify(input.p_data), input.p_expected_revision]);
      response.end(JSON.stringify(result.rows[0].data));
    } else {
      response.writeHead(404);
      response.end(JSON.stringify({ message: "Endpoint de teste não encontrado." }));
    }
  } catch (cause) {
    console.error(cause);
    response.writeHead(400);
    response.end(JSON.stringify({ message: cause instanceof Error ? cause.message : String(cause) }));
  }
});
server.listen(5180, "127.0.0.1", () => console.log("Mobile smoke fixtures: http://127.0.0.1:5180 (dados fictícios em PostgreSQL isolado)"));
