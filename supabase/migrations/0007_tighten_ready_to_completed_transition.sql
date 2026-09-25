-- 0007: Tighten the ready -> completed transition.
--
-- update_pos_order_status() previously let ANY fulfillment type jump
-- straight from 'ready' to 'completed', bypassing 'out_for_delivery' and
-- 'awaiting_pickup' entirely. That undermines the purpose of those
-- intermediate statuses for pickup/delivery orders (knowing a rider is
-- actually out, or that a customer hasn't actually collected the order
-- yet). The client UI never exposed this path in the first place
-- (getNextOrderAction() only ever offers the single intermediate-status
-- button for 'ready'), so this only closes an unused, direct-RPC-only
-- hole - it has no effect on current app behavior.
--
-- walk-in/dine-in keep the fast path: the customer is standing at the
-- counter, so "awaiting pickup" doesn't meaningfully apply and skipping
-- straight to completed is legitimate, fast counter service.

create or replace function public.update_pos_order_status(
  p_session_token text,
  p_order_id uuid,
  p_next_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_order record;
  v_transition_allowed boolean := false;
  v_completed_at timestamptz := null;
  v_amount_paid numeric := 0;
  v_balance_due numeric := 0;
begin
  select *
  into v_context
  from public.get_pos_session_and_shift(p_session_token);

  if p_next_status not in (
    'confirmed',
    'preparing',
    'ready',
    'awaiting_pickup',
    'out_for_delivery',
    'completed',
    'cancelled'
  ) then
    raise exception 'Invalid next order status';
  end if;

  select
    o.id,
    o.order_number,
    o.status,
    o.fulfillment_type,
    o.total
  into v_order
  from public.orders as o
  where o.id = p_order_id
    and o.branch_id = v_context.branch_id
  for update;

  if not found then
    raise exception 'Order not found for this branch';
  end if;

  if v_order.status in ('completed', 'cancelled', 'voided') then
    raise exception 'This order is already final and cannot be changed';
  end if;

  if v_order.status = p_next_status then
    v_transition_allowed := true;

  elsif v_order.status = 'confirmed'
    and p_next_status in ('preparing', 'cancelled') then
    v_transition_allowed := true;

  elsif v_order.status = 'preparing'
    and p_next_status in ('ready', 'cancelled') then
    v_transition_allowed := true;

  elsif v_order.status = 'ready'
    and (
      (
        v_order.fulfillment_type = 'delivery'
        and p_next_status = 'out_for_delivery'
      )
      or (
        v_order.fulfillment_type in ('walk-in', 'pickup', 'dine-in')
        and p_next_status = 'awaiting_pickup'
      )
      or (
        v_order.fulfillment_type in ('walk-in', 'dine-in')
        and p_next_status = 'completed'
      )
      or p_next_status = 'cancelled'
    ) then
    v_transition_allowed := true;

  elsif v_order.status = 'awaiting_pickup'
    and p_next_status in ('completed', 'cancelled') then
    v_transition_allowed := true;

  elsif v_order.status = 'out_for_delivery'
    and p_next_status in ('completed', 'cancelled') then
    v_transition_allowed := true;
  end if;

  if not v_transition_allowed then
    raise exception 'Invalid status transition from % to %', v_order.status, p_next_status;
  end if;

  -- Payment gate: an order may only be completed once it is fully settled.
  -- Cancellation is deliberately exempt so an unpaid order can still be voided.
  if p_next_status = 'completed' then
    select coalesce(sum(p.amount), 0)
    into v_amount_paid
    from public.payments as p
    where p.order_id = v_order.id;

    v_balance_due := round(v_order.total - v_amount_paid, 2);

    if v_balance_due > 0 then
      raise exception
        'Order % cannot be completed with % outstanding. Record the payment first.',
        v_order.order_number,
        to_char(v_balance_due, 'FM999999990.00');
    end if;

    v_completed_at := now();
  end if;

  update public.orders as o
  set
    status = p_next_status,
    completed_by_worker_id = case
      when p_next_status = 'completed' then v_context.worker_id
      else o.completed_by_worker_id
    end,
    completed_in_shift_id = case
      when p_next_status = 'completed' then v_context.shift_id
      else o.completed_in_shift_id
    end,
    completed_at = case
      when p_next_status = 'completed' then v_completed_at
      else o.completed_at
    end,
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
    'pos_order_status_updated',
    jsonb_build_object(
      'order_number', v_order.order_number,
      'previous_status', v_order.status,
      'next_status', p_next_status,
      'amount_paid_at_transition', v_amount_paid
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'previous_status', v_order.status,
    'status', p_next_status,
    'completed_at', v_completed_at
  );
end;
$$;

revoke all on function public.update_pos_order_status(text, uuid, text) from public;
grant execute on function public.update_pos_order_status(text, uuid, text) to anon, authenticated;
