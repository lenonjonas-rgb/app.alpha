begin;

create function public.guard_quote_approvals() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_quotes jsonb;
  v_old_quotes jsonb := '[]'::jsonb;
  v_old_quote jsonb;
  v_quote jsonb;
  v_entry record;
  v_approval jsonb;
  v_role text;
  v_name text;
begin
  if TG_OP = 'DELETE' then return old; end if;
  if TG_OP = 'UPDATE' then
    if old.payload->'quotes' is not distinct from new.payload->'quotes' then
      return new;
    end if;
    v_old_quotes := coalesce(old.payload->'quotes', '[]'::jsonb);
  end if;
  v_quotes := coalesce(new.payload->'quotes', '[]'::jsonb);

  for v_old_quote in select value from jsonb_array_elements(v_old_quotes) loop
    if v_old_quote->>'status' <> 'Aprovado' then continue; end if;
    select value into v_quote
      from jsonb_array_elements(v_quotes)
      where value->>'id' = v_old_quote->>'id';
    if v_quote is null then
      raise exception 'Orçamento aprovado não pode ser excluído.';
    end if;
    if jsonb_set(v_old_quote - 'orderId', '{equipmentModels}',
        coalesce(v_old_quote->'equipmentModels', '[]'::jsonb), true)
      is distinct from jsonb_set(v_quote - 'orderId', '{equipmentModels}',
        coalesce(v_quote->'equipmentModels', '[]'::jsonb), true) then
      raise exception 'Os termos de um orçamento aprovado são imutáveis.';
    end if;
  end loop;

  for v_entry in
    select value, ordinality
    from jsonb_array_elements(v_quotes) with ordinality
  loop
    v_quote := v_entry.value;
    if v_quote->>'status' <> 'Aprovado' then continue; end if;
    select value into v_old_quote
      from jsonb_array_elements(v_old_quotes)
      where value->>'id' = v_quote->>'id';
    if v_old_quote->>'status' = 'Aprovado' then continue; end if;

    v_approval := v_quote->'approval';
    if jsonb_typeof(v_approval) is distinct from 'object'
      or jsonb_typeof(v_approval->'approverUserId') is distinct from 'string'
      or v_actor is null
      or v_approval->>'approverUserId' is distinct from v_actor::text
      or v_approval->'snapshot' is distinct from jsonb_build_object(
        'code', v_quote->'code',
        'clientId', v_quote->'clientId',
        'date', v_quote->'date',
        'expires', v_quote->'expires',
        'items', v_quote->'items',
        'discount', v_quote->'discount',
        'notes', v_quote->'notes',
        'equipmentModels', coalesce(v_quote->'equipmentModels', '[]'::jsonb)
      ) then
      raise exception using errcode = '42501',
        message = 'A aprovação do orçamento exige usuário autenticado e snapshot comercial correspondente.';
    end if;

    select membership.role, membership.display_name
      into v_role, v_name
      from public.company_memberships membership
      where membership.company_id = new.company_id
        and membership.user_id = v_actor;
    if coalesce(v_role, '') not in ('owner', 'admin') then
      raise exception using errcode = '42501',
        message = 'Aprovar orçamento exige acesso de proprietário ou administrador.';
    end if;

    v_approval := v_approval || jsonb_build_object(
      'at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'approverUserId', v_actor::text,
      'approverName', coalesce(nullif(btrim(v_name), ''), v_actor::text)
    );
    v_quotes := jsonb_set(
      v_quotes,
      array[(v_entry.ordinality - 1)::text, 'approval'],
      v_approval,
      false
    );
  end loop;

  new.payload := jsonb_set(new.payload, '{quotes}', v_quotes, false);
  return new;
end;
$$;

revoke all on function public.guard_quote_approvals()
  from public, anon, authenticated, service_role;
create trigger guard_quote_approvals before update on public.company_data
  for each row when (old.payload->'quotes' is distinct from new.payload->'quotes')
  execute function public.guard_quote_approvals();
create trigger guard_quote_approvals_insert_delete before insert or delete
  on public.company_data
  for each row execute function public.guard_quote_approvals();

commit;
