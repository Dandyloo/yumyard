-- 0023: Allow workers to log in and keep their own shift open at any time.
--
-- Model change
--   Before: one open shift per branch; a new worker could not open a shift
--           until the previous worker closed theirs.
--   After:  one open shift per WORKER per branch. Shifts overlap freely.
--           - The first worker to open (no other shift open) confirms the
--             opening float as before.
--           - Later workers auto-open with 0 opening cash (shared till; they are
--             accountable for the cash they collect).
--           - All active orders in the branch are visible to every worker.
--           - A shift may close while other shifts are open (active orders carry
--             over). The LAST open shift cannot close while any active order
--             remains in the branch.

-- 1. Uniqueness: per worker instead of per branch -----------------------------
drop index if exists public.shifts_one_open_shift_per_branch_idx;

create unique index if not exists shifts_one_open_shift_per_worker_idx
  on public.shifts (branch_id, worker_id)
  where status in ('open', 'closing_review');

-- 2. Opening context -----------------------------------------------------------
drop function if exists public.get_shift_opening_context(text);

create function public.get_shift_opening_context(p_session_token text)
returns table(
  active_shift_id uuid,
  active_shift_worker_id uuid,
  active_shift_worker_name text,
  active_shift_opened_at timestamptz,
  previous_shift_id uuid,
  previous_worker_name text,
  previous_shift_closed_at timestamptz,
  inherited_cash numeric,
  requires_opening_cash boolean,
  after_day_close boolean,
  day_close_business_date date,
  other_open_shift_count integer
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_session record;
  v_own_shift record;
  v_others integer := 0;
  v_context record;
begin
  select * into v_session from public.current_worker_session(p_session_token, 'pos');

  select s.id, s.worker_id, w.display_name, s.opened_at
  into v_own_shift
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.worker_id = v_session.worker_id
    and s.status in ('open', 'closing_review')
  order by s.opened_at desc
  limit 1;

  select count(*)::integer
  into v_others
  from public.shifts as s
  where s.branch_id = v_session.branch_id
    and s.worker_id <> v_session.worker_id
    and s.status in ('open', 'closing_review');

  if v_own_shift.id is not null then
    return query
    select
      v_own_shift.id, v_own_shift.worker_id, v_own_shift.display_name, v_own_shift.opened_at,
      null::uuid, null::text, null::timestamptz, null::numeric, false, false, null::date, v_others;
    return;
  end if;

  if v_others > 0 then
    -- Till is already in use: no float confirmation, client auto-opens with 0.
    return query
    select
      null::uuid, null::uuid, null::text, null::timestamptz,
      null::uuid, null::text, null::timestamptz, 0::numeric, false, false, null::date, v_others;
    return;
  end if;

  select * into v_context from public.get_shift_inheritance_context(v_session.branch_id);

  return query
  select
    null::uuid, null::uuid, null::text, null::timestamptz,
    v_context.previous_shift_id, v_context.previous_worker_name, v_context.previous_shift_closed_at,
    v_context.expected_opening_cash, true,
    v_context.after_day_close, v_context.day_close_business_date, 0;
end;
$function$;

-- 3. Open shift -----------------------------------------------------------------
create or replace function public.open_worker_shift(
  p_session_token text,
  p_opening_cash_actual numeric,
  p_opening_note text default null
)
returns table(
  shift_id uuid, worker_id uuid, worker_name text, status text, opened_at timestamptz,
  opening_cash_expected numeric, opening_cash_actual numeric, opening_cash_variance numeric,
  inherited_from_shift_id uuid
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_session record;
  v_existing_shift record;
  v_context record;
  v_others integer := 0;
  v_expected numeric;
  v_source_shift uuid;
  v_actual_opening_cash numeric;
  v_shift_id uuid;
begin
  select * into v_session from public.current_worker_session(p_session_token, 'pos');

  -- Idempotent: return this worker's own open shift if there is one.
  select s.id, s.worker_id, w.display_name, s.status, s.opened_at,
    s.opening_cash_expected, s.opening_cash_actual, s.opening_cash_variance, s.opening_cash_source_shift_id
  into v_existing_shift
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.worker_id = v_session.worker_id
    and s.status in ('open', 'closing_review')
  order by s.opened_at desc
  limit 1;

  if found then
    return query
    select
      v_existing_shift.id, v_existing_shift.worker_id, v_existing_shift.display_name, v_existing_shift.status,
      v_existing_shift.opened_at, v_existing_shift.opening_cash_expected, v_existing_shift.opening_cash_actual,
      v_existing_shift.opening_cash_variance, v_existing_shift.opening_cash_source_shift_id;
    return;
  end if;

  select count(*)::integer
  into v_others
  from public.shifts as s
  where s.branch_id = v_session.branch_id
    and s.status in ('open', 'closing_review');

  select * into v_context from public.get_shift_inheritance_context(v_session.branch_id);

  if v_others > 0 then
    -- Shared till already in use: this shift starts at 0 and is accountable
    -- only for what this worker collects.
    v_expected := 0;
    v_actual_opening_cash := 0;
    v_source_shift := null;
  else
    if p_opening_cash_actual is null or p_opening_cash_actual < 0 then
      raise exception 'Opening cash must be zero or greater';
    end if;
    v_expected := v_context.expected_opening_cash;
    v_actual_opening_cash := round(p_opening_cash_actual, 2);
    v_source_shift := v_context.previous_shift_id;
  end if;

  insert into public.shifts (
    tenant_id, branch_id, worker_id, status, opened_at, opening_confirmed_at,
    opening_cash_expected, opening_cash_actual, opening_cash_variance,
    opening_cash_source_shift_id, closing_note
  )
  values (
    v_session.tenant_id, v_session.branch_id, v_session.worker_id, 'open', now(), now(),
    v_expected, v_actual_opening_cash,
    round(v_actual_opening_cash - v_expected, 2),
    v_source_shift,
    nullif(trim(p_opening_note), '')
  )
  returning id into v_shift_id;

  insert into public.audit_logs (
    tenant_id, branch_id, worker_id, shift_id, entity_type, entity_id, action, details
  )
  values (
    v_session.tenant_id, v_session.branch_id, v_session.worker_id, v_shift_id, 'shift', v_shift_id, 'shift_opened',
    jsonb_build_object(
      'opening_cash_expected', v_expected,
      'opening_cash_actual', v_actual_opening_cash,
      'opening_cash_variance', round(v_actual_opening_cash - v_expected, 2),
      'opening_note', nullif(trim(p_opening_note), ''),
      'after_day_close', case when v_others > 0 then false else coalesce(v_context.after_day_close, false) end,
      'concurrent_with_other_shifts', v_others > 0
    )
  );

  return query
  select s.id, s.worker_id, w.display_name, s.status, s.opened_at,
    s.opening_cash_expected, s.opening_cash_actual, s.opening_cash_variance, s.opening_cash_source_shift_id
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.id = v_shift_id;
end;
$function$;

-- 4. Active orders: visible to every worker in the branch -----------------------
create or replace function public.get_pos_active_orders(p_session_token text)
returns table(
  order_id uuid, order_number text, status text, fulfillment_type text, source text,
  customer_name text, customer_phone text, delivery_address text, rider_id uuid, rider_name text,
  order_notes text, subtotal numeric, delivery_fee numeric, total numeric, amount_paid numeric,
  balance_due numeric, payment_status text, created_at timestamptz, created_by_worker_name text,
  created_in_shift_id uuid, handed_over_from_shift_id uuid, handed_over_to_shift_id uuid, handover_note text
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_context record;
begin
  select * into v_context from public.get_pos_session_and_shift(p_session_token);

  return query
  select
    o.id, o.order_number, o.status, o.fulfillment_type, o.source,
    o.customer_name, o.customer_phone, o.delivery_address, o.rider_id, r.display_name,
    o.order_notes, o.subtotal, o.delivery_fee, o.total,
    coalesce(payment_totals.amount_paid, 0)::numeric,
    greatest(o.total - coalesce(payment_totals.amount_paid, 0), 0)::numeric,
    case
      when coalesce(payment_totals.amount_paid, 0) <= 0 then 'unpaid'
      when coalesce(payment_totals.amount_paid, 0) < o.total then 'partially_paid'
      else 'paid'
    end::text,
    o.created_at, creator.display_name,
    o.created_in_shift_id, o.handed_over_from_shift_id, o.handed_over_to_shift_id, o.handover_note
  from public.orders as o
  join public.workers as creator on creator.id = o.created_by_worker_id
  left join public.riders as r on r.id = o.rider_id
  left join lateral (
    select coalesce(sum(p.amount), 0) as amount_paid
    from public.payments as p
    where p.order_id = o.id
  ) as payment_totals on true
  where o.branch_id = v_context.branch_id
    and o.status not in ('completed', 'cancelled', 'voided')
  order by o.created_at desc;
end;
$function$;

-- 5. Close preview ----------------------------------------------------------------
create or replace function public.get_shift_close_preview(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
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
  v_other_open_shifts integer := 0;
  v_carry_over_count integer := 0;
begin
  select * into v_session from public.current_worker_session(p_session_token, 'pos');

  select * into v_shift
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
  into v_cash_sales, v_momo_sales, v_hubtel_sales
  from public.payments p
  where p.received_in_shift_id = v_shift.id;

  select
    coalesce(sum(cm.amount) filter (where cm.movement_type = 'paid_in'), 0),
    coalesce(sum(cm.amount) filter (where cm.movement_type = 'paid_out'), 0),
    coalesce(sum(cm.amount) filter (where cm.movement_type = 'refund'), 0)
  into v_cash_paid_in, v_cash_paid_out, v_cash_refunds
  from public.cash_movements cm
  where cm.shift_id = v_shift.id;

  v_expected_cash := round(
    v_shift.opening_cash_actual + v_cash_sales + v_cash_paid_in - v_cash_paid_out - v_cash_refunds, 2
  );

  select count(*)::integer into v_other_open_shifts
  from public.shifts s
  where s.branch_id = v_session.branch_id
    and s.id <> v_shift.id
    and s.status in ('open', 'closing_review');

  select count(*)::integer into v_carry_over_count
  from public.orders o
  where o.branch_id = v_session.branch_id
    and o.status not in ('completed', 'cancelled', 'voided');

  -- Only the LAST open shift is blocked by active orders (branch-wide).
  -- With other shifts still open, active orders carry over to them.
  if v_other_open_shifts = 0 then
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
    into v_open_order_count, v_open_orders
    from public.orders o
    left join lateral (
      select coalesce(sum(p.amount), 0) as paid_amount
      from public.payments p
      where p.order_id = o.id
    ) payment_totals on true
    where o.branch_id = v_session.branch_id
      and o.status not in ('completed', 'cancelled', 'voided');
  end if;

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
    'open_orders', v_open_orders,
    'other_open_shift_count', v_other_open_shifts,
    'carry_over_order_count', case when v_other_open_shifts > 0 then v_carry_over_count else 0 end
  );
end;
$function$;

-- 6. Close shift --------------------------------------------------------------------
create or replace function public.close_worker_shift(
  p_session_token text,
  p_actual_cash_counted numeric,
  p_closing_note text default null,
  p_admin_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_context record;
  v_shift record;
  v_preview jsonb;
  v_other_open_shifts integer := 0;
  v_active_order_count integer := 0;
  v_active_order_numbers text;
  v_handover_count integer := 0;
  v_expected_cash numeric;
  v_actual_cash numeric;
  v_cash_variance numeric;
begin
  select * into v_context from public.get_pos_session_and_shift(p_session_token);

  select * into v_shift
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

  select count(*)::integer into v_other_open_shifts
  from public.shifts as s
  where s.branch_id = v_context.branch_id
    and s.id <> v_shift.id
    and s.status in ('open', 'closing_review');

  -- Only the last open shift is blocked by active orders (branch-wide).
  if v_other_open_shifts = 0 then
    select count(*), string_agg(o.order_number, ', ' order by o.created_at asc)
    into v_active_order_count, v_active_order_numbers
    from public.orders as o
    where o.branch_id = v_context.branch_id
      and o.status not in ('completed', 'cancelled', 'voided');

    if v_active_order_count > 0 then
      raise exception
        'Cannot close the last open shift: % active order(s) are still in progress (%). Complete or cancel them first.',
        v_active_order_count, v_active_order_numbers;
    end if;
  end if;

  v_preview := public.get_shift_close_preview(p_session_token);
  v_expected_cash := round(coalesce((v_preview ->> 'expected_cash')::numeric, 0), 2);
  v_cash_variance := round(v_actual_cash - v_expected_cash, 2);

  if v_cash_variance <> 0 and coalesce(trim(p_closing_note), '') = '' then
    raise exception 'A closing note is required when actual cash differs from expected cash';
  end if;

  select count(*) into v_handover_count
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
    tenant_id, branch_id, worker_id, shift_id, entity_type, entity_id, action, details
  )
  values (
    v_context.tenant_id, v_context.branch_id, v_context.worker_id, v_shift.id,
    'shift', v_shift.id, 'shift_closed',
    jsonb_build_object(
      'expected_cash', v_expected_cash,
      'actual_cash_counted', v_actual_cash,
      'cash_variance', v_cash_variance,
      'other_open_shift_count', v_other_open_shifts,
      'handover_order_count', v_handover_count,
      'closing_note', nullif(trim(p_closing_note), '')
    )
  );

  perform public.lock_worker_session(p_session_token, 'Shift closed');

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
$function$;
