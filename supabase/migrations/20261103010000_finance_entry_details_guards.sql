begin;

create function public.guard_finance_entry_details() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_item jsonb; v_details jsonb; v_entry jsonb; v_recurrence jsonb; v_expected jsonb; v_months integer;
begin
  if TG_OP = 'DELETE' then return old; end if;
  if TG_OP = 'UPDATE' and new.payload->'finance' is not distinct from old.payload->'finance' then return new; end if;

  for v_item in
    select e from jsonb_array_elements(coalesce(new.payload #> '{finance,entries}','[]')) e where e ? 'details'
    union all
    select r from jsonb_array_elements(coalesce(new.payload #> '{finance,recurrences}','[]')) r where r ? 'details'
  loop
    v_details := v_item->'details';
    if jsonb_typeof(v_details) is distinct from 'object'
      or v_details - array['competenceOn','documentNumber','seller','monthlyInterestBasisPoints','lateFineBasisPoints'] <> '{}'::jsonb
      or jsonb_typeof(v_details->'competenceOn') is distinct from 'string'
      or coalesce(v_details->>'competenceOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((v_details->>'competenceOn')::date,'YYYY-MM-DD') is distinct from v_details->>'competenceOn'
      or jsonb_typeof(v_details->'documentNumber') is distinct from 'string' or length(v_details->>'documentNumber') > 200
      or jsonb_typeof(v_details->'seller') is distinct from 'string' or length(v_details->>'seller') > 160
      or jsonb_typeof(v_details->'monthlyInterestBasisPoints') is distinct from 'number'
      or coalesce(v_details->>'monthlyInterestBasisPoints','') !~ '^[0-9]+$'
      or (v_details->>'monthlyInterestBasisPoints')::numeric not between 0 and 10000
      or jsonb_typeof(v_details->'lateFineBasisPoints') is distinct from 'number'
      or coalesce(v_details->>'lateFineBasisPoints','') !~ '^[0-9]+$'
      or (v_details->>'lateFineBasisPoints')::numeric not between 0 and 10000 then
      raise exception 'Detalhes da conta financeira invalidos.';
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,entries}','[]')) e where e ? 'installment'
    group by e #>> '{installment,planId}'
    having count(distinct coalesce(e->'details','null'::jsonb)) > 1
  ) then raise exception 'Detalhes das parcelas devem corresponder ao plano.'; end if;

  for v_entry in select e from jsonb_array_elements(coalesce(new.payload #> '{finance,entries}','[]')) e where e ? 'recurrence' loop
    select r into v_recurrence from jsonb_array_elements(coalesce(new.payload #> '{finance,recurrences}','[]')) r
      where r->>'id'=v_entry #>> '{recurrence,id}';
    -- O guard de recorrências valida a existência do vínculo.
    if v_recurrence is null then continue; end if;
    v_expected := null;
    if v_recurrence ? 'details' then
      v_months := (extract(year from ((v_entry #>> '{recurrence,period}') || '-01')::date)::integer -
        extract(year from (v_recurrence->>'firstDueOn')::date)::integer) * 12 +
        extract(month from ((v_entry #>> '{recurrence,period}') || '-01')::date)::integer -
        extract(month from (v_recurrence->>'firstDueOn')::date)::integer;
      v_expected := v_recurrence->'details' || jsonb_build_object('competenceOn',
        to_char((v_recurrence #>> '{details,competenceOn}')::date + make_interval(months => v_months),'YYYY-MM-DD'));
    end if;
    if v_entry->'details' is distinct from v_expected then
      raise exception 'Detalhes da conta nao correspondem a recorrencia.';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_finance_entry_details() from public, anon, authenticated, service_role;
create trigger guard_finance_entry_details before insert or update or delete on public.company_data
for each row execute function public.guard_finance_entry_details();

commit;
