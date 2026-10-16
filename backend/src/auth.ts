import { z } from "zod";
import { requireValue } from "./errors.js";
import { retentionSchema } from "./retentions.js";

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const billingItemSchema = z.object({
  id: z.string().min(1).max(400), source: z.enum(["item", "cost", "travel", "toll"]), kind: z.enum(["produto", "servico"]),
  referenceId: z.string().min(1).max(200).optional(), name: z.string().trim().min(1).max(1000),
  quantity: z.number().positive().max(10000), price: money, gross: money, itemDiscount: money, orderDiscount: money,
}).superRefine((item, context) => {
  if (item.gross !== Math.round(item.quantity * item.price) || item.itemDiscount + item.orderDiscount > item.gross ||
    (item.source === "item" && !item.referenceId) || (item.source !== "item" && (item.kind !== "servico" || item.referenceId !== undefined)))
    context.addIssue({ code: "custom", message: "Snapshot de item faturado inconsistente." });
});
export const companySchema = z.object({
  products: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  services: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  clients: z.array(z.object({ id: z.string(), name: z.string(), document: z.string(), address: z.string() })),
  finance: z.object({
    accounts: z.array(z.object({ id: z.string(), name: z.string(), bank: z.string(), agency: z.string(), account: z.string(), active: z.boolean() })).default([]),
    invoices: z.array(z.object({ id: z.string(), clientId: z.string(), kind: z.enum(["Produtos", "Serviços", "Legado"]), amount: money, canceled: z.boolean(),
      orders: z.array(z.object({
        orderId: z.string().min(1), code: z.string(), amount: money,
        items: z.array(billingItemSchema).min(1).max(200).optional(),
      })).optional(),
    })),
    entries: z.array(z.object({
      id: z.string(), invoiceId: z.string().optional(), kind: z.enum(["Receber", "Pagar"]), clientId: z.string().optional(), party: z.string(), amount: money,
      dueOn: z.string(), issuedOn: z.string(), paymentMethod: z.string(), accountId: z.string(), canceled: z.boolean(),
      retention: retentionSchema.optional(),
      settlements: z.array(z.object({ amount: money, reversed: z.boolean() })),
    })),
  }),
}).superRefine((company, context) => {
  company.finance.entries.forEach((entry, index) => {
    if (!entry.retention) return;
    const invoice = company.finance.invoices.find((item) => item.id === entry.invoiceId);
    if (entry.kind !== "Receber" || invoice?.kind !== "Serviços" || invoice.amount !== entry.amount ||
      entry.retention.invoiceAmount !== entry.amount ||
      entry.settlements.filter((item) => !item.reversed).reduce((sum, item) => sum + item.amount, 0) > entry.retention.net)
      context.addIssue({ code: "custom", path: ["finance", "entries", index, "retention"],
        message: "Conciliação exige conta a receber de serviços com bruto preservado e baixas limitadas ao líquido." });
  });
});
export type CompanyData = z.infer<typeof companySchema>;
export type Context = { tenant: string; actor: string; role: "owner" | "admin"; token: string };
export type FinanceChange = {
  entry: CompanyData["finance"]["entries"][number];
  invoice?: CompanyData["finance"]["invoices"][number];
  action: "cancel" | "retention"; retention?: z.infer<typeof retentionSchema>;
};
export class SupabaseAuth {
  constructor(private url: string, private key: string, private fetcher = fetch, private serviceKey?: string) {}
  private async request(path: string, token: string) {
    const response = await this.fetcher(`${this.url}${path}`, { headers: { apikey: this.key, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    requireValue(response.ok, "Não foi possível validar a sessão/dados da empresa no Supabase.", response.status === 401 || response.status === 403 ? 401 : 502);
    return response.json() as Promise<unknown>;
  }
  async authenticate(header: string | undefined): Promise<Context> {
    requireValue(header && header.startsWith("Bearer ") && header.length < 10000, "Autenticação necessária.", 401);
    const token = header.slice(7);
    const user = z.object({ id: z.uuid() }).parse(await this.request("/auth/v1/user", token));
    const memberships = z.array(z.object({ company_id: z.uuid(), role: z.string() })).parse(
      await this.request(`/rest/v1/company_memberships?user_id=eq.${user.id}&select=company_id,role`, token));
    const membership = memberships[0];
    requireValue(memberships.length === 1 && membership && ["owner", "admin"].includes(membership.role), "Somente Master/Administrativo podem operar o fiscal.", 403);
    return { tenant: membership.company_id, actor: user.id, role: membership.role as "owner" | "admin", token };
  }
  async company(context: Context) {
    const records = z.array(z.object({ payload: z.unknown() })).parse(
      await this.request(`/rest/v1/company_data?company_id=eq.${context.tenant}&select=payload`, context.token));
    requireValue(records.length === 1, "Empresa não encontrada.", 404);
    return companySchema.parse(records[0]!.payload);
  }
  async approveFinanceChange(context: Context, change: FinanceChange) {
    requireValue(this.serviceKey, "Configure SUPABASE_SERVICE_ROLE_KEY apenas no backend privado e aplique a migração de proteção financeira antes de confirmar.", 503);
    const response = await this.fetcher(`${this.url}/rest/v1/rpc/approve_finance_change`, {
      method: "POST", headers: { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_company: context.tenant, p_actor: context.actor, p_entry: change.entry,
        p_invoice: change.invoice ?? null, p_action: change.action, p_retention: change.retention ?? null }),
      signal: AbortSignal.timeout(10000),
    });
    requireValue(response.ok, "Não foi possível autorizar a gravação financeira protegida no Supabase. Confira migração/configuração, aguarde Sincronizado e retente; nenhuma nota/boleto foi cancelado.",
      response.status === 409 ? 409 : 502);
  }
}
