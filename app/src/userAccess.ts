export const roleLabels = { owner: "Master", admin: "Administrativo", technician: "Técnico", manager: "Gestor legado" } as const;
export type CompanyRole = keyof typeof roleLabels;

export function loginEmail(login: string): string {
  const value = login.trim().toLowerCase();
  if (/^[a-z][a-z0-9]{0,59}\.aupha$/.test(value)) return `${value}@users.aupha.invalid`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value;
  throw new Error("Informe seu usuário (ex.: joao.aupha) ou o e-mail da conta existente.");
}

export function displayLogin(email: string): string {
  return email.endsWith("@users.aupha.invalid") ? email.slice(0, -"@users.aupha.invalid".length) : email;
}
