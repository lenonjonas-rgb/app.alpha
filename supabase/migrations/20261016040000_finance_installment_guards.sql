begin;

create function public.guard_finance_installments() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_entries jsonb; v_entry jsonb; v_first jsonb; v_link jsonb; v_plan text;
  v_count integer; v_total bigint; v_number integer; v_previous date; v_due date; v_seen integer;
begin
  if TG_OP='UPDATE' and new.payload->'finance' is not distinct from old.payload->'finance' then return new; end if;
  v_entries := coalesce(new.payload #> '{finance,entries}','[]');
  for v_entry in select e from jsonb_array_elements(v_entries) e where e ? 'installment' loop
    v_link := v_entry->'installment';
    if jsonb_typeof(v_link) is distinct from 'object'
      or jsonb_typeof(v_link->'planId') is distinct from 'string'
      or nullif(btrim(v_link->>'planId'),'') is null or length(v_link->>'planId')>200
      or jsonb_typeof(v_link->'number') is distinct from 'number'
      or jsonb_typeof(v_link->'count') is distinct from 'number'
      or jsonb_typeof(v_link->'total') is distinct from 'number'
      or coalesce(v_link->>'number','') !~ '^[0-9]+$'
      or coalesce(v_link->>'count','') !~ '^[0-9]+$'
      or coalesce(v_link->>'total','') !~ '^[0-9]+$'
      or (v_link->>'count')::numeric not between 2 and 120
      or (v_link->>'number')::numeric not between 1 and (v_link->>'count')::numeric
      or (v_link->>'total')::numeric not between (v_link->>'count')::numeric and 100000000
      or v_entry ? 'invoiceId' or v_entry ? 'retention' then
      raise exception 'Parcelamento manual com estrutura ou vinculos invalidos.';
    end if;
    if TG_OP='UPDATE' and not exists (
      select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,entries}','[]')) e where e->>'id'=v_entry->>'id'
    ) and exists (
      select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,entries}','[]')) e
        where e #>> '{installment,planId}'=v_link->>'planId'
    ) then raise exception 'Parcelamento existente nao aceita novas parcelas.';
    end if;
    if not exists (select 1 from jsonb_array_elements(new.payload #> '{finance,accounts}') a
      where a->>'id'=v_entry->>'accountId') then raise exception 'Conta bancaria do parcelamento inexistente.'; end if;
  end loop;
  for v_plan in select distinct e #>> '{installment,planId}' from jsonb_array_elements(v_entries) e where e ? 'installment' loop
    v_first := null; v_previous := null; v_seen := 0;
    for v_entry in select e from jsonb_array_elements(v_entries) e where e #>> '{installment,planId}'=v_plan
      order by (e #>> '{installment,number}')::integer loop
      v_link := v_entry->'installment';
      if v_first is null then
        v_first := v_entry; v_count := (v_link->>'count')::integer; v_total := (v_link->>'total')::bigint;
      end if;
      v_seen := v_seen+1; v_number := (v_link->>'number')::integer;
      if coalesce(v_entry->>'dueOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or coalesce(v_entry->>'issuedOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Datas de parcelamento invalidas.';
      end if;
      v_due := (v_entry->>'dueOn')::date;
      if v_number<>v_seen or (v_link->>'count')::integer<>v_count or (v_link->>'total')::bigint<>v_total
        or (v_entry-'id'-'amount'-'dueOn'-'installment'-'settlements'-'canceled')
          is distinct from (v_first-'id'-'amount'-'dueOn'-'installment'-'settlements'-'canceled')
        or (v_entry->>'amount')::numeric is distinct from
          (v_total/v_count + case when v_number<=v_total%v_count then 1 else 0 end)::numeric
        or v_due<(v_entry->>'issuedOn')::date or (v_previous is not null and v_due<=v_previous) then
        raise exception 'Parcelamento incompleto ou com valores, datas ou vinculos inconsistentes.';
      end if;
      v_previous := v_due;
    end loop;
    if v_seen<>v_count then raise exception 'Parcelamento incompleto: todas as parcelas devem ser gravadas juntas.'; end if;
    if TG_OP='INSERT' or not exists (
      select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,entries}','[]')) e where e #>> '{installment,planId}'=v_plan
    ) then
      if not exists (select 1 from jsonb_array_elements(new.payload #> '{finance,accounts}') a
        where a->>'id'=v_first->>'accountId' and a->'active'='true'::jsonb) then
        raise exception 'Novo parcelamento exige conta bancaria ativa.';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_finance_installments() from public, anon, authenticated, service_role;
create trigger guard_finance_installments before insert or update on public.company_data
for each row execute function public.guard_finance_installments();

commit;
