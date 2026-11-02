import catalog from "./nfseTaxCatalog.json";
import { existingFiscalCode, normalizedFiscalCode } from "./nfseTaxCodes";

export type NfseTaxOption = { code: string; label: string; suggested: boolean };

export function nfseTaxOptions(input: {
  nationalCode: string;
  nbs: string;
  operationIndicator: string;
  cst: string;
  issueDate: string;
}) {
  const national = normalizedFiscalCode(input.nationalCode);
  const nbs = normalizedFiscalCode(input.nbs);
  const operation = existingFiscalCode(input.operationIndicator, 6);
  const cst = existingFiscalCode(input.cst, 3);
  const correlations = /^\d{9}$/.test(nbs) && (!national || /^\d{6}$/.test(national))
    ? catalog.correlations.filter(([item, rowNbs]) => rowNbs === nbs && (!national || national.startsWith(item)))
    : [];
  const suggestedOperations = new Set(correlations.map(([, , code]) => code));
  const matchingOperation = correlations.filter(([, , code]) => code === operation);
  const suggestedClasses = new Set(matchingOperation.map(([, , , code]) => code));
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(input.issueDate);
  const activeClasses = catalog.classifications.filter((item) => dateValid &&
    (!item.validFrom || item.validFrom <= input.issueDate) && (!item.validUntil || input.issueDate <= item.validUntil));
  const suggestedCsts = new Set(activeClasses.filter((item) => suggestedClasses.has(item.code)).map((item) => item.cst));
  const cstDescriptions = new Map(activeClasses.map((item) => [item.cst, item.cstDescription]));

  const indicators: NfseTaxOption[] = catalog.indicators.map((item) => ({
    code: item.code,
    label: `${item.code} - ${item.kind}: ${item.description}`,
    suggested: suggestedOperations.has(item.code),
  }));
  const csts: NfseTaxOption[] = [...cstDescriptions].map(([code, description]) => ({
    code, label: `${code} - ${description}`, suggested: suggestedCsts.has(code),
  }));
  const classifications: NfseTaxOption[] = activeClasses.filter((item) => item.cst === cst).map((item) => ({
    code: item.code, label: `${item.code} - ${item.description}`, suggested: suggestedClasses.has(item.code),
  }));
  return { indicators, csts, classifications };
}
