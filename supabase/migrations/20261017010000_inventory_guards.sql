begin;

create function public.guard_inventory() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_inventory jsonb;
  v_old_inventory jsonb;
  v_locations jsonb;
  v_movements jsonb;
  v_reservations jsonb;
  v_counts jsonb;
  v_receipts jsonb;
  v_returns jsonb;
  v_reversals jsonb;
  v_receipt jsonb;
  v_purchase_return jsonb;
  v_batch_line jsonb;
  v_reversal jsonb;
  v_movement jsonb;
  v_reservation jsonb;
  v_count jsonb;
  v_product jsonb;
  v_order jsonb;
  v_old_order jsonb;
  v_line jsonb;
  v_stock_item jsonb;
  v_source jsonb;
  v_reference text;
  v_line_id text;
  v_batch_id text;
  v_batch_line_id text;
  v_location_id text;
  v_product_id text;
  v_status text;
  v_total bigint;
  v_balance bigint;
  v_average_cost numeric;
  v_has_average boolean;
  v_received bigint;
  v_returned bigint;
  v_reversed bigint;
begin
  if TG_OP='DELETE' then
    if old.payload ? 'inventory' or jsonb_array_length(coalesce(old.payload->'movements','[]'))>0 then
      raise exception 'Historico e saldos de estoque nao podem ser excluidos.';
    end if;
    return old;
  end if;
  if TG_OP='UPDATE' and not (old.payload ? 'inventory') and not (new.payload ? 'inventory') then return new; end if;
  if jsonb_typeof(new.payload->'inventory') is distinct from 'object'
    or jsonb_typeof(new.payload->'movements') is distinct from 'array'
    or jsonb_typeof(new.payload->'products') is distinct from 'array' then
    raise exception 'Estrutura de estoque invalida ou removida.';
  end if;
  v_inventory := new.payload->'inventory';
  if TG_OP='UPDATE' then
    v_old_inventory := old.payload->'inventory';
  else
    v_old_inventory := null;
  end if;
  v_locations := v_inventory->'locations';
  v_movements := new.payload->'movements';
  v_reservations := v_inventory->'reservations';
  v_counts := v_inventory->'counts';
  v_receipts := coalesce(v_inventory->'purchaseReceipts','[]'::jsonb);
  v_returns := coalesce(v_inventory->'purchaseReturns','[]'::jsonb);
  v_reversals := coalesce(v_inventory->'consumptionReversals','[]'::jsonb);
  if jsonb_typeof(v_locations) is distinct from 'array' or jsonb_array_length(v_locations) not between 1 and 1000
    or jsonb_typeof(v_reservations) is distinct from 'array' or jsonb_array_length(v_reservations)>5000
    or jsonb_typeof(v_counts) is distinct from 'array' or jsonb_array_length(v_counts)>100000
    or jsonb_typeof(v_receipts) is distinct from 'array' or jsonb_array_length(v_receipts)>100000
    or jsonb_typeof(v_returns) is distinct from 'array' or jsonb_array_length(v_returns)>100000
    or jsonb_typeof(v_reversals) is distinct from 'array' or jsonb_array_length(v_reversals)>100000
    or jsonb_array_length(v_movements)>100000
    or not exists(select 1 from jsonb_array_elements(v_locations) l
      where l->>'id'=v_inventory->>'defaultLocationId' and l->'active'='true'::jsonb)
    or exists(select 1 from jsonb_array_elements(v_locations) l
      where jsonb_typeof(l->'id') is distinct from 'string' or length(l->>'id') not between 1 and 200
        or jsonb_typeof(l->'name') is distinct from 'string' or length(btrim(l->>'name')) not between 1 and 1000
        or jsonb_typeof(l->'active') is distinct from 'boolean')
    or exists(select 1 from jsonb_array_elements(v_locations) l group by l->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_locations) l group by lower(btrim(l->>'name')) having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_reservations) r group by r->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_reservations) r
      where r#>>'{events,-1,status}'='Reservada' group by r->>'orderId' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_counts) c group by c->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_receipts) r group by r->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_returns) r group by r->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_reversals) r group by r->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_counts) c
      where jsonb_typeof(c->'id') is distinct from 'string'
        or not exists(select 1 from jsonb_array_elements(new.payload->'products') p where p->>'id'=c->>'productId')
        or not exists(select 1 from jsonb_array_elements(v_locations) l where l->>'id'=c->>'locationId')
        or coalesce(c->>'systemQuantity','') !~ '^[0-9]+$'
        or coalesce(c->>'countedQuantity','') !~ '^[0-9]+$'
        or jsonb_typeof(c->'at') is distinct from 'string'
        or jsonb_typeof(c->'reason') is distinct from 'string'
        or length(btrim(c->>'reason')) not between 1 and 700)
    or exists(select 1 from jsonb_array_elements(v_counts) c
      where (select count(*) from jsonb_array_elements(v_movements) m
        where m#>>'{source,type}'='inventory' and m#>>'{source,referenceId}'=c->>'id')<>1)
    or exists(select 1 from jsonb_array_elements(v_movements) m group by m->>'id' having count(*)>1) then
    raise exception 'Depositos, reservas ou movimentos invalidos ou duplicados.';
  end if;
  if exists(select 1 from jsonb_array_elements(v_returns) r
    where jsonb_typeof(r->'id') is distinct from 'string' or length(r->>'id') not between 1 and 200
      or jsonb_typeof(r->'orderId') is distinct from 'string' or length(r->>'orderId') not between 1 and 200
      or jsonb_typeof(r->'at') is distinct from 'string'
      or coalesce(r->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(r->'reference') is distinct from 'string' or length(r->>'reference')>200
      or jsonb_typeof(r->'reason') is distinct from 'string' or length(btrim(r->>'reason')) not between 5 and 1000
      or jsonb_typeof(r->'items') is distinct from 'array' or jsonb_array_length(r->'items') not between 1 and 100
      or not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o
        where o->>'id'=r->>'orderId'
          and (r->>'date')::date >= (o->>'orderedOn')::date
          and (r->>'at')::timestamptz >= (o->>'createdAt')::timestamptz)
      or exists(select 1 from jsonb_array_elements(r->'items') i
        where jsonb_typeof(i->'lineId') is distinct from 'string'
          or jsonb_typeof(i->'productId') is distinct from 'string'
          or jsonb_typeof(i->'locationId') is distinct from 'string'
          or not exists(select 1 from jsonb_array_elements(v_locations) l where l->>'id'=i->>'locationId')
          or coalesce(i->>'quantity','') !~ '^[1-9][0-9]*$' or (i->>'quantity')::numeric>10000
          or (select count(*) from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o,
              jsonb_array_elements(coalesce(o->'items','[]')) oi
              where o->>'id'=r->>'orderId' and oi->>'id'=i->>'lineId')<>1
          or not exists(select 1 from jsonb_array_elements(v_receipts) rec,
              jsonb_array_elements(coalesce(rec->'items','[]')) ri
            where rec->>'orderId'=r->>'orderId' and ri->>'lineId'=i->>'lineId'
              and ri->>'productId'=i->>'productId' and rec->>'locationId'=i->>'locationId'
              and (r->>'date')::date >= (rec->>'date')::date
              and (r->>'at')::timestamptz >= (rec->>'at')::timestamptz)
            and not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o,
                jsonb_array_elements(coalesce(o#>'{receipt,stockItems}','[]')) si
              where o->>'id'=r->>'orderId' and si->>'lineId'=i->>'lineId'
                and si->>'productId'=i->>'productId' and o#>>'{receipt,locationId}'=i->>'locationId'
                and (r->>'date')::date >= (o#>>'{receipt,date}')::date
                and (r->>'at')::timestamptz >= (o#>>'{receipt,at}')::timestamptz)
          or (select count(*) from jsonb_array_elements(r->'items') ri where ri->>'lineId'=i->>'lineId')<>1
          or (select count(*) from jsonb_array_elements(v_movements) m
            where m#>>'{source,type}'='purchaseReturn' and m#>>'{source,referenceId}'=r->>'id'
              and m#>>'{source,lineId}'=i->>'lineId' and m->>'productId'=i->>'productId'
              and m->>'locationId'=i->>'locationId' and (m->>'delta')::numeric=-((i->>'quantity')::numeric)
              and m->>'reason'=(
                'Devolução ao fornecedor do pedido '||
                (select o->>'id' from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o
                  where o->>'id'=r->>'orderId')||': '||(r->>'reason')))<>1
          or (i->>'quantity')::bigint >
            (select coalesce(sum((ri->>'quantity')::bigint),0) from jsonb_array_elements(v_receipts) rec,
              jsonb_array_elements(coalesce(rec->'items','[]')) ri
              where rec->>'orderId'=r->>'orderId' and ri->>'lineId'=i->>'lineId'
                and ri->>'productId'=i->>'productId' and rec->>'locationId'=i->>'locationId')
              and not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o,
                  jsonb_array_elements(coalesce(o#>'{receipt,stockItems}','[]')) si
                where o->>'id'=r->>'orderId' and si->>'lineId'=i->>'lineId'
                  and si->>'productId'=i->>'productId' and o#>>'{receipt,locationId}'=i->>'locationId')
          or (select coalesce(sum((ri->>'quantity')::bigint),0) from jsonb_array_elements(v_returns) rr,
              jsonb_array_elements(coalesce(rr->'items','[]')) ri
              where rr->>'orderId'=r->>'orderId' and ri->>'lineId'=i->>'lineId'
                and ri->>'productId'=i->>'productId' and ri->>'locationId'=i->>'locationId') >
            (select coalesce(sum((ri->>'quantity')::bigint),0) from jsonb_array_elements(v_receipts) rec,
              jsonb_array_elements(coalesce(rec->'items','[]')) ri
              where rec->>'orderId'=r->>'orderId' and ri->>'lineId'=i->>'lineId'
                and ri->>'productId'=i->>'productId' and rec->>'locationId'=i->>'locationId')
              and not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o,
                  jsonb_array_elements(coalesce(o#>'{receipt,stockItems}','[]')) si
                where o->>'id'=r->>'orderId' and si->>'lineId'=i->>'lineId'
                  and si->>'productId'=i->>'productId' and o#>>'{receipt,locationId}'=i->>'locationId')
          or (select coalesce(sum((ri->>'quantity')::bigint),0) from jsonb_array_elements(v_returns) rr,
              jsonb_array_elements(coalesce(rr->'items','[]')) ri
              where rr->>'orderId'=r->>'orderId' and ri->>'lineId'=i->>'lineId'
                and ri->>'productId'=i->>'productId') >
            (select coalesce(sum((ri->>'quantity')::bigint),0) from jsonb_array_elements(v_receipts) rec,
              jsonb_array_elements(coalesce(rec->'items','[]')) ri
              where rec->>'orderId'=r->>'orderId' and ri->>'lineId'=i->>'lineId'
                and ri->>'productId'=i->>'productId')
              and not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o,
                  jsonb_array_elements(coalesce(o#>'{receipt,stockItems}','[]')) si
                where o->>'id'=r->>'orderId' and si->>'lineId'=i->>'lineId'
                  and si->>'productId'=i->>'productId')
          or (not exists(select 1 from jsonb_array_elements(v_receipts) rec,
              jsonb_array_elements(coalesce(rec->'items','[]')) ri
              where rec->>'orderId'=r->>'orderId' and ri->>'lineId'=i->>'lineId')
            and exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o,
                jsonb_array_elements(coalesce(o#>'{receipt,stockItems}','[]')) si
              where o->>'id'=r->>'orderId' and si->>'lineId'=i->>'lineId'
                and si->>'productId'=i->>'productId')
            and (select coalesce(sum((ri->>'quantity')::bigint),0) from jsonb_array_elements(v_returns) rr,
                jsonb_array_elements(coalesce(rr->'items','[]')) ri
                where rr->>'orderId'=r->>'orderId' and ri->>'lineId'=i->>'lineId'
                  and ri->>'productId'=i->>'productId') >
              (select (oi->>'quantity')::bigint from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o,
                  jsonb_array_elements(coalesce(o->'items','[]')) oi
                where o->>'id'=r->>'orderId' and oi->>'id'=i->>'lineId'))
          )
      or exists(select 1 from jsonb_array_elements(r->'items') i group by i->>'lineId' having count(*)>1)
      or exists(select 1 from jsonb_array_elements(v_returns) rr, jsonb_array_elements(coalesce(rr->'items','[]')) ri
        group by rr->>'orderId',ri->>'lineId',ri->>'productId',ri->>'locationId'
        having count(*)>100000)) then
    raise exception 'Devolucao de compra invalida ou superior as quantidades recebidas.';
  end if;
  if exists(select 1 from jsonb_array_elements(v_receipts) r
    where jsonb_typeof(r->'id') is distinct from 'string' or length(r->>'id') not between 1 and 200
      or jsonb_typeof(r->'orderId') is distinct from 'string' or length(r->>'orderId') not between 1 and 200
      or jsonb_typeof(r->'at') is distinct from 'string'
      or coalesce(r->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(r->'locationId') is distinct from 'string'
      or not exists(select 1 from jsonb_array_elements(v_locations) l where l->>'id'=r->>'locationId')
      or jsonb_typeof(r->'reference') is distinct from 'string' or length(r->>'reference')>200
      or jsonb_typeof(r->'notes') is distinct from 'string' or length(btrim(r->>'notes')) not between 5 and 1000
      or jsonb_typeof(r->'items') is distinct from 'array' or jsonb_array_length(r->'items') not between 1 and 100
      or exists(select 1 from jsonb_array_elements(r->'items') i
        where jsonb_typeof(i->'lineId') is distinct from 'string'
          or jsonb_typeof(i->'productId') is distinct from 'string'
          or coalesce(i->>'quantity','') !~ '^[1-9][0-9]*$'
          or (i->>'quantity')::numeric>10000
          or (select count(*) from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o,
              jsonb_array_elements(coalesce(o->'items','[]')) oi
              where o->>'id'=r->>'orderId' and oi->>'id'=i->>'lineId')<>1
          or not exists(select 1 from jsonb_array_elements(new.payload->'products') p where p->>'id'=i->>'productId'))
      or (select count(*) from jsonb_array_elements(r->'items') i group by i->>'lineId' having count(*)>1)>0
      or exists(select 1 from jsonb_array_elements(v_receipts) r,
          jsonb_array_elements(coalesce(r->'items','[]')) i
        group by r->>'orderId',i->>'lineId' having count(distinct i->>'productId')>1)
      or not exists(select 1 from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o
        where o->>'id'=r->>'orderId'
          and (o#>>'{cancellation,at}' is null or (r->>'at')::timestamptz<=(o#>>'{cancellation,at}')::timestamptz)
          and (r->>'date')::date >= (o->>'orderedOn')::date
          and (r->>'at')::timestamptz >= (o->>'createdAt')::timestamptz)
      or exists(select 1 from jsonb_array_elements(v_receipts) with ordinality later(value, ordinality),
          jsonb_array_elements(v_receipts) with ordinality earlier(value, ordinality)
        where later.value->>'orderId'=earlier.value->>'orderId'
          and later.ordinality>earlier.ordinality
          and ((later.value->>'at')::timestamptz<(earlier.value->>'at')::timestamptz
            or (later.value->>'date')::date<(earlier.value->>'date')::date))) then
    raise exception 'Recebimento parcial de compra invalido.';
  end if;
  if exists(select 1 from jsonb_array_elements(v_reversals) r
    where jsonb_typeof(r->'id') is distinct from 'string' or length(r->>'id') not between 1 and 200
      or jsonb_typeof(r->'reservationId') is distinct from 'string' or length(r->>'reservationId') not between 1 and 200
      or jsonb_typeof(r->'at') is distinct from 'string'
      or jsonb_typeof(r->'reason') is distinct from 'string' or length(btrim(r->>'reason')) not between 5 and 1000
      or jsonb_typeof(r->'items') is distinct from 'array' or jsonb_array_length(r->'items') not between 1 and 200
      or not exists(select 1 from jsonb_array_elements(v_reservations) rs
        where rs->>'id'=r->>'reservationId' and rs#>>'{events,-1,status}'='Consumida'
          and exists(select 1 from jsonb_array_elements(new.payload->'orders') o
            where o->>'id'=rs->>'orderId' and o->>'status'='Finalizada')
          and (r->>'at')::timestamptz >= (rs#>>'{events,-1,at}')::timestamptz)
      or exists(select 1 from jsonb_array_elements(r->'items') i
        where jsonb_typeof(i->'lineId') is distinct from 'string'
          or jsonb_typeof(i->'productId') is distinct from 'string'
          or coalesce(i->>'quantity','') !~ '^[1-9][0-9]*$'
          or not exists(select 1 from jsonb_array_elements(v_reservations) rs,
              jsonb_array_elements(coalesce(rs->'items','[]')) ri
            where rs->>'id'=r->>'reservationId' and ri->>'lineId'=i->>'lineId'
              and ri->>'productId'=i->>'productId')
          or (select count(*) from jsonb_array_elements(v_movements) m
            where m#>>'{source,type}'='consumptionReversal' and m#>>'{source,referenceId}'=r->>'id'
              and m#>>'{source,lineId}'=i->>'lineId' and m->>'productId'=i->>'productId'
              and (m->>'delta')::numeric=(i->>'quantity')::numeric)<>1)
      or (select count(*) from jsonb_array_elements(r->'items') i group by i->>'lineId' having count(*)>1)>0) then
    raise exception 'Estorno de consumo invalido ou sem movimento correspondente.';
  end if;
  if TG_OP='UPDATE' and v_old_inventory is not null then
    if not (new.payload ? 'inventory') or not (new.payload ? 'movements')
      or exists(select 1 from jsonb_array_elements(coalesce(v_old_inventory->'locations','[]')) oldl
        where not exists(select 1 from jsonb_array_elements(v_locations) newl
          where newl->>'id'=oldl->>'id' and newl->>'name'=oldl->>'name'
            and newl->'active'=oldl->'active'))
      or exists(select 1 from jsonb_array_elements(coalesce(old.payload->'movements','[]')) om
        where not exists(select 1 from jsonb_array_elements(v_movements) nm where nm->>'id'=om->>'id' and nm=om))
      or exists(select 1 from jsonb_array_elements(coalesce(v_old_inventory->'reservations','[]')) oldr
        where not exists(select 1 from jsonb_array_elements(v_reservations) newr
          where newr->>'id'=oldr->>'id'
            and (newr-'events') is not distinct from (oldr-'events')
            and jsonb_array_length(newr->'events') between jsonb_array_length(oldr->'events') and 2
            and newr->'events'->0 is not distinct from oldr->'events'->0
            and (jsonb_array_length(oldr->'events')=1 or newr->'events'->1 is not distinct from oldr->'events'->1)))
      or exists(select 1 from jsonb_array_elements(coalesce(v_old_inventory->'counts','[]')) oldc
        where not exists(select 1 from jsonb_array_elements(v_counts) newc
          where newc->>'id'=oldc->>'id' and newc=oldc))
      or exists(select 1 from jsonb_array_elements(coalesce(v_old_inventory->'purchaseReceipts','[]')) oldr
        where not exists(select 1 from jsonb_array_elements(v_receipts) newr
          where newr->>'id'=oldr->>'id' and newr=oldr))
      or exists(select 1 from jsonb_array_elements(coalesce(v_old_inventory->'purchaseReturns','[]')) oldr
        where not exists(select 1 from jsonb_array_elements(v_returns) newr
          where newr->>'id'=oldr->>'id' and newr=oldr))
      or exists(select 1 from jsonb_array_elements(coalesce(v_old_inventory->'consumptionReversals','[]')) oldr
        where not exists(select 1 from jsonb_array_elements(v_reversals) newr
          where newr->>'id'=oldr->>'id' and newr=oldr)) then
      raise exception 'Historico de estoque ou reservas nao pode ser removido ou reescrito.';
    end if;
    for v_old_order in select value from jsonb_array_elements(coalesce(old.payload->'orders','[]')) loop
      select value into v_order from jsonb_array_elements(new.payload->'orders') where value->>'id'=v_old_order->>'id';
      if v_order is null then continue; end if;
      if v_old_order->>'status'='Aberta' and v_order->>'status' in ('Em atendimento','Pausada')
        and exists(select 1 from jsonb_array_elements(coalesce(v_order#>'{details,items}','[]')) i where i->>'kind'='produto')
        and current_setting('app.inventory_mobile_checkin',true) is distinct from 'true'
        and not exists(select 1 from jsonb_array_elements(v_reservations) r
          where r->>'orderId'=v_order->>'id' and r#>>'{events,-1,status}'='Reservada') then
        raise exception 'Iniciar uma OS com pecas exige reserva de estoque.';
      end if;
      if v_old_order->>'status' in ('Em atendimento','Pausada') and v_order->>'status'='Finalizada'
        and exists(select 1 from jsonb_array_elements(coalesce(v_order#>'{details,items}','[]')) i where i->>'kind'='produto')
        and current_setting('app.inventory_mobile_checkout',true) is distinct from 'true'
        and not exists(select 1 from jsonb_array_elements(v_reservations) r
          where r->>'orderId'=v_order->>'id' and r#>>'{events,-1,status}'='Consumida') then
        raise exception 'Finalizar uma OS com pecas exige baixa de estoque.';
      end if;
      if v_old_order->>'status' in ('Em atendimento','Pausada') and v_order->>'status' in ('Em atendimento','Pausada')
        and exists(select 1 from jsonb_array_elements(coalesce(v_old_inventory->'reservations','[]')) r
          where r->>'orderId'=v_order->>'id' and r#>>'{events,-1,status}'='Reservada')
        and not exists(select 1 from jsonb_array_elements(v_reservations) r
          where r->>'orderId'=v_order->>'id' and r#>>'{events,-1,status}'='Reservada') then
        raise exception 'OS em andamento deve manter a reserva de estoque ativa.';
      end if;
    end loop;
  end if;
  for v_movement in select value from jsonb_array_elements(v_movements) loop
    v_source := v_movement->'source';
    v_product_id := v_movement->>'productId';
    v_location_id := v_movement->>'locationId';
    if jsonb_typeof(v_movement) is distinct from 'object'
      or jsonb_typeof(v_movement->'id') is distinct from 'string'
      or not exists(select 1 from jsonb_array_elements(new.payload->'products') p where p->>'id'=v_product_id)
      or not exists(select 1 from jsonb_array_elements(v_locations) l where l->>'id'=v_location_id)
      or coalesce(v_movement->>'delta','') !~ '^-?[0-9]+$'
      or (v_movement->>'delta')::numeric=0
        and coalesce(v_source->>'type','')<>'inventory'
      or coalesce(v_movement->>'balance','') !~ '^[0-9]+$'
      or (v_movement ? 'unitCost' and coalesce(v_movement->>'unitCost','') !~ '^[0-9]+$')
      or (v_movement ? 'averageCostBefore' and coalesce(v_movement->>'averageCostBefore','') !~ '^[0-9]+$')
      or (v_movement ? 'averageCostAfter' and coalesce(v_movement->>'averageCostAfter','') !~ '^[0-9]+$')
      or ((v_movement ? 'unitCost')<>(v_movement ? 'averageCostBefore'))
      or ((v_movement ? 'unitCost')<>(v_movement ? 'averageCostAfter'))
      or coalesce((v_movement->>'unitCost')::numeric,0)>100000000
      or coalesce((v_movement->>'averageCostBefore')::numeric,0)>100000000
      or coalesce((v_movement->>'averageCostAfter')::numeric,0)>100000000
      or (v_movement ? 'unitCost' and v_source->>'type'<>'purchase'
        and ((v_movement->>'unitCost')::numeric is distinct from (v_movement->>'averageCostBefore')::numeric
          or (v_movement->>'averageCostAfter')::numeric is distinct from (v_movement->>'averageCostBefore')::numeric))
      or jsonb_typeof(v_movement->'reason') is distinct from 'string'
      or length(btrim(v_movement->>'reason')) not between 1 and 1000
      or coalesce(v_source->>'type','') not in ('legacy','opening','manual','purchase','purchaseReturn','consumption','consumptionReversal','transfer','migration','inventory')
      or (v_source ? 'referenceId' and jsonb_typeof(v_source->'referenceId') is distinct from 'string')
      or (v_source ? 'lineId' and jsonb_typeof(v_source->'lineId') is distinct from 'string') then
      raise exception 'Movimentacao de estoque invalida.';
    end if;
    if v_source->>'type'='purchase' then
      v_reference := v_source->>'referenceId';
      v_line_id := v_source->>'lineId';
      select o into v_order from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o where o->>'id'=v_reference;
      if position('|' in v_line_id)>0 then
        v_batch_id := split_part(v_line_id,'|',1);
        v_batch_line_id := substr(v_line_id,position('|' in v_line_id)+1);
        select r into v_receipt from jsonb_array_elements(v_receipts) r
          where r->>'id'=v_batch_id and r->>'orderId'=v_reference;
        select i into v_batch_line from jsonb_array_elements(coalesce(v_receipt->'items','[]')) i
          where i->>'lineId'=v_batch_line_id;
        select i into v_line from jsonb_array_elements(coalesce(v_order->'items','[]')) i
          where i->>'id'=v_batch_line_id;
        if v_order is null or v_receipt is null or v_line is null or v_batch_line is null
          or v_batch_line->>'productId' is distinct from v_product_id
          or v_movement->>'locationId' is distinct from v_receipt->>'locationId'
          or (v_movement->>'delta')::numeric is distinct from (v_batch_line->>'quantity')::numeric
          or (v_movement->>'unitCost')::numeric is distinct from (v_line->>'unitCost')::numeric
          or (select count(*) from jsonb_array_elements(v_movements) m
            where m#>>'{source,type}'='purchase' and m#>>'{source,referenceId}'=v_reference
              and m#>>'{source,lineId}'=v_line_id)<>1 then
          raise exception 'Entrada de estoque sem vinculo unico com a entrega da compra.';
        end if;
      else
        select i into v_line from jsonb_array_elements(coalesce(v_order->'items','[]')) i where i->>'id'=v_line_id;
        select i into v_stock_item from jsonb_array_elements(coalesce(v_order#>'{receipt,stockItems}','[]')) i where i->>'lineId'=v_line_id;
        if v_order is null or v_line is null or v_stock_item is null
          or v_stock_item->>'productId' is distinct from v_product_id
          or v_movement->>'locationId' is distinct from v_order#>>'{receipt,locationId}'
          or (v_movement->>'delta')::numeric is distinct from (v_line->>'quantity')::numeric
          or (v_movement->>'unitCost')::numeric is distinct from (v_line->>'unitCost')::numeric
          or (select count(*) from jsonb_array_elements(v_movements) m
            where m#>>'{source,type}'='purchase' and m#>>'{source,referenceId}'=v_reference and m#>>'{source,lineId}'=v_line_id)<>1 then
          raise exception 'Entrada de estoque sem vinculo unico com recebimento integral da compra.';
        end if;
      end if;
      if (v_movement->>'averageCostAfter')::numeric is distinct from (case
          when (v_movement->>'balance')::numeric-(v_movement->>'delta')::numeric=0
            then (v_movement->>'unitCost')::numeric
          else round(
            (((v_movement->>'balance')::numeric-(v_movement->>'delta')::numeric)*
              (v_movement->>'averageCostBefore')::numeric+
             (v_movement->>'delta')::numeric*(v_movement->>'unitCost')::numeric)/
            (v_movement->>'balance')::numeric)
          end) then
        raise exception 'Custo medio apos compra diverge do calculo ponderado.';
      end if;
    elsif v_source->>'type'='purchaseReturn' then
      v_reference := v_source->>'referenceId';
      v_line_id := v_source->>'lineId';
      select r into v_purchase_return from jsonb_array_elements(v_returns) r where r->>'id'=v_reference;
      select i into v_line from jsonb_array_elements(coalesce(v_purchase_return->'items','[]')) i
        where i->>'lineId'=v_line_id;
      select o into v_order from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) o
        where o->>'id'=v_purchase_return->>'orderId';
      if v_purchase_return is null or v_line is null or v_order is null
        or v_line->>'productId' is distinct from v_product_id
        or v_line->>'locationId' is distinct from v_location_id
        or (v_movement->>'delta')::numeric is distinct from -((v_line->>'quantity')::numeric)
        or v_movement->>'reason' is distinct from
          ('Devolução ao fornecedor do pedido '||(v_order->>'id')||': '||(v_purchase_return->>'reason'))
        or (v_movement->>'unitCost')::numeric is distinct from (v_movement->>'averageCostBefore')::numeric
        or (v_movement->>'averageCostAfter')::numeric is distinct from (v_movement->>'averageCostBefore')::numeric
        or (select count(*) from jsonb_array_elements(v_movements) m
          where m#>>'{source,type}'='purchaseReturn' and m#>>'{source,referenceId}'=v_reference
            and m#>>'{source,lineId}'=v_line_id)<>1 then
        raise exception 'Saida de estoque sem vinculo unico com devolucao da compra.';
      end if;
    elsif v_source->>'type'='consumption' then
      v_reference := v_source->>'referenceId';
      v_line_id := v_source->>'lineId';
      select r into v_reservation from jsonb_array_elements(v_reservations) r where r->>'id'=v_reference;
      select i into v_line from jsonb_array_elements(coalesce(v_reservation->'items','[]')) i where i->>'lineId'=v_line_id;
      select o into v_order from jsonb_array_elements(new.payload->'orders') o where o->>'id'=v_reservation->>'orderId';
      if v_reservation is null or v_reservation#>>'{events,-1,status}' is distinct from 'Consumida'
        or v_order->>'status' is distinct from 'Finalizada' or v_line is null
        or v_line->>'productId' is distinct from v_product_id
        or (v_movement->>'delta')::numeric is distinct from -((v_line->>'quantity')::numeric)
        or (v_movement->>'unitCost')::numeric is distinct from (v_movement->>'averageCostBefore')::numeric
        or (v_movement->>'averageCostAfter')::numeric is distinct from (v_movement->>'averageCostBefore')::numeric
        or (select count(*) from jsonb_array_elements(v_movements) m
          where m#>>'{source,type}'='consumption' and m#>>'{source,referenceId}'=v_reference and m#>>'{source,lineId}'=v_line_id)<>1 then
        raise exception 'Baixa de estoque sem vinculo unico com pecas consumidas na OS.';
      end if;
    elsif v_source->>'type'='consumptionReversal' then
      v_reference := v_source->>'referenceId';
      v_line_id := v_source->>'lineId';
      select r into v_reversal from jsonb_array_elements(v_reversals) r where r->>'id'=v_reference;
      select rs into v_reservation from jsonb_array_elements(v_reservations) rs
        where rs->>'id'=v_reversal->>'reservationId';
      select i into v_line from jsonb_array_elements(coalesce(v_reversal->'items','[]')) i
        where i->>'lineId'=v_line_id;
      select o into v_order from jsonb_array_elements(new.payload->'orders') o
        where o->>'id'=v_reservation->>'orderId';
      if v_reversal is null or v_reservation is null or v_line is null
        or v_reservation#>>'{events,-1,status}' is distinct from 'Consumida'
        or v_order->>'status' is distinct from 'Finalizada'
        or v_line->>'productId' is distinct from v_product_id
        or v_movement->>'locationId' is distinct from v_reservation->>'locationId'
        or (v_movement->>'delta')::numeric is distinct from (v_line->>'quantity')::numeric
        or (v_movement->>'unitCost')::numeric is distinct from (v_movement->>'averageCostBefore')::numeric
        or (v_movement->>'averageCostAfter')::numeric is distinct from (v_movement->>'averageCostBefore')::numeric
        or (select count(*) from jsonb_array_elements(v_movements) m
          where m#>>'{source,type}'='consumptionReversal'
            and m#>>'{source,referenceId}'=v_reference and m#>>'{source,lineId}'=v_line_id)<>1 then
        raise exception 'Reposicao de peca sem vinculo unico com estorno do consumo da OS.';
      end if;
    elsif v_source->>'type'='transfer' then
      if (select count(*) from jsonb_array_elements(v_movements) m
        where m#>>'{source,type}'='transfer' and m#>>'{source,referenceId}'=v_source->>'referenceId')<>2
        or (select count(distinct m->>'locationId') from jsonb_array_elements(v_movements) m
          where m#>>'{source,type}'='transfer' and m#>>'{source,referenceId}'=v_source->>'referenceId')<>2
        or (select count(distinct m->>'productId') from jsonb_array_elements(v_movements) m
          where m#>>'{source,type}'='transfer' and m#>>'{source,referenceId}'=v_source->>'referenceId')<>1
        or (select sum((m->>'delta')::bigint) from jsonb_array_elements(v_movements) m
          where m#>>'{source,type}'='transfer' and m#>>'{source,referenceId}'=v_source->>'referenceId')<>0 then
        raise exception 'Transferencia exige duas movimentacoes correspondentes.';
      end if;
    elsif v_source->>'type'='inventory' then
      v_reference := v_source->>'referenceId';
      select c into v_count from jsonb_array_elements(v_counts) c where c->>'id'=v_reference;
      select coalesce(sum((m.value->>'delta')::bigint),0) into v_total
        from jsonb_array_elements(v_movements) with ordinality as m(value, ordinality)
        where m.value->>'productId'=v_product_id and m.value->>'locationId'=v_location_id
          and m.ordinality>(select previous.ordinality
            from jsonb_array_elements(v_movements) with ordinality as previous(value, ordinality)
            where previous.value->>'id'=v_movement->>'id');
      if v_count is null
        or v_count->>'productId' is distinct from v_product_id
        or v_count->>'locationId' is distinct from v_location_id
        or v_movement->>'at' is distinct from v_count->>'at'
        or (v_movement->>'delta')::numeric is distinct from
          (v_count->>'countedQuantity')::numeric-(v_count->>'systemQuantity')::numeric
        or v_total is distinct from (v_count->>'systemQuantity')::bigint
        or v_movement->>'reason' is distinct from concat(
          'Inventário físico: sistema ',v_count->>'systemQuantity',
          ', contado ',v_count->>'countedQuantity',
          '. Justificativa: ',v_count->>'reason')
        or (select count(*) from jsonb_array_elements(v_movements) m
          where m#>>'{source,type}'='inventory' and m#>>'{source,referenceId}'=v_reference)<>1 then
        raise exception 'Contagem fisica sem ajuste unico ou divergente do saldo registrado.';
      end if;
    end if;
  end loop;
  for v_reversal in select value from jsonb_array_elements(v_reversals) loop
    for v_line in select value from jsonb_array_elements(coalesce(v_reversal->'items','[]')) loop
      select coalesce(sum((ri->>'quantity')::bigint),0) into v_reversed
        from jsonb_array_elements(v_reversals) r,
          jsonb_array_elements(coalesce(r->'items','[]')) ri
        where r->>'reservationId'=v_reversal->>'reservationId'
          and ri->>'lineId'=v_line->>'lineId';
      select coalesce(-min((m->>'delta')::bigint),0) into v_received
        from jsonb_array_elements(v_movements) m
        where m#>>'{source,type}'='consumption'
          and m#>>'{source,referenceId}'=v_reversal->>'reservationId'
          and m#>>'{source,lineId}'=v_line->>'lineId';
      if v_received=0 or v_reversed>v_received then
        raise exception 'Quantidade estornada excede o consumo original da OS.';
      end if;
    end loop;
  end loop;
  for v_product in select value from jsonb_array_elements(new.payload->'products') loop
    if coalesce(v_product->>'stock','') !~ '^[0-9]+$' then raise exception 'Saldo de produto invalido.'; end if;
    select coalesce(sum((m->>'delta')::bigint),0) into v_total
      from jsonb_array_elements(v_movements) m where m->>'productId'=v_product->>'id';
    if v_total is distinct from (v_product->>'stock')::bigint then
      raise exception 'Saldo do produto diverge do livro de movimentacoes de estoque.';
    end if;
    v_balance := 0;
    for v_movement in
      select value from jsonb_array_elements(v_movements) with ordinality
      where value->>'productId'=v_product->>'id' order by ordinality desc
    loop
      v_balance := v_balance+(v_movement->>'delta')::bigint;
      if (v_movement->>'balance')::bigint is distinct from v_balance then
        raise exception 'Saldo historico diverge da sequencia do livro de estoque.';
      end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(v_movements) m
      where m->>'productId'=v_product->>'id'
      group by m->>'productId',m->>'locationId' having sum((m->>'delta')::bigint)<0) then
      raise exception 'Saldo fisico negativo por produto e deposito.';
    end if;
    v_has_average := false;
    v_average_cost := null;
    for v_movement in
      select value from jsonb_array_elements(v_movements) with ordinality
      where value->>'productId'=v_product->>'id' and value ? 'averageCostAfter'
      order by ordinality desc
    loop
      if v_has_average and (v_movement->>'averageCostBefore')::numeric is distinct from v_average_cost then
        raise exception 'Historico de custo medio nao e continuo.';
      end if;
      v_average_cost := (v_movement->>'averageCostAfter')::numeric;
      v_has_average := true;
    end loop;
    if v_has_average and (v_product->>'cost')::numeric is distinct from v_average_cost then
      raise exception 'Custo medio atual diverge do ultimo movimento de estoque.';
    end if;
  end loop;
  for v_reservation in select value from jsonb_array_elements(v_reservations) loop
    v_status := v_reservation#>>'{events,-1,status}';
    select o into v_order from jsonb_array_elements(new.payload->'orders') o where o->>'id'=v_reservation->>'orderId';
    if v_order is null or not exists(select 1 from jsonb_array_elements(v_locations) l where l->>'id'=v_reservation->>'locationId')
      or jsonb_array_length(coalesce(v_reservation->'events','[]')) not between 1 and 2
      or v_reservation#>>'{events,0,status}' is distinct from 'Reservada'
      or (v_status not in ('Reservada','Consumida','Liberada'))
      or (v_status='Reservada' and v_order->>'status' not in ('Em atendimento','Pausada')
        and current_setting('app.inventory_mobile_checkout',true) is distinct from 'true')
      or (v_status='Consumida' and v_order->>'status' is distinct from 'Finalizada')
      or jsonb_array_length(coalesce(v_reservation->'items','[]'))<>
        (select count(*) from jsonb_array_elements(coalesce(v_order#>'{details,items}','[]')) i where i->>'kind'='produto')
      or exists(select 1 from jsonb_array_elements(coalesce(v_reservation->'items','[]')) ri
        group by ri->>'lineId' having count(*)>1)
      or (v_status='Reservada' and not exists(select 1 from jsonb_array_elements(v_locations) l
        where l->>'id'=v_reservation->>'locationId' and l->'active'='true'::jsonb))
      or exists(select 1 from jsonb_array_elements(coalesce(v_reservation->'items','[]')) ri
        where not exists(select 1 from jsonb_array_elements(coalesce(v_order#>'{details,items}','[]')) oi
          where oi->>'id'=ri->>'lineId' and oi->>'referenceId'=ri->>'productId'
            and (oi->>'quantity')::numeric=(ri->>'quantity')::numeric))
      or exists(select 1 from jsonb_array_elements(coalesce(v_reservation->'items','[]')) i
        where not exists(select 1 from jsonb_array_elements(new.payload->'products') p where p->>'id'=i->>'productId')
          or coalesce(i->>'quantity','') !~ '^[1-9][0-9]*$') then
      raise exception 'Reserva de estoque invalida ou divergente do status da OS.';
    end if;
    if v_status='Reservada' then
      for v_line in select value from jsonb_array_elements(coalesce(v_reservation->'items','[]')) loop
        select coalesce(sum((m->>'delta')::bigint),0) into v_total from jsonb_array_elements(v_movements) m
          where m->>'productId'=v_line->>'productId' and m->>'locationId'=v_reservation->>'locationId';
        select coalesce(sum((i->>'quantity')::bigint),0) into v_balance
          from jsonb_array_elements(v_reservations) r, jsonb_array_elements(coalesce(r->'items','[]')) i
          where r->>'locationId'=v_reservation->>'locationId' and r#>>'{events,-1,status}'='Reservada'
            and i->>'productId'=v_line->>'productId';
        if v_total<v_balance then raise exception 'Reserva excede o saldo fisico do deposito.'; end if;
      end loop;
    end if;
  end loop;
  for v_order in select value from jsonb_array_elements(coalesce(new.payload#>'{finance,purchasing,orders}','[]')) loop
    for v_line in select value from jsonb_array_elements(coalesce(v_order->'items','[]')) loop
      select coalesce(sum((ri->>'quantity')::bigint),0) into v_received
        from jsonb_array_elements(v_receipts) r, jsonb_array_elements(coalesce(r->'items','[]')) ri
        where r->>'orderId'=v_order->>'id' and ri->>'lineId'=v_line->>'id';
      if v_received>(v_line->>'quantity')::bigint
        or (v_order#>>'{cancellation,at}' is not null and exists(
          select 1 from jsonb_array_elements(v_receipts) r
          where r->>'orderId'=v_order->>'id' and (r->>'at')::timestamptz>(v_order#>>'{cancellation,at}')::timestamptz))
        or (v_order#>'{receipt}' is not null and v_received<>(v_line->>'quantity')::bigint) then
        raise exception 'Quantidade recebida diverge do pedido ou da conclusao financeira.';
      end if;
    end loop;
    if v_order#>>'{receipt,batchId}' is not null
      and (v_order#>'{receipt,stockItems}' is null or not exists(select 1 from jsonb_array_elements(v_receipts) r
        where r->>'id'=v_order#>>'{receipt,batchId}' and r->>'orderId'=v_order->>'id'
          and r->>'date'=v_order#>>'{receipt,date}' and r->>'at'=v_order#>>'{receipt,at}'
          and r->>'locationId'=v_order#>>'{receipt,locationId}'
          and r->>'reference'=v_order#>>'{receipt,reference}' and r->>'notes'=v_order#>>'{receipt,notes}')) then
      raise exception 'Resumo final diverge da ultima entrega registrada.';
    end if;
    if v_order#>'{receipt,stockItems}' is not null then
      if jsonb_array_length(v_order#>'{receipt,stockItems}')<>jsonb_array_length(v_order->'items')
        or (select count(distinct i->>'lineId') from jsonb_array_elements(v_order#>'{receipt,stockItems}') i) <>
          jsonb_array_length(v_order#>'{receipt,stockItems}')
        or exists(select 1 from jsonb_array_elements(v_order#>'{receipt,stockItems}') si
          where not exists(select 1 from jsonb_array_elements(v_order->'items') i where i->>'id'=si->>'lineId')
            or (v_order#>>'{receipt,batchId}' is not null and
              (not exists(select 1 from jsonb_array_elements(v_receipts) r,
                  jsonb_array_elements(coalesce(r->'items','[]')) ri
                where r->>'orderId'=v_order->>'id' and ri->>'lineId'=si->>'lineId'
                  and ri->>'productId'=si->>'productId')
                or (select coalesce(sum((ri->>'quantity')::bigint),0)
                  from jsonb_array_elements(v_receipts) r, jsonb_array_elements(coalesce(r->'items','[]')) ri
                  where r->>'orderId'=v_order->>'id' and ri->>'lineId'=si->>'lineId') <>
                  (select (i->>'quantity')::bigint from jsonb_array_elements(v_order->'items') i where i->>'id'=si->>'lineId')))
            or (v_order#>>'{receipt,batchId}' is null and
              not exists(select 1 from jsonb_array_elements(v_movements) m
                where m#>>'{source,type}'='purchase' and m#>>'{source,referenceId}'=v_order->>'id'
                  and m#>>'{source,lineId}'=si->>'lineId'))) then
        raise exception 'Produto recebido sem movimento de entrada correspondente no estoque.';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_inventory() from public, anon, authenticated, service_role;
create trigger guard_inventory before insert or update or delete on public.company_data
for each row execute function public.guard_inventory();

alter function public.mobile_update_order(text,text,jsonb,bigint) rename to mobile_update_order_without_inventory;
revoke all on function public.mobile_update_order_without_inventory(text,text,jsonb,bigint) from public, anon, authenticated;

create function public.mobile_update_order(
  p_order_id text, p_action text, p_data jsonb, p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_company uuid;
  v_payload jsonb;
  v_order jsonb;
  v_line jsonb;
  v_product jsonb;
  v_reservation jsonb;
  v_items jsonb;
  v_movement jsonb;
  v_index integer;
  v_reservation_index integer;
  v_product_index integer;
  v_location text;
  v_product_id text;
  v_text text;
  v_at text;
  v_delta bigint;
  v_balance bigint;
  v_reserved bigint;
  v_physical bigint;
  v_id text;
  v_now timestamptz := clock_timestamp();
begin
  if p_action='Check-out' then perform set_config('app.inventory_mobile_checkout','true',true); end if;
  if p_action='Check-in' then perform set_config('app.inventory_mobile_checkin','true',true); end if;
  v_result := public.mobile_update_order_without_inventory(p_order_id,p_action,p_data,p_expected_revision);
  perform set_config('app.inventory_mobile_checkout','false',true);
  perform set_config('app.inventory_mobile_checkin','false',true);
  if p_action not in ('Check-in','Check-out') then return v_result; end if;
  select company_id into v_company from public.company_memberships where user_id=auth.uid();
  select payload into v_payload from public.company_data where company_id=v_company for update;
  v_at := to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select value,ordinality-1 into v_order,v_index from jsonb_array_elements(v_payload->'orders') with ordinality
    where value->>'id'=p_order_id;
  if v_order is null then raise exception 'OS nao encontrada.'; end if;
  if not exists(select 1 from jsonb_array_elements(coalesce(v_order#>'{details,items}','[]')) i where i->>'kind'='produto') then
    return public.mobile_company_data();
  end if;
  if jsonb_typeof(v_payload->'inventory') is distinct from 'object' then
    raise exception 'Atualize o estoque da empresa antes de iniciar ou finalizar esta OS.';
  end if;
  if p_action='Check-in' then
    if exists(select 1 from jsonb_array_elements(coalesce(v_payload#>'{inventory,reservations}','[]')) r
      where r->>'orderId'=p_order_id and r#>>'{events,-1,status}'='Reservada') then
      return public.mobile_company_data();
    end if;
    v_location := coalesce(v_order#>>'{details,stockLocationId}',v_payload#>>'{inventory,defaultLocationId}');
    if not exists(select 1 from jsonb_array_elements(v_payload#>'{inventory,locations}') l
      where l->>'id'=v_location and l->'active'='true'::jsonb) then
      raise exception 'Deposito padrao inativo ou inexistente.';
    end if;
    for v_line in select value from jsonb_array_elements(v_order#>'{details,items}') where value->>'kind'='produto' loop
      if coalesce(v_line->>'quantity','') !~ '^[1-9][0-9]*$' then raise exception 'Pecas de OS exigem quantidades inteiras positivas.'; end if;
      v_product_id := v_line->>'referenceId';
      select coalesce(sum((m->>'delta')::bigint),0) into v_physical from jsonb_array_elements(v_payload->'movements') m
        where m->>'productId'=v_product_id and m->>'locationId'=v_location;
      select coalesce(sum((i->>'quantity')::bigint),0) into v_reserved
        from jsonb_array_elements(coalesce(v_payload#>'{inventory,reservations}','[]')) r,
          jsonb_array_elements(coalesce(r->'items','[]')) i
        where r->>'locationId'=v_location and r#>>'{events,-1,status}'='Reservada' and i->>'productId'=v_product_id;
      select coalesce(sum((i->>'quantity')::bigint),0) into v_balance
        from jsonb_array_elements(v_order#>'{details,items}') i
        where i->>'kind'='produto' and i->>'referenceId'=v_product_id;
      if v_physical-v_reserved<v_balance then
        raise exception 'Estoque disponivel insuficiente para reservar % (%).',coalesce(v_line->>'name',v_product_id),v_balance;
      end if;
    end loop;
    v_id := gen_random_uuid()::text;
    select coalesce(jsonb_agg(jsonb_build_object('lineId',i->>'id','productId',i->>'referenceId',
      'productName',i->>'name','quantity',(i->>'quantity')::bigint)),'[]'::jsonb) into v_items
      from jsonb_array_elements(v_order#>'{details,items}') i where i->>'kind'='produto';
    v_text := 'Reserva automática ao iniciar '||coalesce(v_order->>'code','');
    v_reservation := jsonb_build_object('id',v_id,'orderId',p_order_id,'locationId',v_location,
      'createdAt',v_at,'items',v_items,'events',jsonb_build_array(jsonb_build_object(
        'status','Reservada','at',v_at,'reason',v_text)));
    v_payload := jsonb_set(v_payload,array['orders',v_index::text,'details','stockLocationId'],to_jsonb(v_location),true);
    v_payload := jsonb_set(v_payload,'{inventory,reservations}',
      coalesce(v_payload#>'{inventory,reservations}','[]'::jsonb)||jsonb_build_array(v_reservation),true);
  else
    select value,ordinality-1 into v_reservation,v_reservation_index
      from jsonb_array_elements(v_payload#>'{inventory,reservations}') with ordinality
      where value->>'orderId'=p_order_id and value#>>'{events,-1,status}'='Reservada';
    if v_reservation is null then return public.mobile_company_data(); end if;
    v_location := v_reservation->>'locationId';
    v_text := 'Pecas consumidas ao finalizar '||coalesce(v_order->>'code','');
    v_reservation := jsonb_set(v_reservation,'{events}',
      (v_reservation->'events')||jsonb_build_array(jsonb_build_object('status','Consumida','at',v_at,
        'reason',v_text)));
    v_payload := jsonb_set(v_payload,array['inventory','reservations',v_reservation_index::text],v_reservation,true);
    for v_line in select value from jsonb_array_elements(v_reservation->'items') loop
      v_product_id := v_line->>'productId';
      v_delta := -((v_line->>'quantity')::bigint);
      select value,ordinality-1 into v_product,v_product_index from jsonb_array_elements(v_payload->'products') with ordinality
        where value->>'id'=v_product_id;
      if v_product is null then raise exception 'Produto da OS nao encontrado no estoque.'; end if;
      v_balance := (v_product->>'stock')::bigint+v_delta;
      if v_balance<0 then raise exception 'Saldo fisico insuficiente para finalizar a OS.'; end if;
      v_text := 'Consumo automatico na OS '||coalesce(v_order->>'code','');
      v_movement := jsonb_build_object('id',gen_random_uuid()::text,'productId',v_product_id,
        'locationId',v_location,'delta',v_delta,'reason',v_text,
        'balance',v_balance,'at',v_at,'unitCost',(v_product->>'cost')::bigint,
        'averageCostBefore',(v_product->>'cost')::bigint,
        'averageCostAfter',(v_product->>'cost')::bigint,'source',jsonb_build_object('type','consumption',
        'referenceId',v_reservation->>'id','lineId',v_line->>'lineId'));
      v_payload := jsonb_set(v_payload,array['products',v_product_index::text,'stock'],to_jsonb(v_balance),true);
      v_payload := jsonb_set(v_payload,'{movements}',jsonb_build_array(v_movement)||(v_payload->'movements'),true);
    end loop;
  end if;
  if octet_length(v_payload::text)>5000000 then raise exception 'Limite total de 5 MB da empresa excedido.'; end if;
  update public.company_data set payload=v_payload where company_id=v_company;
  return public.mobile_company_data();
end;
$$;
revoke all on function public.mobile_update_order(text,text,jsonb,bigint) from public, anon;
grant execute on function public.mobile_update_order(text,text,jsonb,bigint) to authenticated;

commit;
