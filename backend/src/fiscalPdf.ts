import { createHash } from "node:crypto";
import { danfe, ErroDa, gerarPdf } from "@sinete/da/nfe";
import { danfse } from "@sinete/da/nfse";
import type { Context } from "./auth.js";
import { AppError, requireValue } from "./errors.js";
import type { Store } from "./store.js";
import { authorizedNfeArtifact, authorizedNfseArtifact } from "./authorizedXml.js";
import { parseXml } from "./xml.js";

const renderer = "@sinete/da@0.3.0:alpha-1";
const maximumSize = 12_000_000;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
type SavedPdf = { source: string; renderer: string; filename: string; sha256: string; size: number; generatedAt: string; base64: string };
function validPdf(bytes: Buffer) {
  requireValue(bytes.length > 100 && bytes.length <= maximumSize && bytes.subarray(0, 5).toString() === "%PDF-" &&
    bytes.subarray(-10).toString().trimEnd().endsWith("%%EOF"), "PDF fiscal inválido ou acima de 12 MB.", 409);
}
export class FiscalPdf {
  constructor(private store: Store) {}
  download(context: Context, id: string) {
    const document = this.store.document(context.tenant, id);
    const xml = document.kind === "nfe" ? authorizedNfeArtifact(document) : authorizedNfseArtifact(document);
    const source = hash(JSON.stringify({ renderer, kind: document.kind, environment: document.environment, key: document.key,
      accessKey: document.accessKey, protocol: document.protocol, xml: document.xml, signedXml: document.signedXml, artifact: document.artifact }));
    const filename = `${document.kind === "nfe" ? "DANFE" : "DANFSe"}-${document.environment}-${document.kind === "nfe" ? document.key.slice(3) : document.accessKey}.pdf`;
    let saved = this.store.get<SavedPdf>(context.tenant, "fiscalPdfs", id);
    let bytes: Buffer;
    if (saved?.source === source && saved.renderer === renderer) {
      bytes = Buffer.from(saved.base64, "base64");
      validPdf(bytes);
      requireValue(saved.filename === filename && saved.size === bytes.length && saved.sha256 === hash(bytes),
        "PDF fiscal armazenado falhou na verificação de integridade; restaure o backup ou solicite suporte.", 409);
    } else {
      const text = parseXml(xml).documentElement.textContent ?? "";
      requireValue(!/[^\u0000-\u007f\u00a0-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac]/u.test(text),
        "XML contém caracteres não suportados pelas fontes do PDF; nenhum arquivo foi gerado.", 422);
      try {
        const layout = document.kind === "nfe" ? danfe(xml) : danfse(xml);
        requireValue(layout.paginas.length > 0 && layout.estatisticas.cortados === 0,
          "O leiaute cortaria texto do documento fiscal. Baixe o XML e solicite revisão do leiaute; PDF não gerado.", 422);
        bytes = Buffer.from(gerarPdf(layout));
      } catch (error) {
        if (error instanceof ErroDa) throw new AppError(422, `Não foi possível gerar o documento auxiliar (${error.code}). Confira o XML autorizado e o leiaute suportado.`);
        throw error;
      }
      validPdf(bytes);
      saved = { source, renderer, filename, sha256: hash(bytes), size: bytes.length, generatedAt: new Date().toISOString(), base64: bytes.toString("base64") };
      this.store.db.exec("BEGIN IMMEDIATE");
      try {
        this.store.put(context.tenant, "fiscalPdfs", id, saved);
        this.store.audit(context.tenant, context.actor, "pdf.generate", id);
        this.store.db.exec("COMMIT");
      } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
    }
    this.store.audit(context.tenant, context.actor, "pdf.download", id);
    return { bytes, filename, sha256: saved.sha256 };
  }
}
