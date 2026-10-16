import { inflateSync } from "node:zlib";
import assert from "node:assert/strict";

export function pdfContents(bytes: Buffer) {
  const pdf = bytes.toString("latin1");
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /%%EOF\s*$/);
  assert.match(pdf, /\/Type \/Page\b/);
  const streams = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  assert.ok(streams.length > 0);
  return streams.map((match) => inflateSync(Buffer.from(match[1]!, "latin1")).toString("latin1")).join("\n");
}
