import { z } from "zod";

const id = z.string().trim().min(1).max(200);
export const bankDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Data de extrato inválida.");
export const statementLineSchema = z.object({
  externalId: id, date: bankDateSchema, description: z.string().trim().min(1).max(1000),
  amount: z.number().int().min(-100_000_000).max(100_000_000).refine((value) => value !== 0, "Movimento deve ter valor diferente de zero."),
});
export const bankTransactionSchema = statementLineSchema.extend({
  id, accountId: id, importedAt: z.iso.datetime(), fileName: z.string().min(1).max(255),
});
export const bankMatchSchema = z.object({
  id, transactionId: id, entryId: id, settlementId: id, createdAt: z.iso.datetime(), reversed: z.boolean(),
});
export const bankTransferMatchSchema = z.object({
  id, transactionId: id, transferId: id, leg: z.enum(["outgoing", "incoming"]),
  createdAt: z.iso.datetime(), reversed: z.boolean(),
});
export const bankingSchema = z.object({
  transactions: z.array(bankTransactionSchema).max(10000),
  matches: z.array(bankMatchSchema).max(20000),
  transferMatches: z.array(bankTransferMatchSchema).max(20000).optional(),
});
export type BankTransaction = z.infer<typeof bankTransactionSchema>;
export type BankMatch = z.infer<typeof bankMatchSchema>;
export type BankTransferMatch = z.infer<typeof bankTransferMatchSchema>;
export type Banking = z.infer<typeof bankingSchema>;
export type StatementLine = z.infer<typeof statementLineSchema>;
