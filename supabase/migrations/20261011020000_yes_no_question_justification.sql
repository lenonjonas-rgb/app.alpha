begin;

create or replace function public.questionnaire_validate_answer(p_question jsonb, p_files jsonb)
returns void language plpgsql set search_path = ''
as $$
declare
  v_kind text := p_question->>'kind';
  v_answer jsonb := coalesce(p_question->'answer','""');
  v_text text;
begin
  if v_kind is null or v_kind not in ('Texto','Area de texto','Numero','Escolha','Multipla escolha',
    'Check','Sim ou Não','Data','Hora','Monetaria','CPF/CNPJ','Foto','Assinatura') then
    raise exception 'Tipo de pergunta inválido.';
  end if;
  if jsonb_typeof(v_answer) not in ('string','array') or octet_length(v_answer::text) > 12000 then
    raise exception 'Resposta de questionário inválida.';
  end if;
  if jsonb_typeof(v_answer) = 'array' then
    if v_kind <> 'Multipla escolha' or exists (
      select 1 from jsonb_array_elements(v_answer) a
      where jsonb_typeof(a) <> 'string' or char_length(a#>>'{}') > 1000
    ) then raise exception 'Resposta de questionário inválida.'; end if;
    if exists (select 1 from jsonb_array_elements_text(v_answer) a
      where not (coalesce(p_question->'options','[]') ? a))
      or exists (select 1 from jsonb_array_elements_text(v_answer) a group by a having count(*) > 1) then
      raise exception 'Opções do questionário inválidas.';
    end if;
  else
    v_text := btrim(v_answer#>>'{}');
    if char_length(v_answer#>>'{}') > 10000 then raise exception 'Resposta muito longa.'; end if;
    if v_kind = 'Multipla escolha' and v_text <> '' then raise exception 'Opções do questionário inválidas.'; end if;
    if v_text <> '' then
      if v_kind = 'Escolha' and not (coalesce(p_question->'options','[]') ? (v_answer#>>'{}')) then
        raise exception 'Opção do questionário inválida.';
      elsif v_kind = 'Check' and v_text not in ('Sim','Nao','Não') then raise exception 'Resposta de check inválida.';
      elsif v_kind = 'Sim ou Não' and (v_answer#>>'{}') not in ('Sim','Nao') then raise exception 'Resposta de sim ou não inválida.';
      elsif v_kind in ('Numero','Monetaria') then
        if v_text !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
          or v_text::double precision in ('Infinity'::double precision,'-Infinity'::double precision,'NaN'::double precision) then
          raise exception 'Resposta numérica inválida.';
        end if;
      elsif v_kind = 'Data' then
        if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Data de resposta inválida.'; end if;
        begin
          if to_char(v_text::date,'YYYY-MM-DD') <> v_text then raise exception 'Data de resposta inválida.'; end if;
        exception when others then raise exception 'Data de resposta inválida.';
        end;
      elsif v_kind = 'Hora' and v_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Hora de resposta inválida.';
      elsif v_kind = 'CPF/CNPJ' and not public.questionnaire_document_valid(v_text) then
        raise exception 'CPF/CNPJ de resposta inválido.';
      elsif v_kind = 'Foto' and not exists (
        select 1 from jsonb_array_elements(p_files) f
        where f->>'id' = v_answer#>>'{}' and f->>'mime' in ('image/png','image/jpeg','image/webp')
      ) then raise exception 'Foto da resposta não encontrada.';
      end if;
    end if;
  end if;
  if v_kind <> 'Assinatura' and coalesce(p_question->'signature','null') <> 'null'::jsonb then
    raise exception 'Assinatura em pergunta de outro tipo.';
  end if;
  if v_kind = 'Sim ou Não' then
    if coalesce(p_question->>'justificationOn','') not in ('Sim','Nao') then
      raise exception 'Resposta que exige justificativa inválida.';
    end if;
  elsif p_question ? 'justificationOn' then
    raise exception 'Justificativa condicional em tipo de pergunta inválido.';
  end if;
  if (p_question ? 'justification' and (jsonb_typeof(p_question->'justification') is distinct from 'string'
      or char_length(p_question->>'justification') > 10000))
    or (p_question ? 'justificationPhotoId' and jsonb_typeof(p_question->'justificationPhotoId') is distinct from 'string') then
    raise exception 'Justificativa inválida.';
  end if;
  if (coalesce(btrim(p_question->>'justification'),'') <> '' or coalesce(p_question->>'justificationPhotoId','') <> '')
    and not coalesce(v_kind = 'Sim ou Não' and (v_answer#>>'{}') = p_question->>'justificationOn',false) then
    raise exception 'Justificativa sem resposta correspondente.';
  end if;
  if coalesce(p_question->>'justificationPhotoId','') <> '' and not exists (
    select 1 from jsonb_array_elements(p_files) f
    where f->>'id' = p_question->>'justificationPhotoId' and f->>'mime' in ('image/png','image/jpeg','image/webp')
  ) then raise exception 'Foto da justificativa não encontrada.'; end if;
end;
$$;

create or replace function public.mobile_update_order(
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
  v_checklists jsonb := '[]';
  v_questions jsonb;
  v_signature jsonb;
  v_existing_file jsonb;
  v_old_definition jsonb;
  v_definition jsonb;
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
    from jsonb_array_elements(v_row.payload->'orders') with ordinality where value->>'id' = p_order_id;
  if v_order is null or (v_member.role = 'technician' and
    coalesce(v_order->>'technicianUserId','') <> v_member.user_id::text) then
    raise exception using errcode = '42501', message = 'Tarefa não atribuída à sua conta.';
  end if;
  if coalesce((v_order#>>'{details,archived}')::boolean,false) then raise exception 'Tarefa arquivada.'; end if;
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
      v_location := jsonb_build_object('latitude',v_location->'latitude','longitude',v_location->'longitude',
        'accuracy',v_location->'accuracy','capturedAt',v_time);
    end if;
    if p_action = 'Pausa' and coalesce(btrim(p_data->>'reason'),'') = '' then raise exception 'Informe o motivo da pausa.'; end if;
    if p_action = 'Check-out' then
      if exists (select 1 from jsonb_array_elements(coalesce(v_details->'pending','[]')) p
        where coalesce((p->>'resolved')::boolean,false) = false) then
        raise exception 'Resolva as pendências antes de finalizar.';
      end if;
      if coalesce((v_details->>'questionnaireRequired')::boolean,false)
        and jsonb_array_length(coalesce(v_details->'checklists','[]')) = 0 then
        raise exception 'Questionário obrigatório não vinculado à tarefa.';
      end if;
      for v_checklist in select value from jsonb_array_elements(coalesce(v_details->'checklists','[]')) loop
        for v_question in select value from jsonb_array_elements(v_checklist->'questions') loop
          perform public.questionnaire_validate_answer(v_question,coalesce(v_details->'attachments','[]'));
          v_signature := case when v_question ? 'signature' then v_question->'signature' else v_details->'signature' end;
          if v_question->>'kind' = 'Assinatura' then
            perform public.questionnaire_signature(v_signature,v_signature,v_time);
          end if;
          if coalesce((v_checklist->>'requiredForCheckout')::boolean,true) then
            if coalesce((v_question->>'required')::boolean,false) and (
              (v_question->>'kind' = 'Assinatura' and coalesce(v_signature,'null') = 'null'::jsonb) or
              (v_question->>'kind' <> 'Assinatura' and
                (coalesce(v_question->'answer','""') in ('""'::jsonb,'[]'::jsonb,'null'::jsonb)
                  or (jsonb_typeof(v_question->'answer') = 'string' and btrim(v_question->>'answer') = '')))
            ) then raise exception 'Preencha os itens obrigatórios do questionário.'; end if;
            if v_question->>'kind' = 'Sim ou Não'
              and v_question->>'answer' = v_question->>'justificationOn'
              and coalesce(btrim(v_question->>'justification'),'') = '' then
              raise exception 'Preencha a justificativa da resposta selecionada.';
            end if;
          end if;
        end loop;
      end loop;
    end if;
    if char_length(coalesce(p_data->>'reason','')) > 1000 then raise exception 'Motivo muito longo.'; end if;
    v_patch := jsonb_build_object('id',gen_random_uuid()::text,'kind',p_action,'at',v_time,
      'technician',v_name,'reason',coalesce(p_data->>'reason',''),'justification','','origin','Android');
    if v_location is not null then v_patch := v_patch || jsonb_build_object('location',v_location); end if;
    v_details := v_details || jsonb_build_object('activities',v_activities || jsonb_build_array(v_patch));
    v_status := case p_action when 'Check-out' then 'Finalizada' when 'Pausa' then 'Pausada' else 'Em atendimento' end;
    v_order := v_order || jsonb_build_object('status',v_status);
  elsif p_action = 'report' then
    if jsonb_typeof(p_data) is distinct from 'object' or exists (
      select 1 from jsonb_object_keys(p_data) k where k not in ('report','distanceKm','attachments','checklists','signature','pending')
    ) then raise exception 'Campos do relatório inválidos.'; end if;
    if jsonb_typeof(p_data->'report') is distinct from 'string' or char_length(p_data->>'report') > 10000
      or jsonb_typeof(p_data->'distanceKm') is distinct from 'number' or (p_data->>'distanceKm')::numeric not between 0 and 100000
      or jsonb_typeof(p_data->'attachments') is distinct from 'array'
      or jsonb_typeof(p_data->'checklists') is distinct from 'array'
      or jsonb_typeof(p_data->'pending') is distinct from 'array' then raise exception 'Relatório incompleto ou inválido.'; end if;
    if jsonb_array_length(p_data->'checklists') <> jsonb_array_length(coalesce(v_details->'checklists','[]')) then
      raise exception 'Não é permitido alterar os modelos de questionário.';
    end if;
    if exists (select 1 from jsonb_array_elements(p_data->'checklists') c group by c->>'id' having count(*) > 1)
      or exists (select 1 from jsonb_array_elements(p_data->'checklists') c,
        jsonb_array_elements(c->'questions') q group by c->>'id',q->>'id' having count(*) > 1) then
      raise exception 'Identificadores duplicados no relatório.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_data->'checklists') with ordinality c(value,n)
      where value->>'id' is distinct from (v_details->'checklists'->((n-1)::int))->>'id'
    ) then raise exception 'Modelo de questionário alterado.'; end if;
    for v_checklist in select value from jsonb_array_elements(p_data->'checklists') loop
      select value into v_old_checklist from jsonb_array_elements(coalesce(v_details->'checklists','[]'))
        where value->>'id' = v_checklist->>'id';
      v_old_definition := jsonb_build_object('equipmentId','') || (v_old_checklist - 'questions');
      v_definition := jsonb_build_object('equipmentId','') || (v_checklist - 'questions');
      if v_old_definition ? 'display' then
        v_old_definition := jsonb_set(v_old_definition,'{display}',
          '{"showOnOrder":true,"columns":1,"inlineAnswers":false,"showUnanswered":true,"equipment":false}'::jsonb || (v_old_definition->'display'));
      end if;
      if v_definition ? 'display' then
        v_definition := jsonb_set(v_definition,'{display}',
          '{"showOnOrder":true,"columns":1,"inlineAnswers":false,"showUnanswered":true,"equipment":false}'::jsonb || (v_definition->'display'));
      end if;
      if v_old_checklist is null or v_old_definition <> v_definition
        or jsonb_typeof(v_checklist->'questions') is distinct from 'array'
        or jsonb_array_length(v_old_checklist->'questions') <> jsonb_array_length(v_checklist->'questions') then
        raise exception 'Modelo de questionário alterado.';
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_checklist->'questions') with ordinality q(value,n)
        where value->>'id' is distinct from (v_old_checklist->'questions'->((n-1)::int))->>'id'
      ) then raise exception 'Resposta de questionário inválida. Estrutura definida pelo gestor.'; end if;
      v_questions := '[]';
      for v_question in select value from jsonb_array_elements(v_checklist->'questions') loop
        select value into v_old_question from jsonb_array_elements(v_old_checklist->'questions')
          where value->>'id' = v_question->>'id';
        if v_old_question is null
          or (jsonb_build_object('options','[]'::jsonb) || (v_old_question - array['answer','signature','justification','justificationPhotoId'])) <>
             (jsonb_build_object('options','[]'::jsonb) || (v_question - array['answer','signature','justification','justificationPhotoId']))
          or (v_old_question ? 'signature' and not (v_question ? 'signature')) then
          raise exception 'Resposta de questionário inválida. Estrutura definida pelo gestor.';
        end if;
        perform public.questionnaire_validate_answer(v_question,p_data->'attachments');
        if v_question ? 'signature' then
          v_signature := public.questionnaire_signature(v_question->'signature',v_old_question->'signature',v_time);
          v_question := v_question || jsonb_build_object('signature',v_signature);
        end if;
        v_questions := v_questions || jsonb_build_array((v_old_question - array['answer','justification','justificationPhotoId'])
          || jsonb_build_object('answer',coalesce(v_question->'answer','""'))
          || case when v_question ? 'signature' then jsonb_build_object('signature',v_question->'signature') else '{}'::jsonb end
          || case when v_old_question->>'kind' = 'Sim ou Não' then jsonb_build_object(
            'justification',coalesce(v_question->'justification','""'),
            'justificationPhotoId',coalesce(v_question->'justificationPhotoId','""')) else '{}'::jsonb end);
      end loop;
      v_checklists := v_checklists || jsonb_build_array(v_old_checklist || jsonb_build_object('questions',v_questions));
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
        case when v_existing_file - 'at' = v_file - 'at' then v_existing_file->>'at' else v_time end));
    end loop;
    v_signature := public.questionnaire_signature(p_data->'signature',v_details->'signature',v_time);
    if jsonb_array_length(p_data->'pending') <> jsonb_array_length(coalesce(v_details->'pending','[]')) then
      raise exception 'Não é permitido remover pendências administrativas.';
    end if;
    for v_file in select value from jsonb_array_elements(p_data->'pending') loop
      if coalesce(char_length(v_file->>'title'),0) not between 1 and 1000 or coalesce(v_file->>'id','') = ''
        or jsonb_typeof(v_file->'id') is distinct from 'string' or jsonb_typeof(v_file->'title') is distinct from 'string'
        or jsonb_typeof(v_file->'resolved') is distinct from 'boolean' then raise exception 'Pendência inválida.'; end if;
      if not exists (select 1 from jsonb_array_elements(coalesce(v_details->'pending','[]')) p
        where p - 'resolved' = v_file - 'resolved') then raise exception 'Pendência administrativa alterada.'; end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(p_data->'attachments') f group by f->>'id' having count(*) > 1)
      or exists (select 1 from jsonb_array_elements(p_data->'pending') p group by p->>'id' having count(*) > 1)
      then raise exception 'Identificadores duplicados no relatório.'; end if;
    v_details := v_details || p_data || jsonb_build_object('attachments',v_files,'signature',v_signature,'checklists',v_checklists);
  else raise exception 'Ação inválida.'; end if;
  v_order := v_order || jsonb_build_object('details',v_details,
    'history',coalesce(v_order->'history','[]') || jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid()::text,'at',v_time,
      'description',case when p_action = 'report' then 'Relatório salvo no Android' else p_action || ' registrado no Android por ' || v_name end)));
  v_patch := jsonb_set(v_row.payload,array['orders',v_index::text],v_order);
  if octet_length(v_patch::text) > 5000000 then
    raise exception 'Limite total de 5 MB da empresa excedido. Remova anexos ou reduza os arquivos.';
  end if;
  update public.company_data set payload = v_patch, revision = revision + 1, updated_at = now() where company_id = v_member.company_id;
  return public.mobile_company_data();
end;
$$;

revoke all on function public.questionnaire_validate_answer(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.mobile_update_order(text,text,jsonb,bigint) from public, anon;
grant execute on function public.mobile_update_order(text,text,jsonb,bigint) to authenticated;

commit;
