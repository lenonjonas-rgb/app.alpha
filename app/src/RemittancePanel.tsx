import { useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";
import { currency } from "./domain";
import type { Database } from "./domain";
import { fiscalConfigured, fiscalRequest } from "./fiscalApi";
import { errorMessage } from "./useDatabase";
import { remittanceHistorySchema } from "./remittanceSchema";

const configSchema = z.object({
  accountId: z.string(), agencia: z.string(), conta: z.string(), dac: z.string(), carteira: z.string(),
  nextNossoNumero: z.number().int(), nextFileSequence: z.number().int(),
});
export function RemittancePanel({ data }: { data: Database }) {
  const [accountId, setAccountId] = useState("");
  const [config, setConfig] = useState<z.infer<typeof configSchema> | null>(null);
  const [history, setHistory] = useState<z.infer<typeof remittanceHistorySchema>>([]);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const banks = data.finance.accounts.filter((bank) => bank.active && /itau|341/i.test(bank.bank.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
  const bank = banks.find((item) => item.id === accountId);
  const used = new Set(history.flatMap((item) => item.entryIds));
  const available = data.finance.entries.filter((entry) => entry.accountId === accountId && entry.kind === "Receber" &&
    entry.paymentMethod === "Boleto" && !entry.canceled && entry.invoiceId && !used.has(entry.id) &&
    !entry.settlements.some((settlement) => !settlement.reversed) &&
    data.finance.invoices.some((invoice) => invoice.id === entry.invoiceId && !invoice.canceled && invoice.kind !== "Legado"));
  const clients = data.clients.filter((client) => available.some((entry) => selected.includes(entry.id) &&
    (entry.clientId ?? data.finance.invoices.find((invoice) => invoice.id === entry.invoiceId)?.clientId) === client.id));
  async function refresh() {
    const [configResponse, historyResponse] = await Promise.all([
      fiscalRequest(`/remittances/config?accountId=${encodeURIComponent(accountId)}`), fiscalRequest("/remittances"),
    ]);
    setConfig(configSchema.nullable().parse(await configResponse.json()));
    setHistory(remittanceHistorySchema.parse(await historyResponse.json()));
    setConnected(true);
  }
  async function act(operation: () => Promise<void>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); await refresh(); setMessage(success); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void act(async () => {
      await fiscalRequest("/remittances/config", "PUT", {
        accountId, agencia: form.get("agencia"), conta: form.get("conta"), dac: form.get("dac"), carteira: form.get("carteira"),
        codigoCarteira: "I", primeiroNossoNumero: form.get("nossoNumero"), sequenciaInicialArquivo: Number(form.get("sequence")),
      });
    }, "Configuração salva. Contadores já utilizados não podem regredir.");
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const addresses = Object.fromEntries(clients.map((client) => [client.id, Object.fromEntries(
      ["logradouro", "bairro", "cep", "cidade", "uf"].map((field) => [field, String(form.get(`${client.id}:${field}`)).trim()]),
    )]));
    void act(async () => {
      await fiscalRequest("/remittances", "POST", { accountId, entryIds: selected, addresses });
      setSelected([]);
    }, "Arquivo persistido. Baixe no histórico e homologue no Itaú. Nenhum título foi enviado ou baixado.");
  }
  async function download(id: string, sequence: number) {
    const response = await fiscalRequest(`/remittances/${id}/file`);
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `ITAU-${String(sequence).padStart(6, "0")}.REM`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section>
    <h2>Remessas Itaú · CNAB400</h2>
    <p>Arquivo de cobrança simples para envio manual, sem API bancária. Confirme carteira, contrato e layout com o Itaú e homologue antes de enviar em produção. Não gera Pix, PDF de boleto, registro ou baixa automática.</p>
    <p>Cadastre primeiro o emitente na aba Fiscal e a conta Itaú em Bancos. Aguarde o financeiro ficar Sincronizado. Endereços abaixo são dados específicos do arquivo e não alteram o cadastro do cliente.</p>
    <p>Toda remessa exige uma nota autorizada em produção por faturamento: NF-e para produtos e NFS-e para serviços, inclusive sem retenções. Sem nota, homologação ou outro documento ativo/incerto bloqueiam o lote inteiro, sem consumir numeração.</p>
    <p>O servidor confere XML, assinatura, protocolo e origem financeira da NF-e. NFS-e exige conferência atual confirmada na aba Fiscal; com retenções, remete apenas o líquido oficial conferido, nunca o bruto. Títulos antigos sem origem fiscal preservada não têm liberação automática.</p>
    {!fiscalConfigured && <p role="alert">Configure VITE_FISCAL_API_URL para conectar o backend persistente.</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
    <label className="field">Conta Itaú<select value={accountId} disabled={busy} onChange={(event) => {
      setAccountId(event.target.value); setConfig(null); setConnected(false); setSelected([]); setError(""); setMessage("");
    }}><option value="">Selecione</option>{banks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <button className="button secondary" disabled={!accountId || !fiscalConfigured || busy} onClick={() => void act(async () => {}, "Configuração e histórico atualizados.")}>Conectar / atualizar remessas</button>
    {connected && bank && <>
      <form key={`${accountId}-${config?.nextFileSequence ?? "new"}`} onSubmit={saveConfig}>
        <h3>Contrato de cobrança</h3>
        <div className="form-grid">
          <label className="field">Agência (4 dígitos)<input name="agencia" required pattern="[0-9]{4}" maxLength={4} defaultValue={config?.agencia ?? bank.agency.replace(/\D/g, "")} /></label>
          <label className="field">Conta (5 dígitos)<input name="conta" required pattern="[0-9]{5}" maxLength={5} defaultValue={config?.conta} /></label>
          <label className="field">DAC da conta<input name="dac" required pattern="[0-9]" maxLength={1} defaultValue={config?.dac} /></label>
          <label className="field">Carteira contratada (3 dígitos)<input name="carteira" required pattern="[0-9]{3}" maxLength={3} defaultValue={config?.carteira} /></label>
          <label className="field">Próximo Nosso Número<input name="nossoNumero" required pattern="[0-9]{8}" maxLength={8} defaultValue={config ? String(config.nextNossoNumero).padStart(8, "0") : undefined} /></label>
          <label className="field">Próxima sequência do arquivo<input name="sequence" type="number" required min={1} max={999999} defaultValue={config?.nextFileSequence} /></label>
        </div>
        <p>Use os próximos números livres do contrato existente, incluindo arquivos gerados fora do Alpha. Não reinicie a numeração. Modalidade suportada: cobrança simples escritural, código I; sem registros de mensagem 7/8.</p>
        <button disabled={busy} className="button primary">Salvar contrato de cobrança</button>
      </form>
      <form onSubmit={create}>
        <h3>Títulos abertos para conferir</h3>
        <p>A lista mostra candidatos pelo financeiro, não autorização de cobrança. Ao gerar, o backend revalida as notas e os valores de todos os títulos selecionados.</p>
        <div className="finance-table"><table><thead><tr><th>Selecionar</th><th>Cliente / documento</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>
          {available.map((entry) => <tr key={entry.id}><td><input type="checkbox" aria-label={`Remeter ${entry.description}`} checked={selected.includes(entry.id)} disabled={busy}
            onChange={(event) => setSelected(event.target.checked ? [...selected, entry.id] : selected.filter((id) => id !== entry.id))} /></td>
            <td>{entry.party}<br />{entry.description}</td><td>{entry.dueOn}</td><td>{currency(entry.amount - (entry.retention?.withheld ?? 0))}
              {entry.retention && <small> · líquido sujeito à conferência oficial</small>}</td></tr>)}
        </tbody></table></div>
        {!available.length && <p>Nenhum boleto de faturamento separado elegível nesta conta. Títulos com baixa, cancelados ou já remetidos não entram novamente.</p>}
        {clients.map((client) => <fieldset key={client.id}><legend>Endereço para cobrança · {client.name}</legend><p>Cadastro: {client.address}</p><div className="form-grid">
          <label className="field">Logradouro, número e complemento<input name={`${client.id}:logradouro`} required maxLength={40} /></label>
          <label className="field">Bairro<input name={`${client.id}:bairro`} required maxLength={12} /></label>
          <label className="field">CEP sem pontuação<input name={`${client.id}:cep`} required pattern="[0-9]{8}" maxLength={8} /></label>
          <label className="field">Cidade<input name={`${client.id}:cidade`} required maxLength={15} /></label>
          <label className="field">UF<input name={`${client.id}:uf`} required pattern="[A-Z]{2}" maxLength={2} /></label>
        </div></fieldset>)}
        <button disabled={busy || !config || !selected.length} className="button primary">Gerar arquivo dos títulos selecionados ({selected.length})</button>
      </form>
      <h3>Histórico persistente</h3>
      <div className="finance-table"><table><thead><tr><th>Arquivo</th><th>Criado em</th><th>Títulos / notas vinculadas</th><th>Ação</th></tr></thead><tbody>
        {history.filter((item) => item.accountId === accountId).map((item) => <tr key={item.id}><td>{item.fileSequence}</td><td>{new Date(item.createdAt).toLocaleString("pt-BR")}</td><td>{item.entryIds.length}
          {item.entries?.map((entry) => <div key={entry.entryId}><small>{entry.fiscalDocumentId && entry.amount !== undefined
            ? `${entry.fiscalKind === "nfe" ? "NF-e" : "NFS-e"} · ${entry.fiscalAccessKey} · ${currency(entry.amount)}${entry.fiscalProtocol ? ` · protocolo ${entry.fiscalProtocol}` : ""}`
            : "Arquivo histórico sem vínculo fiscal registrado; não comprova autorização."}</small></div>)}
          {!item.entries && <small>Arquivo histórico sem vínculo fiscal registrado; não comprova autorização.</small>}</td>
          <td><button className="text-button" disabled={busy} onClick={() => void act(() => download(item.id, item.fileSequence), "Remessa original baixada; nenhum novo arquivo ou número foi gerado.")}>Baixar .REM</button></td></tr>)}
      </tbody></table></div>
    </>}
  </section>;
}
