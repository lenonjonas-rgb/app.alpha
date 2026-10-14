import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDatabase, getOrderDetails, instantiateQuestionnaire, validateDatabase } from "./domain";
import { reportSettingsSchema } from "./reportSettings";
import { OrderPrintable } from "./OrderWorkspace";
import { questionnaireDisplaySchema } from "./questionnaireSchema";

function fixture() {
  const data = demoDatabase();
  const order = data.orders[0];
  const unit = data.equipment.find((item) => item.id === order.equipmentId)!;
  unit.assetCode = "EQ-REPORT-UNIT";
  const details = getOrderDetails(order);
  details.report = "RELATO-EXCLUSIVO";
  const template = {
    id: "report-template", title: "QUESTIONARIO-EXCLUSIVO", revision: 1, archived: false,
    requiredForCheckout: false, header: "", footer: "", display: questionnaireDisplaySchema.parse({ equipment: true }),
    questions: [
      { id: "text", kind: "Texto" as const, label: "Texto de teste", required: false, options: [] },
      { id: "photo", kind: "Foto" as const, label: "FOTO-EXCLUSIVA", required: false, options: [] },
      { id: "sign", kind: "Assinatura" as const, label: "ASSINATURA-EXCLUSIVA", required: false, options: [] },
    ],
  };
  const checklist = instantiateQuestionnaire(template, unit.id);
  checklist.questions[0].answer = "RESPOSTA-PRESERVADA";
  details.checklists = [checklist];
  details.signature = { signer: "SIGNATARIO-EXCLUSIVO", image: "data:image/png;base64,AAAA", at: "2026-10-14T12:00:00Z" };
  details.attachments = [
    { id: "photo", name: "ANEXO-FOTO", mime: "image/png", size: 3, data: "data:image/png;base64,AAAA", at: "2026-10-14T12:00:00Z" },
    { id: "file", name: "ANEXO-TEXTO", mime: "text/plain", size: 3, data: "data:text/plain;base64,AAAA", at: "2026-10-14T12:00:00Z" },
  ];
  return { data, order, details, unit };
}

describe("configuração dos relatórios de atendimento", () => {
  it("abre bases antigas com todas as seções e modelo limpo sem alterar tarefas", () => {
    const data = demoDatabase();
    const { reportSettings: _settings, ...oldSettings } = data.settings;
    const restored = validateDatabase({ ...data, settings: oldSettings });
    expect(restored.settings.reportSettings).toEqual(reportSettingsSchema.parse({}));
    expect(Object.values(restored.settings.reportSettings.sections).every(Boolean)).toBe(true);
    expect(restored.orders).toEqual(data.orders);
    expect(validateDatabase(JSON.parse(JSON.stringify(restored))).settings.reportSettings).toEqual(restored.settings.reportSettings);
  });
  it("valida título, modelo, fonte e ordenação", () => {
    expect(() => reportSettingsSchema.parse({ title: "   " })).toThrow();
    expect(() => reportSettingsSchema.parse({ layout: "invalid" })).toThrow();
    expect(() => reportSettingsSchema.parse({ fontSize: "invalid" })).toThrow();
    expect(() => reportSettingsSchema.parse({ questionnaireOrder: "invalid" })).toThrow();
  });
  it.each(["classic", "clean", "watermark"] as const)("renderiza o modelo %s na prévia e na impressão com o mesmo conteúdo", (layout) => {
    const { data, order, details } = fixture();
    data.settings.reportSettings.layout = layout;
    data.settings.reportSettings.title = "TÍTULO PERSONALIZADO";
    const print = renderToStaticMarkup(<OrderPrintable data={data} order={order} details={details} />);
    const preview = renderToStaticMarkup(<OrderPrintable data={data} order={order} details={details} preview />);
    expect(print).toContain(`layout-${layout}`);
    expect(preview.replace("order-report-preview", "order-print-only")).toBe(print);
    expect(print).toContain("TÍTULO PERSONALIZADO");
    expect(print).toContain("EQ-REPORT-UNIT");
    expect(print).toContain("RESPOSTA-PRESERVADA");
    expect(print.includes("report-watermark")).toBe(layout === "watermark");
    expect(print.includes('scope="row"')).toBe(layout === "classic");
  });
  it("remove seções ocultas do conteúdo, não apenas por CSS", () => {
    const { data, order, details } = fixture();
    data.settings.reportSettings.sections = Object.fromEntries(
      Object.keys(data.settings.reportSettings.sections).map((key) => [key, false]),
    ) as typeof data.settings.reportSettings.sections;
    const html = renderToStaticMarkup(<OrderPrintable data={data} order={order} details={details} />);
    for (const secret of ["RELATO-EXCLUSIVO", "QUESTIONARIO-EXCLUSIVO", "RESPOSTA-PRESERVADA", "EQ-REPORT-UNIT",
      "SIGNATARIO-EXCLUSIVO", "ANEXO-FOTO", "ANEXO-TEXTO", data.clients[0].name, "Total da OS", "Controle de horas"])
      expect(html).not.toContain(secret);
    expect(html).toContain(order.code);
  });
  it("oculta fotos e assinaturas também nos questionários, preservando as outras respostas", () => {
    const { data, order, details } = fixture();
    data.settings.reportSettings.sections.photos = false;
    data.settings.reportSettings.sections.signature = false;
    const html = renderToStaticMarkup(<OrderPrintable data={data} order={order} details={details} />);
    expect(html).not.toContain("FOTO-EXCLUSIVA");
    expect(html).not.toContain("ASSINATURA-EXCLUSIVA");
    expect(html).not.toContain("SIGNATARIO-EXCLUSIVO");
    expect(html).not.toContain("ANEXO-FOTO");
    expect(html).toContain("ANEXO-TEXTO");
    expect(html).toContain("RESPOSTA-PRESERVADA");
  });
  it("não mostra totais dos orçamentos quando valores estão ocultos", () => {
    const { data, order, details } = fixture();
    data.quotes[0].orderId = order.id;
    data.settings.reportSettings.sections.values = false;
    const html = renderToStaticMarkup(<OrderPrintable data={data} order={order} details={details} />);
    expect(html).toContain(data.quotes[0].code);
    expect(html).not.toContain("R$");
  });
  it("ordena questionários por equipamento sem alterar o documento original e respeita questionários ocultos", () => {
    const { data, order, details, unit } = fixture();
    const second = { ...unit, id: "second-unit", serial: "EQ-AAA", assetCode: "EQ-AAA" };
    data.equipment.push(second);
    details.checklists.push({ ...structuredClone(details.checklists[0]), id: "second", title: "Primeiro pelo código", equipmentId: second.id });
    details.checklists.push({ ...structuredClone(details.checklists[0]), id: "hidden", title: "NÃO-EXIBIR", display: { ...details.checklists[0].display!, showOnOrder: false } });
    const before = structuredClone(details);
    data.settings.reportSettings.questionnaireOrder = "equipment";
    const html = renderToStaticMarkup(<OrderPrintable data={data} order={order} details={details} />);
    expect(html.indexOf("<h3>Primeiro pelo código")).toBeLessThan(html.indexOf("<h3>QUESTIONARIO-EXCLUSIVO"));
    expect(html).not.toContain("NÃO-EXIBIR");
    expect(details).toEqual(before);
  });
});
