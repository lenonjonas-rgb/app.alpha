type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("O Google retornou informações de pedágio inválidas.");
  return value as RecordValue;
}

export function tollPrice(route: RecordValue): number | null {
  if (route.travelAdvisory === undefined) return 0;
  const advisory = record(route.travelAdvisory);
  if (advisory.tollInfo === undefined) return 0;
  const tolls = record(advisory.tollInfo);
  if (tolls.estimatedPrice === undefined) return null;
  if (!Array.isArray(tolls.estimatedPrice))
    throw new Error("O Google retornou preços de pedágio inválidos.");
  if (!tolls.estimatedPrice.length) return null;
  let total = 0;
  for (const item of tolls.estimatedPrice) {
    const price = record(item);
    if (price.currencyCode !== "BRL") return null;
    const units = price.units ?? "0";
    const nanos = price.nanos ?? 0;
    if (typeof units !== "string" || !/^\d+$/.test(units) ||
      typeof nanos !== "number" || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1_000_000_000)
      throw new Error("O Google retornou um valor de pedágio inválido.");
    total += Number(units) * 100 + nanos / 10_000_000;
  }
  const cents = Math.round(total);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 50_000_000)
    throw new Error("O Google retornou um total de pedágio inválido.");
  return cents;
}
