import { useState } from "react";
import type { Database } from "./domain";
import { fiscalRequest } from "./fiscalApi";
import { FiscalAddressFields } from "./FiscalAddressFields";
import { addressFromForm } from "./fiscalPartySchema";
import type { FiscalRecipient } from "./fiscalPartySchema";

export function FiscalRecipientPanel({ data, recipients, busy, act }: {
  data: Database; recipients: FiscalRecipient[]; busy: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const client = data.clients.find((item) => item.id === clientId);
  const current = recipients.find((item) => item.clientId === clientId);
  return <section>
    <h3>Dados fiscais dos clientes</h3>
    <p>Cadastro nacional com CPF/CNPJ numérico, endereço estruturado e indicador de contribuinte. Não consulta situação cadastral/IE nem valida existência do município na base IBGE. Clientes estrangeiros, CNPJ alfanumérico e CPF contribuinte/produtor rural ainda não são suportados.</p>
    <label className="field">Cliente para cadastro fiscal<select value={clientId} disabled={busy} onChange={(event) => setClientId(event.target.value)}>
      <option value="">Selecione</option>{data.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {client && <form key={`${clientId}:${current?.updatedAt ?? "new"}`} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void act(async () => {
        await fiscalRequest("/recipients", "PUT", {
          clientId, document: String(form.get("document")).replace(/[.\s/-]/g, ""), name: form.get("name"),
          address: addressFromForm(form), ieIndicator: form.get("ieIndicator"), ie: form.get("ie"), im: form.get("im"),
          finalConsumer: form.get("finalConsumer") === "on", email: form.get("email"), phone: form.get("phone"),
        });
      }, "Dados fiscais do cliente salvos. Não representam aprovação contábil ou emissão.");
    }}>
      <fieldset disabled={busy}><legend>{client.name}</legend>
        <p>Documento na nuvem: {client.document || "não preenchido"} · endereço livre: {client.address || "não preenchido"}</p>
        <p>O documento precisa corresponder ao cadastro na nuvem. Dados fiscais são separados e não reescrevem o cliente. Confira novamente se o cadastro principal mudar.</p>
        <div className="form-grid">
          <label className="field">CPF/CNPJ sem pontuação<input name="document" required pattern="([0-9]{11}|[0-9]{14})" maxLength={14} defaultValue={current?.document ?? client.document.replace(/[.\s/-]/g, "")} /></label>
          <label className="field">Nome / razão social fiscal<input name="name" required maxLength={60} defaultValue={current?.name ?? client.name} /></label>
          <label className="field">Indicador de contribuinte ICMS<select name="ieIndicator" defaultValue={current?.ieIndicator ?? "9"}>
            <option value="1">1 · Contribuinte (exige IE)</option><option value="2">2 · Contribuinte isento</option><option value="9">9 · Não contribuinte</option>
          </select></label>
          <label className="field">IE (somente contribuinte; sem pontuação)<input name="ie" pattern="[0-9]{2,14}|^$" maxLength={14} defaultValue={current?.ie ?? ""} /></label>
          <label className="field">Inscrição municipal (quando aplicável)<input name="im" maxLength={30} defaultValue={current?.im ?? ""} /></label>
          <label className="field">E-mail fiscal<input name="email" type="email" maxLength={80} defaultValue={current?.email ?? client.email} /></label>
          <label className="field">Telefone (6 a 14 dígitos, quando informado)<input name="phone" pattern="[0-9]{6,14}|^$" maxLength={14} defaultValue={current?.phone ?? ""} /></label>
        </div>
        <FiscalAddressFields address={current?.address} />
        <label className="checkbox-field"><input name="finalConsumer" type="checkbox" defaultChecked={current?.finalConsumer ?? true} />Consumidor final</label>
        <button className="button primary">Salvar dados fiscais do cliente</button>
      </fieldset>
    </form>}
    <div className="finance-table"><table><thead><tr><th>Cliente</th><th>Documento</th><th>Município / UF</th><th>Contribuinte</th><th>Ação</th></tr></thead><tbody>
      {recipients.map((party) => {
        const record = data.clients.find((item) => item.id === party.clientId);
        const changed = record && record.document.replace(/[.\s/-]/g, "") !== party.document;
        return <tr key={party.clientId}><td>{party.name}{!record && " · cliente ausente"}{changed && " · documento alterado: reconferir"}</td>
          <td>{party.document}</td><td>{party.address.city} / {party.address.state} · {party.address.municipality}</td><td>{party.ieIndicator} · {party.ie || "sem IE"}</td>
          <td><button className="text-button" disabled={busy || !record} onClick={() => setClientId(party.clientId)}>Conferir / editar cliente</button></td></tr>;
      })}
    </tbody></table></div>
    {!recipients.length && <p>Nenhum cliente com dados fiscais estruturados.</p>}
  </section>;
}
