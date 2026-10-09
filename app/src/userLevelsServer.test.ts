/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoDatabase } from "./domain";

const db = new PGlite();
const owner = "00000000-0000-4000-8000-000000000001";
const admin = "00000000-0000-4000-8000-000000000002";
const tech = "00000000-0000-4000-8000-000000000003";
const foreign = "00000000-0000-4000-8000-000000000004";
const created = "00000000-0000-4000-8000-000000000005";
const company = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const request1 = "20000000-0000-4000-8000-000000000001";
const request2 = "20000000-0000-4000-8000-000000000002";
const payload = demoDatabase();
payload.orders[0].technicianUserId = tech;

async function identity(id: string, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec(`set role ${role}`);
}
const reserve = (id: string, master = owner, role = "technician") =>
  db.query<{ data: { username: string; userId: string | null } }>("select public.reserve_company_user($1,$2,'joao','João Silva',$3) as data", [master, id, role]);

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
  `);
  for (const file of [
    "20261008010000_tenant_auth_and_company_data.sql", "20261009010000_android_technicians.sql",
    "20261009020000_technician_link_validation.sql", "20261009030000_user_levels.sql",
  ]) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  await db.query("insert into auth.users values ($1,'master@example.test'),($2,'admin@example.test'),($3,'tech@example.test'),($4,'foreign@example.test')", [owner, admin, tech, foreign]);
  await db.query("insert into public.companies(id,name,created_by) values ($1,'Alpha Tec',$3),($2,'Outra',$4)", [company, otherCompany, owner, foreign]);
  await db.query("insert into public.company_memberships(user_id,company_id,role) values ($1,$5,'owner'),($2,$5,'admin'),($3,$5,'technician'),($4,$6,'owner')", [owner, admin, tech, foreign, company, otherCompany]);
  await db.query("insert into public.company_data(company_id,payload) values ($1,$2)", [company, JSON.stringify(payload)]);
}, 30000);
afterAll(async () => { await db.close(); });

describe("Níveis de usuários e reservas de login", () => {
  it("nega operações de criação via RPC pública e acesso à tabela de logins", async () => {
    for (const id of [owner, admin, tech]) {
      await identity(id);
      await expect(reserve(request1)).rejects.toThrow("permission denied");
      await expect(db.query("select * from public.company_user_logins")).rejects.toThrow("permission denied");
    }
    await identity("", "anon");
    await expect(db.query("select public.list_company_users()")).rejects.toThrow("permission denied");
  });
  it("administrativo mantém o painel, mas não gerencia contas nem promove a si mesmo", async () => {
    await identity(admin);
    expect((await db.query("select * from public.company_data")).rows).toHaveLength(1);
    await db.query("select public.save_company_data($1,0)", [JSON.stringify(payload)]);
    await expect(db.query("select public.list_company_users()")).rejects.toThrow("Master");
    await expect(db.query("select public.set_company_user_role($1,'owner')", [admin])).rejects.toThrow("Master");
    await expect(db.query("select public.link_company_technician('tech@example.test','Técnico')")).rejects.toThrow("Master");
  });
  it("técnico recebe só suas tarefas, sem painel completo ou gestão de usuários", async () => {
    await identity(tech);
    expect((await db.query("select * from public.company_data")).rows).toHaveLength(0);
    const result = await db.query<{ data: { payload: { orders: { technicianUserId: string }[] } } }>("select public.mobile_company_data() as data");
    expect(result.rows[0].data.payload.orders).toHaveLength(1);
    expect(result.rows[0].data.payload.orders[0].technicianUserId).toBe(tech);
    await expect(db.query("select public.list_company_users()")).rejects.toThrow("Master");
    await expect(db.query("select public.set_company_user_role($1,'admin')", [tech])).rejects.toThrow("Master");
  });
  it("protege Master, impede alteração entre empresas e aceita troca administrativo/técnico", async () => {
    await identity(owner);
    await expect(db.query("select public.set_company_user_role($1,'admin')", [owner])).rejects.toThrow("Master não pode");
    await expect(db.query("select public.set_company_user_role($1,'owner')", [tech])).rejects.toThrow("Nível inválido");
    await expect(db.query("select public.set_company_user_role($1,'admin')", [foreign])).rejects.toThrow("não pertence");
    await db.query("select public.set_company_user_role($1,'technician')", [admin]);
    await identity(admin);
    expect((await db.query("select * from public.company_data")).rows).toHaveLength(0);
    await identity(owner);
    await db.query("select public.set_company_user_role($1,'admin')", [admin]);
    expect((await db.query("select public.list_company_users() as data")).rows).toHaveLength(1);
  });
  it("reserva nomes globais sem colisão e verifica o Master mesmo no serviço", async () => {
    await identity(owner, "service_role");
    await expect(reserve(request1, admin)).rejects.toThrow("Master");
    expect((await reserve(request1)).rows[0].data.username).toBe("joao.aupha");
    expect((await reserve(request2, foreign, "admin")).rows[0].data.username).toBe("joao2.aupha");
    await expect(reserve(request1)).rejects.toThrow("não confirmado");
    await expect(db.query("select public.reserve_company_user($1,$2,'joao','João Silva','owner')", [owner, crypto.randomUUID()])).rejects.toThrow("inválido");
  });
  it("só finaliza a reserva correspondente, preserva papel e suporta retry idempotente", async () => {
    await db.exec("reset role");
    await db.query("insert into auth.users values ($1,'joao.aupha@users.aupha.invalid')", [created]);
    await identity(owner, "service_role");
    await expect(db.query("select public.complete_company_user($1,$2,$3)", [foreign, request1, created])).rejects.toThrow("indisponível");
    await expect(db.query("select public.complete_company_user($1,$2,$3)", [owner, request1, tech])).rejects.toThrow("não corresponde");
    await db.query("select public.complete_company_user($1,$2,$3)", [owner, request1, created]);
    expect((await reserve(request1)).rows[0].data.userId).toBe(created);
    await db.exec("reset role");
    await expect(db.query("delete from auth.users where id=$1", [created])).rejects.toThrow();
    await identity(owner);
    const users = await db.query<{ data: { userId: string; login: string; role: string }[] }>("select public.list_company_users() as data");
    expect(users.rows[0].data.find((user) => user.userId === created)).toMatchObject({ login: "joao.aupha", role: "technician" });
  });
});
