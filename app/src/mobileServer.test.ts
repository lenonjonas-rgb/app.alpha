/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoDatabase, getOrderDetails, validateDatabase } from "./domain";
import { mobileSnapshotSchema } from "./mobile";

const owner = "00000000-0000-4000-8000-000000000001";
const tech = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
const company = "10000000-0000-4000-8000-000000000001";
const db = new PGlite();
const payload = demoDatabase();
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

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
  `);
  for (const file of ["20261008010000_tenant_auth_and_company_data.sql", "20261009010000_android_technicians.sql", "20261009020000_technician_link_validation.sql"]) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.query("insert into auth.users values ($1,'owner@example.test'),($2,'tech@example.test'),($3,'other@example.test')", [owner, tech, other]);
  await db.query("insert into public.companies (id,name,created_by) values ($1,'Alpha Tec',$2)", [company, owner]);
  await db.query("insert into public.company_memberships (user_id,company_id,role,display_name) values ($1,$4,'owner','Admin'),($2,$4,'technician','Técnico'),($3,$4,'technician','Outro')", [owner, tech, other, company]);
  await db.query("insert into public.company_data(company_id,payload) values ($1,$2)", [company, JSON.stringify(payload)]);
}, 30000);
afterAll(async () => { await db.close(); });

describe("RPC Android e isolamento de dados", () => {
  it("só projeta tarefas e clientes atribuídos, sem documento completo", async () => {
    await identity(tech);
    const data = await snapshot();
    expect(data.payload.orders.map((order) => order.id)).toEqual([payload.orders[0].id]);
    expect(data.payload.clients.map((client) => client.id)).toEqual([payload.orders[0].clientId]);
    expect(data.payload.settings.registrationData).toEqual({});
    const raw = await db.query("select * from public.company_data");
    expect(raw.rows).toEqual([]);
    await expect(db.query("select public.list_company_technicians()")).rejects.toThrow();
    await expect(db.query("select public.save_company_data($1,0)", [JSON.stringify(payload)])).rejects.toThrow();
    await expect(mutate("Check-in", { location: gps }, 0, payload.orders[1].id)).rejects.toThrow("Tarefa não atribuída");
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
    const first = getOrderDetails(data.payload.orders[0]).activities[0];
    expect(first.technician).toBe("Técnico");
    expect(Date.parse(first.at)).toBeGreaterThan(Date.now() - 60000);
    expect(first.location?.capturedAt).toBe(first.at);
    await expect(mutate("Pausa", { reason: "Intervalo" }, 0)).rejects.toThrow("Sincronize");
    await expect(mutate("Check-in", { location: gps }, data.revision)).rejects.toThrow("Sequência");
    await expect(mutate("Pausa", {}, data.revision)).rejects.toThrow("motivo");
    await mutate("Pausa", { reason: "Intervalo" }, data.revision);
    data = await snapshot();
    await expect(mutate("Check-out", { location: gps }, data.revision)).rejects.toThrow("Sequência");
    await mutate("Retorno", {}, data.revision);
    data = await snapshot();
    await mutate("Check-out", { location: gps }, data.revision);
    data = await snapshot();
    expect(data.payload.orders[0].status).toBe("Finalizada");
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
});
