import { useId, useState } from "react";
import { existingFiscalCode } from "./nfseTaxCodes";
import type { NfseTaxOption } from "./nfseTaxCatalog";

const manualOption = "__manual__";

export function NfseTaxCodeSelect({ label, value, options, onChange, length, maxLength, disabled = false }: {
  label: string;
  value: string;
  options: NfseTaxOption[];
  onChange: (value: string) => void;
  length: number;
  maxLength: number;
  disabled?: boolean;
}) {
  const id = useId();
  const [manual, setManual] = useState(false);
  const code = existingFiscalCode(value, length);
  const known = options.some((option) => option.code === code);
  const showManual = manual || Boolean(value && !known);
  const selected = showManual ? manualOption : known ? code : "";
  const suggested = options.filter((option) => option.suggested);
  const others = options.filter((option) => !option.suggested);

  function choose(next: string) {
    if (next === manualOption) {
      setManual(true);
      return;
    }
    setManual(false);
    onChange(next);
  }

  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={selected} disabled={disabled} onChange={(event) => choose(event.target.value)}>
      <option value="">{disabled ? "Selecione o campo anterior" : "Selecione"}</option>
      {suggested.length > 0 && <optgroup label="Sugestões para o serviço e NBS">
        {suggested.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
      </optgroup>}
      {others.length > 0 && <optgroup label={suggested.length ? "Outras opções" : "Opções da tabela oficial"}>
        {others.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
      </optgroup>}
      <option value={manualOption}>Outro código / valor existente</option>
    </select>
    {showManual && <input aria-label={`${label} manual`} value={value} maxLength={maxLength} disabled={disabled}
      onChange={(event) => onChange(event.target.value)} />}
    {!showManual && known && code !== value && <small>Valor registrado: {value}</small>}
  </div>;
}
