export function percentToBasisPoints(value: string) {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || Number(text) > 100)
    throw new Error("Informe percentuais entre 0 e 100, com até duas casas decimais.");
  return Math.round(Number(text) * 100);
}

export function formatPercent(basisPoints: number) {
  return (basisPoints / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
