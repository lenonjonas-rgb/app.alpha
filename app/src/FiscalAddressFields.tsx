import type { FiscalAddress } from "./fiscalPartySchema";

export function FiscalAddressFields({ address, issuer = false }: { address?: FiscalAddress; issuer?: boolean }) {
  return <div className="form-grid">
    <label className="field">Logradouro<input name="street" required maxLength={60} defaultValue={address?.street} /></label>
    <label className="field">Número (ou S/N)<input name="number" required maxLength={60} defaultValue={address?.number} /></label>
    <label className="field">Complemento<input name="complement" maxLength={60} defaultValue={address?.complement} /></label>
    <label className="field">Bairro<input name="district" required maxLength={60} defaultValue={address?.district} /></label>
    <label className="field">CEP (8 dígitos)<input name="postalCode" required pattern="[0-9]{8}" maxLength={8} defaultValue={address?.postalCode} /></label>
    <label className="field">Município IBGE (7 dígitos)<input name="municipality" required pattern={issuer ? "4205407" : "[0-9]{7}"} maxLength={7} defaultValue={address?.municipality ?? (issuer ? "4205407" : "")} readOnly={issuer} /></label>
    <label className="field">Nome do município<input name="city" required maxLength={60} defaultValue={address?.city ?? (issuer ? "Florianópolis" : "")} /></label>
    <label className="field">UF<select name="state" required defaultValue={address?.state ?? (issuer ? "SC" : "")}>
      <option value="">Selecione</option>{(issuer ? ["SC"] : ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"]).map((state) =>
        <option key={state} value={state}>{state}</option>)}
    </select></label>
  </div>;
}
