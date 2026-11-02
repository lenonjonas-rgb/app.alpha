import { validateDatabase } from "./domain";
import type { Database } from "./domain";
import type { ServiceInvoice } from "./serviceInvoiceSchema";
import { nfseTaxSetSchema } from "./nfseTaxSetSchema";
import type { NfseTaxSet } from "./nfseTaxSetSchema";
import { existingFiscalCode, normalizedFiscalCode } from "./nfseTaxCodes";

export function saveNfseTaxSet(data: Database, input: NfseTaxSet): Database {
  const set = nfseTaxSetSchema.parse(input);
  const others = data.settings.nfseTaxSets.filter((item) => item.id !== set.id);
  if (others.some((item) => item.name.toLocaleLowerCase("pt-BR") === set.name.toLocaleLowerCase("pt-BR")))
    throw new Error("Já existe um conjunto de tributação com este nome.");
  const updated = data.settings.nfseTaxSets.some((item) => item.id === set.id)
    ? data.settings.nfseTaxSets.map((item) => item.id === set.id ? set : set.isDefault ? { ...item, isDefault: false } : item)
    : [...data.settings.nfseTaxSets.map((item) => set.isDefault ? { ...item, isDefault: false } : item), set];
  return validateDatabase({ ...data, settings: { ...data.settings, nfseTaxSets: updated } });
}

export function applyNfseTaxSet(nfse: ServiceInvoice, set: NfseTaxSet): ServiceInvoice {
  if (!set.active) throw new Error("Selecione um conjunto de tributação ativo.");
  return {
    ...nfse,
    service: {
      ...nfse.service,
      taxSetId: set.id,
      taxSet: set.name,
      nationalCode: set.nationalCode,
      municipalCode: set.municipalCode,
      nbs: set.nbs,
      operationIndicator: set.operationIndicator,
      cst: "",
      classification: "",
    },
    taxes: { ...nfse.taxes, issRate: set.issRate, ibptRate: set.ibptRate ?? nfse.taxes.ibptRate },
  };
}

export function detachNfseTaxSet(nfse: ServiceInvoice): ServiceInvoice {
  return { ...nfse, service: { ...nfse.service, taxSetId: "", taxSet: "" } };
}

export function nfseTaxSetDiffers(nfse: ServiceInvoice, set: NfseTaxSet): boolean {
  return nfse.service.taxSet !== set.name ||
    normalizedFiscalCode(nfse.service.nationalCode) !== set.nationalCode ||
    nfse.service.municipalCode !== set.municipalCode ||
    normalizedFiscalCode(nfse.service.nbs) !== set.nbs ||
    existingFiscalCode(nfse.service.operationIndicator, 6) !== set.operationIndicator ||
    nfse.taxes.issRate !== set.issRate ||
    (set.ibptRate !== null && nfse.taxes.ibptRate !== set.ibptRate);
}

export function changeNfseOperation(nfse: ServiceInvoice, operationIndicator: string): ServiceInvoice {
  if (nfse.service.operationIndicator === operationIndicator) return nfse;
  const oldCode = existingFiscalCode(nfse.service.operationIndicator, 6);
  const newCode = existingFiscalCode(operationIndicator, 6);
  const unchangedCode = /^\d{6}$/.test(oldCode) && oldCode === newCode;
  return { ...nfse, service: { ...nfse.service, operationIndicator,
    cst: unchangedCode ? nfse.service.cst : "", classification: unchangedCode ? nfse.service.classification : "" } };
}

export function changeNfseCst(nfse: ServiceInvoice, cst: string): ServiceInvoice {
  if (nfse.service.cst === cst) return nfse;
  const oldCode = existingFiscalCode(nfse.service.cst, 3);
  const newCode = existingFiscalCode(cst, 3);
  const classification = /^\d{3}$/.test(oldCode) && oldCode === newCode ? nfse.service.classification : "";
  return { ...nfse, service: { ...nfse.service, cst, classification } };
}
