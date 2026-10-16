begin;

create function public.guard_bank_reconciliation() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_banking jsonb; v_old jsonb; v_new jsonb; v_transaction jsonb; v_entry jsonb; v_settlement jsonb;
  v_transactions jsonb; v_matches jsonb; v_active_transactions text[] := '{}'; v_active_settlements text[] := '{}'; v_key text;
begin
  if TG_OP = 'DELETE' then
    if jsonb_array_length(coalesce(old.payload #> '{finance,banking,transactions}','[]')) > 0
      or jsonb_array_length(coalesce(old.payload #> '{finance,banking,matches}','[]')) > 0 then
      raise exception 'Historico de extratos e conciliacoes nao pode ser excluido.';
    end if;
    return old;
  end if;
  if TG_OP = 'UPDATE' and new.payload->'finance' is not distinct from old.payload->'finance' then
    return new;
  end if;
  v_banking := new.payload #> '{finance,banking}';
  if v_banking is not null and (jsonb_typeof(v_banking) is distinct from 'object'
    or jsonb_typeof(v_banking->'transactions') is distinct from 'array'
    or jsonb_typeof(v_banking->'matches') is distinct from 'array') then
    raise exception 'Estrutura de conciliacao bancaria invalida.';
  end if;
  v_transactions := coalesce(v_banking->'transactions','[]');
  v_matches := coalesce(v_banking->'matches','[]');
  if jsonb_array_length(v_transactions)>10000 or jsonb_array_length(v_matches)>20000
    or exists(select 1 from jsonb_array_elements(v_transactions) t group by t->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_transactions) t group by t->>'accountId',t->>'externalId' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_matches) m group by m->>'id' having count(*)>1) then
    raise exception 'Movimentos ou vinculos bancarios duplicados/limite excedido.';
  end if;
  if TG_OP = 'UPDATE' then
    for v_old in select t from jsonb_array_elements(coalesce(old.payload #> '{finance,banking,transactions}','[]')) t loop
      select t into v_new from jsonb_array_elements(v_transactions) t where t->>'id'=v_old->>'id';
      if v_new is distinct from v_old then
        raise exception 'Extratos importados nao podem ser alterados ou removidos.';
      end if;
    end loop;
    for v_old in select m from jsonb_array_elements(coalesce(old.payload #> '{finance,banking,matches}','[]')) m loop
      select m into v_new from jsonb_array_elements(v_matches) m where m->>'id'=v_old->>'id';
      if v_new is null or (v_new-'reversed') is distinct from (v_old-'reversed')
        or ((v_old->>'reversed')::boolean and not coalesce((v_new->>'reversed')::boolean,false)) then
        raise exception 'Vinculos nao podem ser removidos/reescritos nem ter desfazimento revertido.';
      end if;
    end loop;
  end if;
  for v_transaction in select t from jsonb_array_elements(v_transactions) t loop
    if jsonb_typeof(v_transaction) is distinct from 'object'
      or nullif(btrim(v_transaction->>'id'),'') is null
      or nullif(btrim(v_transaction->>'externalId'),'') is null
      or nullif(btrim(v_transaction->>'description'),'') is null
      or nullif(btrim(v_transaction->>'fileName'),'') is null
      or nullif(v_transaction->>'importedAt','') is null
      or jsonb_typeof(v_transaction->'amount') is distinct from 'number'
      or (v_transaction->>'amount')::numeric <> trunc((v_transaction->>'amount')::numeric)
      or (v_transaction->>'amount')::numeric=0 or abs((v_transaction->>'amount')::numeric)>100000000
      or coalesce(v_transaction->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((v_transaction->>'date')::date,'YYYY-MM-DD') <> v_transaction->>'date'
      or (v_transaction->>'date')::date > current_date
      or not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,accounts}','[]')) a
        where a->>'id'=v_transaction->>'accountId') then
      raise exception 'Movimento de extrato invalido ou banco inexistente.';
    end if;
  end loop;
  for v_new in select m from jsonb_array_elements(v_matches) m loop
    select t into v_transaction from jsonb_array_elements(v_transactions) t where t->>'id'=v_new->>'transactionId';
    select e into v_entry from jsonb_array_elements(coalesce(new.payload #> '{finance,entries}','[]')) e where e->>'id'=v_new->>'entryId';
    select s into v_settlement from jsonb_array_elements(coalesce(v_entry->'settlements','[]')) s where s->>'id'=v_new->>'settlementId';
    if v_transaction is null or v_entry is null or v_settlement is null
      or nullif(btrim(v_new->>'id'),'') is null or nullif(v_new->>'createdAt','') is null
      or jsonb_typeof(v_new->'reversed') is distinct from 'boolean'
      or v_settlement->>'accountId' is distinct from v_transaction->>'accountId'
      or v_settlement->>'date' is distinct from v_transaction->>'date'
      or (v_settlement->>'amount')::numeric is distinct from abs((v_transaction->>'amount')::numeric)
      or v_entry->>'kind' is distinct from (case when (v_transaction->>'amount')::numeric>0 then 'Receber' else 'Pagar' end) then
      raise exception 'Vinculo de conciliacao incompativel com extrato/baixa.';
    end if;
    if not (v_new->>'reversed')::boolean and not coalesce((v_entry->>'canceled')::boolean,false)
      and not coalesce((v_settlement->>'reversed')::boolean,false) then
      v_key := jsonb_build_array(v_entry->>'id',v_settlement->>'id')::text;
      if v_new->>'transactionId'=any(v_active_transactions) or v_key=any(v_active_settlements) then
        raise exception 'Movimento ou baixa ja conciliado.';
      end if;
      v_active_transactions := array_append(v_active_transactions,v_new->>'transactionId');
      v_active_settlements := array_append(v_active_settlements,v_key);
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_bank_reconciliation() from public, anon, authenticated, service_role;
create trigger guard_bank_reconciliation before insert or update or delete on public.company_data
for each row execute function public.guard_bank_reconciliation();

commit;
