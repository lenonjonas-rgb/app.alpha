import type { Attachment } from "./domain";
import { captureLocation, prepareAttachment } from "./mobile";

export async function prepareQuestionnairePhoto(file: File, photoMetadata: boolean): Promise<Attachment> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("A resposta exige uma foto JPG, PNG ou WebP.");
  if (!photoMetadata) return prepareAttachment(file);
  if (!file.size || file.size > 15_000_000) throw new Error("Foto vazia ou maior que 15 MB.");
  try {
    const location = await captureLocation();
    if (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90
      || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180
      || !Number.isFinite(location.accuracy) || location.accuracy < 0
      || !Number.isFinite(Date.parse(location.capturedAt))) throw new Error("Localização GPS inválida.");
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const imageWidth = Math.max(1, Math.round(bitmap.width * scale));
      canvas.width = Math.max(640, imageWidth);
      const imageHeight = Math.max(1, Math.round(bitmap.height * scale));
      const fontSize = Math.max(12, Math.round(canvas.width / 55));
      const lineHeight = fontSize * 1.5;
      const height = lineHeight * 2 + fontSize;
      canvas.height = imageHeight + height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas indisponível.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, (canvas.width - imageWidth) / 2, 0, imageWidth, imageHeight);
      const lines = [
        `GPS: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)} (±${Math.round(location.accuracy)} m)`,
        `Captura: ${new Date(location.capturedAt).toLocaleString("pt-BR")} · ${location.capturedAt}`,
      ];
      context.fillStyle = "#000";
      context.fillRect(0, imageHeight, canvas.width, height);
      context.font = `${fontSize}px sans-serif`;
      context.fillStyle = "#fff";
      lines.forEach((line, index) => context.fillText(line, fontSize / 2, canvas.height - height + fontSize + index * lineHeight, canvas.width - fontSize));
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Falha ao carimbar a foto.")), "image/jpeg", 0.85);
      });
      return await prepareAttachment(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
    } finally { bitmap.close(); }
  } catch (cause) {
    throw new Error(`Foto com coordenadas/data obrigatórias: não foi possível aplicar o carimbo. Verifique a permissão de GPS e o suporte a imagens. ${cause instanceof Error ? cause.message : ""}`);
  }
}
