-- POS Close Day. Distinct from an individual worker's shift close: this
-- is the business-day-level close (the "Z-report" pattern) that
-- aggregates every shift since the last day-close, records what the
-- owner actually walked away with, and - critically - breaks the cash
-- inheritance chain so tomorrow's first shift doesn't silently expect
-- to find last night's full drawer count still sitting there.
--
-- Gated to owner/manager only, POS-side (access_area = 'pos'), and only
-- runnable when there is no currently active shift for the branch.

create table public.business_day_closes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  business_date date not null,
  closed_by_worker_id uuid not null references public.workers(id),
  closed_at timestamptz not null default now(),
  shifts_count integer not null default 0,
  total_sales numeric not null default 0,
  total_orders integer not null default 0,
  cash_handed_over numeric not null default 0,
  opening_float_for_next_day numeric not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index business_day_closes_branch_closed_at_idx
  on public.business_day_closes (branch_id, closed_at desc);

-- Same lock-down pattern as every other business table (see
-- 0009_lock_down_table_grants.sql) - RLS enabled, no direct grants at
-- all, reachable only through SECURITY DEFINER RPCs below.
alter table public.business_day_closes enable row level security;
revoke all on public.business_day_closes from anon, authenticated;

drop function if exists public.get_shift_opening_context(text) cascade;
drop function if exists public.open_worker_shift(text, numeric, text) cascade;
drop function if exists public.get_close_day_preview(text) cascade;
drop function if exists public.close_business_day(text, numeric, numeric, text) cascade;

-- Shared logic for both the preview screen and the actual shift-open:
-- whichever happened more recently - a shift closing, or a day closing -
-- determines what the next shift should expect to find in the drawer.
-- Kept as its own function so open_worker_shift() and
-- get_shift_opening_context() can never quietly drift out of sync with
-- each other on this math.
drop function if exists public.get_shift_inheritance_context(uuid) cascade;

create or replace function public.get_shift_inheritance_context(
  p_branch_id uuid
)
returns table (
  expected_opening_cash numeric,
  previous_shift_id uuid,
  previous_worker_name text,
  previous_shift_closed_at timestamptz,
  after_day_close boolean,
  day_close_business_date date,
  day_close_opening_float numeric
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_previous_shift record;
  v_last_close record;
begin
  select s.id, w.display_name, s.closed_at, coalesce(s.actual_cash_counted, 0) as actual_cash_counted
  into v_previous_shift
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.branch_id = p_branch_id
    and s.status = 'closed'
  order by s.closed_at desc
  limit 1;

  select bdc.business_date, bdc.closed_at, bdc.opening_float_for_next_day
  into v_last_close
  from public.business_day_closes as bdc
  where bdc.branch_id = p_branch_id
  order by bdc.closed_at desc
  limit 1;

  -- The day close is the more recent event (or there are no shifts at
  -- all yet) - the chain is broken, next shift starts from the float the
  -- owner set when closing the day, not from any prior shift's count.
  if v_last_close.closed_at is not null
    and (v_previous_shift.closed_at is null or v_last_close.closed_at > v_previous_shift.closed_at) then
    return query
    select
      v_last_close.opening_float_for_next_day,
      null::uuid,
      null::text,
      null::timestamptz,
      true,
      v_last_close.business_date,
      v_last_close.opening_float_for_next_day;
    return;
  end if;

  if v_previous_shift.id is not null then
    return query
    select
      v_previous_shift.actual_cash_counted,
      v_previous_shift.id,
      v_previous_shift.display_name,
      v_previous_shift.closed_at,
      false,
      null::date,
      null::numeric;
    return;
  end if;

  -- True first-ever shift for this branch.
  return query
  select 0::numeric, null::uuid, null::text, null::timestamptz, false, null::date, null::numeric;
end;
$$;

create or replace function public.get_shift_opening_context(p_session_token text)
returns table (
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
  day_close_business_date date
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session record;
  v_active_shift record;
  v_context record;
begin
  select * into v_session from public.current_worker_session(p_session_token, 'pos');

  select s.id, s.worker_id, w.display_name, s.opened_at
  into v_active_shift
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.status in ('open', 'closing_review')
  order by s.opened_at desc
  limit 1;

  if found then
    return query
    select
      v_active_shift.id, v_active_shift.worker_id, v_active_shift.display_name, v_active_shift.opened_at,
      null::uuid, null::text, null::timestamptz, null::numeric, false, false, null::date;
    return;
  end if;

  select * into v_context from public.get_shift_inheritance_context(v_session.branch_id);

  return query
  select
    null::uuid, null::uuid, null::text, null::timestamptz,
    v_context.previous_shift_id, v_context.previous_worker_name, v_context.previous_shift_closed_at,
    v_context.expected_opening_cash, true,
    v_context.after_day_close, v_context.day_close_business_date;
end;
$$;

create or replace function public.open_worker_shift(
  p_session_token text,
  p_opening_cash_actual numeric,
  p_opening_note text default null
)
returns table (
  shift_id uuid,
  worker_id uuid,
  worker_name text,
  status text,
  opened_at timestamptz,
  opening_cash_expected numeric,
  opening_cash_actual numeric,
  opening_cash_variance numeric,
  inherited_from_shift_id uuid
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session record;
  v_existing_shift record;
  v_context record;
  v_actual_opening_cash numeric;
  v_shift_id uuid;
begin
  select * into v_session from public.current_worker_session(p_session_token, 'pos');

  if p_opening_cash_actual is null or p_opening_cash_actual < 0 then
    raise exception 'Opening cash must be zero or greater';
  end if;

  v_actual_opening_cash := round(p_opening_cash_actual, 2);

  select s.id, s.worker_id, w.display_name, s.status, s.opened_at,
    s.opening_cash_expected, s.opening_cash_actual, s.opening_cash_variance, s.opening_cash_source_shift_id
  into v_existing_shift
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.status in ('open', 'closing_review')
  order by s.opened_at desc
  limit 1;

  if found then
    if v_existing_shift.worker_id = v_session.worker_id then
      return query
      select
        v_existing_shift.id, v_existing_shift.worker_id, v_existing_shift.display_name, v_existing_shift.status,
        v_existing_shift.opened_at, v_existing_shift.opening_cash_expected, v_existing_shift.opening_cash_actual,
        v_existing_shift.opening_cash_variance, v_existing_shift.opening_cash_source_shift_id;
      return;
    end if;

    raise exception 'Another worker has an active shift. The current shift must be closed before you can open yours.';
  end if;

  select * into v_context from public.get_shift_inheritance_context(v_session.branch_id);

  insert into public.shifts (
    tenant_id, branch_id, worker_id, status, opened_at, opening_confirmed_at,
    opening_cash_expected, opening_cash_actual, opening_cash_variance,
    opening_cash_source_shift_id, closing_note
  )
  values (
    v_session.tenant_id, v_session.branch_id, v_session.worker_id, 'open', now(), now(),
    v_context.expected_opening_cash, v_actual_opening_cash,
    round(v_actual_opening_cash - v_context.expected_opening_cash, 2),
    v_context.previous_shift_id,
    nullif(trim(p_opening_note), '')
  )
  returning id into v_shift_id;

  insert into public.audit_logs (
    tenant_id, branch_id, worker_id, shift_id, entity_type, entity_id, action, details
  )
  values (
    v_session.tenant_id, v_session.branch_id, v_session.worker_id, v_shift_id, 'shift', v_shift_id, 'shift_opened',
    jsonb_build_object(
      'opening_cash_expected', v_context.expected_opening_cash,
      'opening_cash_actual', v_actual_opening_cash,
      'opening_cash_variance', round(v_actual_opening_cash - v_context.expected_opening_cash, 2),
      'opening_note', nullif(trim(p_opening_note), ''),
      'after_day_close', v_context.after_day_close
    )
  );

  return query
  select s.id, s.worker_id, w.display_name, s.status, s.opened_at,
    s.opening_cash_expected, s.opening_cash_actual, s.opening_cash_variance, s.opening_cash_source_shift_id
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.id = v_shift_id;
end;
$$;

create or replace function public.get_close_day_preview(p_session_token text)
returns table (
  can_close boolean,
  blocked_reason text,
  business_date date,
  shifts_count integer,
  total_sales numeric,
  total_orders integer,
  last_shift_worker_name text,
  last_shift_closed_at timestamptz,
  last_shift_actual_cash_counted numeric
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session record;
  v_active_shift_count integer;
  v_since timestamptz;
  v_last_shift record;
  v_totals record;
begin
  select * into v_session from public.current_worker_session(p_session_token, 'pos');

  select count(*) into v_active_shift_count
  from public.shifts
  where branch_id = v_session.branch_id
    and status in ('open', 'closing_review');

  select bdc.closed_at into v_since
  from public.business_day_closes as bdc
  where bdc.branch_id = v_session.branch_id
  order by bdc.closed_at desc
  limit 1;

  select s.id, w.display_name, s.closed_at, coalesce(s.actual_cash_counted, 0) as actual_cash_counted
  into v_last_shift
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.status = 'closed'
    and (v_since is null or s.closed_at > v_since)
  order by s.closed_at desc
  limit 1;

  select
    count(*) filter (where s.status = 'closed') as shifts_count,
    coalesce(sum(o.total) filter (where o.status not in ('cancelled', 'voided')), 0) as total_sales,
    count(o.id) filter (where o.status not in ('cancelled', 'voided')) as total_orders
  into v_totals
  from public.shifts as s
  left join public.orders as o
    on o.branch_id = v_session.branch_id
    and (o.created_in_shift_id = s.id or o.handed_over_to_shift_id = s.id)
  where s.branch_id = v_session.branch_id
    and s.status = 'closed'
    and (v_since is null or s.closed_at > v_since);

  return query
  select
    (v_active_shift_count = 0 and v_session.worker_role in ('owner', 'manager')),
    case
      when v_active_shift_count > 0 then 'Close the current shift before closing the day'
      when v_session.worker_role not in ('owner', 'manager') then 'Only an owner or manager can close the day'
      else null
    end,
    (now() at time zone 'Africa/Accra')::date,
    coalesce(v_totals.shifts_count, 0)::integer,
    coalesce(v_totals.total_sales, 0)::numeric,
    coalesce(v_totals.total_orders, 0)::integer,
    v_last_shift.display_name,
    v_last_shift.closed_at,
    coalesce(v_last_shift.actual_cash_counted, 0)::numeric;
end;
$$;

create or replace function public.close_business_day(
  p_session_token text,
  p_cash_handed_over numeric,
  p_opening_float_for_next_day numeric default 0,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session record;
  v_active_shift_count integer;
  v_since timestamptz;
  v_totals record;
  v_id uuid;
begin
  select * into v_session from public.current_worker_session(p_session_token, 'pos');

  if v_session.worker_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can close the day';
  end if;

  select count(*) into v_active_shift_count
  from public.shifts
  where branch_id = v_session.branch_id
    and status in ('open', 'closing_review');

  if v_active_shift_count > 0 then
    raise exception 'Close the current shift before closing the day';
  end if;

  if p_cash_handed_over is null or p_cash_handed_over < 0 then
    raise exception 'Cash handed over must be zero or greater';
  end if;

  if p_opening_float_for_next_day is null or p_opening_float_for_next_day < 0 then
    raise exception 'Opening float for next day must be zero or greater';
  end if;

  select bdc.closed_at into v_since
  from public.business_day_closes as bdc
  where bdc.branch_id = v_session.branch_id
  order by bdc.closed_at desc
  limit 1;

  select
    count(*) filter (where s.status = 'closed') as shifts_count,
    coalesce(sum(o.total) filter (where o.status not in ('cancelled', 'voided')), 0) as total_sales,
    count(o.id) filter (where o.status not in ('cancelled', 'voided')) as total_orders
  into v_totals
  from public.shifts as s
  left join public.orders as o
    on o.branch_id = v_session.branch_id
    and (o.created_in_shift_id = s.id or o.handed_over_to_shift_id = s.id)
  where s.branch_id = v_session.branch_id
    and s.status = 'closed'
    and (v_since is null or s.closed_at > v_since);

  insert into public.business_day_closes (
    tenant_id, branch_id, business_date, closed_by_worker_id,
    shifts_count, total_sales, total_orders, cash_handed_over, opening_float_for_next_day, notes
  )
  values (
    v_session.tenant_id, v_session.branch_id, (now() at time zone 'Africa/Accra')::date, v_session.worker_id,
    coalesce(v_totals.shifts_count, 0), coalesce(v_totals.total_sales, 0), coalesce(v_totals.total_orders, 0),
    round(p_cash_handed_over, 2), round(p_opening_float_for_next_day, 2), nullif(trim(p_notes), '')
  )
  returning id into v_id;

  insert into public.audit_logs (
    tenant_id, branch_id, worker_id, entity_type, entity_id, action, details
  )
  values (
    v_session.tenant_id, v_session.branch_id, v_session.worker_id, 'business_day_close', v_id, 'business_day_closed',
    jsonb_build_object(
      'shifts_count', coalesce(v_totals.shifts_count, 0),
      'total_sales', coalesce(v_totals.total_sales, 0),
      'cash_handed_over', round(p_cash_handed_over, 2),
      'opening_float_for_next_day', round(p_opening_float_for_next_day, 2)
    )
  );

  return v_id;
end;
$$;

grant execute on function public.get_shift_opening_context(text) to anon, authenticated;
grant execute on function public.open_worker_shift(text, numeric, text) to anon, authenticated;
grant execute on function public.get_close_day_preview(text) to anon, authenticated;
grant execute on function public.close_business_day(text, numeric, numeric, text) to anon, authenticated;
