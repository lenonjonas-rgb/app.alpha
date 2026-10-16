import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, X509Certificate, createPrivateKey, createPublicKey } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireValue } from "./errors.js";
import type { Store } from "./store.js";

type Certificate = { encrypted: string; cnpj: string; subject: string; expiresAt: string; fingerprint: string };
export type Identity = { key: string; cert: string; cnpj: string; chain?: string };
export function encrypt(value: string, master: Buffer, tenant: string) {
  requireValue(master.length === 32, "Chave mestra inválida.", 500);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", master, iv);
  cipher.setAAD(Buffer.from(tenant));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decrypt(value: string, master: Buffer, tenant: string) {
  const bytes = Buffer.from(value, "base64");
  requireValue(bytes.length > 28, "Certificado armazenado inválido.", 500);
  const decipher = createDecipheriv("aes-256-gcm", master, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(tenant));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}

function certificateCnpj(cert: X509Certificate) {
  const candidates: string[] = [];
  type Der = { tag: number; bytes: Buffer; children: Der[] };
  const parse = (bytes: Buffer, depth = 0): Der[] => {
    requireValue(depth < 30, "Estrutura ASN.1 do A1 inválida.");
    const nodes: Der[] = [];
    for (let offset = 0; offset < bytes.length;) {
      const tag = bytes[offset++]!;
      let length = bytes[offset++]!;
      if (length & 0x80) {
        const count = length & 0x7f;
        requireValue(count > 0 && count <= 4 && offset + count <= bytes.length, "ASN.1 inválido.");
        length = bytes.readUIntBE(offset, count); offset += count;
      }
      requireValue(Number.isInteger(length) && offset + length <= bytes.length, "ASN.1 truncado.");
      const value = bytes.subarray(offset, offset + length); offset += length;
      nodes.push({ tag, bytes: value, children: tag & 0x20 ? parse(value, depth + 1) : [] });
    }
    return nodes;
  };
  const leaves = (node: Der): string[] => node.children.length ? node.children.flatMap(leaves) : [node.bytes.toString("utf8")];
  const walk = (node: Der) => {
    if (node.children.some((child) => child.tag === 6 && child.bytes.equals(Buffer.from("604c010303", "hex"))))
      candidates.push(...node.children.filter((child) => child.tag !== 6).flatMap(leaves).filter((value) => /^\d{14}$/.test(value)));
    // A extensao subjectAltName e um OCTET STRING contendo outro DER.
    if (node.children.some((child) => child.tag === 6 && child.bytes.equals(Buffer.from("551d11", "hex"))))
      node.children.filter((child) => child.tag === 4).forEach((child) => parse(child.bytes).forEach(walk));
    node.children.forEach(walk);
  };
  parse(cert.raw).forEach(walk);
  requireValue(new Set(candidates).size === 1, "Não foi possível identificar o CNPJ ICP-Brasil do A1.");
  return candidates[0]!;
}

export async function readPfx(base64: string, password: string, expectedCnpj: string) {
  requireValue(/^[A-Za-z0-9+/]*={0,2}$/.test(base64) && base64.length > 0 && base64.length < 2_800_000, "Arquivo A1 inválido ou maior que 2 MB.");
  requireValue(!/[\r\n]/.test(password), "A senha do A1 não pode conter quebra de linha.");
  const directory = await mkdtemp(join(tmpdir(), "alpha-a1-"));
  let pem: string;
  try {
    const file = join(directory, "certificate.p12");
    await writeFile(file, Buffer.from(base64, "base64"), { mode: 0o600 });
    const open = (legacy: boolean) => new Promise<string>((resolve, reject) => {
      const process = spawn("openssl", ["pkcs12", ...(legacy ? ["-legacy"] : []), "-in", file, "-passin", "stdin", "-nodes"], { windowsHide: true });
      const chunks: Buffer[] = [];
      let size = 0;
      let diagnostic = "";
      const timer = setTimeout(() => { process.kill(); reject(new Error("Tempo excedido ao abrir A1.")); }, 10000);
      process.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 4_000_000) process.kill(); else chunks.push(chunk); });
      process.stderr.on("data", (chunk: Buffer) => { diagnostic += chunk.toString("utf8").slice(0, Math.max(0, 2000 - diagnostic.length)); });
      process.on("error", () => { clearTimeout(timer); reject(new Error("OpenSSL indisponível. Instale o backend pelo Docker documentado.")); });
      process.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 || size > 4_000_000) {
          if (!legacy && diagnostic.includes("unsupported")) reject(new Error("PKCS12_LEGACY_CIPHER"));
          else reject(new Error("Não foi possível abrir o A1. Confira arquivo e senha."));
        } else resolve(Buffer.concat(chunks).toString("utf8"));
      });
      process.stdin.on("error", () => { clearTimeout(timer); reject(new Error("Falha ao entregar a senha ao OpenSSL.")); });
      process.stdin.end(`${password}\n`);
    });
    try { pem = await open(false); }
    catch (cause) {
      if (!(cause instanceof Error) || cause.message !== "PKCS12_LEGACY_CIPHER") throw cause;
      pem = await open(true);
    }
  } finally { await rm(directory, { recursive: true }); }
  const keys = pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/g) ?? [];
  const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  for (const key of keys) {
    const publicKey = createPublicKey(createPrivateKey(key)).export({ format: "der", type: "spki" });
    for (const cert of certificates) {
      const x509 = new X509Certificate(cert);
      const candidateKey = x509.publicKey.export({ format: "der", type: "spki" });
      if (publicKey.length !== candidateKey.length || !timingSafeEqual(publicKey, candidateKey)) continue;
      requireValue(Date.parse(x509.validFrom) <= Date.now() && Date.parse(x509.validTo) > Date.now(), "Certificado fora da validade.");
      const cnpj = certificateCnpj(x509);
      requireValue(cnpj === expectedCnpj, "CNPJ do certificado diferente do emitente cadastrado.");
      requireValue(x509.publicKey.asymmetricKeyType === "rsa", "A1 deve usar chave RSA compatível com XMLDSig.");
      const chain = certificates.filter((entry) => entry !== cert).join("\n");
      return { identity: { key, cert, cnpj, chain }, metadata: { cnpj, subject: x509.subject, expiresAt: x509.validTo, fingerprint: x509.fingerprint256 } };
    }
  }
  throw new Error("A1 sem chave privada e certificado correspondentes.");
}
export class CertificateVault {
  constructor(private store: Store, private master: Buffer) {}
  metadata(tenant: string) {
    const record = this.store.get<Certificate>(tenant, "certificate", "a1");
    if (!record) return null;
    const { encrypted: _secret, ...metadata } = record;
    return metadata;
  }
  async save(tenant: string, base64: string, password: string, cnpj: string) {
    const { identity, metadata } = await readPfx(base64, password, cnpj);
    this.store.put(tenant, "certificate", "a1", { ...metadata, encrypted: encrypt(JSON.stringify(identity), this.master, tenant) });
    return metadata;
  }
  identity(tenant: string): Identity {
    const stored = this.store.get<Certificate>(tenant, "certificate", "a1");
    requireValue(stored, "Cadastre o certificado A1 no backend antes de transmitir.");
    requireValue(Date.parse(stored.expiresAt) > Date.now(), "Certificado A1 vencido.");
    return JSON.parse(decrypt(stored.encrypted, this.master, tenant)) as Identity;
  }
}
