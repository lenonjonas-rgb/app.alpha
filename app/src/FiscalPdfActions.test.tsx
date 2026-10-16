import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FiscalPdfActions } from "./FiscalPdfActions";
import { fiscalPdfFile, shareFiscalPdf } from "./fiscalPdf";

const item = { id: "document", kind: "nfe", environment: "homologacao", status: "autorizado" };
describe("documentos auxiliares fiscais", () => {
  it("só oferece PDF autorizado e identifica homologação, modelo e compartilhamento por arquivo", () => {
    const html = renderToStaticMarkup(<FiscalPdfActions item={item} busy={false} />);
    expect(html).toContain("Baixar DANFE (PDF)");
    expect(html).toContain("sem validade fiscal/jurídica");
    expect(html).toContain("Preparar compartilhamento");
    expect(html).not.toContain(">Compartilhar arquivo<");
    expect(renderToStaticMarkup(<FiscalPdfActions item={{ ...item, kind: "nfse", environment: "producao" }} busy={false} />)).toContain("Baixar DANFSe (PDF)");
    for (const status of ["rascunho", "incerto", "cancelado", "rejeitado", "processando", "enviando"])
      expect(renderToStaticMarkup(<FiscalPdfActions item={{ ...item, status }} busy={false} />)).toBe("");
  });
  it("recusa HTML/XML disfarçado e devolve arquivo PDF sem link/token", async () => {
    const response = () => new Response("%PDF-1.4\nfixture\n%%EOF", { headers: { "Content-Type": "application/pdf" } });
    const file = await fiscalPdfFile(response(), "DANFE-homologacao.pdf");
    expect(file.name).toBe("DANFE-homologacao.pdf");
    expect(file.type).toBe("application/pdf");
    await expect(fiscalPdfFile(new Response("<html/>"), "test.pdf")).rejects.toThrow("não retornou um PDF");
    await expect(fiscalPdfFile(new Response("<xml/>", { headers: { "Content-Type": "application/pdf" } }), "test.pdf")).rejects.toThrow("PDF fiscal inválido");
  });
  it("chama o compartilhamento com arquivo imediatamente, sem URL pública nem envio confirmado", async () => {
    const file = new File(["%PDF-"], "DANFE.pdf", { type: "application/pdf" });
    const share = vi.fn().mockResolvedValue(undefined), download = vi.fn();
    const result = shareFiscalPdf(file, { canShare: () => true, share }, download);
    expect(share).toHaveBeenCalledWith({ files: [file], title: file.name });
    expect(await result).toContain("não é confirmada");
    expect(download).not.toHaveBeenCalled();
  });
  it("faz fallback explícito se indisponível; cancelamento não vira sucesso; erros permanecem visíveis", async () => {
    const file = new File(["%PDF-"], "DANFSe.pdf", { type: "application/pdf" }), download = vi.fn();
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareFiscalPdf(file, { canShare: () => false, share }, download)).toContain("anexar manualmente");
    expect(download).toHaveBeenCalledWith(file);
    expect(share).not.toHaveBeenCalled();
    download.mockClear();
    share.mockRejectedValue(new DOMException("Cancelado", "AbortError"));
    expect(await shareFiscalPdf(file, { canShare: () => true, share }, download)).toBe("Compartilhamento cancelado.");
    share.mockRejectedValue(new DOMException("Bloqueado", "NotAllowedError"));
    await expect(shareFiscalPdf(file, { canShare: () => true, share }, download)).rejects.toThrow("Bloqueado");
    expect(download).not.toHaveBeenCalled();
  });
});
