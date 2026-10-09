begin;

create table public.company_user_logins (
  request_id uuid primary key,
  username text not null unique check (username ~ '^[a-z][a-z0-9]{0,59}\.aupha$'),
  company_id uuid not null references public.companies(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  role text not null check (role in ('admin', 'technician')),
  user_id uuid unique references auth.users(id) on delete restrict,
  state text not null default 'reserved' check (state in ('reserved', 'complete', 'failed')),
  created_at timestamptz not null default now()
);
alter table public.company_user_logins enable row level security;
revoke all on public.company_user_logins from public, anon, authenticated;

create function public.reserve_company_user(
  p_master uuid, p_request_id uuid, p_base text, p_name text, p_role text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_login text;
  v_number integer := 1;
  v_existing public.company_user_logins;
begin
  select company_id into v_company from public.company_memberships
    where user_id = p_master and role = 'owner' for share;
  if v_company is null then
    raise exception using errcode = '42501', message = 'Somente o Master pode criar usuários.';
  end if;
  if p_request_id is null or p_base is null or p_base !~ '^[a-z][a-z0-9]{0,39}$'
    or p_name is null or char_length(btrim(p_name)) not between 1 and 100
    or p_role is null or p_role not in ('admin','technician') then
    raise exception 'Cadastro de usuário inválido.';
  end if;
  perform pg_advisory_xact_lock(734891201);
  select * into v_existing from public.company_user_logins where request_id = p_request_id;
  if found then
    if v_existing.requested_by <> p_master or v_existing.display_name <> btrim(p_name)
      or v_existing.role <> p_role then
      raise exception 'Identificador de cadastro já utilizado.';
    end if;
    if v_existing.state <> 'complete' then
      raise exception 'Cadastro anterior não confirmado. Atualize a lista antes de tentar novamente.';
    end if;
    return jsonb_build_object('username',v_existing.username,'userId',v_existing.user_id);
  end if;
  loop
    v_login := p_base || case when v_number = 1 then '' else v_number::text end || '.aupha';
    exit when not exists (select 1 from public.company_user_logins where username = v_login)
      and not exists (select 1 from auth.users where lower(email) = v_login || '@users.aupha.invalid');
    v_number := v_number + 1;
    if v_number > 10000 then raise exception 'Não foi possível reservar um login para este nome.'; end if;
  end loop;
  insert into public.company_user_logins(request_id,username,company_id,requested_by,display_name,role)
    values(p_request_id,v_login,v_company,p_master,btrim(p_name),p_role);
  return jsonb_build_object('username',v_login,'userId',null);
end;
$$;

create function public.complete_company_user(p_master uuid, p_request_id uuid, p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_login public.company_user_logins;
begin
  select * into v_login from public.company_user_logins
    where request_id = p_request_id and requested_by = p_master for update;
  if not found or v_login.state <> 'reserved' then raise exception 'Reserva de usuário indisponível.'; end if;
  if not exists (select 1 from public.company_memberships
    where user_id = p_master and company_id = v_login.company_id and role = 'owner') then
    raise exception using errcode = '42501', message = 'Somente o Master pode criar usuários.';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id
    and email = v_login.username || '@users.aupha.invalid') then
    raise exception 'Conta Auth não corresponde à reserva.';
  end if;
  insert into public.company_memberships(user_id,company_id,role,display_name)
    values(p_user_id,v_login.company_id,v_login.role,v_login.display_name);
  update public.company_user_logins set user_id = p_user_id, state = 'complete'
    where request_id = p_request_id;
  return jsonb_build_object('username',v_login.username,'userId',p_user_id);
end;
$$;

create function public.fail_company_user(p_master uuid, p_request_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.company_user_logins set state = 'failed'
    where request_id = p_request_id and requested_by = p_master and state = 'reserved';
end;
$$;

create function public.list_company_users()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_company uuid;
begin
  select company_id into v_company from public.company_memberships
    where user_id = auth.uid() and role = 'owner';
  if v_company is null then
    raise exception using errcode = '42501', message = 'Somente o Master pode gerenciar usuários.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'userId',m.user_id,'name',coalesce(nullif(m.display_name,''),u.email),
    'login',coalesce(l.username,u.email),'role',m.role
  ) order by m.role,m.display_name,u.email)
    from public.company_memberships m join auth.users u on u.id = m.user_id
    left join public.company_user_logins l on l.user_id = m.user_id and l.state = 'complete'
    where m.company_id = v_company),'[]'::jsonb);
end;
$$;

create function public.set_company_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_company uuid; v_member public.company_memberships;
begin
  select company_id into v_company from public.company_memberships
    where user_id = auth.uid() and role = 'owner' for share;
  if v_company is null then
    raise exception using errcode = '42501', message = 'Somente o Master pode alterar níveis.';
  end if;
  if p_role is null or p_role not in ('admin','technician') then raise exception 'Nível inválido.'; end if;
  select * into v_member from public.company_memberships
    where user_id = p_user_id and company_id = v_company for update;
  if not found then raise exception 'Usuário não pertence à empresa.'; end if;
  if v_member.role = 'owner' then raise exception 'A conta Master não pode ser alterada.'; end if;
  update public.company_memberships set role = p_role where user_id = p_user_id;
end;
$$;

alter function public.link_company_technician(text,text) rename to link_company_technician_internal;
revoke all on function public.link_company_technician_internal(text,text) from public, anon, authenticated;
create function public.link_company_technician(p_email text, p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.company_memberships where user_id = auth.uid() and role = 'owner') then
    raise exception using errcode = '42501', message = 'Somente o Master pode vincular contas.';
  end if;
  return public.link_company_technician_internal(p_email,p_name);
end;
$$;

revoke all on function public.reserve_company_user(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.complete_company_user(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.fail_company_user(uuid,uuid) from public, anon, authenticated;
grant execute on function public.reserve_company_user(uuid,uuid,text,text,text) to service_role;
grant execute on function public.complete_company_user(uuid,uuid,uuid) to service_role;
grant execute on function public.fail_company_user(uuid,uuid) to service_role;
revoke all on function public.list_company_users() from public, anon;
revoke all on function public.set_company_user_role(uuid,text) from public, anon;
revoke all on function public.link_company_technician(text,text) from public, anon;
grant execute on function public.list_company_users() to authenticated;
grant execute on function public.set_company_user_role(uuid,text) to authenticated;
grant execute on function public.link_company_technician(text,text) to authenticated;

commit;
