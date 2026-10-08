create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.company_memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  role text not null default 'owner'
    check (role in ('owner', 'admin', 'manager', 'technician')),
  created_at timestamptz not null default now()
);

create index company_memberships_company_id_idx
  on public.company_memberships (company_id);

create table public.company_data (
  company_id uuid primary key references public.companies (id) on delete cascade,
  payload jsonb not null
    check (
      coalesce(
        jsonb_typeof(payload) = 'object'
        and payload ->> 'version' = '1'
        and jsonb_typeof(payload -> 'clients') = 'array'
        and jsonb_typeof(payload -> 'equipment') = 'array'
        and jsonb_typeof(payload -> 'products') = 'array'
        and jsonb_typeof(payload -> 'services') = 'array'
        and jsonb_typeof(payload -> 'orders') = 'array'
        and jsonb_typeof(payload -> 'quotes') = 'array'
        and jsonb_typeof(payload -> 'movements') = 'array'
        and jsonb_typeof(payload -> 'settings') = 'object'
        and octet_length(payload::text) <= 5000000,
        false
      )
    ),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

revoke all on table public.companies from public, anon, authenticated;
revoke all on table public.company_memberships from public, anon, authenticated;
revoke all on table public.company_data from public, anon, authenticated;

alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
alter table public.company_data enable row level security;

create policy "Users can read their own membership"
  on public.company_memberships
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Members can read company data"
  on public.company_data
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.company_memberships as membership
      where membership.company_id = company_data.company_id
        and membership.user_id = (select auth.uid())
        and membership.role in ('owner', 'admin')
    )
  );

grant select on public.company_memberships to authenticated;
grant select on public.company_data to authenticated;

create function public.create_company_for_current_user(
  p_company_name text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_company_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_company_name is null
    or char_length(btrim(p_company_name)) not between 1 and 100
  then
    raise exception using errcode = '22023', message = 'Company name is invalid.';
  end if;

  if p_payload is null
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload ->> 'version' is distinct from '1'
    or jsonb_typeof(p_payload -> 'clients') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'equipment') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'products') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'services') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'orders') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'quotes') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'movements') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'settings') is distinct from 'object'
    or p_payload #>> '{settings,company}' is distinct from btrim(p_company_name)
    or octet_length(p_payload::text) > 5000000
  then
    raise exception using errcode = '22023', message = 'Company data is invalid.';
  end if;

  if exists (
    select 1 from public.company_memberships as membership
    where membership.user_id = v_user_id
  ) then
    raise exception using errcode = '23505', message = 'This account already belongs to a company.';
  end if;

  insert into public.companies (name, created_by)
  values (btrim(p_company_name), v_user_id)
  returning id into v_company_id;

  insert into public.company_memberships (user_id, company_id, role)
  values (v_user_id, v_company_id, 'owner');

  insert into public.company_data (company_id, payload)
  values (v_company_id, p_payload);

  return v_company_id;
end;
$$;

create function public.save_company_data(
  p_payload jsonb,
  p_expected_revision bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_company_id uuid;
  v_revision bigint;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload ->> 'version' is distinct from '1'
    or jsonb_typeof(p_payload -> 'clients') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'equipment') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'products') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'services') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'orders') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'quotes') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'movements') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'settings') is distinct from 'object'
    or octet_length(p_payload::text) > 5000000
  then
    raise exception using errcode = '22023', message = 'Company data is invalid.';
  end if;

  select membership.company_id
  into v_company_id
  from public.company_memberships as membership
  where membership.user_id = v_user_id
    and membership.role in ('owner', 'admin')
  limit 1;

  if v_company_id is null then
    raise exception using errcode = '42501', message = 'Company administrator access required.';
  end if;

  update public.company_data
  set payload = p_payload,
      revision = revision + 1,
      updated_at = now()
  where company_id = v_company_id
    and revision = p_expected_revision
  returning revision into v_revision;

  if v_revision is null then
    raise exception using errcode = '40001', message = 'Company data changed in another session. Reload before saving.';
  end if;

  return v_revision;
end;
$$;

revoke all on function public.create_company_for_current_user(text, jsonb)
  from public, anon;
revoke all on function public.save_company_data(jsonb, bigint)
  from public, anon;
grant execute on function public.create_company_for_current_user(text, jsonb)
  to authenticated;
grant execute on function public.save_company_data(jsonb, bigint)
  to authenticated;
