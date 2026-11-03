import { makeId, validateDatabase } from "./domain";
import type { Database } from "./domain";
import { calculateCommissionItems, commissionRecordSchema, commissionSellerSchema } from "./commissionSchema";
import type { CommissionRecord, CommissionSeller } from "./commissionSchema";

type CommissionPreview = Omit<CommissionRecord, "id" | "createdAt">;

export function saveCommissionSeller(data: Database, input: CommissionSeller, expected?: CommissionSeller) {
  const seller = commissionSellerSchema.parse(input);
  const current = data.finance.commissions ?? { sellers: [], records: [] };
  const previous = current.sellers.find((item) => item.id === seller.id);
  if ((previous && (!expected || JSON.stringify(previous) !== JSON.stringify(expected))) || (!previous && expected))
    throw new Error("Vendedor alterado ou removido. Atualize e revise a regra.");
  if (current.sellers.some((item) => item.id !== seller.id &&
    item.name.toLocaleLowerCase("pt-BR") === seller.name.toLocaleLowerCase("pt-BR")))
    throw new Error("Já existe um vendedor com este nome.");
  return validateDatabase({ ...data, finance: { ...data.finance, commissions: {
    ...current, sellers: previous ? current.sellers.map((item) => item.id === seller.id ? seller : item) : [...current.sellers, seller],
  } } });
}

export function previewCommission(data: Database, invoiceId: string, orderId: string, sellerId: string): CommissionPreview {
  const seller = data.finance.commissions?.sellers.find((item) => item.id === sellerId && item.active);
  if (!seller) throw new Error("Selecione um vendedor ativo com regra cadastrada.");
  const invoice = data.finance.invoices.find((item) => item.id === invoiceId);
  const order = invoice?.orders.find((item) => item.orderId === orderId);
  if (!invoice || invoice.canceled || !order) throw new Error("Faturamento indisponível para apuração.");
  if (data.finance.commissions?.records.some((item) => item.invoiceId === invoiceId && item.orderId === orderId))
    throw new Error("A comissão deste faturamento e pedido já foi apurada.");
  if (!order.items) throw new Error("Faturamento sem itens congelados, inclusive alguns gerados pela NF-e; a comissão não pode ser calculada automaticamente.");
  const items = calculateCommissionItems(order.items, seller.rule);
  if (!items.length) throw new Error("Não há produtos ou serviços comissionáveis neste faturamento.");
  return {
    invoiceId, orderId, sellerId, sellerName: seller.name, rule: seller.rule, items,
    base: items.reduce((sum, item) => sum + item.base, 0), amount: items.reduce((sum, item) => sum + item.amount, 0),
  };
}

export function recordCommission(data: Database, expected: CommissionPreview, confirmed: boolean, id: string = makeId()) {
  if (!confirmed) throw new Error("Confira e confirme o vendedor, os itens e a regra da comissão.");
  const current = previewCommission(data, expected.invoiceId, expected.orderId, expected.sellerId);
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new Error("Faturamento ou regra alterados. Revise a prévia novamente.");
  const record = commissionRecordSchema.parse({ ...current, id, createdAt: new Date().toISOString() });
  const commissions = data.finance.commissions;
  if (!commissions) throw new Error("Cadastre um vendedor antes de apurar comissões.");
  if (commissions.records.some((item) => item.id === id)) throw new Error("Identificador de comissão duplicado.");
  return validateDatabase({ ...data, finance: { ...data.finance, commissions: {
    ...commissions, records: [...commissions.records, record],
  } } });
}

export function commissionRelease(data: Database, record: CommissionRecord) {
  const invoice = data.finance.invoices.find((item) => item.id === record.invoiceId);
  if (!invoice) throw new Error("Faturamento da comissão não encontrado.");
  const entries = data.finance.entries.filter((item) => item.invoiceId === invoice.id);
  if (!entries.length) throw new Error("Contas do faturamento da comissão não encontradas.");
  const collectible = entries.reduce((sum, item) => sum + item.amount - (item.retention?.withheld ?? 0), 0);
  const received = entries.flatMap((item) => item.settlements).filter((item) => !item.reversed)
    .reduce((sum, item) => sum + item.amount, 0);
  const first = entries.filter((item) => item.amount - (item.retention?.withheld ?? 0) > 0)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id))[0];
  const firstAmount = first ? first.amount - (first.retention?.withheld ?? 0) : 0;
  const firstReceived = first?.settlements.filter((item) => !item.reversed).reduce((sum, item) => sum + item.amount, 0) ?? 0;
  let released = 0;
  if (!invoice.canceled) {
    if (record.rule.release === "billing") released = record.amount;
    else if (record.rule.release === "first" && firstAmount > 0 && firstReceived === firstAmount) released = record.amount;
    else if (record.rule.release === "last" && collectible > 0 && received === collectible) released = record.amount;
    else if (record.rule.release === "proportional" && collectible > 0)
      released = Number((BigInt(record.amount) * BigInt(received) * 2n + BigInt(collectible)) / (BigInt(collectible) * 2n));
  }
  const status = invoice.canceled ? "Cancelada" : record.amount === 0 ? "Sem comissão" :
    released === 0 ? "Aguardando liberação" : released === record.amount ? "Liberada" : "Parcialmente liberada";
  return { status, released, pending: invoice.canceled ? 0 : record.amount - released, collectible, received };
}
