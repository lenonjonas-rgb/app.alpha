import type { FiscalTaxParameters } from "./fiscalTaxParameters";

export function FiscalTaxParameterFields({ kind, parameters }: { kind: "nfe" | "nfse"; parameters?: FiscalTaxParameters }) {
  const products = parameters?.kind === "nfe" ? parameters : undefined;
  const services = parameters?.kind === "nfse" ? parameters : undefined;
  const ibs = parameters?.ibsCbs;
  const percent = (name: string, label: string, value?: string) => <label key={name} className="field">{label}
    <input name={name} type="number" required min="0" max="100" step="0.0001" defaultValue={value} />
  </label>;
  const code = (name: string, label: string, digits: number, value?: string) => <label className="field">{label}
    <input name={name} required pattern={`[0-9]{${digits}}`} maxLength={digits} defaultValue={value} />
  </label>;
  return <section>
    <h4>Parâmetros fiscais da matriz</h4>
    <p>Preencha os percentuais, inclusive zero quando efetivamente aplicável. Base em % é a parcela da base escolhida sujeita ao tributo (por exemplo, 100 significa base integral); não é a alíquota. Nenhum valor é sugerido automaticamente. Os parâmetros são salvos nesta matriz; não alteram a referência do Bling nem recalculam notas existentes.</p>
    {kind === "nfe" ? <>
      <h5>Operação e ICMS</h5>
      <div className="form-grid">
        {code("cfop", "CFOP da operação", 4, products?.cfop)}
        {code("icms.cst", "CST ICMS", 2, products?.icms.cst)}
        {percent("icms.rate", "Alíquota ICMS (%)", products?.icms.rate)}
        {percent("icms.basePercent", "Parcela tributável da base ICMS (%)", products?.icms.basePercent)}
      </div>
      <p>A base ICMS aqui cadastrada é o valor líquido do item após desconto. Operações que exigem outra fórmula, ST, FCP, DIFAL, IPI, benefícios ou diferimento ainda precisam de campos/cálculo específicos; não adapte esses casos colocando taxas arbitrárias.</p>
      {(["pis", "cofins"] as const).map((name) => <div key={name}>
        <h5>{name.toUpperCase()} · apuração própria</h5><div className="form-grid">
          {code(`${name}.cst`, `CST ${name.toUpperCase()}`, 2, products?.[name].cst)}
          {percent(`${name}.rate`, `Alíquota ${name.toUpperCase()} (%)`, products?.[name].rate)}
          {percent(`${name}.basePercent`, `Parcela tributável da base ${name.toUpperCase()} (%)`, products?.[name].basePercent)}
          <label className="field">Composição da base<select name={`${name}.baseMode`} required defaultValue={products?.[name].baseMode ?? ""}>
            <option value="">Selecione</option><option value="net">Valor líquido do item</option><option value="net-minus-icms">Valor líquido menos ICMS</option>
          </select></label>
        </div>
      </div>)}
    </> : <>
      <h5>ISS</h5><div className="form-grid">
        {percent("iss.rate", "Alíquota ISS (%)", services?.iss.rate)}
        {percent("iss.basePercent", "Parcela tributável da base ISS (%)", services?.iss.basePercent)}
        {code("iss.incidenceMunicipality", "Município IBGE de incidência do ISS", 7, services?.iss.incidenceMunicipality)}
        <label className="field">ISS retido<select name="iss.retained" required defaultValue={services ? String(services.iss.retained) : ""}>
          <option value="">Selecione</option><option value="false">Não</option><option value="true">Sim</option>
        </select></label>
      </div>
      <h5>Retenções federais sobre o valor líquido do serviço</h5>
      <div className="form-grid">
        {(["pisRate", "cofinsRate", "csllRate", "inssRate", "irrfRate"] as const).map((name) =>
          percent(`federalWithholding.${name}`, `${name.replace("Rate", "").toUpperCase()} retido (%)`, services?.federalWithholding[name]))}
      </div>
      <p>Retenção não é apuração própria. Salvar os parâmetros não libera transmissão com retenções: a conciliação do valor bruto/líquido ainda será implementada no gerador de serviços.</p>
    </>}
    <h5>IBS e CBS</h5><div className="form-grid">
      {code("ibsCbs.cst", "CST IBS/CBS", 3, ibs?.cst)}
      {code("ibsCbs.classification", "Classificação tributária IBS/CBS (cClassTrib)", 6, ibs?.classification)}
      {percent("ibsCbs.stateRate", "Alíquota IBS estadual (%)", ibs?.stateRate)}
      {percent("ibsCbs.municipalRate", "Alíquota IBS municipal (%)", ibs?.municipalRate)}
      {percent("ibsCbs.cbsRate", "Alíquota CBS (%)", ibs?.cbsRate)}
      {percent("ibsCbs.basePercent", "Parcela tributável da base IBS/CBS (%)", ibs?.basePercent)}
      <label className="field">Composição da base IBS/CBS<select name="ibsCbs.baseMode" required defaultValue={ibs?.baseMode ?? ""}>
        <option value="">Selecione</option><option value="net">Valor líquido do item/serviço</option>
        {kind === "nfe" ? <option value="net-minus-icms-pis-cofins">Valor líquido menos ICMS, PIS e COFINS próprios</option> :
          <option value="net-minus-iss">Valor líquido menos ISS</option>}
      </select></label>
    </div>
    <p>Escolha a fórmula aprovada para a operação/vigência. Cadastro de código/formato não comprova enquadramento legal. Códigos ou fórmulas ainda não suportados pelo futuro gerador deverão ser bloqueados, não aproximados.</p>
  </section>;
}
