begin;

alter table public.company_memberships
  add column display_name text not null default '';

create function public.list_company_technicians()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.company_memberships
    where user_id = auth.uid() and role in ('owner', 'admin');
  if v_company is null then
    raise exception using errcode = '42501', message = 'Acesso de administrador necessário.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId', m.user_id, 'email', u.email,
      'name', coalesce(nullif(m.display_name, ''), u.email)
    ) order by m.display_name, u.email)
    from public.company_memberships m join auth.users u on u.id = m.user_id
    where m.company_id = v_company and m.role in ('owner', 'admin', 'technician')
  ), '[]'::jsonb);
end;
$$;

create function public.link_company_technician(p_email text, p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_user uuid;
  v_existing_company uuid;
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
  select company_id into v_existing_company from public.company_memberships where user_id = v_user;
  if v_existing_company is not null and v_existing_company <> v_company then
    raise exception 'Esta conta pertence a outra empresa.';
  end if;
  insert into public.company_memberships (user_id, company_id, role, display_name)
    values (v_user, v_company, 'technician', btrim(p_name))
    on conflict (user_id) do update set display_name = excluded.display_name
    where public.company_memberships.company_id = v_company;
  return v_user;
end;
$$;

create function public.validate_technician_assignment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_order jsonb;
begin
  for v_order in select value from jsonb_array_elements(new.payload->'orders') loop
    if coalesce(v_order->>'technicianUserId', '') <> '' and not exists (
      select 1 from public.company_memberships m
      where m.company_id = new.company_id
        and m.user_id::text = v_order->>'technicianUserId'
        and m.role in ('owner','admin','technician')
    ) then
      raise exception 'Conta do técnico não vinculada à empresa.';
    end if;
  end loop;
  return new;
end;
$$;
create trigger validate_technician_assignment
before insert or update of payload on public.company_data
for each row execute function public.validate_technician_assignment();

create function public.mobile_company_data()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.company_memberships;
  v_data public.company_data;
  v_orders jsonb;
  v_clients jsonb;
  v_equipment jsonb;
  v_quotes jsonb;
  v_products jsonb;
  v_services jsonb;
begin
  select * into v_member from public.company_memberships where user_id = auth.uid();
  if v_member.user_id is null or v_member.role not in ('owner','admin','technician') then
    raise exception using errcode = '42501', message = 'Conta não vinculada à equipe. Solicite acesso ao administrador.';
  end if;
  select * into v_data from public.company_data where company_id = v_member.company_id;
  select coalesce(jsonb_agg(o), '[]'::jsonb) into v_orders
    from jsonb_array_elements(v_data.payload->'orders') o
    where v_member.role in ('owner','admin') or o->>'technicianUserId' = v_member.user_id::text;
  select coalesce(jsonb_agg(c), '[]'::jsonb) into v_clients
    from jsonb_array_elements(v_data.payload->'clients') c
    where exists (select 1 from jsonb_array_elements(v_orders) o where o->>'clientId' = c->>'id');
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_equipment
    from jsonb_array_elements(v_data.payload->'equipment') e
    where exists (select 1 from jsonb_array_elements(v_orders) o
      where e->>'id' = o->>'equipmentId' or coalesce(o#>'{details,equipmentIds}','[]') ? (e->>'id'));
  select coalesce(jsonb_agg(q), '[]'::jsonb) into v_quotes
    from jsonb_array_elements(v_data.payload->'quotes') q
    where exists (select 1 from jsonb_array_elements(v_orders) o where o->>'id' = q->>'orderId');
  select coalesce(jsonb_agg(p), '[]'::jsonb) into v_products
    from jsonb_array_elements(v_data.payload->'products') p
    where exists (select 1 from jsonb_array_elements(v_orders) o,
      jsonb_array_elements(coalesce(o#>'{details,items}','[]')) i where i->>'kind' = 'produto' and i->>'referenceId' = p->>'id')
    or exists (select 1 from jsonb_array_elements(v_quotes) q,
      jsonb_array_elements(q->'items') i where i->>'kind' = 'produto' and i->>'referenceId' = p->>'id');
  select coalesce(jsonb_agg(s), '[]'::jsonb) into v_services
    from jsonb_array_elements(v_data.payload->'services') s
    where exists (select 1 from jsonb_array_elements(v_orders) o,
      jsonb_array_elements(coalesce(o#>'{details,items}','[]')) i where i->>'kind' = 'servico' and i->>'referenceId' = s->>'id')
    or exists (select 1 from jsonb_array_elements(v_quotes) q,
      jsonb_array_elements(q->'items') i where i->>'kind' = 'servico' and i->>'referenceId' = s->>'id');
  return jsonb_build_object(
    'revision', v_data.revision,
    'name', coalesce(nullif(v_member.display_name,''), (select email from auth.users where id = v_member.user_id)),
    'role', v_member.role,
    'payload', jsonb_build_object(
      'version', 1, 'settings', jsonb_build_object(
        'company', v_data.payload#>>'{settings,company}',
        'technician', coalesce(nullif(v_member.display_name,''),'Técnico'),
        'logo', coalesce(v_data.payload#>>'{settings,logo}',''),
        'kilometerRate', coalesce(v_data.payload#>'{settings,kilometerRate}','0')
      ),
      'orders', v_orders, 'clients', v_clients, 'equipment', v_equipment,
      'products', v_products, 'services', v_services,
      'quotes', v_quotes,
      'movements', '[]'::jsonb, 'expenses', '[]'::jsonb
    )
  );
end;
$$;

create function public.mobile_update_order(
  p_order_id text, p_action text, p_data jsonb, p_expected_revision bigint
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.company_memberships;
  v_row public.company_data;
  v_order jsonb;
  v_details jsonb;
  v_activities jsonb;
  v_last text;
  v_status text;
  v_time text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_location jsonb;
  v_question jsonb;
  v_checklist jsonb;
  v_old_checklist jsonb;
  v_old_question jsonb;
  v_file jsonb;
  v_index int;
  v_name text;
  v_patch jsonb;
  v_files jsonb := '[]';
  v_signature jsonb;
  v_existing_file jsonb;
begin
  select * into v_member from public.company_memberships where user_id = auth.uid();
  if v_member.user_id is null or v_member.role not in ('owner','admin','technician') then
    raise exception using errcode = '42501', message = 'Acesso à equipe necessário.';
  end if;
  select * into v_row from public.company_data where company_id = v_member.company_id for update;
  if v_row.revision <> p_expected_revision or p_expected_revision is null then
    raise exception using errcode = '40001', message = 'Os dados mudaram. Sincronize antes de tentar novamente.';
  end if;
  select value, ordinality - 1 into v_order, v_index
    from jsonb_array_elements(v_row.payload->'orders') with ordinality
    where value->>'id' = p_order_id;
  if v_order is null or (v_member.role = 'technician' and
      coalesce(v_order->>'technicianUserId','') <> v_member.user_id::text) then
    raise exception using errcode = '42501', message = 'Tarefa não atribuída à sua conta.';
  end if;
  if coalesce((v_order#>>'{details,archived}')::boolean,false) then
    raise exception 'Tarefa arquivada.';
  end if;
  v_name := coalesce(nullif(v_member.display_name,''), (select email from auth.users where id = v_member.user_id));
  v_details := coalesce(v_order->'details','{}'::jsonb);
  v_activities := coalesce(v_details->'activities','[]'::jsonb);
  v_last := v_activities->-1->>'kind';
  if v_activities->-1->>'at' >= v_time then
    raise exception 'Horário anterior ao último registro. Aguarde antes de tentar novamente.';
  end if;
  if p_action in ('Check-in','Check-out','Pausa','Retorno') then
    if v_order->>'status' = 'Finalizada' then raise exception 'Tarefa já finalizada.'; end if;
    if not coalesce((
      (p_action = 'Check-in' and (v_last is null or v_last in ('Deslocamento','Check-out'))) or
      (p_action in ('Check-out','Pausa') and v_last in ('Check-in','Retorno')) or
      (p_action = 'Retorno' and v_last = 'Pausa')
    ), false) then raise exception 'Sequência de atendimento inválida.'; end if;
    if p_action in ('Check-in','Check-out') then
      v_location := p_data->'location';
      if jsonb_typeof(v_location) is distinct from 'object'
        or jsonb_typeof(v_location->'latitude') is distinct from 'number'
        or jsonb_typeof(v_location->'longitude') is distinct from 'number'
        or jsonb_typeof(v_location->'accuracy') is distinct from 'number'
        or (v_location->>'latitude')::numeric not between -90 and 90
        or (v_location->>'longitude')::numeric not between -180 and 180
        or (v_location->>'accuracy')::numeric < 0 then
        raise exception 'Localização GPS necessária para entrada e saída.';
      end if;
      v_location := jsonb_build_object(
        'latitude', v_location->'latitude','longitude',v_location->'longitude',
        'accuracy',v_location->'accuracy','capturedAt',v_time);
    end if;
    if p_action = 'Pausa' and coalesce(btrim(p_data->>'reason'),'') = '' then
      raise exception 'Informe o motivo da pausa.';
    end if;
    if p_action = 'Check-out' then
      if exists (select 1 from jsonb_array_elements(coalesce(v_details->'pending','[]')) p
        where coalesce((p->>'resolved')::boolean,false) = false) then
        raise exception 'Resolva as pendências antes de finalizar.';
      end if;
      for v_question in select q from jsonb_array_elements(coalesce(v_details->'checklists','[]')) c,
        jsonb_array_elements(c->'questions') q loop
        if coalesce((v_question->>'required')::boolean,false) and (
          (v_question->>'kind' = 'Assinatura' and coalesce(v_details->'signature','null') = 'null'::jsonb) or
          (v_question->>'kind' <> 'Assinatura' and
            (coalesce(v_question->'answer','""') in ('""'::jsonb,'[]'::jsonb,'null'::jsonb)
              or (jsonb_typeof(v_question->'answer') = 'string' and btrim(v_question->>'answer') = '')))
        ) then raise exception 'Preencha os itens obrigatórios do questionário.'; end if;
      end loop;
    end if;
    if char_length(coalesce(p_data->>'reason','')) > 1000 then raise exception 'Motivo muito longo.'; end if;
    v_patch := jsonb_build_object(
      'id', gen_random_uuid()::text, 'kind', p_action, 'at', v_time,
      'technician', v_name, 'reason', coalesce(p_data->>'reason',''),
      'justification', '', 'origin','Android');
    if v_location is not null then v_patch := v_patch || jsonb_build_object('location',v_location); end if;
    v_details := v_details || jsonb_build_object('activities',v_activities || jsonb_build_array(v_patch));
    v_status := case p_action when 'Check-out' then 'Finalizada' when 'Pausa' then 'Pausada' else 'Em atendimento' end;
    v_order := v_order || jsonb_build_object('status',v_status);
  elsif p_action = 'report' then
    if jsonb_typeof(p_data) is distinct from 'object' or exists (
      select 1 from jsonb_object_keys(p_data) k
      where k not in ('report','distanceKm','attachments','checklists','signature','pending')
    ) then raise exception 'Campos do relatório inválidos.'; end if;
    if jsonb_typeof(p_data->'report') is distinct from 'string' or char_length(p_data->>'report') > 10000
      or jsonb_typeof(p_data->'distanceKm') is distinct from 'number'
      or (p_data->>'distanceKm')::numeric not between 0 and 100000
      or jsonb_typeof(p_data->'attachments') is distinct from 'array'
      or jsonb_typeof(p_data->'checklists') is distinct from 'array'
      or jsonb_typeof(p_data->'pending') is distinct from 'array' then
      raise exception 'Relatório incompleto ou inválido.';
    end if;
    if jsonb_array_length(p_data->'checklists') <> jsonb_array_length(coalesce(v_details->'checklists','[]')) then
      raise exception 'Não é permitido alterar os modelos de questionário.';
    end if;
    for v_checklist in select value from jsonb_array_elements(p_data->'checklists') loop
      select value into v_old_checklist from jsonb_array_elements(coalesce(v_details->'checklists','[]'))
        where value->>'id' = v_checklist->>'id';
      if v_old_checklist is null or v_old_checklist - 'questions' <> v_checklist - 'questions'
        or jsonb_typeof(v_checklist->'questions') is distinct from 'array'
        or jsonb_array_length(v_old_checklist->'questions') <> jsonb_array_length(v_checklist->'questions') then
        raise exception 'Modelo de questionário alterado.';
      end if;
      for v_question in select value from jsonb_array_elements(v_checklist->'questions') loop
        select value into v_old_question from jsonb_array_elements(v_old_checklist->'questions')
          where value->>'id' = v_question->>'id';
        if v_old_question is null or v_old_question - 'answer' <> v_question - 'answer'
          or jsonb_typeof(v_question->'answer') is null
          or jsonb_typeof(v_question->'answer') not in ('string','array')
          or octet_length((v_question->'answer')::text) > 12000 then
          raise exception 'Resposta de questionário inválida.';
        end if;
        if (jsonb_typeof(v_question->'answer') = 'string' and char_length(v_question->>'answer') > 10000)
          or (jsonb_typeof(v_question->'answer') = 'array' and exists (
            select 1 from jsonb_array_elements(v_question->'answer') a
            where jsonb_typeof(a) <> 'string' or char_length(a#>>'{}') > 1000
          )) then raise exception 'Resposta muito longa ou inválida.'; end if;
        if v_question->>'kind' = 'Escolha' and v_question->>'answer' <> '' and
          not (v_question->'options' ? (v_question->>'answer')) then
          raise exception 'Opção do questionário inválida.';
        end if;
        if v_question->>'kind' = 'Multipla escolha' and (
          jsonb_typeof(v_question->'answer') <> 'array' or exists (
            select 1 from jsonb_array_elements_text(v_question->'answer') a
            where not (v_question->'options' ? a)
          )) then raise exception 'Opções do questionário inválidas.'; end if;
        if v_question->>'kind' = 'Foto' and coalesce(v_question->>'answer','') <> '' and not exists (
          select 1 from jsonb_array_elements(p_data->'attachments') f
          where f->>'id' = v_question->>'answer' and f->>'mime' like 'image/%'
        ) then raise exception 'Foto da resposta não encontrada.'; end if;
      end loop;
    end loop;
    for v_file in select value from jsonb_array_elements(p_data->'attachments') loop
      if jsonb_typeof(v_file) <> 'object' or coalesce(v_file->>'id','') = ''
        or jsonb_typeof(v_file->'id') is distinct from 'string'
        or jsonb_typeof(v_file->'name') is distinct from 'string'
        or jsonb_typeof(v_file->'mime') is distinct from 'string'
        or jsonb_typeof(v_file->'data') is distinct from 'string'
        or coalesce(char_length(btrim(v_file->>'name')),0) not between 1 and 1000
        or coalesce(v_file->>'mime','') not in ('image/png','image/jpeg','image/webp','application/pdf','text/plain')
        or coalesce((v_file->>'size')::int,0) not between 1 and 500000
        or coalesce(char_length(v_file->>'data'),0) not between 1 and 800000
        or v_file->>'data' !~ ('^data:' || (v_file->>'mime') || ';base64,[A-Za-z0-9+/=]+$') then
        raise exception 'Anexo inválido. Limite de 500 KB por arquivo.';
      end if;
      if octet_length(decode(split_part(v_file->>'data', ',', 2), 'base64')) <> (v_file->>'size')::int then
        raise exception 'Tamanho do anexo não corresponde ao arquivo enviado.';
      end if;
      select value into v_existing_file from jsonb_array_elements(coalesce(v_details->'attachments','[]'))
        where value->>'id' = v_file->>'id';
      v_files := v_files || jsonb_build_array(v_file || jsonb_build_object('at',
        case when v_existing_file - 'at' = v_file - 'at'
          then v_existing_file->>'at' else v_time end));
    end loop;
    if coalesce(p_data->'signature','null') <> 'null'::jsonb and (
      jsonb_typeof(p_data->'signature') <> 'object'
      or coalesce(char_length(btrim(p_data#>>'{signature,signer}')),0) not between 1 and 1000
      or coalesce(char_length(p_data#>>'{signature,image}'),0) not between 1 and 800000
      or p_data#>>'{signature,image}' !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
    ) then raise exception 'Assinatura inválida.'; end if;
    v_signature := coalesce(p_data->'signature','null');
    if v_signature <> 'null'::jsonb then
      v_signature := jsonb_build_object('signer',btrim(v_signature->>'signer'),'image',v_signature->>'image',
        'at',case when v_signature - 'at' =
          (case when jsonb_typeof(v_details->'signature') = 'object' then v_details->'signature' else '{}'::jsonb end) - 'at'
          then v_details#>>'{signature,at}' else v_time end);
    end if;
    if jsonb_array_length(p_data->'pending') <> jsonb_array_length(coalesce(v_details->'pending','[]')) then
      raise exception 'Não é permitido remover pendências administrativas.';
    end if;
    for v_file in select value from jsonb_array_elements(p_data->'pending') loop
      if coalesce(char_length(v_file->>'title'),0) not between 1 and 1000
        or coalesce(v_file->>'id','') = ''
        or jsonb_typeof(v_file->'id') is distinct from 'string'
        or jsonb_typeof(v_file->'title') is distinct from 'string'
        or jsonb_typeof(v_file->'resolved') is distinct from 'boolean' then
        raise exception 'Pendência inválida.';
      end if;
      if not exists (select 1 from jsonb_array_elements(coalesce(v_details->'pending','[]')) p
        where p - 'resolved' = v_file - 'resolved') then
        raise exception 'Pendência administrativa alterada.';
      end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(p_data->'attachments') f group by f->>'id' having count(*) > 1)
      or exists (select 1 from jsonb_array_elements(p_data->'pending') p group by p->>'id' having count(*) > 1)
      or exists (select 1 from jsonb_array_elements(p_data->'checklists') c group by c->>'id' having count(*) > 1)
      or exists (select 1 from jsonb_array_elements(p_data->'checklists') c,
        jsonb_array_elements(c->'questions') q group by c->>'id',q->>'id' having count(*) > 1) then
      raise exception 'Identificadores duplicados no relatório.';
    end if;
    v_details := v_details || p_data || jsonb_build_object('attachments',v_files,'signature',v_signature);
  else raise exception 'Ação inválida.'; end if;
  v_order := v_order || jsonb_build_object('details',v_details,
    'history',coalesce(v_order->'history','[]') || jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid()::text,'at',v_time,
      'description',case when p_action = 'report' then 'Relatório salvo no Android' else p_action || ' registrado no Android por ' || v_name end
    )));
  v_patch := jsonb_set(v_row.payload,array['orders',v_index::text],v_order);
  if octet_length(v_patch::text) > 5000000 then
    raise exception 'Limite total de 5 MB da empresa excedido. Remova anexos ou reduza os arquivos.';
  end if;
  update public.company_data set
    payload = v_patch,
    revision = revision + 1, updated_at = now()
    where company_id = v_member.company_id;
  return public.mobile_company_data();
end;
$$;

revoke all on function public.list_company_technicians() from public, anon;
revoke all on function public.link_company_technician(text,text) from public, anon;
revoke all on function public.mobile_company_data() from public, anon;
revoke all on function public.mobile_update_order(text,text,jsonb,bigint) from public, anon;
revoke all on function public.validate_technician_assignment() from public, anon, authenticated;
grant execute on function public.list_company_technicians() to authenticated;
grant execute on function public.link_company_technician(text,text) to authenticated;
grant execute on function public.mobile_company_data() to authenticated;
grant execute on function public.mobile_update_order(text,text,jsonb,bigint) to authenticated;

commit;
