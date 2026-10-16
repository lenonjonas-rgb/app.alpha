begin;

create function public.guard_bank_transfer_matches() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_matches jsonb; v_old jsonb; v_new jsonb; v_transaction jsonb; v_transfer jsonb; v_entry jsonb; v_settlement jsonb;
  v_active_transactions text[] := '{}'; v_active_legs text[] := '{}'; v_key text; v_is_new boolean;
begin
  if TG_OP='DELETE' then
    if jsonb_array_length(coalesce(old.payload #> '{finance,banking,transferMatches}','[]'))>0 then
      raise exception 'Historico de vinculos de transferencia nao pode ser excluido.';
    end if;
    return old;
  end if;
  if TG_OP='UPDATE' and new.payload->'finance' is not distinct from old.payload->'finance' then return new; end if;
  v_matches := coalesce(new.payload #> '{finance,banking,transferMatches}','[]');
  if jsonb_typeof(v_matches) is distinct from 'array' or jsonb_array_length(v_matches)>20000 then
    raise exception 'Estrutura ou limite de vinculos de transferencia invalido.';
  end if;
  if exists(select 1 from jsonb_array_elements(v_matches) m group by m->>'id' having count(*)>1) then
    raise exception 'Identificadores de vinculos de transferencia duplicados.';
  end if;
  if TG_OP='UPDATE' then
    for v_old in select m from jsonb_array_elements(coalesce(old.payload #> '{finance,banking,transferMatches}','[]')) m loop
      select m into v_new from jsonb_array_elements(v_matches) m where m->>'id'=v_old->>'id';
      if v_new is null or (v_new-'reversed') is distinct from (v_old-'reversed')
        or ((v_old->>'reversed')::boolean and not coalesce((v_new->>'reversed')::boolean,false)) then
        raise exception 'Vinculos de transferencia nao podem ser removidos/reescritos nem reativados apos desfazimento.';
      end if;
    end loop;
  end if;
  for v_new in select m from jsonb_array_elements(coalesce(new.payload #> '{finance,banking,matches}','[]')) m loop
    select e into v_entry from jsonb_array_elements(coalesce(new.payload #> '{finance,entries}','[]')) e where e->>'id'=v_new->>'entryId';
    select s into v_settlement from jsonb_array_elements(coalesce(v_entry->'settlements','[]')) s where s->>'id'=v_new->>'settlementId';
    if not coalesce((v_new->>'reversed')::boolean,false) and v_entry is not null and v_settlement is not null
      and not coalesce((v_entry->>'canceled')::boolean,false) and not coalesce((v_settlement->>'reversed')::boolean,false) then
      v_active_transactions := array_append(v_active_transactions,v_new->>'transactionId');
    end if;
  end loop;
  for v_new in select m from jsonb_array_elements(v_matches) m loop
    select t into v_transaction from jsonb_array_elements(coalesce(new.payload #> '{finance,banking,transactions}','[]')) t
      where t->>'id'=v_new->>'transactionId';
    select t into v_transfer from jsonb_array_elements(coalesce(new.payload #> '{finance,transfers}','[]')) t
      where t->>'id'=v_new->>'transferId';
    if jsonb_typeof(v_new) is distinct from 'object' or jsonb_typeof(v_new->'id') is distinct from 'string'
      or jsonb_typeof(v_new->'transactionId') is distinct from 'string'
      or jsonb_typeof(v_new->'transferId') is distinct from 'string'
      or jsonb_typeof(v_new->'createdAt') is distinct from 'string'
      or nullif(btrim(v_new->>'id'),'') is null
      or length(v_new->>'id')>200 or jsonb_typeof(v_new->'reversed') is distinct from 'boolean'
      or coalesce(v_new->>'leg','') not in ('outgoing','incoming')
      or coalesce(v_new->>'createdAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      or v_transaction is null or v_transfer is null
      or v_transaction->>'date' is distinct from v_transfer->>'date'
      or v_transaction->>'accountId' is distinct from
        (case when v_new->>'leg'='outgoing' then v_transfer->>'fromAccountId' else v_transfer->>'toAccountId' end)
      or (v_transaction->>'amount')::numeric is distinct from
        (case when v_new->>'leg'='outgoing' then -(v_transfer->>'amount')::numeric else (v_transfer->>'amount')::numeric end) then
      raise exception 'Vinculo de transferencia incompativel com conta/data/sinal/valor do extrato.';
    end if;
    perform (v_new->>'createdAt')::timestamptz;
    v_is_new := TG_OP='INSERT' or not exists(
      select 1 from jsonb_array_elements(coalesce(old.payload #> '{finance,banking,transferMatches}','[]')) m where m->>'id'=v_new->>'id');
    if v_is_new and ((v_new->>'reversed')::boolean or v_transfer ? 'reversal') then
      raise exception 'Novo vinculo exige transferencia ativa e nao pode iniciar desfeito.';
    end if;
    if not (v_new->>'reversed')::boolean and not (v_transfer ? 'reversal') then
      v_key := jsonb_build_array(v_new->>'transferId',v_new->>'leg')::text;
      if v_new->>'transactionId'=any(v_active_transactions) or v_key=any(v_active_legs) then
        raise exception 'Movimento ou ponta de transferencia ja conciliado.';
      end if;
      v_active_transactions := array_append(v_active_transactions,v_new->>'transactionId');
      v_active_legs := array_append(v_active_legs,v_key);
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_bank_transfer_matches() from public, anon, authenticated, service_role;
create trigger guard_bank_transfer_matches before insert or update or delete on public.company_data
for each row execute function public.guard_bank_transfer_matches();

commit;
