/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoDatabase, getOrderDetails, validateDatabase } from "./domain";
import { mobileSnapshotSchema, technicianAgendaOrders } from "./mobile";

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
  for (const file of ["20261008010000_tenant_auth_and_company_data.sql", "20261009010000_android_technicians.sql", "20261009020000_technician_link_validation.sql", "20261010010000_questionnaires.sql", "20261011010000_questionnaire_checkout_requirement.sql", "20261011020000_yes_no_question_justification.sql"]) {
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
