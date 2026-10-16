import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function syntheticIdentity(cnpj: string) {
  const directory = mkdtempSync(join(tmpdir(), "alpha-fiscal-test-"));
  try {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    writeFileSync(join(directory, "key.pem"), key, { mode: 0o600 });
    execFileSync("openssl", ["req", "-new", "-x509", "-key", join(directory, "key.pem"), "-out", join(directory, "cert.pem"),
      "-days", "1", "-subj", "/CN=Fiscal synthetic test"], { stdio: "pipe" });
    return { key, cert: readFileSync(join(directory, "cert.pem"), "utf8"), cnpj };
  } finally { rmSync(directory, { recursive: true }); }
}
