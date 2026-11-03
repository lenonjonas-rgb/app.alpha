export function encodeCsv(rows: readonly (readonly (string | number)[])[]) {
  const escape = (value: string | number) => {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Valor numérico inválido para exportação CSV.");
      return `"${value.toFixed(2).replace(".", ",")}"`;
    }
    return `"${(/^[\s]*[=+@\-\t\r]/.test(value) ? "'" : "") + value.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + rows.map((row) => row.map(escape).join(";")).join("\r\n");
}
