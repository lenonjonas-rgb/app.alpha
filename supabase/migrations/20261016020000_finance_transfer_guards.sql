begin;

create function public.guard_finance_transfers() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_transfers jsonb; v_old jsonb; v_new jsonb;
begin
  if TG_OP = 'DELETE' then
    if jsonb_array_length(coalesce(old.payload #> '{finance,transfers}','[]')) > 0 then
      raise exception 'Historico de transferencias nao pode ser excluido.';
    end if;
    return old;
  end if;
  if TG_OP = 'UPDATE' and new.payload->'finance' is not distinct from old.payload->'finance' then
    return new;
  end if;
  v_transfers := coalesce(new.payload #> '{finance,transfers}','[]');
  if jsonb_typeof(v_transfers) is distinct from 'array' or jsonb_array_length(v_transfers)>10000 then
    raise exception 'Estrutura ou limite de transferencias invalido.';
  end if;
  if exists(select 1 from jsonb_array_elements(v_transfers) t group by t->>'id' having count(*)>1) then
    raise exception 'Identificadores de transferencias duplicados.';
  end if;
  if TG_OP = 'UPDATE' then
    for v_old in select t from jsonb_array_elements(coalesce(old.payload #> '{finance,transfers}','[]')) t loop
      select t into v_new from jsonb_array_elements(v_transfers) t where t->>'id'=v_old->>'id';
      if v_new is null or (v_new-'reversal') is distinct from (v_old-'reversal') then
        raise exception 'Transferencias nao podem ser removidas ou reescritas.';
      end if;
      if v_old ? 'reversal' and v_old->'reversal' is distinct from v_new->'reversal' then
        raise exception 'Estorno de transferencia nao pode ser removido ou alterado.';
      end if;
    end loop;
  end if;
  for v_new in select t from jsonb_array_elements(v_transfers) t loop
    if jsonb_typeof(v_new) is distinct from 'object'
      or nullif(btrim(v_new->>'id'),'') is null
      or nullif(btrim(v_new->>'description'),'') is null
      or length(v_new->>'description')>1000 or length(v_new->>'id')>200
      or coalesce(v_new->>'createdAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      or jsonb_typeof(v_new->'amount') is distinct from 'number'
      or (v_new->>'amount')::numeric <> trunc((v_new->>'amount')::numeric)
      or (v_new->>'amount')::numeric<=0 or (v_new->>'amount')::numeric>100000000
      or coalesce(v_new->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((v_new->>'date')::date,'YYYY-MM-DD') <> v_new->>'date'
      or (v_new->>'date')::date>current_date
      or v_new->>'fromAccountId' is not distinct from v_new->>'toAccountId'
      or not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,accounts}','[]')) a where a->>'id'=v_new->>'fromAccountId')
      or not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,accounts}','[]')) a where a->>'id'=v_new->>'toAccountId') then
      raise exception 'Transferencia invalida: confira contas distintas, data e valor inteiro positivo.';
    end if;
    perform (v_new->>'createdAt')::timestamptz;
    if v_new ? 'reversal' then
      if jsonb_typeof(v_new->'reversal') is distinct from 'object'
        or coalesce(v_new #>> '{reversal,at}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        or length(btrim(coalesce(v_new #>> '{reversal,reason}','')))<5
        or length(v_new #>> '{reversal,reason}')>1000 then
        raise exception 'Estorno exige data/hora e motivo de 5 a 1000 caracteres.';
      end if;
      perform (v_new #>> '{reversal,at}')::timestamptz;
    end if;
    if TG_OP='INSERT' or not exists(select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,transfers}','[]')) t where t->>'id'=v_new->>'id') then
      if v_new ? 'reversal'
        or not exists(select 1 from jsonb_array_elements(new.payload #> '{finance,accounts}') a
          where a->>'id'=v_new->>'fromAccountId' and a->'active'='true'::jsonb)
        or not exists(select 1 from jsonb_array_elements(new.payload #> '{finance,accounts}') a
          where a->>'id'=v_new->>'toAccountId' and a->'active'='true'::jsonb) then
        raise exception 'Nova transferencia exige duas contas ativas e nao pode iniciar estornada.';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_finance_transfers() from public, anon, authenticated, service_role;
create trigger guard_finance_transfers before insert or update or delete on public.company_data
for each row execute function public.guard_finance_transfers();

commit;
