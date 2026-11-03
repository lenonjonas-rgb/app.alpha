import { useState } from "react";
import { Empty, Modal } from "./components";
import { currency, displayDate, makeId } from "./domain";
import type { Database } from "./domain";
import { commissionSellerSchema } from "./commissionSchema";
import type { CommissionRule, CommissionSeller } from "./commissionSchema";
import { commissionRelease, previewCommission, recordCommission, saveCommissionSeller } from "./commissions";
import { encodeCsv } from "./csv";
import { formatPercent, percentToBasisPoints } from "./financePercent";
import { downloadFile, errorMessage } from "./useDatabase";

type Commit = (update: (current: Database) => Database) => void;
type Editor = { mode: "seller"; seller?: CommissionSeller } | { mode: "review"; invoiceId: string; orderId: string };
const releaseOptions: { value: CommissionRule["release"]; label: string }[] = [
  { value: "proportional", label: "Proporcional aos recebimentos" },
  { value: "billing", label: "Integral no faturamento interno" },
  { value: "first", label: "Integral após quitação da primeira parcela" },
  { value: "last", label: "Integral após quitação de todas as parcelas" },
];
const releaseLabel = (value: CommissionRule["release"]) => releaseOptions.find((item) => item.value === value)!.label;

export function CommissionsPanel({ data, commit, onSuccess }: { data: Database; commit: Commit; onSuccess: (message: string) => void }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const commissions = data.finance.commissions ?? { sellers: [], records: [] };
  const candidates = data.finance.invoices.filter((invoice) => !invoice.canceled).flatMap((invoice) =>
    invoice.orders.filter((order) => !commissions.records.some((record) => record.invoiceId === invoice.id && record.orderId === order.orderId))
      .map((order) => ({ invoice, order, suggested: data.salesOrders.find((sale) => sale.id === order.orderId)?.seller ?? "" })));
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const records = commissions.records.map((record) => {
    const invoice = data.finance.invoices.find((item) => item.id === record.invoiceId)!;
    const order = invoice.orders.find((item) => item.orderId === record.orderId)!;
    return { record, invoice, order, release: commissionRelease(data, record) };
  }).filter(({ record, invoice, order }) =>
    `${record.sellerName} ${invoice.clientName} ${order.code}`.toLocaleLowerCase("pt-BR").includes(search));
  function exportRecords() {
    try {
      const money = (value: number) => (value / 100).toFixed(2).replace(".", ",");
      downloadFile("comissoes-gerenciais.csv", encodeCsv([
        ["Data do faturamento", "Pedido ou OS", "Cliente", "Vendedor", "Base (R$)", "Comissão (R$)",
          "Liberada (R$)", "Aguardando (R$)", "Situação", "Regra de liberação"],
        ...records.map(({ record, invoice, order, release }) => [
          invoice.createdOn, order.code, invoice.clientName, record.sellerName, money(record.base), money(record.amount),
          money(release.released), money(release.pending), release.status, releaseLabel(record.rule.release),
        ]),
      ]), "text/csv;charset=utf-8");
      setError("");
    } catch (cause) { setError(errorMessage(cause)); }
  }
  return <section className="finance-management" aria-label="Comissões">
    <div className="finance-statements-heading"><div><h2>Comissões</h2>
      <p>Regras por vendedor e apuração interna revisada por faturamento.</p></div>
      <button type="button" className="button primary" onClick={() => setEditor({ mode: "seller" })}>Cadastrar vendedor</button>
    </div>
    <p className="finance-statement-note">A apuração é manual e não paga comissões nem cria contas a pagar. A regra é congelada ao confirmar.
      A liberação acompanha as baixas ativas; estornos e cancelamentos são refletidos. O faturamento é interno e não significa nota fiscal autorizada.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    <h3>Vendedores e regras</h3>
    <div className="finance-table"><table><thead><tr><th>Vendedor</th><th>Cálculo</th><th>Liberação</th><th>Situação</th><th>Ações</th></tr></thead>
      <tbody>{commissions.sellers.map((seller) => <tr key={seller.id}><td>{seller.name}</td>
        <td>{seller.rule.calculation.type === "fixed" ? `Fixa: ${formatPercent(seller.rule.calculation.rate)}%` :
          seller.rule.calculation.tiers.map((tier) => `Até ${formatPercent(tier.upTo)}%: ${formatPercent(tier.rate)}%`).join(" · ")}</td>
        <td>{releaseLabel(seller.rule.release)}</td><td>{seller.active ? "Ativo" : "Inativo"}</td>
        <td><button type="button" className="text-button" onClick={() => setEditor({ mode: "seller", seller })}>Editar regra</button></td></tr>)}</tbody>
    </table></div>
    {!commissions.sellers.length && <Empty title="Nenhum vendedor cadastrado" />}
    <h3>Faturamentos aguardando apuração</h3>
    <p>Escolha o vendedor e confirme os itens. Valores de frete, deslocamento e outras despesas não são comissionados;
      descontos dos itens e o rateio do desconto geral reduzem a base. Faturamentos sem itens congelados,
      inclusive alguns gerados pela NF-e, não podem ser apurados automaticamente.</p>
    <div className="finance-table"><table><thead><tr><th>Data</th><th>Pedido / OS</th><th>Cliente</th><th>Vendedor informado</th><th>Ações</th></tr></thead>
      <tbody>{candidates.map(({ invoice, order, suggested }) => <tr key={JSON.stringify([invoice.id, order.orderId])}>
        <td>{displayDate(invoice.createdOn)}</td><td>{order.code} · {invoice.kind}</td><td>{invoice.clientName}</td>
        <td>{suggested || "Não informado"}</td><td>{order.items?.some((item) => item.source === "item") ?
          <button type="button" className="button secondary" onClick={() =>
            setEditor({ mode: "review", invoiceId: invoice.id, orderId: order.orderId })}>Revisar comissão</button> :
          "Sem itens comissionáveis congelados"}</td></tr>)}</tbody>
    </table></div>
    {!candidates.length && <Empty title="Nenhum faturamento aguardando apuração" />}
    <div className="section-heading"><h3>Comissões apuradas</h3>
      <label className="field">Buscar por vendedor, cliente ou pedido<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <button type="button" className="button secondary" onClick={exportRecords}>Exportar comissões CSV</button></div>
    <p>Quando há várias OS em um faturamento, os recebimentos são rateados proporcionalmente entre as comissões.
      Retenções reduzem o valor líquido a receber; elas não são tratadas como pagamento.</p>
    <div className="finance-table"><table><thead><tr><th>Pedido / OS</th><th>Vendedor</th><th>Base</th><th>Comissão</th>
      <th>Liberada</th><th>Aguardando</th><th>Situação / regra</th></tr></thead><tbody>{records.map(({ record, invoice, order, release }) =>
        <tr key={record.id}><td>{order.code}<br /><small>{invoice.clientName} · {invoice.kind} · {displayDate(invoice.createdOn)}</small></td>
          <td>{record.sellerName}</td><td>{currency(record.base)}</td><td>{currency(record.amount)}</td>
          <td>{currency(release.released)}</td><td>{currency(release.pending)}</td><td>{release.status}<details>
            <summary>Regra e itens</summary><p>{releaseLabel(record.rule.release)}</p>
            {record.items.map((item) => <p key={item.id}>{item.name}: base {currency(item.base)} × {formatPercent(item.rate)}% = {currency(item.amount)}</p>)}
          </details></td></tr>)}</tbody></table></div>
    {!records.length && <Empty title="Nenhuma comissão apurada" />}
    {editor && (editor.mode === "seller" ? <CommissionSellerEditor seller={editor.seller} onClose={() => setEditor(null)}
      onSave={(update) => { commit(update); setEditor(null); setError(""); onSuccess("Regra de vendedor salva. Aguarde Sincronizado quando conectado."); }} /> :
      <CommissionReview data={data} invoiceId={editor.invoiceId} orderId={editor.orderId} onClose={() => setEditor(null)}
        onSave={(update) => { commit(update); setEditor(null); setError(""); onSuccess("Comissão apurada internamente, sem registrar pagamento."); }} />)}
  </section>;
}

function CommissionSellerEditor({ seller, onClose, onSave }: {
  seller?: CommissionSeller; onClose: () => void; onSave: Commit;
}) {
  const [id] = useState(makeId);
  const [release, setRelease] = useState<CommissionRule["release"]>(seller?.rule.release ?? "proportional");
  const [mode, setMode] = useState<"fixed" | "discount">(seller?.rule.calculation.type ?? "fixed");
  const [rate, setRate] = useState(seller?.rule.calculation.type === "fixed" ? String(seller.rule.calculation.rate / 100) : "0");
  const [tiers, setTiers] = useState(() => seller?.rule.calculation.type === "discount"
    ? seller.rule.calculation.tiers.map((tier) => ({ upTo: String(tier.upTo / 100), rate: String(tier.rate / 100) }))
    : [{ upTo: "100", rate: "0" }]);
  const [error, setError] = useState("");
  return <Modal title={seller ? "Editar vendedor e regra" : "Cadastrar vendedor e regra"} onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        const calculation = mode === "fixed" ? { type: "fixed" as const, rate: percentToBasisPoints(rate) } :
          { type: "discount" as const, tiers: tiers.map((tier) => ({ upTo: percentToBasisPoints(tier.upTo), rate: percentToBasisPoints(tier.rate) })) };
        const input = commissionSellerSchema.parse({ id: seller?.id ?? id, name: String(form.get("name") ?? ""),
          active: form.get("active") === "on", rule: { release, calculation } });
        onSave((current) => saveCommissionSeller(current, input, seller));
      } catch (cause) { setError(errorMessage(cause)); }
    }}><div className="modal-body"><div className="form-grid">
      {error && <p className="error-message full" role="alert">{error}</p>}
      <label className="field">Nome do vendedor<input name="name" required maxLength={160} defaultValue={seller?.name} /></label>
      <label className="checkbox-field"><input type="checkbox" name="active" defaultChecked={seller?.active ?? true} />Ativo</label>
      <label className="field">Liberação<select value={release} onChange={(event) => {
        const option = releaseOptions.find((item) => item.value === event.target.value);
        if (option) setRelease(option.value);
      }}>{releaseOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="field">Cálculo<select value={mode} onChange={(event) => setMode(event.target.value === "discount" ? "discount" : "fixed")}>
        <option value="fixed">Alíquota fixa</option><option value="discount">Alíquota conforme desconto do item</option>
      </select></label>
      {mode === "fixed" ? <label className="field">Alíquota (%)<input type="number" min="0" max="100" step="0.01" required
        value={rate} onChange={(event) => setRate(event.target.value)} /></label> :
        <fieldset className="finance-billing-group full"><legend>Faixas de desconto do item</legend>
          <p>Informe faixas crescentes. A última deve terminar em 100%. A alíquota é aplicada sobre o valor líquido de cada item.</p>
          {tiers.map((tier, index) => <div className="finance-commission-tier" key={index}>
            <label className="field">Desconto até (%)<input type="number" min="0" max="100" step="0.01" required value={tier.upTo}
              onChange={(event) => setTiers(tiers.map((row, rowIndex) => rowIndex === index ? { ...row, upTo: event.target.value } : row))} /></label>
            <label className="field">Comissão (%)<input type="number" min="0" max="100" step="0.01" required value={tier.rate}
              onChange={(event) => setTiers(tiers.map((row, rowIndex) => rowIndex === index ? { ...row, rate: event.target.value } : row))} /></label>
            <button type="button" className="button secondary" disabled={tiers.length === 1}
              onClick={() => setTiers(tiers.filter((_, rowIndex) => rowIndex !== index))}>Remover faixa</button>
          </div>)}
          <button type="button" className="button secondary" disabled={tiers.length >= 20} onClick={() =>
            setTiers([...tiers.slice(0, -1), { upTo: "", rate: "0" }, tiers[tiers.length - 1]])}>Adicionar faixa</button>
        </fieldset>}
      <p className="full">Mudanças valem apenas para novas apurações. O histórico mantém a regra e o nome escolhidos anteriormente.</p>
    </div></div><footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Voltar</button>
      <button className="button primary">Salvar vendedor</button></footer></form>
  </Modal>;
}

function CommissionReview({ data, invoiceId, orderId, onClose, onSave }: {
  data: Database; invoiceId: string; orderId: string; onClose: () => void; onSave: Commit;
}) {
  const suggested = data.salesOrders.find((item) => item.id === orderId)?.seller.trim().toLocaleLowerCase("pt-BR");
  const sellers = data.finance.commissions?.sellers.filter((item) => item.active) ?? [];
  const [sellerId, setSellerId] = useState(() => sellers.find((item) => item.name.toLocaleLowerCase("pt-BR") === suggested)?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  let preview: ReturnType<typeof previewCommission> | undefined;
  let previewError = "";
  if (sellerId) {
    try { preview = previewCommission(data, invoiceId, orderId, sellerId); }
    catch (cause) { previewError = errorMessage(cause); }
  }
  return <Modal title="Revisar comissão" onClose={onClose}><form onSubmit={(event) => {
    event.preventDefault();
    try {
      if (!preview) throw new Error(previewError || "Selecione um vendedor ativo.");
      const reviewed = preview;
      onSave((current) => recordCommission(current, reviewed, confirmed));
    } catch (cause) { setError(errorMessage(cause)); }
  }}><div className="modal-body"><div className="form-grid">
    {(error || previewError) && <p className="error-message full" role="alert">{error || previewError}</p>}
    <label className="field full">Vendedor<select required value={sellerId} onChange={(event) => {
      setSellerId(event.target.value); setConfirmed(false); setError("");
    }}><option value="">Selecione</option>{sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</select></label>
    {!sellers.length && <p className="full">Cadastre um vendedor ativo e sua regra antes de apurar.</p>}
    {preview && <><p className="full">Liberação: {releaseLabel(preview.rule.release)}. A regra e os valores abaixo serão preservados nesta apuração.</p>
      <div className="finance-table full"><table><thead><tr><th>Item</th><th>Valor bruto</th><th>Desconto</th><th>Base</th><th>Alíquota</th><th>Comissão</th></tr></thead>
        <tbody>{preview.items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{currency(item.gross)}</td>
          <td>{currency(item.discount)}</td><td>{currency(item.base)}</td><td>{formatPercent(item.rate)}%</td><td>{currency(item.amount)}</td></tr>)}</tbody></table></div>
      <p className="full">Base: <strong>{currency(preview.base)}</strong> · Comissão: <strong>{currency(preview.amount)}</strong></p>
      <label className="checkbox-field full"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        Conferi vendedor, itens e regra. Entendo que isso não registra pagamento.</label></>}
  </div></div><footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Voltar</button>
    <button className="button primary" disabled={!preview}>Confirmar apuração</button></footer></form></Modal>;
}
