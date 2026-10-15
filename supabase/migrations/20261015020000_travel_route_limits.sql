begin;

create table public.travel_route_requests (
  company_id uuid primary key references public.companies(id) on delete cascade,
  requested_at timestamptz not null
);
alter table public.travel_route_requests enable row level security;
revoke all on public.travel_route_requests from public, anon, authenticated;

create function public.reserve_travel_route()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_reserved uuid;
begin
  select company_id into v_company from public.company_memberships
    where user_id = auth.uid() and role in ('owner','admin');
  if v_company is null then
    raise exception using errcode = '42501', message = 'Somente a administração pode calcular rotas.';
  end if;
  insert into public.travel_route_requests(company_id,requested_at)
    values(v_company,clock_timestamp())
    on conflict(company_id) do update set requested_at = excluded.requested_at
      where travel_route_requests.requested_at <= clock_timestamp() - interval '10 seconds'
    returning company_id into v_reserved;
  if v_reserved is null then
    raise exception 'Aguarde 10 segundos entre os cálculos de rota da empresa.';
  end if;
end;
$$;
revoke all on function public.reserve_travel_route() from public, anon;
grant execute on function public.reserve_travel_route() to authenticated;
commit;
