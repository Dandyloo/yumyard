-- Admin Shift History (Phase 3, Task 6).
--
-- "All orders in that shift" reuses the exact same ownership rule as
-- get_pos_active_orders() (0004/0012): an order belongs to a shift if it
-- was either created there or handed into it
-- (created_in_shift_id = shift_id or handed_over_to_shift_id = shift_id).

drop function if exists public.get_admin_shift_history(text, date, date, uuid, integer, integer) cascade;
drop function if exists public.get_admin_shift_detail(text, uuid) cascade;

create or replace function public.get_admin_shift_history(
  p_session_token text,
  p_date_from date default null,
  p_date_to date default null,
  p_worker_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  shift_id uuid,
  worker_name text,
  status text,
  opened_at timestamptz,
  closed_at timestamptz,
  opening_cash_actual numeric,
  expected_cash numeric,
  actual_cash_counted numeric,
  cash_variance numeric,
  closing_note text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  return query
  with matching_shifts as (
    select s.*
    from public.shifts as s
    where s.branch_id = v_context.branch_id
      and (
        p_date_from is null
        or (s.opened_at at time zone 'Africa/Accra')::date >= p_date_from
      )
      and (
        p_date_to is null
        or (s.opened_at at time zone 'Africa/Accra')::date <= p_date_to
      )
      and (p_worker_id is null or s.worker_id = p_worker_id)
  )
  select
    ms.id,
    w.display_name,
    ms.status,
    ms.opened_at,
    ms.closed_at,
    ms.opening_cash_actual,
    ms.expected_cash,
    ms.actual_cash_counted,
    ms.cash_variance,
    ms.closing_note,
    count(*) over ()
  from matching_shifts as ms
  join public.workers as w
    on w.id = ms.worker_id
  order by ms.opened_at desc
  limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.get_admin_shift_detail(
  p_session_token text,
  p_shift_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_shift record;
  v_result jsonb;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  select s.*, w.display_name as worker_name
  into v_shift
  from public.shifts as s
  join public.workers as w
    on w.id = s.worker_id
  where s.id = p_shift_id
    and s.branch_id = v_context.branch_id;

  if not found then
    raise exception 'Shift not found for this branch';
  end if;

  select jsonb_build_object(
    'shiftId', v_shift.id,
    'workerName', v_shift.worker_name,
    'status', v_shift.status,
    'openedAt', v_shift.opened_at,
    'closedAt', v_shift.closed_at,
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
      select jsonb_agg(
        jsonb_build_object(
          'orderId', o.id,
          'orderNumber', o.order_number,
          'status', o.status,
          'fulfillmentType', o.fulfillment_type,
          'total', o.total,
          'createdAt', o.created_at
        )
        order by o.created_at
      )
      from public.orders as o
      where o.branch_id = v_context.branch_id
        and (
          o.created_in_shift_id = v_shift.id
          or o.handed_over_to_shift_id = v_shift.id
        )
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pay.id,
          'orderNumber', o.order_number,
          'paymentMethod', pay.payment_method,
          'amount', pay.amount,
          'reference', pay.reference,
          'receivedAt', pay.received_at
        )
        order by pay.received_at
      )
      from public.payments as pay
      join public.orders as o
        on o.id = pay.order_id
      where pay.received_in_shift_id = v_shift.id
    ), '[]'::jsonb),
    'cashMovements', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cm.id,
          'movementType', cm.movement_type,
          'amount', cm.amount,
          'reason', cm.reason,
          'createdAt', cm.created_at
        )
        order by cm.created_at
      )
      from public.cash_movements as cm
      where cm.shift_id = v_shift.id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_admin_shift_history(text, date, date, uuid, integer, integer) to anon, authenticated;
grant execute on function public.get_admin_shift_detail(text, uuid) to anon, authenticated;
