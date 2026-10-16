begin;

create function public.purchase_document_valid(p_document text) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare v_digit integer; v_index integer; v_sum integer; v_remainder integer; v_weight integer;
begin
  if p_document = '' then return true; end if;
  if p_document is null or p_document !~ '^([0-9]{11}|[A-Z0-9]{12}[0-9]{2})$' or p_document ~ '^([A-Z0-9])\1+$' then return false; end if;
  for v_digit in length(p_document)-1..length(p_document) loop
    v_sum := 0;
    for v_index in 1..v_digit-1 loop
      v_weight := case when length(p_document)=11 then v_digit-v_index+1 else (v_digit-v_index-1)%8+2 end;
      v_sum := v_sum + (ascii(substring(p_document,v_index,1))-48)*v_weight;
    end loop;
    v_remainder := v_sum%11;
    if substring(p_document,v_digit,1)::integer <> (case when v_remainder<2 then 0 else 11-v_remainder end) then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.purchase_document_valid(text) from public, anon, authenticated, service_role;

create function public.guard_purchases() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_data jsonb; v_suppliers jsonb; v_orders jsonb; v_entries jsonb;
  v_supplier jsonb; v_order jsonb; v_old jsonb; v_item jsonb; v_row jsonb; v_entry jsonb; v_receipt jsonb;
  v_total bigint; v_count integer; v_index integer; v_previous date; v_due date; v_new boolean; v_receiving boolean;
begin
  if TG_OP='DELETE' then
    if jsonb_array_length(coalesce(old.payload #> '{finance,purchasing,suppliers}','[]'))>0
      or jsonb_array_length(coalesce(old.payload #> '{finance,purchasing,orders}','[]'))>0 then
      raise exception 'Historico de compras e fornecedores nao pode ser excluido.';
    end if;
    return old;
  end if;
  if TG_OP='UPDATE' and new.payload->'finance' is not distinct from old.payload->'finance' then return new; end if;
  v_data := coalesce(new.payload #> '{finance,purchasing}','{"suppliers":[],"orders":[]}');
  v_suppliers := v_data->'suppliers'; v_orders := v_data->'orders';
  v_entries := coalesce(new.payload #> '{finance,entries}','[]');
  if jsonb_typeof(v_data) is distinct from 'object' or jsonb_typeof(v_suppliers) is distinct from 'array'
    or jsonb_typeof(v_orders) is distinct from 'array'
    or jsonb_array_length(v_suppliers)>2000 or jsonb_array_length(v_orders)>5000
    or exists(select 1 from jsonb_array_elements(v_suppliers) s group by s->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_suppliers) s where s->>'document'<>'' group by s->>'document' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_orders) o group by o->>'id' having count(*)>1) then
    raise exception 'Compras, fornecedores ou documentos invalidos ou duplicados.';
  end if;
  if TG_OP='UPDATE' then
    if exists(select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,purchasing,suppliers}','[]')) s
      where not exists(select 1 from jsonb_array_elements(v_suppliers) n where n->>'id'=s->>'id')) then
      raise exception 'Fornecedor nao pode ser removido; inative o cadastro.';
    end if;
    for v_old in select o from jsonb_array_elements(coalesce(old.payload #> '{finance,purchasing,orders}','[]')) o loop
      select o into v_order from jsonb_array_elements(v_orders) o where o->>'id'=v_old->>'id';
      if v_order is null or (v_order-'receipt'-'cancellation') is distinct from (v_old-'receipt'-'cancellation')
        or (v_old ? 'receipt' and v_order->'receipt' is distinct from v_old->'receipt')
        or (v_old ? 'cancellation' and v_order->'cancellation' is distinct from v_old->'cancellation') then
        raise exception 'Pedido, recebimento e cancelamento nao podem ser removidos ou reescritos.';
      end if;
    end loop;
  end if;
  for v_supplier in select s from jsonb_array_elements(v_suppliers) s loop
    if jsonb_typeof(v_supplier) is distinct from 'object'
      or jsonb_typeof(v_supplier->'id') is distinct from 'string' or length(v_supplier->>'id') not between 1 and 200
      or jsonb_typeof(v_supplier->'name') is distinct from 'string' or length(btrim(v_supplier->>'name')) not between 1 and 1000
      or jsonb_typeof(v_supplier->'document') is distinct from 'string' or not public.purchase_document_valid(v_supplier->>'document')
      or jsonb_typeof(v_supplier->'phone') is distinct from 'string' or length(v_supplier->>'phone')>100
      or jsonb_typeof(v_supplier->'address') is distinct from 'string' or length(v_supplier->>'address')>1000
      or jsonb_typeof(v_supplier->'email') is distinct from 'string' or length(v_supplier->>'email')>254
      or (v_supplier->>'email'<>'' and v_supplier->>'email' !~ '^(?:[A-Za-z0-9_''+\-]+\.)*[A-Za-z0-9_''+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$')
      or jsonb_typeof(v_supplier->'active') is distinct from 'boolean' then
      raise exception 'Fornecedor invalido: confira nome, documento, contatos e situacao.';
    end if;
  end loop;
  for v_order in select o from jsonb_array_elements(v_orders) o loop
    v_old := null;
    if TG_OP='UPDATE' then
      select o into v_old from jsonb_array_elements(coalesce(old.payload #> '{finance,purchasing,orders}','[]')) o where o->>'id'=v_order->>'id';
    end if;
    v_new := v_old is null;
    v_receiving := v_order ? 'receipt' and not coalesce(v_old ? 'receipt',false);
    select s into v_supplier from jsonb_array_elements(v_suppliers) s where s->>'id'=v_order->>'supplierId';
    if jsonb_typeof(v_order) is distinct from 'object'
      or exists(select 1 from unnest(array['id','supplierId','accountId']) k
        where jsonb_typeof(v_order->k) is distinct from 'string' or length(v_order->>k) not between 1 and 200)
      or exists(select 1 from unnest(array['supplierName','description']) k
        where jsonb_typeof(v_order->k) is distinct from 'string' or length(btrim(v_order->>k)) not between 1 and 1000)
      or jsonb_typeof(v_order->'supplierDocument') is distinct from 'string' or not public.purchase_document_valid(v_order->>'supplierDocument')
      or coalesce(v_order->>'paymentMethod','') not in ('Pix','Boleto','Transferência','Dinheiro','Cartão','Outro')
      or coalesce(v_order->>'orderedOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((v_order->>'orderedOn')::date,'YYYY-MM-DD') is distinct from v_order->>'orderedOn'
      or coalesce(v_order->>'createdAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      or jsonb_typeof(v_order->'items') is distinct from 'array' or jsonb_array_length(v_order->'items') not between 1 and 100
      or jsonb_typeof(v_order->'schedule') is distinct from 'array' or jsonb_array_length(v_order->'schedule') not between 1 and 120
      or v_supplier is null
      or not exists(select 1 from jsonb_array_elements(new.payload #> '{finance,accounts}') a where a->>'id'=v_order->>'accountId')
      or (v_order ? 'categoryId' and (jsonb_typeof(v_order->'categoryId') is distinct from 'string' or not exists(
        select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,categories}','[]')) c where c->>'id'=v_order->>'categoryId' and c->>'kind'='Pagar')))
      or (v_order ? 'costCenterId' and (jsonb_typeof(v_order->'costCenterId') is distinct from 'string' or not exists(
        select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,costCenters}','[]')) c where c->>'id'=v_order->>'costCenterId')))
      or (v_order ? 'receipt' and v_order ? 'cancellation') then
      raise exception 'Pedido de compra com estrutura, datas ou referencias invalidas.';
    end if;
    perform (v_order->>'createdAt')::timestamptz;
    if v_new and (v_order ? 'receipt' or v_order ? 'cancellation' or (v_order->>'orderedOn')::date>current_date
      or v_order->'supplierName' is distinct from v_supplier->'name'
      or v_order->'supplierDocument' is distinct from v_supplier->'document') then
      raise exception 'Novo pedido exige fornecedor atual, data nao futura e nenhum recebimento/cancelamento.';
    end if;
    if (v_new or v_receiving) and (v_supplier->'active' is distinct from 'true'::jsonb
      or not exists(select 1 from jsonb_array_elements(new.payload #> '{finance,accounts}') a where a->>'id'=v_order->>'accountId' and a->'active'='true'::jsonb)
      or (v_order ? 'categoryId' and not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,categories}','[]')) c
        where c->>'id'=v_order->>'categoryId' and c->'active'='true'::jsonb))
      or (v_order ? 'costCenterId' and not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,costCenters}','[]')) c
        where c->>'id'=v_order->>'costCenterId' and c->'active'='true'::jsonb))) then
      raise exception 'Novo pedido ou recebimento exige fornecedor, banco e classificacoes ativos.';
    end if;
    v_total := 0;
    for v_item in select i from jsonb_array_elements(v_order->'items') i loop
      if jsonb_typeof(v_item) is distinct from 'object'
        or jsonb_typeof(v_item->'description') is distinct from 'string' or length(btrim(v_item->>'description')) not between 1 and 1000
        or jsonb_typeof(v_item->'quantity') is distinct from 'number' or coalesce(v_item->>'quantity','') !~ '^[0-9]+$'
        or (v_item->>'quantity')::numeric not between 1 and 10000
        or jsonb_typeof(v_item->'unitCost') is distinct from 'number' or coalesce(v_item->>'unitCost','') !~ '^[0-9]+$'
        or (v_item->>'unitCost')::numeric not between 1 and 100000000 then
        raise exception 'Itens de compra exigem descricao, quantidade inteira e custo positivo em centavos.';
      end if;
      v_total := v_total+(v_item->>'quantity')::bigint*(v_item->>'unitCost')::bigint;
    end loop;
    v_count := jsonb_array_length(v_order->'schedule'); v_index := 0; v_previous := null;
    if v_total not between v_count and 100000000 then raise exception 'Total de compra fora do limite ou insuficiente para as parcelas.'; end if;
    for v_row in select r from jsonb_array_elements(v_order->'schedule') r loop
      v_index := v_index+1;
      if jsonb_typeof(v_row) is distinct from 'object'
        or coalesce(v_row->>'dueOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or jsonb_typeof(v_row->'amount') is distinct from 'number' or coalesce(v_row->>'amount','') !~ '^[0-9]+$'
        or (v_row->>'amount')::numeric is distinct from (v_total/v_count+case when v_index<=v_total%v_count then 1 else 0 end)::numeric then
        raise exception 'Parcelas da compra divergem do rateio em centavos.';
      end if;
      v_due := (v_row->>'dueOn')::date;
      if to_char(v_due,'YYYY-MM-DD') is distinct from v_row->>'dueOn' or v_due<(v_order->>'orderedOn')::date
        or (v_previous is not null and v_due<=v_previous) then raise exception 'Vencimentos de compra invalidos ou fora de ordem.'; end if;
      v_previous := v_due;
    end loop;
    if v_order ? 'cancellation' then
      if jsonb_typeof(v_order->'cancellation') is distinct from 'object'
        or jsonb_typeof(v_order #> '{cancellation,reason}') is distinct from 'string'
        or length(btrim(v_order #>> '{cancellation,reason}')) not between 5 and 1000
        or coalesce(v_order #>> '{cancellation,at}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        or (v_order #>> '{cancellation,at}')::timestamptz<(v_order->>'createdAt')::timestamptz then
        raise exception 'Cancelamento de compra exige data/hora e motivo validos.';
      end if;
    end if;
    if not (v_order ? 'receipt') then
      if exists(select 1 from jsonb_array_elements(v_entries) e where e->>'purchaseId'=v_order->>'id') then
        raise exception 'Pedido nao recebido nao pode gerar contas a pagar.';
      end if;
      continue;
    end if;
    v_receipt := v_order->'receipt';
    if jsonb_typeof(v_receipt) is distinct from 'object'
      or coalesce(v_receipt->>'at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      or (v_receipt->>'at')::timestamptz<(v_order->>'createdAt')::timestamptz
      or coalesce(v_receipt->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((v_receipt->>'date')::date,'YYYY-MM-DD') is distinct from v_receipt->>'date'
      or (v_receipt->>'date')::date<(v_order->>'orderedOn')::date
      or (v_receiving and (v_receipt->>'date')::date>current_date)
      or jsonb_typeof(v_receipt->'reference') is distinct from 'string' or length(v_receipt->>'reference')>200
      or jsonb_typeof(v_receipt->'notes') is distinct from 'string' or length(btrim(v_receipt->>'notes')) not between 5 and 1000
      or jsonb_typeof(v_receipt->'entryIds') is distinct from 'array' or jsonb_array_length(v_receipt->'entryIds')<>v_count
      or exists(select 1 from jsonb_array_elements(v_receipt->'entryIds') i
        where jsonb_typeof(i) is distinct from 'string' or length(i #>> '{}') not between 1 and 200)
      or exists(select 1 from jsonb_array_elements(v_receipt->'entryIds') i group by i having count(*)>1)
      or (select count(*) from jsonb_array_elements(v_entries) e where e->>'purchaseId'=v_order->>'id')<>v_count then
      raise exception 'Recebimento integral exige conferencia, datas e todas as contas vinculadas.';
    end if;
    v_index := 0;
    for v_row in select r from jsonb_array_elements(v_order->'schedule') r loop
      select e into v_entry from jsonb_array_elements(v_entries) e
        where e->'id'=v_receipt->'entryIds'->v_index and e->'purchaseId'=v_order->'id';
      if v_entry is null or v_entry->>'kind' is distinct from 'Pagar'
        or v_entry->'party' is distinct from v_order->'supplierName' or v_entry->'description' is distinct from v_order->'description'
        or v_entry->'accountId' is distinct from v_order->'accountId' or v_entry->'paymentMethod' is distinct from v_order->'paymentMethod'
        or v_entry->'amount' is distinct from v_row->'amount' or v_entry->'dueOn' is distinct from v_row->'dueOn'
        or v_entry->'issuedOn' is distinct from v_order->'orderedOn'
        or v_entry ?| array['clientId','invoiceId','retention','recurrence']
        or (v_count=1 and v_entry ? 'installment')
        or (v_count>1 and v_entry->'installment' is distinct from jsonb_build_object('planId',v_order->>'id','number',v_index+1,'count',v_count,'total',v_total))
        or (v_receiving and TG_OP='UPDATE' and exists(
          select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,entries}','[]')) e where e->'id'=v_entry->'id')) then
        raise exception 'Conta a pagar diverge da origem, valores ou parcelas do recebimento.';
      end if;
      if v_receiving and (v_order ? 'categoryId' or v_order ? 'costCenterId') and not exists(
        select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,classifications}','[]')) c
        where c->'entryId'=v_entry->'id' and c->'categoryId' is not distinct from v_order->'categoryId'
          and c->'costCenterId' is not distinct from v_order->'costCenterId') then
        raise exception 'Recebimento exige classificacao inicial igual ao pedido.';
      end if;
      v_index := v_index+1;
    end loop;
  end loop;
  if exists(select 1 from jsonb_array_elements(v_entries) e where e ? 'purchaseId' and (
    jsonb_typeof(e->'purchaseId') is distinct from 'string'
    or not exists(select 1 from jsonb_array_elements(v_orders) o where o->'id'=e->'purchaseId'))) then
    raise exception 'Conta vinculada a compra inexistente ou invalida.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_purchases() from public, anon, authenticated, service_role;
create trigger guard_purchases before insert or update or delete on public.company_data
for each row execute function public.guard_purchases();

commit;
