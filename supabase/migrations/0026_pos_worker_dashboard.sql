-- 0026: Per-worker dashboard for the POS ("My dashboard").
--
-- get_pos_worker_dashboard(session_token, scope)
--   scope 'shift' = the worker's current shift; 'day' = since the last day close
--   (or midnight Africa/Accra if the day has never been closed).
--   Returns: money collected by this worker split by payment method (any method that
--   appears), orders created (excl. cancelled/voided) with count/value/average,
--   cancelled orders (count, value, last 20 with reasons), outstanding balance on the
--   worker's active orders, and the current shift's expected drawer cash.
--   "Sold" = payments RECEIVED by this worker, so it reconciles with their cash count.

create or replace function public.get_pos_worker_dashboard(p_session_token text, p_scope text default 'shift')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_context record;
  v_scope text := case when lower(coalesce(p_scope, '')) = 'day' then 'day' else 'shift' end;
  v_since timestamptz;
  v_shift record;
  v_by_method jsonb;
  v_total_collected numeric := 0;
  v_orders_count integer := 0;
  v_orders_value numeric := 0;
  v_cancelled_count integer := 0;
  v_cancelled_value numeric := 0;
  v_cancelled jsonb := '[]'::jsonb;
  v_outstanding_count integer := 0;
  v_outstanding_balance numeric := 0;
  v_cash_collected numeric := 0;
  v_opening numeric := 0;
  v_snap record;
begin
  select * into v_context from public.get_pos_session_and_shift(p_session_token);

  select s.id, s.opened_at, s.opening_cash_actual into v_shift
  from public.shifts s where s.id = v_context.shift_id;

  select coalesce(
    (select bdc.closed_at from public.business_day_closes bdc
      where bdc.branch_id = v_context.branch_id order by bdc.closed_at desc limit 1),
    ((now() at time zone 'Africa/Accra')::date)::timestamp at time zone 'Africa/Accra'
  ) into v_since;

  select
    coalesce(jsonb_agg(jsonb_build_object('method', m.payment_method, 'amount', m.amount, 'count', m.cnt) order by m.amount desc), '[]'::jsonb),
    coalesce(sum(m.amount), 0),
    coalesce(sum(m.amount) filter (where m.payment_method = 'cash'), 0)
  into v_by_method, v_total_collected, v_cash_collected
  from (
    select p.payment_method, sum(p.amount) as amount, count(*)::integer as cnt
    from public.payments p
    where p.received_by_worker_id = v_context.worker_id
      and (
        (v_scope = 'shift' and p.received_in_shift_id = v_context.shift_id)
        or (v_scope = 'day' and p.received_at >= v_since)
      )
    group by p.payment_method
  ) m;

  select count(*)::integer, coalesce(sum(o.total), 0)
  into v_orders_count, v_orders_value
  from public.orders o
  where o.created_by_worker_id = v_context.worker_id
    and o.status not in ('cancelled', 'voided')
    and (
      (v_scope = 'shift' and o.created_in_shift_id = v_context.shift_id)
      or (v_scope = 'day' and o.created_at >= v_since)
    );

  select
    count(*)::integer,
    coalesce(sum(c.total), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'order_id', c.id, 'order_number', c.order_number, 'total', c.total,
      'reason', c.cancellation_reason, 'cancelled_at', c.cancelled_at,
      'cancelled_by', c.cancelled_by_name
    ) order by c.cancelled_at desc nulls last) filter (where c.rn <= 20), '[]'::jsonb)
  into v_cancelled_count, v_cancelled_value, v_cancelled
  from (
    select o.id, o.order_number, o.total, o.cancellation_reason, o.cancelled_at,
      cw.display_name as cancelled_by_name,
      row_number() over (order by o.cancelled_at desc nulls last) as rn
    from public.orders o
    left join public.workers cw on cw.id = o.cancelled_by_worker_id
    where o.created_by_worker_id = v_context.worker_id
      and o.status = 'cancelled'
      and (
        (v_scope = 'shift' and o.created_in_shift_id = v_context.shift_id)
        or (v_scope = 'day' and o.created_at >= v_since)
      )
  ) c;

  select count(*)::integer, coalesce(sum(greatest(x.total - x.paid, 0)), 0)
  into v_outstanding_count, v_outstanding_balance
  from (
    select o.total, coalesce((select sum(p.amount) from public.payments p where p.order_id = o.id), 0) as paid
    from public.orders o
    where o.created_by_worker_id = v_context.worker_id
      and o.branch_id = v_context.branch_id
      and o.status not in ('completed', 'cancelled', 'voided')
  ) x
  where x.paid < x.total;

  select * into v_snap from public.shift_cash_snapshot(v_context.shift_id);
  v_opening := coalesce(v_shift.opening_cash_actual, 0);

  return jsonb_build_object(
    'scope', v_scope,
    'since', case when v_scope = 'day' then v_since else v_shift.opened_at end,
    'worker_name', v_context.worker_name,
    'total_collected', v_total_collected,
    'by_method', v_by_method,
    'orders_count', v_orders_count,
    'orders_value', v_orders_value,
    'average_order_value', case when v_orders_count > 0 then round(v_orders_value / v_orders_count, 2) else 0 end,
    'cancelled_count', v_cancelled_count,
    'cancelled_value', v_cancelled_value,
    'cancelled_orders', v_cancelled,
    'outstanding_count', v_outstanding_count,
    'outstanding_balance', v_outstanding_balance,
    'shift_opening_cash', v_opening,
    'shift_cash_collected', v_snap.cash,
    'shift_expected_cash', round(v_opening + v_snap.cash + v_snap.paid_in - v_snap.paid_out - v_snap.refunds, 2)
  );
end;
$function$;
