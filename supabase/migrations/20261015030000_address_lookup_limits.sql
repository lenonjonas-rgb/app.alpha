begin;

create table public.address_lookup_requests (
  company_id uuid primary key references public.companies(id) on delete cascade,
  window_started_at timestamptz not null,
  requests integer not null check (requests between 1 and 30)
);
alter table public.address_lookup_requests enable row level security;
revoke all on public.address_lookup_requests from public, anon, authenticated;

create function public.reserve_address_lookup()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_reserved uuid;
begin
  select company_id into v_company from public.company_memberships
    where user_id = auth.uid() and role in ('owner','admin');
  if v_company is null then
    raise exception using errcode = '42501', message = 'Somente a administração pode localizar endereços.';
  end if;
  insert into public.address_lookup_requests(company_id,window_started_at,requests)
    values(v_company,clock_timestamp(),1)
    on conflict(company_id) do update set
      requests = case when address_lookup_requests.window_started_at <= clock_timestamp() - interval '1 minute'
        then 1 else address_lookup_requests.requests + 1 end,
      window_started_at = case when address_lookup_requests.window_started_at <= clock_timestamp() - interval '1 minute'
        then clock_timestamp() else address_lookup_requests.window_started_at end
    where address_lookup_requests.window_started_at <= clock_timestamp() - interval '1 minute'
      or address_lookup_requests.requests < 30
    returning company_id into v_reserved;
  if v_reserved is null then
    raise exception 'Limite de 30 consultas de endereço por minuto por empresa. Aguarde um minuto.';
  end if;
end;
$$;
revoke all on function public.reserve_address_lookup() from public, anon;
grant execute on function public.reserve_address_lookup() to authenticated;
commit;
