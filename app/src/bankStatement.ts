import { statementLineSchema } from "./bankingSchema";
import type { StatementLine } from "./bankingSchema";

export type ParsedStatement = { format: "CSV" | "OFX"; account: string; bank: string; lines: StatementLine[] };
export const statementTemplate = "\uFEFFid;data;descricao;valor\r\nmovimento-001;2026-10-16;Recebimento cliente;100,00\r\nmovimento-002;2026-10-16;Pagamento fornecedor;-50,00\r\n";

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === '"') {
      if (cell || closed) throw new Error("CSV com aspas fora do início do campo.");
      quoted = true;
    } else if (char === ";" || char === "\n" || char === "\r") {
      row.push(cell); cell = ""; closed = false;
      if (char !== ";") {
        if (char === "\r" && text[index + 1] === "\n") index++;
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
      }
    } else {
      if (closed) throw new Error("CSV com caracteres após o fechamento das aspas.");
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV com aspas não fechadas.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function cents(value: string, brazilian: boolean) {
  const text = value.trim();
  const pattern = brazilian ? /^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/ : /^-?\d+\.\d{2}$/;
  if (!pattern.test(text)) throw new Error(brazilian
    ? "Valor CSV inválido: use 100,00 ou -50,00 (duas casas decimais)." : "Valor OFX inválido: esperado valor com ponto e duas casas decimais.");
  const normalized = brazilian ? text.replace(/\./g, "").replace(",", ".") : text;
  const amount = Number(normalized.replace(".", ""));
  if (!Number.isSafeInteger(amount) || !amount || Math.abs(amount) > 100_000_000)
    throw new Error("Movimento deve ter valor não nulo de até R$ 1.000.000,00.");
  return amount;
}

function decode(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => {
    switch (entity) {
      case "&amp;": return "&";
      case "&lt;": return "<";
      case "&gt;": return ">";
      case "&quot;": return '"';
      default: return "'";
    }
  });
}

function tag(text: string, name: string, required = true) {
  const values = [...text.matchAll(new RegExp(`<${name}>\\s*([^<\\r\\n]*)`, "gi"))];
  if (values.length > 1 || (required && (!values.length || !values[0][1].trim())))
    throw new Error(`OFX com campo ${name} ausente ou repetido.`);
  return decode(values[0]?.[1].trim() ?? "");
}

export function parseBankStatement(content: string, fileName: string): ParsedStatement {
  if (!content.trim() || content.length > 2_000_000) throw new Error("Selecione um extrato de até 2 MB com movimentos.");
  if (content.includes("\uFFFD")) throw new Error("Arquivo com codificação inválida. Exporte em UTF-8.");
  const text = content.replace(/^\uFEFF/, "");
  let result: ParsedStatement;
  if (/\.csv$/i.test(fileName)) {
    const [header, ...rows] = csvRows(text);
    if (!header || header.map((value) => value.trim().toLowerCase()).join(";") !== "id;data;descricao;valor")
      throw new Error("CSV deve usar o cabeçalho id;data;descricao;valor. Baixe o modelo.");
    result = { format: "CSV", account: "", bank: "", lines: rows.map((row, index) => {
      if (row.length !== 4) throw new Error(`Registro CSV ${index + 2}: esperado exatamente 4 campos.`);
      try {
        return statementLineSchema.parse({ externalId: row[0], date: row[1].trim(), description: row[2], amount: cents(row[3], true) });
      } catch (cause) { throw new Error(`Registro CSV ${index + 2}: ${cause instanceof Error ? cause.message : "Dados inválidos."}`); }
    }) };
  } else if (/\.ofx$/i.test(fileName)) {
    if (!/<OFX>/i.test(text) || !/<\/OFX>/i.test(text) || /<!DOCTYPE|<!ENTITY|<INVSTMTRS>|<CCSTMTRS>/i.test(text))
      throw new Error("OFX não suportado: use extrato de conta bancária, sem investimentos/cartão ou entidades externas.");
    const statements = [...text.matchAll(/<STMTRS>([\s\S]*?)<\/STMTRS>/gi)];
    if (statements.length !== 1) throw new Error("OFX deve conter exatamente um extrato STMTRS de conta bancária.");
    const statement = statements[0][1], blocks = [...statement.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
    if (tag(statement, "CURDEF") !== "BRL") throw new Error("Somente extratos OFX em BRL são suportados.");
    if (/<CORRECTFITID>|<CORRECTACTION>/i.test(statement))
      throw new Error("OFX com correções/substituições de movimentos exige conferência manual; importação recusada.");
    if (blocks.length !== (statement.match(/<STMTTRN>/gi) ?? []).length)
      throw new Error("OFX contém movimentos incompletos.");
    result = { format: "OFX", account: tag(statement, "ACCTID"), bank: tag(statement, "BANKID"), lines: blocks.map(([, block], index) => {
      try {
        const rawDate = tag(block, "DTPOSTED");
        if (!/^\d{8}(?:\d{6}(?:\.\d+)?(?:\[[^\]]+\])?)?$/.test(rawDate)) throw new Error("DTPOSTED inválida.");
        return statementLineSchema.parse({
          externalId: tag(block, "FITID"), date: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
          description: tag(block, "MEMO", false) || tag(block, "NAME", false) || tag(block, "TRNTYPE"),
          amount: cents(tag(block, "TRNAMT"), false),
        });
      } catch (cause) { throw new Error(`Movimento OFX ${index + 1}: ${cause instanceof Error ? cause.message : "Dados inválidos."}`); }
    }) };
  } else throw new Error("Formato não suportado. Selecione CSV padronizado ou OFX.");
  if (!result.lines.length || result.lines.length > 2000) throw new Error("Importe entre 1 e 2.000 movimentos por arquivo.");
  if (new Set(result.lines.map((item) => item.externalId)).size !== result.lines.length)
    throw new Error("Extrato contém IDs repetidos. Cada movimento precisa de um ID bancário único e estável.");
  return result;
}
