begin;

create function public.guard_purchase_approvals() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_orders jsonb;
  v_old_orders jsonb;
  v_order jsonb;
  v_old_order jsonb;
  v_procurement jsonb;
  v_quote jsonb;
  v_quote_count integer;
  v_total bigint;
  v_selected jsonb;
  v_actor uuid := auth.uid();
begin
  if TG_OP = 'DELETE' then return old; end if;
  v_orders := coalesce(new.payload#>'{finance,purchasing,orders}','[]');
  if TG_OP = 'UPDATE' then
    v_old_orders := coalesce(old.payload#>'{finance,purchasing,orders}','[]');
  else
    v_old_orders := '[]'::jsonb;
  end if;
  for v_order in select value from jsonb_array_elements(v_orders) loop
    select value into v_old_order from jsonb_array_elements(v_old_orders)
      where value->>'id'=v_order->>'id';
    if v_old_order is not null then continue; end if;
    v_procurement := v_order->'procurement';
    select coalesce(sum((item->>'quantity')::bigint*(item->>'unitCost')::bigint),0)
      into v_total from jsonb_array_elements(coalesce(v_order->'items','[]')) item;
    if jsonb_typeof(v_procurement) is distinct from 'object'
      or jsonb_typeof(v_procurement->'quotes') is distinct from 'array'
      or jsonb_array_length(v_procurement->'quotes') not between 1 and 20
      or nullif(v_procurement->>'selectedQuoteId','') is null
      or jsonb_typeof(v_procurement->'approval') is distinct from 'object'
      or jsonb_typeof(v_procurement#>'{approval,at}') is distinct from 'string'
      or coalesce(v_procurement#>>'{approval,at}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      or (v_procurement#>>'{approval,at}')::timestamptz < (v_order->>'createdAt')::timestamptz
      or (v_procurement#>>'{approval,at}')::timestamptz > clock_timestamp()+interval '5 minutes'
      or jsonb_typeof(v_procurement#>'{approval,approverUserId}') is distinct from 'string'
      or v_procurement#>>'{approval,approverUserId}' is distinct from v_actor::text
      or jsonb_typeof(v_procurement#>'{approval,approverRole}') is distinct from 'string'
      or v_procurement#>>'{approval,approverRole}' not in ('owner','admin')
      or jsonb_typeof(v_procurement#>'{approval,approverName}') is distinct from 'string'
      or length(btrim(v_procurement#>>'{approval,approverName}')) not between 1 and 1000
      or jsonb_typeof(v_procurement#>'{approval,reason}') is distinct from 'string'
      or length(btrim(v_procurement#>>'{approval,reason}')) not between 5 and 1000
      or not exists(select 1 from public.company_memberships membership
        where membership.company_id=new.company_id and membership.user_id=v_actor
          and membership.role=v_procurement#>>'{approval,approverRole}') then
      raise exception using errcode='42501', message='Pedido de compra exige aprovacao auditavel de owner/admin autenticado.';
    end if;
    v_quote_count := jsonb_array_length(v_procurement->'quotes');
    if v_procurement ? 'quoteExceptionReason' and
      (jsonb_typeof(v_procurement->'quoteExceptionReason') is distinct from 'string'
        or length(btrim(v_procurement->>'quoteExceptionReason')) not between 5 and 1000) then
      raise exception 'Justificativa de excecao de cotacoes invalida.';
    end if;
    if v_quote_count < 3 and length(btrim(coalesce(v_procurement->>'quoteExceptionReason',''))) not between 5 and 1000 then
      raise exception 'Menos de tres cotacoes exige justificativa registrada.';
    end if;
    if exists(select 1 from jsonb_array_elements(v_procurement->'quotes') quote
      where jsonb_typeof(quote) is distinct from 'object'
        or jsonb_typeof(quote->'id') is distinct from 'string' or length(quote->>'id') not between 1 and 200
        or jsonb_typeof(quote->'supplierId') is distinct from 'string'
        or jsonb_typeof(quote->'supplierName') is distinct from 'string'
        or jsonb_typeof(quote->'amount') is distinct from 'number'
        or coalesce(quote->>'amount','') !~ '^[1-9][0-9]*$'
        or (quote->>'amount')::numeric > 100000000
        or coalesce(quote->>'quotedOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or to_char((quote->>'quotedOn')::date,'YYYY-MM-DD') is distinct from quote->>'quotedOn'
        or (quote->>'quotedOn')::date > (v_order->>'orderedOn')::date
        or jsonb_typeof(quote->'reference') is distinct from 'string' or length(quote->>'reference')>200
        or jsonb_typeof(quote->'terms') is distinct from 'string' or length(quote->>'terms')>1000
        or (length(btrim(quote->>'reference'))=0 and length(btrim(quote->>'terms'))=0)
        or not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,suppliers}','[]')) supplier
          where supplier->>'id'=quote->>'supplierId' and supplier->>'name'=quote->>'supplierName')
        or not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,suppliers}','[]')) supplier
          where supplier->>'id'=quote->>'supplierId' and supplier->'active'='true'::jsonb))
      or exists(select 1 from jsonb_array_elements(v_procurement->'quotes') quote
        group by quote->>'id' having count(*)>1)
      or exists(select 1 from jsonb_array_elements(v_procurement->'quotes') quote
        group by quote->>'supplierId' having count(*)>1)
      or (select count(*) from jsonb_array_elements(v_procurement->'quotes') quote
        where quote->>'id'=v_procurement->>'selectedQuoteId')<>1 then
      raise exception 'Cotacoes invalidas, duplicadas ou sem fornecedor ativo.';
    end if;
    select quote into v_selected from jsonb_array_elements(v_procurement->'quotes') quote
      where quote->>'id'=v_procurement->>'selectedQuoteId';
    if v_selected->>'supplierId' is distinct from v_order->>'supplierId'
      or (v_selected->>'amount')::bigint is distinct from v_total then
      raise exception 'Fornecedor e total do pedido devem corresponder a cotacao selecionada.';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_purchase_approvals() from public, anon, authenticated, service_role;
create trigger guard_purchase_approvals before insert or update or delete on public.company_data
for each row execute function public.guard_purchase_approvals();

commit;
