export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function requireValue(condition: unknown, message: string, status = 422): asserts condition {
  if (!condition) throw new AppError(status, message);
}
