import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const source = new URL("../android/app/build/outputs/apk/debug/app-debug.apk", import.meta.url);
const folder = new URL("../public/downloads/", import.meta.url);
const target = new URL("alpha-tec-tecnicos-debug.apk", folder);
const binary = await readFile(source);
const hash = createHash("sha256").update(binary).digest("hex");
await mkdir(folder, { recursive: true });
await copyFile(source, target);
await writeFile(new URL("alpha-tec-tecnicos-debug.apk.sha256", folder), `${hash}  alpha-tec-tecnicos-debug.apk\n`);
console.log(`APK debug empacotado (${binary.length} bytes): ${target.pathname}`);
console.log(`SHA256: ${hash}`);
