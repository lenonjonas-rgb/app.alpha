export function downloadFiscalPdf(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = file.name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type FileSharing = Pick<Navigator, "canShare" | "share">;
export async function shareFiscalPdf(file: File, sharing: FileSharing, download = downloadFiscalPdf) {
  if (!sharing.canShare || !sharing.share || !sharing.canShare({ files: [file] })) {
    download(file);
    return "Compartilhamento de arquivos indisponível neste navegador. PDF baixado para anexar manualmente.";
  }
  try {
    await sharing.share({ files: [file], title: file.name });
    return "Compartilhamento concluído no dispositivo. A entrega ao destinatário não é confirmada pelo sistema.";
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") return "Compartilhamento cancelado.";
    throw cause;
  }
}
export async function fiscalPdfFile(response: Response, filename: string) {
  if (response.headers.get("Content-Type")?.split(";")[0] !== "application/pdf") throw new Error("O backend não retornou um PDF fiscal.");
  const blob = await response.blob();
  if (!blob.size || blob.size > 12_000_000 || await blob.slice(0, 5).text() !== "%PDF-")
    throw new Error("PDF fiscal inválido ou acima de 12 MB.");
  return new File([blob], filename, { type: "application/pdf" });
}
