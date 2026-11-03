begin;

create function public.guard_cash_sessions() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_sessions jsonb; v_old_sessions jsonb; v_session jsonb; v_old jsonb; v_close jsonb; v_move jsonb;
  v_entry jsonb; v_settlement jsonb; v_transfer jsonb; v_value bigint; v_sum bigint; v_closing boolean;
begin
  if TG_OP = 'DELETE' then
    if jsonb_array_length(coalesce(old.payload #> '{finance,cashSessions}','[]')) > 0 then
      raise exception 'O historico de caixas nao pode ser excluido.';
    end if;
    return old;
  end if;
  if TG_OP = 'UPDATE' and new.payload->'finance' is not distinct from old.payload->'finance' then return new; end if;
  v_sessions := coalesce(new.payload #> '{finance,cashSessions}','[]');
  v_old_sessions := case when TG_OP = 'UPDATE' then coalesce(old.payload #> '{finance,cashSessions}','[]') else '[]'::jsonb end;
  if jsonb_typeof(v_sessions) is distinct from 'array' or jsonb_array_length(v_sessions) > 10000
    or exists(select 1 from jsonb_array_elements(v_sessions) s group by s->>'id' having count(*) > 1)
    or exists(select 1 from jsonb_array_elements(v_sessions) s where not (s ? 'closure') group by s->>'accountId' having count(*) > 1) then
    raise exception 'Caixas invalidos, duplicados ou com mais de uma sessao aberta por conta.';
  end if;
  for v_old in select value from jsonb_array_elements(v_old_sessions) loop
    select s into v_session from jsonb_array_elements(v_sessions) s where s->>'id'=v_old->>'id';
    if v_session is null or (v_session-'closure') is distinct from (v_old-'closure')
      or (v_old ? 'closure' and v_session->'closure' is distinct from v_old->'closure') then
      raise exception 'Aberturas e fechamentos de caixa nao podem ser removidos ou reescritos.';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(v_sessions) s,
      jsonb_array_elements(coalesce(s #> '{closure,movements}','[]')) m
    group by m->>'source',m->>'entryId',m->>'settlementId',m->>'transferId',m->>'leg' having count(*) > 1
  ) then raise exception 'Movimentacao ja vinculada a um fechamento de caixa.'; end if;

  for v_session in select value from jsonb_array_elements(v_sessions) loop
    if jsonb_typeof(v_session) is distinct from 'object'
      or v_session - array['id','accountId','store','openedAt','openedOn','openingAmount','closure'] <> '{}'::jsonb
      or jsonb_typeof(v_session->'id') is distinct from 'string' or length(btrim(v_session->>'id')) not between 1 and 200
      or jsonb_typeof(v_session->'accountId') is distinct from 'string'
      or jsonb_typeof(v_session->'store') is distinct from 'string' or length(btrim(v_session->>'store')) not between 1 and 160
      or coalesce(v_session->>'openedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      or coalesce(v_session->>'openedOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(v_session->'openingAmount') is distinct from 'number'
      or coalesce(v_session->>'openingAmount','') !~ '^[0-9]+$'
      or (v_session->>'openingAmount')::numeric not between 0 and 100000000
      or not exists(select 1 from jsonb_array_elements(coalesce(new.payload #> '{finance,accounts}','[]')) a
        where a->>'id'=v_session->>'accountId' and a->>'kind'='Caixa') then
      raise exception 'Dados de abertura de caixa invalidos.';
    end if;
    perform (v_session->>'openedAt')::timestamptz;
    perform (v_session->>'openedOn')::date;
    select s into v_old from jsonb_array_elements(v_old_sessions) s where s->>'id'=v_session->>'id';
    if v_old is null then
      if v_session ? 'closure' or not exists(select 1 from jsonb_array_elements(new.payload #> '{finance,accounts}') a
        where a->>'id'=v_session->>'accountId' and a->'active'='true'::jsonb) then
        raise exception 'Nova abertura exige conta Caixa ativa e nao pode iniciar fechada.';
      end if;
      continue;
    end if;
    v_closing := not (v_old ? 'closure') and (v_session ? 'closure');
    if not v_closing then continue; end if;
    v_close := v_session->'closure';
    if jsonb_typeof(v_close) is distinct from 'object'
      or v_close - array['at','date','counted','expected','difference','movements'] <> '{}'::jsonb
      or coalesce(v_close->>'at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      or coalesce(v_close->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (v_close->>'at')::timestamptz < (v_session->>'openedAt')::timestamptz
      or (v_close->>'date')::date < (v_session->>'openedOn')::date
      or jsonb_typeof(v_close->'counted') is distinct from 'number' or coalesce(v_close->>'counted','') !~ '^[0-9]+$'
      or (v_close->>'counted')::numeric not between 0 and 100000000
      or jsonb_typeof(v_close->'expected') is distinct from 'number' or coalesce(v_close->>'expected','') !~ '^-?[0-9]+$'
      or jsonb_typeof(v_close->'difference') is distinct from 'number' or coalesce(v_close->>'difference','') !~ '^-?[0-9]+$'
      or jsonb_typeof(v_close->'movements') is distinct from 'array' or jsonb_array_length(v_close->'movements') > 10000 then
      raise exception 'Dados de fechamento de caixa invalidos.';
    end if;
    v_sum := (v_session->>'openingAmount')::bigint;
    for v_move in select value from jsonb_array_elements(v_close->'movements') loop
      if jsonb_typeof(v_move) is distinct from 'object'
        or coalesce(v_move->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or (v_move->>'date')::date < (v_session->>'openedOn')::date or (v_move->>'date')::date > (v_close->>'date')::date
        or jsonb_typeof(v_move->'amount') is distinct from 'number' or coalesce(v_move->>'amount','') !~ '^-?[0-9]+$'
        or (v_move->>'amount')::numeric not between -100000000 and 100000000 or (v_move->>'amount')::numeric = 0 then
        raise exception 'Movimentacao do fechamento invalida.';
      end if;
      if v_move->>'source' = 'settlement' then
        if v_move - array['source','entryId','settlementId','date','amount'] <> '{}'::jsonb
          or jsonb_typeof(v_move->'entryId') is distinct from 'string' or jsonb_typeof(v_move->'settlementId') is distinct from 'string' then
          raise exception 'Vinculo de baixa invalido.';
        end if;
        select e into v_entry from jsonb_array_elements(coalesce(new.payload #> '{finance,entries}','[]')) e where e->>'id'=v_move->>'entryId';
        select s into v_settlement from jsonb_array_elements(coalesce(v_entry->'settlements','[]')) s where s->>'id'=v_move->>'settlementId';
        if v_entry is null or v_settlement is null or coalesce((v_entry->>'canceled')::boolean,false)
          or coalesce((v_settlement->>'reversed')::boolean,false)
          or v_settlement->>'accountId' is distinct from v_session->>'accountId'
          or v_settlement->>'date' is distinct from v_move->>'date' then
          raise exception 'Baixa nao esta ativa ou nao pertence a esta conta e data.';
        end if;
        v_value := (v_settlement->>'amount')::bigint + coalesce((v_settlement #>> '{adjustment,interest}')::bigint,0)
          + coalesce((v_settlement #>> '{adjustment,fine}')::bigint,0) - coalesce((v_settlement #>> '{adjustment,discount}')::bigint,0);
        if v_entry->>'kind' = 'Pagar' then v_value := -v_value; end if;
      elsif v_move->>'source' = 'transfer' then
        if v_move - array['source','transferId','leg','date','amount'] <> '{}'::jsonb
          or jsonb_typeof(v_move->'transferId') is distinct from 'string' or coalesce(v_move->>'leg','') not in ('incoming','outgoing') then
          raise exception 'Vinculo de transferencia invalido.';
        end if;
        select t into v_transfer from jsonb_array_elements(coalesce(new.payload #> '{finance,transfers}','[]')) t where t->>'id'=v_move->>'transferId';
        if v_transfer is null or v_transfer ? 'reversal' or v_transfer->>'date' is distinct from v_move->>'date'
          or (case when v_move->>'leg'='incoming' then v_transfer->>'toAccountId' else v_transfer->>'fromAccountId' end)
            is distinct from v_session->>'accountId' then
          raise exception 'Transferencia nao esta ativa ou nao pertence a esta conta e data.';
        end if;
        v_value := (v_transfer->>'amount')::bigint;
        if v_move->>'leg'='outgoing' then v_value := -v_value; end if;
      else raise exception 'Origem da movimentacao de caixa invalida.';
      end if;
      if v_value <> (v_move->>'amount')::bigint then raise exception 'Valor da movimentacao diverge da origem.'; end if;
      v_sum := v_sum + v_value;
    end loop;
    if (v_close->>'expected')::numeric <> v_sum or (v_close->>'difference')::numeric <> (v_close->>'counted')::bigint-v_sum then
      raise exception 'Total ou diferenca do fechamento de caixa invalidos.';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_cash_sessions() from public, anon, authenticated, service_role;
create trigger guard_cash_sessions before insert or update or delete on public.company_data
for each row execute function public.guard_cash_sessions();

commit;
