-- 0024: Close Day open to any POS worker, drawer-aware cash totals.
--
-- * get_branch_drawer_cash(): total physical cash expected in the shared drawer
--   since the last day close = first shift's opening float + each closed shift's
--   net cash added (counted - opening). Correct for both sequential and
--   overlapping shifts. Internal only (execute revoked).
-- * get_shift_inheritance_context(): next opening cash uses the drawer total,
--   not just the last closer's count (which is wrong once shifts overlap).
-- * get_close_day_preview() / close_business_day(): no owner/manager role gate;
--   blocked while any shift is open (names listed) or any order is still active.
--   The closer is recorded in audit_logs (details.closed_by_role) and
--   business_day_closes.closed_by_worker_id.

create or replace function public.get_branch_drawer_cash(p_branch_id uuid)
returns numeric
language plpgsql
stable
set search_path to 'public', 'extensions'
as $function$
declare
  v_since timestamptz;
  v_first_opening numeric;
  v_net numeric;
  v_count integer;
begin
  select bdc.closed_at into v_since
  from public.business_day_closes as bdc
  where bdc.branch_id = p_branch_id
  order by bdc.closed_at desc
  limit 1;

  select s.opening_cash_actual into v_first_opening
  from public.shifts as s
  where s.branch_id = p_branch_id
    and s.status = 'closed'
    and (v_since is null or s.closed_at > v_since)
  order by s.opened_at asc
  limit 1;

  select count(*), coalesce(sum(coalesce(s.actual_cash_counted, 0) - coalesce(s.opening_cash_actual, 0)), 0)
  into v_count, v_net
  from public.shifts as s
  where s.branch_id = p_branch_id
    and s.status = 'closed'
    and (v_since is null or s.closed_at > v_since);

  if v_count = 0 then
    return null;
  end if;

  return round(coalesce(v_first_opening, 0) + v_net, 2);
end;
$function$;

revoke all on function public.get_branch_drawer_cash(uuid) from public, anon, authenticated;

create or replace function public.get_shift_inheritance_context(p_branch_id uuid)
returns table(expected_opening_cash numeric, previous_shift_id uuid, previous_worker_name text, previous_shift_closed_at timestamptz, after_day_close boolean, day_close_business_date date, day_close_opening_float numeric)
language plpgsql
stable
set search_path to 'public', 'extensions'
as $function$
declare
  v_previous_shift record;
  v_last_close record;
  v_drawer numeric;
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

  if v_last_close.closed_at is not null
    and (v_previous_shift.closed_at is null or v_last_close.closed_at > v_previous_shift.closed_at) then
    return query
    select
      v_last_close.opening_float_for_next_day,
      null::uuid, null::text, null::timestamptz,
      true,
      v_last_close.business_date,
      v_last_close.opening_float_for_next_day;
    return;
  end if;

  if v_previous_shift.id is not null then
    v_drawer := public.get_branch_drawer_cash(p_branch_id);
    return query
    select
      coalesce(v_drawer, v_previous_shift.actual_cash_counted),
      v_previous_shift.id,
      v_previous_shift.display_name,
      v_previous_shift.closed_at,
      false,
      null::date,
      null::numeric;
    return;
  end if;

  return query
  select 0::numeric, null::uuid, null::text, null::timestamptz, false, null::date, null::numeric;
end;
$function$;

drop function if exists public.get_close_day_preview(text);

create function public.get_close_day_preview(p_session_token text)
returns table(
  can_close boolean, blocked_reason text, business_date date, shifts_count integer,
  total_sales numeric, total_orders integer, last_shift_worker_name text,
  last_shift_closed_at timestamptz, last_shift_actual_cash_counted numeric,
  drawer_cash_total numeric, open_shift_count integer, open_shift_workers text
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_session record;
  v_active_shift_count integer;
  v_open_workers text;
  v_active_orders integer;
  v_since timestamptz;
  v_last_shift record;
  v_totals record;
  v_drawer numeric;
begin
  select * into v_session from public.current_worker_session(p_session_token, 'pos');

  select count(*), string_agg(w.display_name, ', ' order by s.opened_at)
  into v_active_shift_count, v_open_workers
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.status in ('open', 'closing_review');

  select count(*) into v_active_orders
  from public.orders as o
  where o.branch_id = v_session.branch_id
    and o.status not in ('completed', 'cancelled', 'voided');

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

  v_drawer := public.get_branch_drawer_cash(v_session.branch_id);

  return query
  select
    (v_active_shift_count = 0 and v_active_orders = 0),
    case
      when v_active_shift_count > 0 then 'These shifts are still open: ' || v_open_workers || '. Each worker must close their shift first.'
      when v_active_orders > 0 then v_active_orders::text || ' active order(s) are still in progress. Complete or cancel them first.'
      else null
    end,
    (now() at time zone 'Africa/Accra')::date,
    coalesce(v_totals.shifts_count, 0)::integer,
    coalesce(v_totals.total_sales, 0)::numeric,
    coalesce(v_totals.total_orders, 0)::integer,
    v_last_shift.display_name,
    v_last_shift.closed_at,
    coalesce(v_last_shift.actual_cash_counted, 0)::numeric,
    coalesce(v_drawer, 0)::numeric,
    v_active_shift_count,
    v_open_workers;
end;
$function$;

create or replace function public.close_business_day(
  p_session_token text,
  p_cash_handed_over numeric,
  p_opening_float_for_next_day numeric default 0,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_session record;
  v_active_shift_count integer;
  v_open_workers text;
  v_active_orders integer;
  v_since timestamptz;
  v_totals record;
  v_id uuid;
begin
  select * into v_session from public.current_worker_session(p_session_token, 'pos');

  select count(*), string_agg(w.display_name, ', ' order by s.opened_at)
  into v_active_shift_count, v_open_workers
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.status in ('open', 'closing_review');

  if v_active_shift_count > 0 then
    raise exception 'These shifts are still open: %. Each worker must close their shift first.', v_open_workers;
  end if;

  select count(*) into v_active_orders
  from public.orders as o
  where o.branch_id = v_session.branch_id
    and o.status not in ('completed', 'cancelled', 'voided');

  if v_active_orders > 0 then
    raise exception '% active order(s) are still in progress. Complete or cancel them first.', v_active_orders;
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
      'opening_float_for_next_day', round(p_opening_float_for_next_day, 2),
      'closed_by_role', v_session.worker_role
    )
  );

  return v_id;
end;
$function$;
