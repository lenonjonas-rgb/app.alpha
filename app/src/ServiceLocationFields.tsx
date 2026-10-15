import { useEffect, useState } from "react";
import type { Client, OrderDetails, ServiceLocation } from "./domain";
import { lookupPostalCode } from "./cep";
import { errorMessage } from "./useDatabase";
import { serviceLocationAddress, serviceLocationSchema } from "./domain";
import { ServicePointPicker } from "./ServicePointPicker";

export function ServiceLocationFields({ client, details, initialPoint }: { client?: Client; details?: OrderDetails; initialPoint?: OrderDetails["servicePoint"] }) {
  const [location, setLocation] = useState<ServiceLocation>(() => details?.serviceLocation ?? {
    useClientAddress: true, postalCode: "", street: "", number: "",
    complement: "", neighborhood: "", city: "", state: "",
  });
  const [lookup, setLookup] = useState({ status: "", message: "" });
  const [lookupCode, setLookupCode] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { postalCode, useClientAddress } = location;
  useEffect(() => {
    if (useClientAddress || lookupCode.length !== 8) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLookup({ status: "loading", message: "Consultando CEP…" });
      void lookupPostalCode(lookupCode, controller.signal).then((address) => {
        if (controller.signal.aborted) return;
        setLocation((current) => ({ ...current, ...address }));
        setLookup({ status: "success", message: "Endereço localizado. Informe o número e, se houver, o complemento." });
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setLookup({ status: "error", message: `${errorMessage(cause)} Você também pode preencher o endereço manualmente.` });
      });
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [lookupCode, useClientAddress, attempt]);

  function field(key: "street" | "number" | "complement" | "neighborhood" | "city" | "state", label: string, maxLength: number, required = true) {
    return <label className={`field${key === "street" ? " full" : ""}`}>
      {label}{required ? " *" : ""}
      <input name={`service_${key}`} value={location[key]} maxLength={maxLength} required={required}
        onChange={(event) => setLocation((current) => ({ ...current, [key]: key === "state" ? event.target.value.toUpperCase() : event.target.value }))} />
    </label>;
  }

  return <>
    <label className="field full">Endereço cadastrado do cliente
      <input value={client?.address ?? ""} readOnly placeholder="Cliente sem endereço cadastrado" />
    </label>
    <label className="checkbox-field full">
      <input type="checkbox" name="useClientAddress" checked={useClientAddress}
        onChange={(event) => setLocation((current) => ({ ...current, useClientAddress: event.target.checked }))} />
      Atendimento no endereço cadastrado do cliente
    </label>
    {!useClientAddress && <>
      <label className="field full">CEP de atendimento *
        <input name="service_postalCode" inputMode="numeric" autoComplete="postal-code" required
          value={postalCode.length > 5 ? `${postalCode.slice(0, 5)}-${postalCode.slice(5)}` : postalCode}
          maxLength={9} pattern="\d{5}-?\d{3}"
          onChange={(event) => {
            const value = event.target.value.replace(/\D/g, "").slice(0, 8);
            setLookupCode(value);
            setLocation((current) => ({ ...current, postalCode: value, street: "", neighborhood: "", city: "", state: "" }));
            setLookup({ status: "", message: "" });
          }} />
        <small role={lookup.status === "error" ? "alert" : "status"}>{lookup.message}</small>
        {lookup.status === "error" && <button type="button" className="text-button" onClick={() => setAttempt((current) => current + 1)}>Consultar CEP novamente</button>}
      </label>
      {field("street", "Logradouro de atendimento", 300)}
      {field("number", "Número de atendimento", 40)}
      {field("complement", "Complemento de atendimento", 200, false)}
      {field("neighborhood", "Bairro de atendimento", 200, false)}
      {field("city", "Cidade de atendimento", 200)}
      {field("state", "UF de atendimento", 2)}
    </>}
    <ServicePointPicker address={serviceLocationAddress(location, client?.address ?? "")} initialPoint={initialPoint ?? details?.servicePoint}
      ready={serviceLocationSchema.safeParse(location).success} />
    <label className="field">Nome do responsável pelo atendimento
      <input name="responsibleName" defaultValue={details?.responsibleName ?? ""} maxLength={160} />
    </label>
    <label className="field">Telefone do responsável pelo atendimento
      <input name="responsiblePhone" type="tel" defaultValue={details?.responsiblePhone ?? ""} maxLength={40} />
    </label>
  </>;
}
