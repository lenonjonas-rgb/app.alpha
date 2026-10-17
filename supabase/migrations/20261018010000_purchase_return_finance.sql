begin;

create or replace function public.guard_finance_history() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb; v_new jsonb; v_invoice jsonb; v_old_invoice jsonb; v_s jsonb; v_ns jsonb;
  v_permit public.finance_change_permits; v_finance jsonb; v_paid numeric; v_offset jsonb;
  v_old_offsets jsonb; v_offsets jsonb; v_offset_total numeric; v_index integer;
begin
  if TG_OP = 'DELETE' then
    if jsonb_array_length(coalesce(old.payload #> '{finance,entries}','[]')) > 0
      or jsonb_array_length(coalesce(old.payload #> '{finance,invoices}','[]')) > 0 then
      raise exception 'Historico financeiro nao pode ser excluido. Preserve contas, faturamentos e baixas.';
    end if;
    return old;
  end if;
  if TG_OP = 'UPDATE' and (new.payload->'finance') is not distinct from (old.payload->'finance') then
    return new;
  end if;
  v_finance := new.payload->'finance';
  if v_finance is not null then
    if jsonb_typeof(v_finance) <> 'object' or jsonb_typeof(v_finance->'entries') is distinct from 'array'
      or jsonb_typeof(v_finance->'invoices') is distinct from 'array' or jsonb_typeof(v_finance->'accounts') is distinct from 'array' then
      raise exception 'Estrutura financeira invalida.';
    end if;
    if exists (select 1 from jsonb_array_elements(v_finance->'entries') e group by e->>'id' having count(*)>1)
      or exists (select 1 from jsonb_array_elements(v_finance->'invoices') i group by i->>'id' having count(*)>1)
      or exists (select 1 from jsonb_array_elements(v_finance->'entries') e where nullif(e->>'id','') is null)
      or exists (select 1 from jsonb_array_elements(v_finance->'invoices') i where nullif(i->>'id','') is null) then
      raise exception 'Identificadores financeiros invalidos ou duplicados.';
    end if;
  end if;
  if TG_OP = 'INSERT' then
    if exists (select 1 from jsonb_array_elements(coalesce(v_finance->'entries','[]')) e
      where e ? 'retention' or coalesce((e->>'canceled')::boolean,false)
        or jsonb_array_length(coalesce(e->'purchaseReturnOffsets','[]'))>0)
      or exists (select 1 from jsonb_array_elements(coalesce(v_finance->'invoices','[]')) i
        where coalesce((i->>'canceled')::boolean,false)) then
      raise exception 'Nova empresa nao pode importar cancelamentos, abatimentos ou retencoes autorizados em outra base.';
    end if;
  end if;
  for v_old in select e from jsonb_array_elements(coalesce(old.payload #> '{finance,entries}','[]')) e loop
    select e into v_new from jsonb_array_elements(coalesce(v_finance->'entries','[]')) e where e->>'id'=v_old->>'id';
    if v_new is null then raise exception 'Historico financeiro nao pode ser removido por gravacao ou restauracao.'; end if;
    if (v_old - 'settlements' - 'canceled' - 'retention' - 'purchaseReturnOffsets') is distinct from
      (v_new - 'settlements' - 'canceled' - 'retention' - 'purchaseReturnOffsets') then
      raise exception 'Dados originais da conta sao imutaveis. Preserve o historico e use o fluxo de cancelamento.';
    end if;
    v_old_offsets := coalesce(v_old->'purchaseReturnOffsets','[]');
    v_offsets := coalesce(v_new->'purchaseReturnOffsets','[]');
    if jsonb_typeof(v_old_offsets) is distinct from 'array' or jsonb_typeof(v_offsets) is distinct from 'array'
      or jsonb_array_length(v_offsets)<jsonb_array_length(v_old_offsets) then
      raise exception 'Abatimentos de devolucao nao podem ser removidos ou reescritos.';
    end if;
    for v_index in 0..jsonb_array_length(v_old_offsets)-1 loop
      if v_offsets->v_index is distinct from v_old_offsets->v_index then
        raise exception 'Abatimentos de devolucao nao podem ser removidos ou reescritos.';
      end if;
    end loop;
    if jsonb_array_length(v_offsets)>jsonb_array_length(v_old_offsets) then
      if v_old->>'kind' is distinct from 'Pagar' or nullif(v_old->>'purchaseId','') is null
        or v_old->'purchaseReturnCreditId' is not null then
        raise exception 'Abatimentos de devolucao so podem reduzir contas a pagar de compras.';
      end if;
      for v_index in jsonb_array_length(v_old_offsets)..jsonb_array_length(v_offsets)-1 loop
        v_offset := v_offsets->v_index;
        if jsonb_typeof(v_offset) is distinct from 'object'
          or nullif(v_offset->>'returnId','') is null
          or coalesce(v_offset->>'amount','') !~ '^[1-9][0-9]*$'
          or not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{inventory,purchaseReturns}','[]')) r,
              jsonb_array_elements(coalesce(r#>'{financial,payableOffsets}','[]')) ro
            where r->>'id'=v_offset->>'returnId' and r->>'orderId'=v_old->>'purchaseId'
              and ro->>'entryId'=v_old->>'id' and ro->'amount'=v_offset->'amount') then
          raise exception 'Abatimento financeiro sem devolucao de compra correspondente.';
        end if;
      end loop;
    end if;
    if coalesce((v_old->>'canceled')::boolean,false) is distinct from coalesce((v_new->>'canceled')::boolean,false)
      or v_old->'retention' is distinct from v_new->'retention' then
      select * into v_permit from public.finance_change_permits
        where company_id=new.company_id and entry_id=v_old->>'id' for update;
      if found and v_permit.before_entry=v_old and v_permit.after_entry=v_new then
        select i into v_invoice from jsonb_array_elements(coalesce(v_finance->'invoices','[]')) i where i->>'id'=v_new->>'invoiceId';
        select i into v_old_invoice from jsonb_array_elements(coalesce(old.payload #> '{finance,invoices}','[]')) i where i->>'id'=v_old->>'invoiceId';
        if v_permit.before_invoice is distinct from v_old_invoice or v_permit.after_invoice is distinct from v_invoice then
          raise exception 'Autorizacao financeira nao corresponde ao faturamento salvo.';
        end if;
        delete from public.finance_change_permits where company_id=new.company_id and entry_id=v_old->>'id';
      elsif v_old ? 'invoiceId' or (v_old - 'settlements' - 'canceled') is distinct from (v_new - 'settlements' - 'canceled')
        or coalesce((v_old->>'canceled')::boolean,false) or not coalesce((v_new->>'canceled')::boolean,false) then
        raise exception 'Cancelamento ou retencao exige autorizacao atual do backend fiscal.';
      end if;
    end if;
    if jsonb_typeof(v_new->'settlements') is distinct from 'array' then raise exception 'Historico de baixas invalido.'; end if;
    for v_s in select s from jsonb_array_elements(v_old->'settlements') s loop
      select s into v_ns from jsonb_array_elements(v_new->'settlements') s where s->>'id'=v_s->>'id';
      if v_ns is null or (v_ns-'reversed') is distinct from (v_s-'reversed')
        or (coalesce((v_s->>'reversed')::boolean,false) and not coalesce((v_ns->>'reversed')::boolean,false)) then
        raise exception 'Baixas nao podem ser apagadas, editadas ou ter estorno desfeito.';
      end if;
    end loop;
  end loop;
  for v_old in select i from jsonb_array_elements(coalesce(old.payload #> '{finance,invoices}','[]')) i loop
    select i into v_new from jsonb_array_elements(coalesce(v_finance->'invoices','[]')) i where i->>'id'=v_old->>'id';
    if v_new is null or (v_old-'canceled'-'kind') is distinct from (v_new-'canceled'-'kind')
      or coalesce(v_old->>'kind','Legado') is distinct from coalesce(v_new->>'kind','Legado') then
      raise exception 'Faturamento e snapshots nao podem ser apagados ou reescritos.';
    end if;
    if coalesce((v_old->>'canceled')::boolean,false) is distinct from coalesce((v_new->>'canceled')::boolean,false) then
      if coalesce((v_old->>'canceled')::boolean,false) or not coalesce((v_new->>'canceled')::boolean,false)
        or not exists (select 1 from jsonb_array_elements(v_finance->'entries') e
          where e->>'invoiceId'=v_old->>'id' and (e->>'canceled')::boolean)
        or not exists (select 1 from jsonb_array_elements(old.payload #> '{finance,entries}') e
          where e->>'invoiceId'=v_old->>'id' and not coalesce((e->>'canceled')::boolean,false)) then
        raise exception 'Cancelamento do faturamento exige a conta correspondente autorizada.';
      end if;
    end if;
  end loop;
  for v_new in select i from jsonb_array_elements(coalesce(v_finance->'invoices','[]')) i loop
    if v_new ? 'canceled' and jsonb_typeof(v_new->'canceled') is distinct from 'boolean' then
      raise exception 'Situacao do faturamento invalida.';
    end if;
    if not exists (select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,invoices}','[]')) i where i->>'id'=v_new->>'id')
      and coalesce((v_new->>'canceled')::boolean,false) then
      raise exception 'Novo faturamento deve iniciar aberto.';
    end if;
    if (select count(*) from jsonb_array_elements(v_finance->'entries') e where e->>'invoiceId'=v_new->>'id') <> 1
      or not exists (select 1 from jsonb_array_elements(v_finance->'entries') e where e->>'invoiceId'=v_new->>'id'
        and e->>'kind'='Receber' and e->>'clientId'=v_new->>'clientId' and e->'amount'=v_new->'amount'
        and coalesce((e->>'canceled')::boolean,false)=coalesce((v_new->>'canceled')::boolean,false)) then
      raise exception 'Faturamento exige uma unica conta a receber correspondente.';
    end if;
  end loop;
  for v_new in select e from jsonb_array_elements(coalesce(v_finance->'entries','[]')) e loop
    if not exists (select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,entries}','[]')) e where e->>'id'=v_new->>'id')
      and (v_new ? 'retention' or coalesce((v_new->>'canceled')::boolean,false) or jsonb_array_length(v_new->'settlements')>0
        or jsonb_array_length(coalesce(v_new->'purchaseReturnOffsets','[]'))>0) then
      raise exception 'Nova conta deve iniciar aberta sem baixas, abatimentos ou retencoes.';
    end if;
    if jsonb_typeof(v_new->'amount') is distinct from 'number'
      or (v_new->>'amount')::numeric <= 0 or (v_new->>'amount')::numeric <> trunc((v_new->>'amount')::numeric)
      or (v_new ? 'canceled' and jsonb_typeof(v_new->'canceled') is distinct from 'boolean')
      or (v_new ? 'invoiceId' and not exists (select 1 from jsonb_array_elements(v_finance->'invoices') i where i->>'id'=v_new->>'invoiceId'))
      or not exists (select 1 from jsonb_array_elements(v_finance->'accounts') a where a->>'id'=v_new->>'accountId')
      or jsonb_typeof(v_new->'settlements') is distinct from 'array'
      or exists (select 1 from jsonb_array_elements(v_new->'settlements') s group by s->>'id' having count(*)>1)
      or exists (select 1 from jsonb_array_elements(v_new->'settlements') s
        where nullif(s->>'id','') is null or jsonb_typeof(s->'amount') is distinct from 'number'
          or jsonb_typeof(s->'reversed') is distinct from 'boolean'
          or not exists (select 1 from jsonb_array_elements(v_finance->'accounts') a where a->>'id'=s->>'accountId')
          or (s->>'amount')::numeric <= 0 or (s->>'amount')::numeric <> trunc((s->>'amount')::numeric))
      or jsonb_typeof(coalesce(v_new->'purchaseReturnOffsets','[]')) is distinct from 'array'
      or exists(select 1 from jsonb_array_elements(coalesce(v_new->'purchaseReturnOffsets','[]')) ro
        where jsonb_typeof(ro->'returnId') is distinct from 'string' or nullif(ro->>'returnId','') is null
          or coalesce(ro->>'amount','') !~ '^[1-9][0-9]*$')
      or exists(select 1 from jsonb_array_elements(coalesce(v_new->'purchaseReturnOffsets','[]')) ro
        group by ro->>'returnId' having count(*)>1) then
      raise exception 'Baixas ou abatimentos invalidos ou duplicados.';
    end if;
    select coalesce(sum((s->>'amount')::numeric),0) into v_paid from jsonb_array_elements(v_new->'settlements') s
      where not coalesce((s->>'reversed')::boolean,false);
    select coalesce(sum((ro->>'amount')::numeric),0) into v_offset_total
      from jsonb_array_elements(coalesce(v_new->'purchaseReturnOffsets','[]')) ro;
    if v_paid+v_offset_total > (v_new->>'amount')::numeric-coalesce((v_new#>>'{retention,withheld}')::numeric,0)
      or (coalesce((v_new->>'canceled')::boolean,false) and v_paid>0) then
      raise exception 'Baixas e abatimentos excedem o saldo liquido ou conta cancelada.';
    end if;
  end loop;
  return new;
end;
$$;

create function public.guard_purchase_return_finance() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_return jsonb; v_order jsonb; v_line jsonb; v_offset jsonb; v_entry jsonb;
  v_financial jsonb; v_expected numeric; v_offsets numeric; v_credit numeric;
begin
  if TG_OP='DELETE' then return old; end if;
  for v_return in select value from jsonb_array_elements(coalesce(new.payload#>'{inventory,purchaseReturns}','[]')) loop
    v_financial := v_return->'financial';
    if v_financial is null then continue; end if;
    select value into v_order from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]'))
      where value->>'id'=v_return->>'orderId';
    if v_order is null or jsonb_typeof(v_financial) is distinct from 'object'
      or jsonb_typeof(v_financial->'amount') is distinct from 'number'
      or coalesce(v_financial->>'amount','') !~ '^[0-9]+$'
      or jsonb_typeof(v_financial->'payableOffsets') is distinct from 'array'
      or jsonb_array_length(v_financial->'payableOffsets')>120 then
      raise exception 'Dados financeiros da devolucao de compra invalidos.';
    end if;
    select coalesce(sum((ri->>'quantity')::numeric*(oi->>'unitCost')::numeric),0) into v_expected
      from jsonb_array_elements(coalesce(v_return->'items','[]')) ri
      join jsonb_array_elements(coalesce(v_order->'items','[]')) oi on oi->>'id'=ri->>'lineId';
    select coalesce(sum((ro->>'amount')::numeric),0) into v_offsets
      from jsonb_array_elements(v_financial->'payableOffsets') ro;
    v_credit := v_expected-v_offsets;
    if v_financial->>'amount' is distinct from v_expected::text
      or v_offsets>v_expected
      or exists(select 1 from jsonb_array_elements(v_financial->'payableOffsets') ro
        where jsonb_typeof(ro->'entryId') is distinct from 'string' or nullif(ro->>'entryId','') is null
          or coalesce(ro->>'amount','') !~ '^[1-9][0-9]*$'
          or not exists(select 1 from jsonb_array_elements(coalesce(v_order#>'{receipt,entryIds}',
              v_order#>'{cancellation,payableEntryIds}','[]')) ids
            where ids#>>'{}'=ro->>'entryId')
          or not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,entries}','[]')) e
            where e->>'id'=ro->>'entryId' and e->>'kind'='Pagar' and e->>'purchaseId'=v_order->>'id'
              and exists(select 1 from jsonb_array_elements(coalesce(e->'purchaseReturnOffsets','[]')) eo
                where eo->>'returnId'=v_return->>'id' and eo->'amount'=ro->'amount')))
      or exists(select 1 from jsonb_array_elements(v_financial->'payableOffsets') ro group by ro->>'entryId' having count(*)>1)
      or (v_credit>0 and (nullif(v_financial->>'creditEntryId','') is null
        or not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,entries}','[]')) e
          where e->>'id'=v_financial->>'creditEntryId' and e->>'purchaseReturnCreditId'=v_return->>'id'
            and e->>'kind'='Receber' and e->>'party'=v_order->>'supplierName'
            and e->>'description'=concat('Crédito de devolução da compra ',v_order->>'id')
            and e->>'amount'=v_credit::text and e->>'issuedOn'=v_return->>'date'
            and e->>'dueOn'=v_return->>'date' and e->>'accountId'=v_order->>'accountId'
            and e->>'paymentMethod'=v_order->>'paymentMethod')))
      or (v_credit=0 and v_financial ? 'creditEntryId') then
      raise exception 'Abatimento ou credito nao corresponde aos valores e contas da devolucao.';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,entries}','[]')) e
    where jsonb_array_length(coalesce(e->'purchaseReturnOffsets','[]'))>0
      and exists(select 1 from jsonb_array_elements(coalesce(e->'purchaseReturnOffsets','[]')) eo
        where not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{inventory,purchaseReturns}','[]')) r,
            jsonb_array_elements(coalesce(r#>'{financial,payableOffsets}','[]')) ro
          where r->>'id'=eo->>'returnId' and ro->>'entryId'=e->>'id' and ro->'amount'=eo->'amount')))
    or exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,entries}','[]')) e
      where e ? 'purchaseReturnCreditId'
        and not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{inventory,purchaseReturns}','[]')) r
          where r->>'id'=e->>'purchaseReturnCreditId' and r#>>'{financial,creditEntryId}'=e->>'id')) then
    raise exception 'Conta de credito ou abatimento sem devolucao de compra correspondente.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_purchase_return_finance() from public, anon, authenticated, service_role;
create trigger guard_purchase_return_finance before insert or update or delete on public.company_data
for each row execute function public.guard_purchase_return_finance();

commit;
