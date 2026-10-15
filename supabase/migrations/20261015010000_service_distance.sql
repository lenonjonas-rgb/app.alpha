begin;

alter function public.mobile_update_order(text,text,jsonb,bigint)
  rename to mobile_update_order_without_service_distance;
revoke all on function public.mobile_update_order_without_service_distance(text,text,jsonb,bigint)
  from public, anon, authenticated;

create function public.mobile_update_order(
  p_order_id text, p_action text, p_data jsonb, p_expected_revision bigint
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_company uuid;
  v_payload jsonb;
  v_order jsonb;
  v_index int;
  v_address text;
  v_client_address text;
  v_service jsonb;
  v_point jsonb;
  v_activity jsonb;
  v_location jsonb;
  v_haversine double precision;
  v_meters bigint;
begin
  -- The existing RPC validates authorization, assignment, GPS and checkout rules,
  -- and holds the company row lock until this transaction completes.
  v_result := public.mobile_update_order_without_service_distance(
    p_order_id, p_action, p_data, p_expected_revision
  );
  if p_action not in ('Check-in','Check-out') then return v_result; end if;

  select company_id into v_company from public.company_memberships where user_id = auth.uid();
  select payload into v_payload from public.company_data where company_id = v_company;
  select value, ordinality - 1 into v_order, v_index
    from jsonb_array_elements(v_payload->'orders') with ordinality
    where value->>'id' = p_order_id;
  v_point := v_order#>'{details,servicePoint}';
  if v_point is null or v_point = 'null'::jsonb then return v_result; end if;
  if jsonb_typeof(v_point) is distinct from 'object'
    or jsonb_typeof(v_point->'latitude') is distinct from 'number'
    or jsonb_typeof(v_point->'longitude') is distinct from 'number'
    or jsonb_typeof(v_point->'address') is distinct from 'string' then
    raise exception 'Ponto de atendimento inválido. Solicite a confirmação pelo administrador.';
  end if;
  if (v_point->>'latitude')::numeric not between -90 and 90
    or (v_point->>'longitude')::numeric not between -180 and 180 then
    raise exception 'Coordenadas do atendimento inválidas.';
  end if;
  select value->>'address' into v_client_address
    from jsonb_array_elements(v_payload->'clients')
    where value->>'id' = v_order->>'clientId';
  v_service := v_order#>'{details,serviceLocation}';
  if v_service is null or v_service = 'null'::jsonb
    or coalesce((v_service->>'useClientAddress')::boolean,true) then
    v_address := coalesce(v_client_address,'');
  else
    v_address := concat_ws(' · ',
      nullif(concat_ws(', ', nullif(v_service->>'street',''), nullif(v_service->>'number','')),''),
      nullif(v_service->>'complement',''), nullif(v_service->>'neighborhood',''),
      nullif(concat_ws(' - ', nullif(v_service->>'city',''), nullif(v_service->>'state','')),''),
      'CEP ' || (v_service->>'postalCode'));
  end if;
  -- A changed address requires a newly confirmed point. Never recompute old events.
  if btrim(v_address) = '' or v_point->>'address' is distinct from v_address then return v_result; end if;
  v_activity := v_order#>'{details,activities,-1}';
  v_location := v_activity->'location';
  v_haversine :=
    power(sin(radians(((v_point->>'latitude')::double precision - (v_location->>'latitude')::double precision) / 2)),2) +
    cos(radians((v_location->>'latitude')::double precision)) *
    cos(radians((v_point->>'latitude')::double precision)) *
    power(sin(radians(((v_point->>'longitude')::double precision - (v_location->>'longitude')::double precision) / 2)),2);
  v_meters := round((6371000 * 2 * asin(sqrt(least(1::double precision,greatest(0::double precision,v_haversine)))))::numeric)::bigint;
  v_activity := v_activity || jsonb_build_object('serviceDistance',jsonb_build_object(
    'latitude',v_point->'latitude','longitude',v_point->'longitude',
    'address',v_address,'meters',v_meters));
  v_payload := jsonb_set(v_payload,array['orders',v_index::text,'details','activities',
    (jsonb_array_length(v_order#>'{details,activities}') - 1)::text],v_activity);
  if octet_length(v_payload::text) > 5000000 then
    raise exception 'Limite total de 5 MB da empresa excedido.';
  end if;
  update public.company_data set payload = v_payload where company_id = v_company;
  return public.mobile_company_data();
end;
$$;

revoke all on function public.mobile_update_order(text,text,jsonb,bigint) from public, anon;
grant execute on function public.mobile_update_order(text,text,jsonb,bigint) to authenticated;

commit;
