begin;

create table public.finance_change_permits (
  company_id uuid not null references public.companies(id) on delete restrict,
  entry_id text not null,
  before_entry jsonb not null,
  after_entry jsonb not null,
  before_invoice jsonb,
  after_invoice jsonb,
  actor uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (company_id, entry_id)
);
alter table public.finance_change_permits enable row level security;
revoke all on public.finance_change_permits from public, anon, authenticated, service_role;

create function public.approve_finance_change(
  p_company uuid, p_actor uuid, p_entry jsonb, p_invoice jsonb,
  p_action text, p_retention jsonb default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_payload jsonb; v_entry jsonb; v_invoice jsonb; v_after jsonb; v_after_invoice jsonb;
begin
  if not exists (select 1 from public.company_memberships
    where company_id = p_company and user_id = p_actor and role in ('owner','admin')) then
    raise exception using errcode = '42501', message = 'Administrador nao pertence a empresa da autorizacao financeira.';
  end if;
  select payload into v_payload from public.company_data where company_id = p_company for update;
  select e into v_entry from jsonb_array_elements(v_payload #> '{finance,entries}') e where e->>'id' = p_entry->>'id';
  if v_entry is null or not v_entry @> p_entry or coalesce((v_entry->>'canceled')::boolean,false)
    or p_entry->>'id' is null then
    raise exception 'Conta alterada ou indisponivel. Sincronize antes de confirmar.';
  end if;
  if v_entry ? 'invoiceId' then
    select i into v_invoice from jsonb_array_elements(v_payload #> '{finance,invoices}') i
      where i->>'id' = v_entry->>'invoiceId';
    if v_invoice is null or p_invoice is null or not v_invoice @> p_invoice
      or coalesce((v_invoice->>'canceled')::boolean,false) then
      raise exception 'Faturamento alterado ou indisponivel.';
    end if;
  elsif p_invoice is not null then raise exception 'Conta sem faturamento nao aceita autorizacao de outro grupo.';
  end if;
  -- O backend envia a projecao completa conhecida, incluindo baixas e retencao.
  if coalesce(v_entry->'retention','null'::jsonb) is distinct from coalesce(p_entry->'retention','null'::jsonb)
    or jsonb_array_length(v_entry->'settlements') <> jsonb_array_length(p_entry->'settlements') then
    raise exception 'Retencoes ou baixas alteradas durante a autorizacao.';
  end if;
  if exists (select 1 from jsonb_array_elements(v_entry->'settlements') s
    where not coalesce((s->>'reversed')::boolean,false)) then
    raise exception 'Estorne as baixas ativas antes de cancelar ou alterar retencoes.';
  end if;
  v_after := v_entry;
  v_after_invoice := v_invoice;
  if p_action = 'cancel' then
    v_after := jsonb_set(v_entry,'{canceled}','true');
    if v_invoice is not null then v_after_invoice := jsonb_set(v_invoice,'{canceled}','true'); end if;
  elsif p_action = 'retention' then
    if v_invoice->>'kind' is distinct from 'Serviços' or v_entry->>'kind' <> 'Receber' then
      raise exception 'Retencao exige conta a receber de servicos.';
    end if;
    if p_retention is null or p_retention = 'null'::jsonb then
      v_after := v_entry - 'retention';
    else
      if jsonb_typeof(p_retention) <> 'object'
        or not p_retention ?& array['calculationId','invoiceAmount','withheld','net','irrf','inss','csll','confirmedAt','confirmedBy']
        or coalesce(p_retention->>'calculationId','') !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(p_retention->'calculationId') is distinct from 'string'
        or jsonb_typeof(p_retention->'confirmedBy') is distinct from 'string'
        or coalesce(p_retention->>'confirmedBy','') = ''
        or jsonb_typeof(p_retention->'confirmedAt') is distinct from 'string'
        or coalesce(p_retention->>'confirmedAt','') = ''
        or exists (select 1 from jsonb_each(p_retention) e
          where e.key = any(array['invoiceAmount','withheld','net','irrf','inss','csll'])
          and (jsonb_typeof(e.value) <> 'number' or e.value::text !~ '^[0-9]+$'))
        or (p_retention->>'invoiceAmount')::numeric <> (v_entry->>'amount')::numeric
        or (p_retention->>'withheld')::numeric <= 0
        or (p_retention->>'net')::numeric <= 0
        or (p_retention->>'net')::numeric + (p_retention->>'withheld')::numeric <> (v_entry->>'amount')::numeric
        or (p_retention->>'withheld')::numeric <> (p_retention->>'irrf')::numeric +
          (p_retention->>'inss')::numeric + (p_retention->>'csll')::numeric then
        raise exception 'Retencao autorizada inconsistente.';
      end if;
      v_after := jsonb_set(v_entry,'{retention}',p_retention);
    end if;
  else raise exception 'Acao financeira nao suportada.';
  end if;
  insert into public.finance_change_permits(company_id,entry_id,before_entry,after_entry,before_invoice,after_invoice,actor)
    values(p_company,v_entry->>'id',v_entry,v_after,v_invoice,v_after_invoice,p_actor)
    on conflict(company_id,entry_id) do update set before_entry=excluded.before_entry,after_entry=excluded.after_entry,
      before_invoice=excluded.before_invoice,after_invoice=excluded.after_invoice,actor=excluded.actor,created_at=now();
end;
$$;
revoke all on function public.approve_finance_change(uuid,uuid,jsonb,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.approve_finance_change(uuid,uuid,jsonb,jsonb,text,jsonb) to service_role;

create function public.guard_finance_history() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb; v_new jsonb; v_invoice jsonb; v_old_invoice jsonb; v_s jsonb; v_ns jsonb;
  v_permit public.finance_change_permits; v_finance jsonb; v_paid numeric;
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
      where e ? 'retention' or coalesce((e->>'canceled')::boolean,false))
      or exists (select 1 from jsonb_array_elements(coalesce(v_finance->'invoices','[]')) i
        where coalesce((i->>'canceled')::boolean,false)) then
      raise exception 'Nova empresa nao pode importar cancelamentos ou retencoes autorizados em outra base.';
    end if;
  end if;
  for v_old in select e from jsonb_array_elements(coalesce(old.payload #> '{finance,entries}','[]')) e loop
    select e into v_new from jsonb_array_elements(coalesce(v_finance->'entries','[]')) e where e->>'id'=v_old->>'id';
    if v_new is null then raise exception 'Historico financeiro nao pode ser removido por gravacao ou restauracao.'; end if;
    if (v_old - 'settlements' - 'canceled' - 'retention') is distinct from (v_new - 'settlements' - 'canceled' - 'retention') then
      raise exception 'Dados originais da conta sao imutaveis. Preserve o historico e use o fluxo de cancelamento.';
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
        -- Consumido somente na mesma transacao que grava a versao aprovada.
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
      and (v_new ? 'retention' or coalesce((v_new->>'canceled')::boolean,false) or jsonb_array_length(v_new->'settlements')>0) then
      raise exception 'Nova conta deve iniciar aberta sem baixas ou retencoes. Importe saldos pela operacao apropriada.';
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
          or (s->>'amount')::numeric <= 0 or (s->>'amount')::numeric <> trunc((s->>'amount')::numeric)) then
      raise exception 'Baixas invalidas ou duplicadas.';
    end if;
    select coalesce(sum((s->>'amount')::numeric),0) into v_paid from jsonb_array_elements(v_new->'settlements') s
      where not coalesce((s->>'reversed')::boolean,false);
    if v_paid > (v_new->>'amount')::numeric - coalesce((v_new #>> '{retention,withheld}')::numeric,0)
      or (coalesce((v_new->>'canceled')::boolean,false) and v_paid>0) then raise exception 'Baixas excedem o saldo liquido ou conta cancelada.'; end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_finance_history() from public, anon, authenticated;
create trigger guard_finance_history before insert or update or delete on public.company_data
for each row execute function public.guard_finance_history();

commit;
