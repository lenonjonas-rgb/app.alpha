import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { AppLauncher } from "@capacitor/app-launcher";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { z } from "zod";
import { attachmentSchema, databaseSchema, makeId, validateDatabase } from "./domain";
import type { Attachment } from "./domain";

export const mobileSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  name: z.string(),
  role: z.enum(["owner", "admin", "technician"]),
  payload: databaseSchema,
}).transform((value) => ({ ...value, payload: validateDatabase(value.payload) }));
export type MobileSnapshot = z.infer<typeof mobileSnapshotSchema>;

function routeQuery(address: string) {
  if (!address.trim()) throw new Error("O cliente não possui endereço cadastrado.");
  return encodeURIComponent(address.trim());
}

export function routeUrl(address: string, provider: "google" | "waze") {
  const query = routeQuery(address);
  return provider === "waze"
    ? `https://waze.com/ul?q=${query}&navigate=yes`
    : `https://www.google.com/maps/dir/?api=1&destination=${query}&travelmode=driving`;
}

export async function openRoute(address: string, provider: "google" | "waze") {
  const url = routeUrl(address, provider);
  if (Capacitor.isNativePlatform()) {
    const nativeUrl = nativeRouteUrl(address, provider);
    const installed = await AppLauncher.canOpenUrl({ url: nativeUrl });
    const result = await AppLauncher.openUrl({ url: installed.value ? nativeUrl : url });
    if (!result.completed) throw new Error("Não foi possível abrir o aplicativo de rotas.");
  } else {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    // With noopener, browsers may return null even after opening the destination.
    if (opened) opened.opener = null;
  }
}

export function nativeRouteUrl(address: string, provider: "google" | "waze") {
  const query = routeQuery(address);
  return provider === "waze"
    ? `waze://?q=${query}&navigate=yes`
    : `google.navigation:q=${query}&mode=d`;
}

export async function captureLocation() {
  const position = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0,
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    capturedAt: new Date(position.timestamp).toISOString(),
  };
}

export function durationText(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export async function shareAttachment(file: Attachment) {
  const data = file.data.split(",")[1];
  if (!data) throw new Error("Arquivo inválido para compartilhar.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.data));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const extensions: Record<Attachment["mime"], string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "application/pdf": "pdf", "text/plain": "txt",
  };
  const saved = await Filesystem.writeFile({
    path: `shared/${hash}.${extensions[file.mime]}`, directory: Directory.Cache,
    data, recursive: true,
  });
  await Share.share({ title: file.name, files: [saved.uri], dialogTitle: "Compartilhar anexo" });
}

export async function prepareAttachment(file: File): Promise<Attachment> {
  const mime = file.type;
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"].includes(mime))
    throw new Error("Formato não aceito. Use JPG, PNG, WebP, PDF ou TXT.");
  if (file.size === 0 || file.size > 15_000_000)
    throw new Error("Arquivo vazio ou maior que 15 MB.");
  let result: Blob = file;
  let name = file.name;
  if (file.size > 500_000 && mime.startsWith("image/")) {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Não foi possível preparar a foto.");
      for (const maxSide of [1600, 1100, 800]) {
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        result = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível reduzir a foto.")), "image/jpeg", 0.75);
        });
        if (result.size <= 500_000) break;
      }
      name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    } finally {
      bitmap.close();
    }
  }
  if (result.size > 500_000)
    throw new Error("Não foi possível atender ao limite de 500 KB. Reduza o arquivo.");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Arquivo inválido."));
    reader.readAsDataURL(result);
  });
  return attachmentSchema.parse({ id: makeId(), name, mime: result.type, size: result.size, data, at: new Date().toISOString() });
}
