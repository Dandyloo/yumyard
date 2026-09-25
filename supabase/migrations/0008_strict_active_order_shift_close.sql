-- 0008: Strict "no close with active orders" enforcement.
--
-- Previously, close_worker_shift() allowed closing with active orders as
-- long as they were explicitly handed over (with a note) - even if nobody
-- had claimed them yet - by requiring an owner/admin session token as a
-- bypass. That bypass is removed. The rule is now unconditional:
--
--   An order is "active and tied to this shift" if its status is not
--   completed/cancelled/voided, and either:
--     (a) this shift created it and has not handed it off away, or
--     (b) this shift received it via handover (handed_over_to_shift_id).
--
-- If any such order exists, shift close is rejected with no exceptions.
-- Handing an order off to another open shift remains the valid way to
-- offload it before closing - there is just no more admin override for
-- orders that were handed off but never claimed.
--
-- p_admin_session_token is kept in the signature (still defaults to null)
-- purely for backward compatibility with existing callers; it is no
-- longer read or required.

create or replace function public.get_shift_close_preview(
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session record;
  v_shift record;
  v_cash_sales numeric := 0;
  v_momo_sales numeric := 0;
  v_hubtel_sales numeric := 0;
  v_cash_paid_in numeric := 0;
  v_cash_paid_out numeric := 0;
  v_cash_refunds numeric := 0;
  v_expected_cash numeric := 0;
  v_open_orders jsonb := '[]'::jsonb;
  v_open_order_count integer := 0;
begin
  select *
  into v_session
  from public.current_worker_session(p_session_token, 'pos');

  select *
  into v_shift
  from public.shifts s
  where s.branch_id = v_session.branch_id
    and s.worker_id = v_session.worker_id
    and s.status in ('open', 'closing_review')
  order by s.opened_at desc
  limit 1;

  if not found then
    raise exception 'No active shift found for this worker';
  end if;

  select
    coalesce(sum(p.amount) filter (where p.payment_method = 'cash'), 0),
    coalesce(sum(p.amount) filter (where p.payment_method = 'momo'), 0),
    coalesce(sum(p.amount) filter (where p.payment_method = 'hubtel'), 0)
  into
    v_cash_sales,
    v_momo_sales,
    v_hubtel_sales
  from public.payments p
  where p.received_in_shift_id = v_shift.id;

  select
    coalesce(sum(cm.amount) filter (where cm.movement_type = 'paid_in'), 0),
    coalesce(sum(cm.amount) filter (where cm.movement_type = 'paid_out'), 0),
    coalesce(sum(cm.amount) filter (where cm.movement_type = 'refund'), 0)
  into
    v_cash_paid_in,
    v_cash_paid_out,
    v_cash_refunds
  from public.cash_movements cm
  where cm.shift_id = v_shift.id;

  v_expected_cash := round(
    v_shift.opening_cash_actual
    + v_cash_sales
    + v_cash_paid_in
    - v_cash_paid_out
    - v_cash_refunds,
    2
  );

  -- Active orders "tied to" this shift: created here and not handed off
  -- away, OR received here via handover. Orders this shift has already
  -- handed off (regardless of claim status) no longer count against it.
  select
    count(*),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_id', o.id,
          'order_number', o.order_number,
          'status', o.status,
          'fulfillment_type', o.fulfillment_type,
          'payment_status',
            case
              when coalesce(payment_totals.paid_amount, 0) >= o.total then 'paid'
              when coalesce(payment_totals.paid_amount, 0) > 0 then 'partially_paid'
              else 'unpaid'
            end,
          'total', o.total,
          'customer_name', o.customer_name,
          'customer_phone', o.customer_phone,
          'delivery_address', o.delivery_address,
          'rider_id', o.rider_id,
          'created_in_shift_id', o.created_in_shift_id
        )
        order by o.created_at asc
      ),
      '[]'::jsonb
    )
  into
    v_open_order_count,
    v_open_orders
  from public.orders o
  left join lateral (
    select coalesce(sum(p.amount), 0) as paid_amount
    from public.payments p
    where p.order_id = o.id
  ) payment_totals on true
  where o.branch_id = v_session.branch_id
    and o.status not in ('completed', 'cancelled', 'voided')
    and (
      (
        o.created_in_shift_id = v_shift.id
        and o.handed_over_from_shift_id is distinct from v_shift.id
      )
      or o.handed_over_to_shift_id = v_shift.id
    );

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'worker_id', v_session.worker_id,
    'worker_name', v_session.worker_name,
    'opened_at', v_shift.opened_at,
    'opening_cash_expected', v_shift.opening_cash_expected,
    'opening_cash_actual', v_shift.opening_cash_actual,
    'opening_cash_variance', v_shift.opening_cash_variance,
    'cash_sales_total', v_cash_sales,
    'momo_sales_total', v_momo_sales,
    'hubtel_sales_total', v_hubtel_sales,
    'cash_paid_in_total', v_cash_paid_in,
    'cash_paid_out_total', v_cash_paid_out,
    'cash_refund_total', v_cash_refunds,
    'expected_cash', v_expected_cash,
    'open_order_count', v_open_order_count,
    'open_orders', v_open_orders
  );
end;
$$;

create or replace function public.close_worker_shift(
  p_session_token text,
  p_actual_cash_counted numeric,
  p_closing_note text default null,
  p_admin_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_shift record;
  v_preview jsonb;
  v_active_order_count integer := 0;
  v_active_order_numbers text;
  v_handover_count integer := 0;
  v_expected_cash numeric;
  v_actual_cash numeric;
  v_cash_variance numeric;
begin
  select *
  into v_context
  from public.get_pos_session_and_shift(p_session_token);

  select *
  into v_shift
  from public.shifts as s
  where s.id = v_context.shift_id
  for update;

  if not found or v_shift.status <> 'open' then
    raise exception 'This shift is not available for closing';
  end if;

  if p_actual_cash_counted is null or p_actual_cash_counted < 0 then
    raise exception 'Actual cash counted must be zero or greater';
  end if;

  v_actual_cash := round(p_actual_cash_counted, 2);

  -- Strict, unconditional check: no active orders may remain tied to this
  -- shift. There is no admin-approval bypass. An order counts against this
  -- shift if it was created here and hasn't been handed off away, or if
  -- it was received here via handover.
  select
    count(*),
    string_agg(o.order_number, ', ' order by o.created_at asc)
  into
    v_active_order_count,
    v_active_order_numbers
  from public.orders as o
  where o.branch_id = v_context.branch_id
    and o.status not in ('completed', 'cancelled', 'voided')
    and (
      (
        o.created_in_shift_id = v_shift.id
        and o.handed_over_from_shift_id is distinct from v_shift.id
      )
      or o.handed_over_to_shift_id = v_shift.id
    );

  if v_active_order_count > 0 then
    raise exception
      'Cannot close shift: % active order(s) are still tied to it (%). Complete, cancel, or hand off these orders before closing.',
      v_active_order_count,
      v_active_order_numbers;
  end if;

  v_preview := public.get_shift_close_preview(p_session_token);
  v_expected_cash := round(coalesce((v_preview ->> 'expected_cash')::numeric, 0), 2);
  v_cash_variance := round(v_actual_cash - v_expected_cash, 2);

  if v_cash_variance <> 0
    and coalesce(trim(p_closing_note), '') = '' then
    raise exception 'A closing note is required when actual cash differs from expected cash';
  end if;

  -- Informational only: how many orders this shift handed off during its
  -- lifetime. Does not affect whether the shift can close.
  select count(*)
  into v_handover_count
  from public.orders as o
  where o.handed_over_from_shift_id = v_shift.id;

  update public.shifts as s
  set
    status = 'closed',
    closed_at = now(),
    cash_sales_total = coalesce((v_preview ->> 'cash_sales_total')::numeric, 0),
    momo_sales_total = coalesce((v_preview ->> 'momo_sales_total')::numeric, 0),
    hubtel_sales_total = coalesce((v_preview ->> 'hubtel_sales_total')::numeric, 0),
    delivery_fee_total = 0,
    cash_paid_in_total = coalesce((v_preview ->> 'cash_paid_in_total')::numeric, 0),
    cash_paid_out_total = coalesce((v_preview ->> 'cash_paid_out_total')::numeric, 0),
    cash_refund_total = coalesce((v_preview ->> 'cash_refund_total')::numeric, 0),
    expected_cash = v_expected_cash,
    actual_cash_counted = v_actual_cash,
    cash_variance = v_cash_variance,
    open_order_count_at_close = 0,
    handover_order_count = v_handover_count,
    closing_note = nullif(trim(p_closing_note), ''),
    requires_admin_approval = false,
    approved_by_worker_id = null,
    approved_at = null,
    closed_by_session_id = v_context.session_id,
    updated_at = now()
  where s.id = v_shift.id;

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
    v_shift.id,
    'shift',
    v_shift.id,
    'shift_closed',
    jsonb_build_object(
      'expected_cash', v_expected_cash,
      'actual_cash_counted', v_actual_cash,
      'cash_variance', v_cash_variance,
      'open_order_count', 0,
      'handover_order_count', v_handover_count,
      'closing_note', nullif(trim(p_closing_note), '')
    )
  );

  perform public.lock_worker_session(
    p_session_token,
    'Shift closed'
  );

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'worker_id', v_context.worker_id,
    'worker_name', v_context.worker_name,
    'status', 'closed',
    'opened_at', v_shift.opened_at,
    'closed_at', now(),
    'opening_cash_actual', v_shift.opening_cash_actual,
    'cash_sales_total', coalesce((v_preview ->> 'cash_sales_total')::numeric, 0),
    'momo_sales_total', coalesce((v_preview ->> 'momo_sales_total')::numeric, 0),
    'hubtel_sales_total', coalesce((v_preview ->> 'hubtel_sales_total')::numeric, 0),
    'expected_cash', v_expected_cash,
    'actual_cash_counted', v_actual_cash,
    'cash_variance', v_cash_variance,
    'open_order_count_at_close', 0,
    'handover_order_count', v_handover_count,
    'requires_admin_approval', false
  );
end;
$$;

revoke all on function public.get_shift_close_preview(text) from public;
revoke all on function public.close_worker_shift(text, numeric, text, text) from public;

grant execute on function public.get_shift_close_preview(text) to anon, authenticated;
grant execute on function public.close_worker_shift(text, numeric, text, text) to anon, authenticated;
