import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createServer as createViteServer } from "vite";
import type * as Domain from "../src/domain.ts";

const vite = await createViteServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true },
});
let domain: typeof Domain;
try {
  domain = await vite.ssrLoadModule("/src/domain.ts") as typeof Domain;
} finally {
  await vite.close();
}
const { demoDatabase, getOrderDetails, validateDatabase } = domain;

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
await db.exec(await readFile(new URL("../../supabase/migrations/20261010010000_questionnaires.sql", import.meta.url), "utf8"));
await db.query("insert into auth.users values ($1,'admin@example.test'),($2,'tecnico@example.test')", [ownerId, userId]);
await db.query("insert into public.companies(id,name,created_by) values ($1,'Alpha Tec Teste',$2)", [companyId, ownerId]);
await db.query("insert into public.company_memberships(user_id,company_id,role,display_name) values ($1,$3,'owner','Admin'),($2,$3,'technician','Técnico Teste')", [ownerId, userId, companyId]);
const payload = demoDatabase();
payload.orders[0].technicianUserId = userId;
payload.orders[0].status = "Aberta";
const equipmentId = "smoke-equipment";
payload.equipment.push({
  id: equipmentId, clientId: payload.orders[0].clientId,
  name: "Equipamento de teste mobile", serial: "MOBILE-001",
  category: "Teste", warranty: "",
  notes: "Equipamento associado ao questionário de verificação.",
});
payload.orders[0].equipmentId = equipmentId;
payload.orders[0].details = {
  ...getOrderDetails(payload.orders[0]),
  questionnaireRequired: true,
  pending: [{ id: "pending", title: "Conferir funcionamento", resolved: false }],
  checklists: [{
    id: "questions", title: "Verificação", equipmentId,
    templateId: "mobile-verification-template", templateRevision: 2,
    header: "Registre o resultado, as assinaturas e a foto do equipamento.",
    footer: "Verificação concluída após resolver todas as pendências.",
    display: { showOnOrder: true, columns: 1, inlineAnswers: false, showUnanswered: true, equipment: true },
    questions: [
    { id: "result", label: "Resultado do teste", kind: "Area de texto", required: true, options: [], answer: "", description: "Descreva o funcionamento do equipamento e os serviços realizados." },
    { id: "technician-signature", label: "Assinatura do técnico", kind: "Assinatura", required: true, options: [], answer: "", signature: null, description: "O técnico deve assinar esta pergunta." },
    { id: "customer-signature", label: "Assinatura do responsável", kind: "Assinatura", required: true, options: [], answer: "", signature: null, description: "O responsável deve assinar esta pergunta separadamente." },
    { id: "equipment-photo", label: "Foto do equipamento com GPS", kind: "Foto", required: true, options: [], answer: "", photoMetadata: true, description: "Capture uma foto com coordenadas e data/hora carimbadas na imagem." },
  ] }],
};
await db.query("insert into public.company_data(company_id,payload) values ($1,$2)", [companyId, JSON.stringify(validateDatabase(payload))]);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
await db.exec("set role authenticated");
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "tecnico@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const encoded = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated", role: "authenticated" })}.test-signature`;
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1:5180").pathname;
  const endpoint = ({
    "/auth/v1/token": "/login",
    "/auth/v1/user": "/user",
    "/rest/v1/rpc/mobile_company_data": "/snapshot",
    "/rest/v1/rpc/mobile_update_order": "/action",
  } as Record<string, string>)[pathname] ?? pathname;
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type,authorization,apikey,x-client-info,x-supabase-api-version,content-profile,accept-profile,prefer");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Content-Type", "application/json");
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204); response.end();
    } else if (endpoint === "/link-migration") {
      response.setHeader("Content-Type", "text/plain");
      response.end(await readFile(new URL("../../supabase/migrations/20261009020000_technician_link_validation.sql", import.meta.url), "utf8"));
    } else if (endpoint === "/order-migration") {
      response.setHeader("Content-Type", "text/plain");
      response.end(await readFile(new URL("../../supabase/migrations/20261010010000_questionnaires.sql", import.meta.url), "utf8"));
    } else if (endpoint === "/migration") {
      response.setHeader("Content-Type", "text/plain");
      response.end(migration);
    } else if (endpoint === "/login") {
      response.end(JSON.stringify({ user, access_token: token, refresh_token: "test-refresh", expires_in: 3600, token_type: "bearer" }));
    } else if (endpoint === "/user") {
      response.end(JSON.stringify(user));
    } else if (endpoint === "/snapshot") {
      const result = await db.query<{ data: unknown }>("select public.mobile_company_data() as data");
      response.end(JSON.stringify(result.rows[0].data));
    } else if (endpoint === "/action" && request.method === "POST") {
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
