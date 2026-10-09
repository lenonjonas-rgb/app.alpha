begin;

create or replace function public.link_company_technician(p_email text, p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_user uuid;
  v_linked_user uuid;
  v_existing_company uuid;
  v_existing_role text;
begin
  select company_id into v_company from public.company_memberships
    where user_id = auth.uid() and role in ('owner', 'admin');
  if v_company is null then
    raise exception using errcode = '42501', message = 'Acesso de administrador necessário.';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then
    raise exception 'Informe o nome do técnico (até 100 caracteres).';
  end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'Crie primeiro esta conta no painel Supabase Auth.';
  end if;
  select company_id, role into v_existing_company, v_existing_role
    from public.company_memberships where user_id = v_user;
  if v_existing_company is not null and v_existing_company <> v_company then
    raise exception 'Esta conta pertence a outra empresa.';
  end if;
  if v_existing_role = 'manager' then
    raise exception 'Esta conta tem perfil de gestor. Ajuste o perfil antes de vinculá-la como técnico.';
  end if;
  insert into public.company_memberships (user_id, company_id, role, display_name)
    values (v_user, v_company, 'technician', btrim(p_name))
    on conflict (user_id) do update set display_name = excluded.display_name
    where public.company_memberships.company_id = v_company
      and public.company_memberships.role in ('owner','admin','technician')
    returning user_id into v_linked_user;
  if v_linked_user is null then
    raise exception 'O vínculo da conta mudou. Atualize a equipe antes de tentar novamente.';
  end if;
  return v_linked_user;
end;
$$;

commit;
