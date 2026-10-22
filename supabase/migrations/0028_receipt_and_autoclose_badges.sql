-- 0028: Receipt data + admin badges for force/auto-closed shifts.
--
-- get_pos_order_receipt(): branch-scoped (any signed-in worker can reprint any order);
--   returns items, payments, amount paid, balance due, who served, who printed.
-- get_admin_shift_history() / get_admin_shift_detail(): expose force_closed / auto_closed so the
--   Admin app can badge shifts closed by the 01:00 job or by "Close the day anyway".

create or replace function public.get_pos_order_receipt(p_session_token text, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_context record;
  v_order record;
  v_paid numeric;
  v_result jsonb;
begin
  select * into v_context from public.get_pos_session_and_shift(p_session_token);

  select o.*, cw.display_name as created_by_name
  into v_order
  from public.orders as o
  left join public.workers as cw on cw.id = o.created_by_worker_id
  where o.id = p_order_id and o.branch_id = v_context.branch_id;

  if not found then
    raise exception 'Order not found';
  end if;

  select coalesce(sum(pay.amount), 0) into v_paid from public.payments pay where pay.order_id = v_order.id;

  select jsonb_build_object(
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'status', v_order.status,
    'fulfillmentType', v_order.fulfillment_type,
    'source', v_order.source,
    'customerName', v_order.customer_name,
    'customerPhone', v_order.customer_phone,
    'deliveryAddress', v_order.delivery_address,
    'orderNotes', v_order.order_notes,
    'subtotal', v_order.subtotal,
    'deliveryFee', v_order.delivery_fee,
    'total', v_order.total,
    'amountPaid', v_paid,
    'balanceDue', greatest(v_order.total - v_paid, 0),
    'createdAt', v_order.created_at,
    'createdByName', v_order.created_by_name,
    'printedByName', v_context.worker_name,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemName', oi.item_name, 'unitPrice', oi.unit_price, 'quantity', oi.quantity,
        'proteinChoice', oi.protein_choice, 'lineTotal', oi.line_total) order by oi.created_at)
      from public.order_items as oi where oi.order_id = v_order.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'paymentMethod', pay.payment_method, 'amount', pay.amount, 'receivedAt', pay.received_at) order by pay.received_at)
      from public.payments as pay where pay.order_id = v_order.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

drop function if exists public.get_admin_shift_history(text, date, date, uuid, integer, integer);

create function public.get_admin_shift_history(
  p_session_token text, p_date_from date default null, p_date_to date default null,
  p_worker_id uuid default null, p_limit integer default 50, p_offset integer default 0
)
returns table(
  shift_id uuid, worker_name text, status text, opened_at timestamptz, closed_at timestamptz,
  opening_cash_actual numeric, expected_cash numeric, actual_cash_counted numeric, cash_variance numeric,
  closing_note text, total_count bigint, force_closed boolean, auto_closed boolean
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_context record;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  return query
  with matching_shifts as (
    select s.*
    from public.shifts as s
    where s.branch_id = v_context.branch_id
      and (p_date_from is null or (s.opened_at at time zone 'Africa/Accra')::date >= p_date_from)
      and (p_date_to is null or (s.opened_at at time zone 'Africa/Accra')::date <= p_date_to)
      and (p_worker_id is null or s.worker_id = p_worker_id)
  )
  select
    ms.id, w.display_name, ms.status, ms.opened_at, ms.closed_at, ms.opening_cash_actual,
    ms.expected_cash, ms.actual_cash_counted, ms.cash_variance, ms.closing_note,
    count(*) over (), ms.force_closed, ms.auto_closed
  from matching_shifts as ms
  join public.workers as w on w.id = ms.worker_id
  order by ms.opened_at desc
  limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

create or replace function public.get_admin_shift_detail(p_session_token text, p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_context record;
  v_shift record;
  v_result jsonb;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  select s.*, w.display_name as worker_name
  into v_shift
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.id = p_shift_id and s.branch_id = v_context.branch_id;

  if not found then
    raise exception 'Shift not found for this branch';
  end if;

  select jsonb_build_object(
    'shiftId', v_shift.id,
    'workerName', v_shift.worker_name,
    'status', v_shift.status,
    'openedAt', v_shift.opened_at,
    'closedAt', v_shift.closed_at,
    'forceClosed', v_shift.force_closed,
    'autoClosed', v_shift.auto_closed,
    'openingCashActual', v_shift.opening_cash_actual,
    'cashSalesTotal', v_shift.cash_sales_total,
    'momoSalesTotal', v_shift.momo_sales_total,
    'hubtelSalesTotal', v_shift.hubtel_sales_total,
    'deliveryFeeTotal', v_shift.delivery_fee_total,
    'cashPaidInTotal', v_shift.cash_paid_in_total,
    'cashPaidOutTotal', v_shift.cash_paid_out_total,
    'cashRefundTotal', v_shift.cash_refund_total,
    'expectedCash', v_shift.expected_cash,
    'actualCashCounted', v_shift.actual_cash_counted,
    'cashVariance', v_shift.cash_variance,
    'closingNote', v_shift.closing_note,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'orderId', o.id, 'orderNumber', o.order_number, 'status', o.status,
        'fulfillmentType', o.fulfillment_type, 'total', o.total, 'createdAt', o.created_at) order by o.created_at)
      from public.orders as o
      where o.branch_id = v_context.branch_id
        and (o.created_in_shift_id = v_shift.id or o.handed_over_to_shift_id = v_shift.id)
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pay.id, 'orderNumber', o.order_number, 'paymentMethod', pay.payment_method,
        'amount', pay.amount, 'reference', pay.reference, 'receivedAt', pay.received_at) order by pay.received_at)
      from public.payments as pay
      join public.orders as o on o.id = pay.order_id
      where pay.received_in_shift_id = v_shift.id
    ), '[]'::jsonb),
    'cashMovements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cm.id, 'movementType', cm.movement_type, 'amount', cm.amount,
        'reason', cm.reason, 'createdAt', cm.created_at) order by cm.created_at)
      from public.cash_movements as cm where cm.shift_id = v_shift.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;
