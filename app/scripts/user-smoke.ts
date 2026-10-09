import { createServer } from "node:http";
import { demoDatabase } from "../src/domain.ts";
import { firstNameBase } from "../../supabase/functions/manage-users/handler.ts";

const owner = "00000000-0000-4000-8000-000000000001";
const company = "10000000-0000-4000-8000-000000000001";
const payload = demoDatabase();
let role = "owner";
const users = [{ userId: owner, name: "Master fictício", login: "master@example.test", role: "owner" }];
const requests: string[] = [];
const user = { id: owner, email: "master@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const expires = Math.floor(Date.now() / 1000) + 3600;
const session = { user, access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: owner, exp: expires, aud: "authenticated", role: "authenticated" })}.fixture-signature`, refresh_token: "fixture-refresh", expires_in: 3600, expires_at: expires, token_type: "bearer" };

createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, x-supabase-api-version");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  response.setHeader("Content-Type", "application/json");
  const path = new URL(request.url ?? "/", "http://127.0.0.1:5183").pathname;
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  requests.push(path);
  let raw = "";
  for await (const chunk of request) raw += chunk;
  try {
    const fields = raw ? JSON.parse(raw) : {};
    let data: unknown;
    if (path === "/fixture/level") {
      if (!["owner", "admin", "technician"].includes(fields.role)) throw new Error("Invalid fixture role.");
      role = fields.role; requests.length = 0; data = { role };
    } else if (path === "/fixture/requests") data = requests;
    else if (path === "/auth/v1/token") data = session;
    else if (path === "/auth/v1/user") data = user;
    else if (path === "/rest/v1/company_memberships") data = { company_id: company, role };
    else if (path === "/rest/v1/company_data") {
      if (role === "technician") throw new Error("Technician must not fetch full document.");
      data = { payload, revision: 0 };
    } else if (path === "/rest/v1/rpc/list_company_users") {
      if (role !== "owner") throw new Error("Master required.");
      data = users;
    } else if (path === "/rest/v1/rpc/list_company_technicians") data = users.map((account) => ({
      userId: account.userId, name: account.name,
      email: account.login.includes("@") ? account.login : `${account.login}@users.aupha.invalid`,
    }));
    else if (path === "/functions/v1/manage-users") {
      if (role !== "owner" || !["admin", "technician"].includes(fields.role)) throw new Error("Invalid user creation.");
      const base = firstNameBase(fields.name);
      let number = 1;
      let login = `${base}.aupha`;
      while (users.some((account) => account.login === login)) login = `${base}${++number}.aupha`;
      const account = { userId: crypto.randomUUID(), name: fields.name, login, role: fields.role };
      users.push(account);
      data = { username: login, userId: account.userId };
    } else if (path === "/rest/v1/rpc/mobile_company_data") data = {
      companyId: company, revision: 0, role, name: "João Técnico",
      payload: { ...payload, orders: [], clients: [], equipment: [], quotes: [], products: [], services: [], expenses: [], movements: [] },
    };
    else throw new Error(`Unexpected fixture endpoint: ${path}`);
    response.end(JSON.stringify(data));
  } catch (cause) {
    response.writeHead(400);
    response.end(JSON.stringify({ message: cause instanceof Error ? cause.message : String(cause) }));
  }
}).listen(5183, "127.0.0.1", () => console.log("UI fixtures on 5183: fictitious accounts only, no production Auth or database."));
