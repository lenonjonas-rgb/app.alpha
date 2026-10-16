begin;

create function public.guard_finance_recurrences() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_items jsonb; v_old jsonb; v_item jsonb; v_event jsonb; v_status text; v_at timestamptz;
  v_entry jsonb; v_link jsonb; v_due date; v_first date; v_month date; v_new boolean;
begin
  if TG_OP='DELETE' then
    if jsonb_array_length(coalesce(old.payload #> '{finance,recurrences}','[]'))>0 then
      raise exception 'Historico de recorrencias nao pode ser excluido.';
    end if;
    return old;
  end if;
  if TG_OP='UPDATE' and new.payload->'finance' is not distinct from old.payload->'finance' then return new; end if;
  v_items := coalesce(new.payload #> '{finance,recurrences}','[]');
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items)>1000
    or exists(select 1 from jsonb_array_elements(v_items) r group by r->>'id' having count(*)>1) then
    raise exception 'Recorrencias invalidas ou duplicadas.';
  end if;
  if TG_OP='UPDATE' then
    for v_old in select r from jsonb_array_elements(coalesce(old.payload #> '{finance,recurrences}','[]')) r loop
      select r into v_item from jsonb_array_elements(v_items) r where r->>'id'=v_old->>'id';
      if v_item is null or (v_item-'events') is distinct from (v_old-'events') then
        raise exception 'Dados originais de recorrencias nao podem ser removidos ou reescritos.';
      end if;
      if jsonb_typeof(v_item->'events') is distinct from 'array'
        or jsonb_array_length(v_item->'events') not between jsonb_array_length(v_old->'events') and jsonb_array_length(v_old->'events')+1
        or exists(select 1 from jsonb_array_elements(v_old->'events') with ordinality e(value,n)
          where v_item->'events'->(e.n::integer-1) is distinct from e.value) then
        raise exception 'Historico de situacao da recorrencia e imutavel; acrescente uma transicao por vez.';
      end if;
    end loop;
  end if;
  for v_item in select r from jsonb_array_elements(v_items) r loop
    if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'id') is distinct from 'string'
      or length(btrim(v_item->>'id')) not between 1 and 200
      or coalesce(v_item->>'kind','') not in ('Receber','Pagar')
      or jsonb_typeof(v_item->'party') is distinct from 'string' or length(btrim(v_item->>'party')) not between 1 and 1000
      or jsonb_typeof(v_item->'description') is distinct from 'string' or length(btrim(v_item->>'description')) not between 1 and 1000
      or jsonb_typeof(v_item->'amount') is distinct from 'number' or coalesce(v_item->>'amount','') !~ '^[0-9]+$'
      or (v_item->>'amount')::numeric not between 1 and 100000000
      or coalesce(v_item->>'paymentMethod','') not in ('Pix','Boleto','Transferência','Dinheiro','Cartão','Outro')
      or coalesce(v_item->>'firstDueOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(v_item->>'endsOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (v_item->>'endsOn')::date<(v_item->>'firstDueOn')::date
      or coalesce(v_item->>'createdAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      or jsonb_typeof(v_item->'accountId') is distinct from 'string'
      or (v_item ? 'clientId' and jsonb_typeof(v_item->'clientId') is distinct from 'string')
      or (v_item ? 'categoryId' and jsonb_typeof(v_item->'categoryId') is distinct from 'string')
      or (v_item ? 'costCenterId' and jsonb_typeof(v_item->'costCenterId') is distinct from 'string')
      or jsonb_typeof(v_item->'events') is distinct from 'array' or jsonb_array_length(v_item->'events')>1000
      or not exists(select 1 from jsonb_array_elements(new.payload #> '{finance,accounts}') a where a->>'id'=v_item->>'accountId')
      or (v_item->>'kind'='Receber' and not (v_item ? 'clientId'))
      or (v_item ? 'clientId' and not exists(select 1 from jsonb_array_elements(new.payload->'clients') c where c->>'id'=v_item->>'clientId'))
      or (v_item ? 'categoryId' and not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,categories}','[]')) c
        where c->>'id'=v_item->>'categoryId' and c->>'kind'=v_item->>'kind'))
      or (v_item ? 'costCenterId' and not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,costCenters}','[]')) c
        where c->>'id'=v_item->>'costCenterId')) then
      raise exception 'Recorrencia com estrutura, vigencia ou referencias invalidas.';
    end if;
    v_status := 'Ativa'; v_at := (v_item->>'createdAt')::timestamptz;
    for v_event in select e from jsonb_array_elements(v_item->'events') e loop
      if jsonb_typeof(v_event) is distinct from 'object'
        or coalesce(v_event->>'status','') not in ('Ativa','Suspensa','Cancelada')
        or v_status='Cancelada' or v_event->>'status'=v_status
        or jsonb_typeof(v_event->'reason') is distinct from 'string' or length(btrim(v_event->>'reason')) not between 5 and 1000
        or coalesce(v_event->>'at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        or (v_event->>'at')::timestamptz<v_at then
        raise exception 'Transicao de recorrencia invalida; cancelamento e definitivo.';
      end if;
      v_status := v_event->>'status'; v_at := (v_event->>'at')::timestamptz;
    end loop;
    v_new := TG_OP='INSERT' or not exists(select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,recurrences}','[]')) r where r->>'id'=v_item->>'id');
    if v_new and (jsonb_array_length(v_item->'events')>0
      or not exists(select 1 from jsonb_array_elements(new.payload #> '{finance,accounts}') a where a->>'id'=v_item->>'accountId' and a->'active'='true'::jsonb)
      or (v_item ? 'categoryId' and not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,categories}','[]')) c
        where c->>'id'=v_item->>'categoryId' and c->'active'='true'::jsonb))
      or (v_item ? 'costCenterId' and not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,costCenters}','[]')) c
        where c->>'id'=v_item->>'costCenterId' and c->'active'='true'::jsonb))) then
      raise exception 'Nova recorrencia exige referencias ativas e historico vazio.';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,entries}','[]')) e where e ? 'recurrence'
    group by e #>> '{recurrence,id}', e #>> '{recurrence,period}' having count(*)>1) then
    raise exception 'Mes da recorrencia ja gerado, inclusive em conta cancelada.';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,entries}','[]')) e
    where e ? 'recurrence' and (TG_OP='INSERT' or not exists(
      select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,entries}','[]')) o where o->>'id'=e->>'id'))
    group by e #>> '{recurrence,id}' having count(*)>24) then
    raise exception 'Geracao limitada a 24 meses por recorrencia em cada gravacao.';
  end if;
  for v_entry in select e from jsonb_array_elements(coalesce(new.payload #> '{finance,entries}','[]')) e where e ? 'recurrence' loop
    v_link := v_entry->'recurrence';
    select r into v_item from jsonb_array_elements(v_items) r where r->>'id'=v_link->>'id';
    if jsonb_typeof(v_link) is distinct from 'object' or jsonb_typeof(v_link->'id') is distinct from 'string'
      or coalesce(v_link->>'period','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or v_item is null then
      raise exception 'Vinculo de recorrencia invalido.';
    end if;
    v_first := (v_item->>'firstDueOn')::date; v_month := ((v_link->>'period')||'-01')::date;
    v_due := v_month + (least(extract(day from v_first)::integer,
      extract(day from (v_month+interval '1 month - 1 day'))::integer)-1);
    if v_due<v_first or v_due>(v_item->>'endsOn')::date or v_entry->>'dueOn' is distinct from to_char(v_due,'YYYY-MM-DD')
      or v_entry->'kind' is distinct from v_item->'kind' or v_entry->'party' is distinct from v_item->'party'
      or v_entry->'clientId' is distinct from v_item->'clientId' or v_entry->'description' is distinct from v_item->'description'
      or v_entry->'amount' is distinct from v_item->'amount' or v_entry->'accountId' is distinct from v_item->'accountId'
      or v_entry->'paymentMethod' is distinct from v_item->'paymentMethod'
      or v_entry ? 'invoiceId' or v_entry ? 'retention' or v_entry ? 'installment' then
      raise exception 'Conta recorrente incompativel com origem, valor, data ou vigencia.';
    end if;
    v_new := TG_OP='INSERT' or not exists(select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,entries}','[]')) e where e->>'id'=v_entry->>'id');
    if v_new and (coalesce(v_item->'events'->-1->>'status','Ativa')<>'Ativa'
      or not exists(select 1 from jsonb_array_elements(new.payload #> '{finance,accounts}') a where a->>'id'=v_item->>'accountId' and a->'active'='true'::jsonb)
      or (v_item ? 'categoryId' and not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,categories}','[]')) c
        where c->>'id'=v_item->>'categoryId' and c->'active'='true'::jsonb))
      or (v_item ? 'costCenterId' and not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,costCenters}','[]')) c
        where c->>'id'=v_item->>'costCenterId' and c->'active'='true'::jsonb))) then
      raise exception 'Geracao exige recorrencia e referencias ativas.';
    end if;
    if v_new and (v_item ? 'categoryId' or v_item ? 'costCenterId') and not exists(
      select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,management,classifications}','[]')) c
      where c->>'entryId'=v_entry->>'id' and c->'categoryId' is not distinct from v_item->'categoryId'
        and c->'costCenterId' is not distinct from v_item->'costCenterId'
    ) then raise exception 'Nova conta recorrente exige classificacao inicial da recorrencia.'; end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_finance_recurrences() from public, anon, authenticated, service_role;
create trigger guard_finance_recurrences before insert or update or delete on public.company_data
for each row execute function public.guard_finance_recurrences();

commit;
