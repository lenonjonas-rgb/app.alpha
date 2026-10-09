import { describe, expect, it, vi } from "vitest";
import { displayLogin, loginEmail } from "./userAccess";
import { firstNameBase, manageUsersHandler } from "../../supabase/functions/manage-users/handler";

const master = "00000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const fields = { name: "João Silva", role: "technician", password: "uma-senha-segura-123", requestId };
const request = (body: object = fields, token = "caller-token") => new Request("https://example.test", {
  method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
});
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const env = { url: "https://example.test", serviceKey: "server-only-key" };

describe("Logins e criação de usuários", () => {
  it("normaliza primeiro nome, mantém e-mail Master e valida logins", () => {
    expect(firstNameBase("  João da Silva ")).toBe("joao");
    expect(firstNameBase("Érica Souza")).toBe("erica");
    expect(() => firstNameBase("123 Silva")).toThrow();
    expect(loginEmail(" JOAO2.AUPHA ")).toBe("joao2.aupha@users.aupha.invalid");
    expect(loginEmail("Master@example.com")).toBe("master@example.com");
    expect(displayLogin(loginEmail("joao.aupha"))).toBe("joao.aupha");
    expect(displayLogin("master@example.com")).toBe("master@example.com");
    expect(() => loginEmail("joao")).toThrow();
    expect(() => loginEmail("joao.aupha@")).toThrow();
  });
  it("nega anônimos e administrativos antes de chamar a criação Auth", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ id: master })).mockResolvedValueOnce(reply({ message: "Denied" }, 403));
    const handler = manageUsersHandler(env, fetcher);
    expect((await handler(request(fields, ""))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await handler(request())).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ Authorization: "Bearer caller-token" });
  });
  it("valida nível e senha, incluindo tentativa de criar Master", async () => {
    for (const invalid of [{ ...fields, role: "owner" }, { ...fields, password: "curta" }, { ...fields, requestId: "invalid" }]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ id: master })).mockResolvedValueOnce(reply([]));
      expect((await manageUsersHandler(env, fetcher)(request(invalid))).status).toBe(400);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it("cria Auth somente no servidor, confirma membership e não retorna a senha", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ id: master })).mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply({ username: "joao2.aupha", userId: null }))
      .mockResolvedValueOnce(reply({ id: user }))
      .mockResolvedValueOnce(reply({ username: "joao2.aupha", userId: user }));
    const result = await manageUsersHandler(env, fetcher)(request());
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({ username: "joao2.aupha", userId: user });
    expect(JSON.parse(String(fetcher.mock.calls[3][1]?.body))).toMatchObject({ email: "joao2.aupha@users.aupha.invalid", email_confirm: true });
    expect(fetcher.mock.calls[3][1]?.headers).toMatchObject({ Authorization: "Bearer server-only-key" });
  });
  it("repetição de operação concluída não cria duas contas", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ id: master })).mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply({ username: "joao.aupha", userId: user }));
    expect((await manageUsersHandler(env, fetcher)(request())).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("confirma commit incerto antes de remover Auth", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ id: master })).mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply({ username: "joao.aupha", userId: null })).mockResolvedValueOnce(reply({ id: user }))
      .mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce(reply({ username: "joao.aupha", userId: user }));
    expect((await manageUsersHandler(env, fetcher)(request())).status).toBe(200);
    expect(fetcher.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(false);
  });
  it("remove criação parcial e expõe falha de cleanup sem sucesso falso", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ id: master })).mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply({ username: "joao.aupha", userId: null })).mockResolvedValueOnce(reply({ id: user }))
      .mockResolvedValueOnce(reply({ message: "Membership failed" }, 400))
      .mockResolvedValueOnce(reply({ message: "Pending" }, 400))
      .mockRejectedValueOnce(new Error("Cleanup unavailable")).mockResolvedValueOnce(reply(null));
    const result = await manageUsersHandler(env, fetcher)(request());
    expect(result.status).toBe(502);
    expect((await result.json()).error).toContain("Master deve conferir");
    expect(fetcher.mock.calls[6][1]?.method).toBe("DELETE");
  });
});
