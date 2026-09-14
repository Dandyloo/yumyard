create or replace function public.get_pending_handover_orders(
  p_session_token text
)
returns table (
  order_id uuid,
  order_number text,
  order_status text,
  fulfillment_type text,
  source text,
  customer_name text,
  customer_phone text,
  delivery_address text,
  rider_name text,
  total numeric,
  amount_paid numeric,
  balance_due numeric,
  payment_status text,
  handed_over_from_shift_id uuid,
  handed_over_by_worker_name text,
  handed_over_at timestamptz,
  handover_note text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
begin
  select *
  into v_context
  from public.get_pos_session_and_shift(p_session_token);

  return query
  select
    o.id as order_id,
    o.order_number,
    o.status as order_status,
    o.fulfillment_type,
    o.source,
    o.customer_name,
    o.customer_phone,
    o.delivery_address,
    r.display_name as rider_name,
    o.total,
    coalesce(payment_totals.amount_paid, 0)::numeric as amount_paid,
    greatest(o.total - coalesce(payment_totals.amount_paid, 0), 0)::numeric as balance_due,
    case
      when coalesce(payment_totals.amount_paid, 0) <= 0 then 'unpaid'
      when coalesce(payment_totals.amount_paid, 0) < o.total then 'partially_paid'
      else 'paid'
    end::text as payment_status,
    o.handed_over_from_shift_id,
    handover_worker.display_name as handed_over_by_worker_name,
    o.handed_over_at,
    o.handover_note
  from public.orders as o
  join public.shifts as source_shift
    on source_shift.id = o.handed_over_from_shift_id
  join public.workers as handover_worker
    on handover_worker.id = source_shift.worker_id
  left join public.riders as r
    on r.id = o.rider_id
  left join lateral (
    select coalesce(sum(p.amount), 0) as amount_paid
    from public.payments as p
    where p.order_id = o.id
  ) as payment_totals
    on true
  where o.branch_id = v_context.branch_id
    and o.status not in ('completed', 'cancelled', 'voided')
    and o.handed_over_from_shift_id is not null
    and o.handed_over_to_shift_id is null
  order by o.handed_over_at asc;
end;
$$;

create or replace function public.claim_handover_orders_for_shift(
  p_session_token text,
  p_order_ids uuid[],
  p_acknowledgement_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_order_id uuid;
  v_order record;
  v_claimed_count integer := 0;
begin
  select *
  into v_context
  from public.get_pos_session_and_shift(p_session_token);

  if p_order_ids is null or cardinality(p_order_ids) = 0 then
    raise exception 'Select at least one handover order to acknowledge';
  end if;

  foreach v_order_id in array p_order_ids
  loop
    select
      o.id,
      o.order_number,
      o.status,
      o.handed_over_from_shift_id,
      o.handed_over_to_shift_id
    into v_order
    from public.orders as o
    where o.id = v_order_id
      and o.branch_id = v_context.branch_id
    for update;

    if not found then
      raise exception 'A selected order was not found in this branch';
    end if;

    if v_order.status in ('completed', 'cancelled', 'voided') then
      raise exception 'Finalized orders cannot be claimed';
    end if;

    if v_order.handed_over_from_shift_id is null then
      raise exception 'Selected order % is not a handover order', v_order.order_number;
    end if;

    if v_order.handed_over_to_shift_id is not null then
      raise exception 'Selected order % has already been claimed', v_order.order_number;
    end if;

    update public.orders as o
    set
      handed_over_to_shift_id = v_context.shift_id,
      last_updated_by_worker_id = v_context.worker_id,
      last_updated_in_shift_id = v_context.shift_id,
      updated_at = now()
    where o.id = v_order.id;

    insert into public.audit_logs (
      tenant_id,
      branch_id,
      worker_id,
      shift_id,
      entity_type,
      entity_id,
      action,
      details
    )
    values (
      v_context.tenant_id,
      v_context.branch_id,
      v_context.worker_id,
      v_context.shift_id,
      'order',
      v_order.id,
      'order_handover_claimed',
      jsonb_build_object(
        'order_number', v_order.order_number,
        'handover_from_shift_id', v_order.handed_over_from_shift_id,
        'handover_to_shift_id', v_context.shift_id,
        'acknowledgement_note', nullif(trim(p_acknowledgement_note), '')
      )
    );

    v_claimed_count := v_claimed_count + 1;
  end loop;

  return jsonb_build_object(
    'shift_id', v_context.shift_id,
    'worker_id', v_context.worker_id,
    'claimed_order_count', v_claimed_count,
    'acknowledgement_note', nullif(trim(p_acknowledgement_note), '')
  );
end;
$$;

create or replace function public.get_pos_active_orders(
  p_session_token text
)
returns table (
  order_id uuid,
  order_number text,
  status text,
  fulfillment_type text,
  source text,
  customer_name text,
  customer_phone text,
  delivery_address text,
  rider_id uuid,
  rider_name text,
  order_notes text,
  subtotal numeric,
  delivery_fee numeric,
  total numeric,
  amount_paid numeric,
  balance_due numeric,
  payment_status text,
  created_at timestamptz,
  created_by_worker_name text,
  created_in_shift_id uuid,
  handed_over_from_shift_id uuid,
  handed_over_to_shift_id uuid,
  handover_note text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
begin
  select *
  into v_context
  from public.get_pos_session_and_shift(p_session_token);

  return query
  select
    o.id,
    o.order_number,
    o.status,
    o.fulfillment_type,
    o.source,
    o.customer_name,
    o.customer_phone,
    o.delivery_address,
    o.rider_id,
    r.display_name,
    o.order_notes,
    o.subtotal,
    o.delivery_fee,
    o.total,
    coalesce(payment_totals.amount_paid, 0)::numeric,
    greatest(
      o.total - coalesce(payment_totals.amount_paid, 0),
      0
    )::numeric,
    case
      when coalesce(payment_totals.amount_paid, 0) <= 0 then 'unpaid'
      when coalesce(payment_totals.amount_paid, 0) < o.total then 'partially_paid'
      else 'paid'
    end::text,
    o.created_at,
    creator.display_name,
    o.created_in_shift_id,
    o.handed_over_from_shift_id,
    o.handed_over_to_shift_id,
    o.handover_note
  from public.orders as o
  join public.workers as creator
    on creator.id = o.created_by_worker_id
  left join public.riders as r
    on r.id = o.rider_id
  left join lateral (
    select coalesce(sum(p.amount), 0) as amount_paid
    from public.payments as p
    where p.order_id = o.id
  ) as payment_totals
    on true
  where o.branch_id = v_context.branch_id
    and o.status not in ('completed', 'cancelled', 'voided')
    and (
      o.created_in_shift_id = v_context.shift_id
      or o.handed_over_to_shift_id = v_context.shift_id
    )
  order by
    case o.status
      when 'confirmed' then 1
      when 'preparing' then 2
      when 'ready' then 3
      when 'awaiting_pickup' then 4
      when 'out_for_delivery' then 5
      else 6
    end,
    o.created_at asc;
end;
$$;

revoke all on function public.get_pos_active_orders(text) from public;

grant execute
on function public.get_pos_active_orders(text)
to anon, authenticated;

create or replace function public.get_pos_active_orders(
  p_session_token text
)
returns table (
  order_id uuid,
  order_number text,
  status text,
  fulfillment_type text,
  source text,
  customer_name text,
  customer_phone text,
  delivery_address text,
  rider_id uuid,
  rider_name text,
  order_notes text,
  subtotal numeric,
  delivery_fee numeric,
  total numeric,
  amount_paid numeric,
  balance_due numeric,
  payment_status text,
  created_at timestamptz,
  created_by_worker_name text,
  created_in_shift_id uuid,
  handed_over_from_shift_id uuid,
  handed_over_to_shift_id uuid,
  handover_note text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
begin
  select *
  into v_context
  from public.get_pos_session_and_shift(p_session_token);

  return query
  select
    o.id,
    o.order_number,
    o.status,
    o.fulfillment_type,
    o.source,
    o.customer_name,
    o.customer_phone,
    o.delivery_address,
    o.rider_id,
    r.display_name,
    o.order_notes,
    o.subtotal,
    o.delivery_fee,
    o.total,
    coalesce(payment_totals.amount_paid, 0)::numeric,
    greatest(o.total - coalesce(payment_totals.amount_paid, 0), 0)::numeric,
    case
      when coalesce(payment_totals.amount_paid, 0) <= 0 then 'unpaid'
      when coalesce(payment_totals.amount_paid, 0) < o.total then 'partially_paid'
      else 'paid'
    end::text,
    o.created_at,
    creator.display_name,
    o.created_in_shift_id,
    o.handed_over_from_shift_id,
    o.handed_over_to_shift_id,
    o.handover_note
  from public.orders as o
  join public.workers as creator
    on creator.id = o.created_by_worker_id
  left join public.riders as r
    on r.id = o.rider_id
  left join lateral (
    select coalesce(sum(p.amount), 0) as amount_paid
    from public.payments as p
    where p.order_id = o.id
  ) as payment_totals
    on true
  where o.branch_id = v_context.branch_id
    and o.status not in ('completed', 'cancelled', 'voided')
    and (
      o.created_in_shift_id = v_context.shift_id
      or o.handed_over_to_shift_id = v_context.shift_id
    )
  order by
    case o.status
      when 'confirmed' then 1
      when 'preparing' then 2
      when 'ready' then 3
      when 'awaiting_pickup' then 4
      when 'out_for_delivery' then 5
      else 6
    end,
    o.created_at asc;
end;
$$;

revoke all on function public.get_pending_handover_orders(text) from public;
revoke all on function public.claim_handover_orders_for_shift(text, uuid[], text) from public;
revoke all on function public.get_pos_active_orders(text) from public;

grant execute on function public.get_pending_handover_orders(text) to anon, authenticated;
grant execute on function public.claim_handover_orders_for_shift(text, uuid[], text) to anon, authenticated;
grant execute on function public.get_pos_active_orders(text) to anon, authenticated;