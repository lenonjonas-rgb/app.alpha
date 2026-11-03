begin;

create function public.valid_commission_rule(v_rule jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare v_calculation jsonb; v_tier jsonb; v_previous integer := -1; v_up_to integer; v_rate integer;
begin
  if jsonb_typeof(v_rule) is distinct from 'object'
    or v_rule - array['release','calculation'] <> '{}'::jsonb
    or coalesce(v_rule->>'release','') not in ('proportional','billing','first','last') then return false; end if;
  v_calculation := v_rule->'calculation';
  if jsonb_typeof(v_calculation) is distinct from 'object' then return false; end if;
  if v_calculation->>'type' = 'fixed' then
    return v_calculation - array['type','rate'] = '{}'::jsonb
      and jsonb_typeof(v_calculation->'rate') = 'number'
      and coalesce(v_calculation->>'rate','') ~ '^[0-9]{1,5}$'
      and (v_calculation->>'rate')::numeric between 0 and 10000;
  elsif v_calculation->>'type' = 'discount' then
    if v_calculation - array['type','tiers'] <> '{}'::jsonb
      or jsonb_typeof(v_calculation->'tiers') is distinct from 'array'
      or jsonb_array_length(v_calculation->'tiers') not between 1 and 20 then return false; end if;
    for v_tier in select value from jsonb_array_elements(v_calculation->'tiers') loop
      if jsonb_typeof(v_tier) is distinct from 'object' or v_tier - array['upTo','rate'] <> '{}'::jsonb
        or jsonb_typeof(v_tier->'upTo') is distinct from 'number' or jsonb_typeof(v_tier->'rate') is distinct from 'number'
        or coalesce(v_tier->>'upTo','') !~ '^[0-9]{1,5}$' or coalesce(v_tier->>'rate','') !~ '^[0-9]{1,5}$' then return false; end if;
      v_up_to := (v_tier->>'upTo')::integer; v_rate := (v_tier->>'rate')::integer;
      if v_up_to <= v_previous or v_up_to > 10000 or v_rate > 10000 then return false; end if;
      v_previous := v_up_to;
    end loop;
    return v_previous = 10000;
  end if;
  return false;
end;
$$;
revoke all on function public.valid_commission_rule(jsonb) from public, anon, authenticated, service_role;

create function public.guard_commissions() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_data jsonb; v_old_data jsonb; v_seller jsonb; v_old jsonb; v_record jsonb; v_invoice jsonb; v_order jsonb;
  v_source jsonb; v_tier jsonb; v_expected jsonb; v_base bigint; v_discount bigint; v_gross bigint;
  v_rate integer; v_amount bigint; v_base_total bigint; v_amount_total bigint; v_new boolean;
begin
  if TG_OP = 'DELETE' then
    if old.payload #> '{finance,commissions}' is not null then
      raise exception 'O historico de comissoes nao pode ser excluido.';
    end if;
    return old;
  end if;
  if TG_OP = 'UPDATE' and new.payload->'finance' is not distinct from old.payload->'finance' then return new; end if;
  v_data := new.payload #> '{finance,commissions}';
  if TG_OP = 'UPDATE' then v_old_data := old.payload #> '{finance,commissions}'; end if;
  if v_data is null then
    if v_old_data is not null then raise exception 'O historico de comissoes nao pode ser removido.'; end if;
    return new;
  end if;
  if jsonb_typeof(v_data) is distinct from 'object' or v_data - array['sellers','records'] <> '{}'::jsonb
    or jsonb_typeof(v_data->'sellers') is distinct from 'array' or jsonb_array_length(v_data->'sellers') > 2000
    or jsonb_typeof(v_data->'records') is distinct from 'array' or jsonb_array_length(v_data->'records') > 50000
    or exists(select 1 from jsonb_array_elements(v_data->'sellers') s group by s->>'id' having count(*) > 1)
    or exists(select 1 from jsonb_array_elements(v_data->'sellers') s group by lower(btrim(s->>'name')) having count(*) > 1)
    or exists(select 1 from jsonb_array_elements(v_data->'records') r group by r->>'id' having count(*) > 1)
    or exists(select 1 from jsonb_array_elements(v_data->'records') r group by r->>'invoiceId',r->>'orderId' having count(*) > 1) then
    raise exception 'Estrutura de comissoes ou identificadores invalidos ou duplicados.';
  end if;

  if v_old_data is not null then
    for v_old in select value from jsonb_array_elements(v_old_data->'sellers') loop
      if not exists(select 1 from jsonb_array_elements(v_data->'sellers') s where s->>'id'=v_old->>'id') then
        raise exception 'Vendedores cadastrados nao podem ser removidos; desative-os.';
      end if;
    end loop;
    for v_old in select value from jsonb_array_elements(v_old_data->'records') loop
      select r into v_record from jsonb_array_elements(v_data->'records') r where r->>'id'=v_old->>'id';
      if v_record is null or v_record is distinct from v_old then
        raise exception 'Historico de comissoes nao pode ser removido ou reescrito.';
      end if;
    end loop;
  end if;

  for v_seller in select value from jsonb_array_elements(v_data->'sellers') loop
    if jsonb_typeof(v_seller) is distinct from 'object' or v_seller - array['id','name','active','rule'] <> '{}'::jsonb
      or jsonb_typeof(v_seller->'id') is distinct from 'string' or length(btrim(v_seller->>'id')) not between 1 and 200
      or jsonb_typeof(v_seller->'name') is distinct from 'string' or length(btrim(v_seller->>'name')) not between 1 and 160
      or jsonb_typeof(v_seller->'active') is distinct from 'boolean' or public.valid_commission_rule(v_seller->'rule') is not true then
      raise exception 'Vendedor ou regra de comissao invalidos.';
    end if;
  end loop;

  for v_record in select value from jsonb_array_elements(v_data->'records') loop
    if jsonb_typeof(v_record) is distinct from 'object'
      or v_record - array['id','invoiceId','orderId','sellerId','sellerName','rule','items','base','amount','createdAt'] <> '{}'::jsonb
      or jsonb_typeof(v_record->'id') is distinct from 'string' or length(btrim(v_record->>'id')) not between 1 and 200
      or jsonb_typeof(v_record->'invoiceId') is distinct from 'string'
      or jsonb_typeof(v_record->'orderId') is distinct from 'string' or jsonb_typeof(v_record->'sellerId') is distinct from 'string'
      or jsonb_typeof(v_record->'sellerName') is distinct from 'string' or length(btrim(v_record->>'sellerName')) not between 1 and 160
      or public.valid_commission_rule(v_record->'rule') is not true
      or jsonb_typeof(v_record->'items') is distinct from 'array' or jsonb_array_length(v_record->'items') not between 1 and 200
      or jsonb_typeof(v_record->'base') is distinct from 'number' or coalesce(v_record->>'base','') !~ '^[0-9]+$'
      or jsonb_typeof(v_record->'amount') is distinct from 'number' or coalesce(v_record->>'amount','') !~ '^[0-9]+$'
      or (v_record->>'base')::numeric not between 0 and 100000000 or (v_record->>'amount')::numeric not between 0 and 100000000
      or coalesce(v_record->>'createdAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then
      raise exception 'Apuracao de comissao invalida.';
    end if;
    select s into v_seller from jsonb_array_elements(v_data->'sellers') s where s->>'id'=v_record->>'sellerId';
    select i into v_invoice from jsonb_array_elements(coalesce(new.payload #> '{finance,invoices}','[]')) i where i->>'id'=v_record->>'invoiceId';
    select o into v_order from jsonb_array_elements(coalesce(v_invoice->'orders','[]')) o where o->>'orderId'=v_record->>'orderId';
    if v_seller is null or v_invoice is null or v_order is null or jsonb_typeof(v_order->'items') is distinct from 'array' then
      raise exception 'Comissao sem vendedor, faturamento ou itens correspondentes.';
    end if;
    v_new := v_old_data is null or not exists(select 1 from jsonb_array_elements(v_old_data->'records') r where r->>'id'=v_record->>'id');
    if not v_new then continue; end if;
    if v_seller->'active' is distinct from 'true'::jsonb or v_invoice->'canceled' is distinct from 'false'::jsonb
      or v_record->'sellerName' is distinct from v_seller->'name' or v_record->'rule' is distinct from v_seller->'rule' then
      raise exception 'Nova comissao exige faturamento ativo e regra atual do vendedor.';
    end if;
    perform (v_record->>'createdAt')::timestamptz;
    v_expected := '[]'::jsonb; v_base_total := 0; v_amount_total := 0;
    for v_source in select value from jsonb_array_elements(v_order->'items') where value->>'source'='item' loop
      v_gross := (v_source->>'gross')::bigint;
      v_discount := (v_source->>'itemDiscount')::bigint + (v_source->>'orderDiscount')::bigint;
      v_base := v_gross - v_discount;
      if v_gross < 0 or v_discount < 0 or v_base < 0 then raise exception 'Itens de comissao invalidos.'; end if;
      if v_record #>> '{rule,calculation,type}' = 'fixed' then
        v_rate := (v_record #>> '{rule,calculation,rate}')::integer;
      else
        v_rate := null;
        for v_tier in select value from jsonb_array_elements(v_record #> '{rule,calculation,tiers}') loop
          if v_gross = 0 or v_discount * 10000 <= v_gross * (v_tier->>'upTo')::integer then
            v_rate := (v_tier->>'rate')::integer; exit;
          end if;
        end loop;
      end if;
      if v_rate is null then raise exception 'Faixa de desconto da comissao nao encontrada.'; end if;
      v_amount := (v_base * v_rate + 5000) / 10000;
      v_expected := v_expected || jsonb_build_array(jsonb_build_object(
        'id',v_source->'id','name',v_source->'name','gross',v_gross,'discount',v_discount,
        'base',v_base,'rate',v_rate,'amount',v_amount));
      v_base_total := v_base_total + v_base; v_amount_total := v_amount_total + v_amount;
    end loop;
    if jsonb_array_length(v_expected) = 0 or v_record->'items' is distinct from v_expected
      or (v_record->>'base')::bigint <> v_base_total or (v_record->>'amount')::bigint <> v_amount_total then
      raise exception 'Itens ou valores da comissao nao correspondem ao faturamento e regra.';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_commissions() from public, anon, authenticated, service_role;
create trigger guard_commissions before insert or update or delete on public.company_data
for each row execute function public.guard_commissions();

commit;
