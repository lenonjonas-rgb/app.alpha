export function normalizedFiscalCode(value: string) {
  return value.trim().replace(/[.\s-]/g, "");
}

export function existingFiscalCode(value: string, length: number) {
  return value.match(new RegExp(`^(\\d{${length}})(?:\\s*[-–—:]\\s*.+)?$`))?.[1] ?? value;
}
