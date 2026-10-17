begin;

create function public.guard_bank_reconciliation_groups() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_groups jsonb; v_old_groups jsonb; v_group jsonb; v_old_group jsonb;
  v_transaction jsonb; v_entry jsonb; v_settlement jsonb; v_ref jsonb; v_match jsonb; v_transfer_match jsonb;
  v_transactions jsonb; v_settlements jsonb; v_tx_id text; v_entry_id text; v_settlement_id text;
  v_account_id text; v_kind text; v_key text; v_group_active boolean;
  v_amount numeric; v_total numeric; v_min_date date; v_max_date date;
  v_active_transactions text[] := '{}'; v_active_settlements text[] := '{}';
begin
  if TG_OP='DELETE' then
    if jsonb_array_length(coalesce(old.payload #> '{finance,banking,reconciliationGroups}','[]'))>0 then
      raise exception 'Historico de conciliacoes agrupadas nao pode ser excluido.';
    end if;
    return old;
  end if;
  if TG_OP='UPDATE' and new.payload->'finance' is not distinct from old.payload->'finance' then return new; end if;
  v_groups := coalesce(new.payload #> '{finance,banking,reconciliationGroups}','[]');
  if jsonb_typeof(v_groups) is distinct from 'array' or jsonb_array_length(v_groups)>10000
    or exists(select 1 from jsonb_array_elements(v_groups) group by value->>'id' having count(*)>1) then
    raise exception 'Estrutura, limite ou identificadores de conciliacao agrupada invalidos.';
  end if;
  v_transactions := coalesce(new.payload #> '{finance,banking,transactions}','[]');
  v_settlements := coalesce(new.payload #> '{finance,entries}','[]');
  if TG_OP='UPDATE' then
    v_old_groups := coalesce(old.payload #> '{finance,banking,reconciliationGroups}','[]');
    for v_old_group in select value from jsonb_array_elements(v_old_groups) loop
      select value into v_group from jsonb_array_elements(v_groups) where value->>'id'=v_old_group->>'id';
      if v_group is null or (v_group-'reversed') is distinct from (v_old_group-'reversed')
        or ((v_old_group->>'reversed')::boolean and not coalesce((v_group->>'reversed')::boolean,false)) then
        raise exception 'Historico de conciliacao agrupada nao pode ser removido, reescrito ou reativado.';
      end if;
    end loop;
  end if;
  for v_match in select value from jsonb_array_elements(coalesce(new.payload #> '{finance,banking,matches}','[]')) loop
    select value into v_transaction from jsonb_array_elements(v_transactions) where value->>'id'=v_match->>'transactionId';
    select value into v_entry from jsonb_array_elements(v_settlements) where value->>'id'=v_match->>'entryId';
    select value into v_settlement from jsonb_array_elements(coalesce(v_entry->'settlements','[]'))
      where value->>'id'=v_match->>'settlementId';
    if v_transaction is not null and v_entry is not null and v_settlement is not null
      and not coalesce((v_match->>'reversed')::boolean,false)
      and not coalesce((v_entry->>'canceled')::boolean,false)
      and not coalesce((v_settlement->>'reversed')::boolean,false) then
      v_active_transactions := array_append(v_active_transactions,v_match->>'transactionId');
      v_active_settlements := array_append(v_active_settlements,jsonb_build_array(v_match->>'entryId',v_match->>'settlementId')::text);
    end if;
  end loop;
  for v_transfer_match in select value from jsonb_array_elements(coalesce(new.payload #> '{finance,banking,transferMatches}','[]')) loop
    select value into v_transaction from jsonb_array_elements(v_transactions) where value->>'id'=v_transfer_match->>'transactionId';
    select value into v_group from jsonb_array_elements(coalesce(new.payload #> '{finance,transfers}','[]'))
      where value->>'id'=v_transfer_match->>'transferId';
    if v_transaction is not null and v_group is not null
      and not coalesce((v_transfer_match->>'reversed')::boolean,false) and not (v_group ? 'reversal') then
      v_active_transactions := array_append(v_active_transactions,v_transfer_match->>'transactionId');
    end if;
  end loop;
  for v_group in select value from jsonb_array_elements(v_groups) loop
    v_transactions := v_group->'transactionIds';
    v_settlements := v_group->'settlements';
    if jsonb_typeof(v_group) is distinct from 'object'
      or jsonb_typeof(v_group->'id') is distinct from 'string' or length(btrim(v_group->>'id')) not between 1 and 200
      or jsonb_typeof(v_group->'createdAt') is distinct from 'string'
      or coalesce(v_group->>'createdAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      or jsonb_typeof(v_group->'reversed') is distinct from 'boolean'
      or jsonb_typeof(v_transactions) is distinct from 'array'
      or jsonb_array_length(v_transactions) not between 1 and 200
      or jsonb_typeof(v_settlements) is distinct from 'array'
      or jsonb_array_length(v_settlements) not between 1 and 200
      or jsonb_array_length(v_transactions)+jsonb_array_length(v_settlements)<3
      or (select count(*) from jsonb_array_elements_text(v_transactions)) <>
         (select count(distinct value) from jsonb_array_elements_text(v_transactions))
      or (select count(*) from jsonb_array_elements(v_settlements)) <>
         (select count(distinct jsonb_build_array(value->>'entryId',value->>'settlementId')::text)
          from jsonb_array_elements(v_settlements)) then
      raise exception 'Grupo de conciliacao invalido ou sem divisao/agrupamento.';
    end if;
    perform (v_group->>'createdAt')::timestamptz;
    v_account_id := null; v_kind := null; v_total := 0; v_min_date := null; v_max_date := null;
    v_group_active := not (v_group->>'reversed')::boolean;
    for v_tx_id in select jsonb_array_elements_text(v_transactions) loop
      select value into v_transaction from jsonb_array_elements(coalesce(new.payload #> '{finance,banking,transactions}','[]'))
        where value->>'id'=v_tx_id;
      if v_transaction is null then raise exception 'Grupo referencia movimento de extrato inexistente.'; end if;
      if v_account_id is null then
        v_account_id := v_transaction->>'accountId';
        v_kind := case when (v_transaction->>'amount')::numeric>0 then 'Receber' else 'Pagar' end;
      elsif v_transaction->>'accountId' is distinct from v_account_id
        or (case when (v_transaction->>'amount')::numeric>0 then 'Receber' else 'Pagar' end) is distinct from v_kind then
        raise exception 'Grupo mistura bancos ou sentidos de movimento.';
      end if;
      v_total := v_total+abs((v_transaction->>'amount')::numeric);
      if v_min_date is null or (v_transaction->>'date')::date<v_min_date then v_min_date := (v_transaction->>'date')::date; end if;
      if v_max_date is null or (v_transaction->>'date')::date>v_max_date then v_max_date := (v_transaction->>'date')::date; end if;
    end loop;
    for v_ref in select value from jsonb_array_elements(v_settlements) loop
      v_settlement_id := v_ref->>'settlementId'; v_entry_id := v_ref->>'entryId';
      select value into v_entry from jsonb_array_elements(coalesce(new.payload #> '{finance,entries}','[]'))
        where value->>'id'=v_entry_id;
      select value into v_settlement from jsonb_array_elements(coalesce(v_entry->'settlements','[]'))
        where value->>'id'=v_settlement_id;
      if jsonb_typeof(v_entry) is distinct from 'object' or jsonb_typeof(v_settlement) is distinct from 'object'
        or v_entry->>'kind' is distinct from v_kind
        or v_settlement->>'accountId' is distinct from v_account_id
        or coalesce(v_settlement->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Grupo referencia baixa incompativel com banco ou sentido.';
      end if;
      v_amount := public.settlement_cash_amount(v_settlement);
      if v_amount<=0 then raise exception 'Baixa agrupada deve ter valor efetivo positivo.'; end if;
      v_total := v_total-v_amount;
      if v_min_date is null or (v_settlement->>'date')::date<v_min_date then v_min_date := (v_settlement->>'date')::date; end if;
      if v_max_date is null or (v_settlement->>'date')::date>v_max_date then v_max_date := (v_settlement->>'date')::date; end if;
      if coalesce((v_entry->>'canceled')::boolean,false) or coalesce((v_settlement->>'reversed')::boolean,false) then
        v_group_active := false;
      end if;
    end loop;
    if v_max_date-v_min_date>3 or v_total<>0 then
      raise exception 'Grupo de conciliacao excede tres dias ou possui total divergente.';
    end if;
    if v_group_active then
      for v_tx_id in select jsonb_array_elements_text(v_transactions) loop
        if v_tx_id=any(v_active_transactions) then raise exception 'Movimento ja conciliado.'; end if;
        v_active_transactions := array_append(v_active_transactions,v_tx_id);
      end loop;
      for v_ref in select value from jsonb_array_elements(v_settlements) loop
        v_settlement_id := v_ref->>'settlementId'; v_entry_id := v_ref->>'entryId';
        v_key := jsonb_build_array(v_entry_id,v_settlement_id)::text;
        if v_key=any(v_active_settlements) then raise exception 'Baixa ja conciliada.'; end if;
        v_active_settlements := array_append(v_active_settlements,v_key);
      end loop;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_bank_reconciliation_groups() from public, anon, authenticated, service_role;
create trigger guard_bank_reconciliation_groups before insert or update or delete on public.company_data
for each row execute function public.guard_bank_reconciliation_groups();

commit;
