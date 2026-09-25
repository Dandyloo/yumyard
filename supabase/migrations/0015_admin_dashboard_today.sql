-- Admin Dashboard (Phase 3, Task 2): "Today" summary totals, hourly sales
-- for the chart, and shifts closed today. All three RPCs take an admin
-- session token and validate it themselves via current_worker_session()
-- with p_required_access_area = 'admin' - mirrors get_pos_session_and_shift()
-- from 0004, just for the admin access area instead of pos.
--
-- "Today" is computed in Africa/Accra local time rather than the server's
-- own timezone, since Ghana has no daylight saving and this keeps the
-- boundary correct regardless of where Postgres itself runs.

drop function if exists public.get_admin_session(text) cascade;
drop function if exists public.get_admin_dashboard_today(text) cascade;
drop function if exists public.get_admin_sales_by_hour(text) cascade;
drop function if exists public.get_admin_shifts_closed_today(text) cascade;

create or replace function public.get_admin_session(
  p_session_token text
)
returns table (
  session_id uuid,
  tenant_id uuid,
  branch_id uuid,
  worker_id uuid,
  worker_name text,
  worker_role text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session record;
begin
  select *
  into v_session
  from public.current_worker_session(p_session_token, 'admin');

  return query
  select
    v_session.session_id,
    v_session.tenant_id,
    v_session.branch_id,
    v_session.worker_id,
    v_session.worker_name,
    v_session.worker_role;
end;
$$;

create or replace function public.get_admin_dashboard_today(
  p_session_token text
)
returns table (
  total_sales numeric,
  total_orders integer,
  total_delivery_orders integer,
  cancelled_orders integer,
  total_revenue numeric
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
  from public.get_admin_session(p_session_token);

  return query
  select
    coalesce(sum(o.total) filter (
      where o.status not in ('cancelled', 'voided')
    ), 0)::numeric as total_sales,
    count(*) filter (
      where o.status not in ('cancelled', 'voided')
    )::integer as total_orders,
    count(*) filter (
      where o.status not in ('cancelled', 'voided')
        and o.fulfillment_type = 'delivery'
    )::integer as total_delivery_orders,
    count(*) filter (
      where o.status = 'cancelled'
    )::integer as cancelled_orders,
    -- Net of cancellations: cancelled/voided orders are already excluded
    -- from total_sales above, so revenue is the same figure today. Kept
    -- as its own column so a future refund/discount feature can diverge
    -- from total_sales without a breaking API change.
    coalesce(sum(o.total) filter (
      where o.status not in ('cancelled', 'voided')
    ), 0)::numeric as total_revenue
  from public.orders as o
  where o.branch_id = v_context.branch_id
    and (
      (o.created_at at time zone 'Africa/Accra')::date
      = (now() at time zone 'Africa/Accra')::date
    );
end;
$$;

create or replace function public.get_admin_sales_by_hour(
  p_session_token text
)
returns table (
  hour_of_day integer,
  sales numeric
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
  from public.get_admin_session(p_session_token);

  return query
  select
    h.hour_of_day,
    coalesce(sum(o.total), 0)::numeric as sales
  from generate_series(0, 23) as h(hour_of_day)
  left join public.orders as o
    on o.branch_id = v_context.branch_id
    and o.status not in ('cancelled', 'voided')
    and (
      (o.created_at at time zone 'Africa/Accra')::date
      = (now() at time zone 'Africa/Accra')::date
    )
    and extract(hour from (o.created_at at time zone 'Africa/Accra'))::integer
      = h.hour_of_day
  group by h.hour_of_day
  order by h.hour_of_day;
end;
$$;

create or replace function public.get_admin_shifts_closed_today(
  p_session_token text
)
returns table (
  shift_id uuid,
  worker_name text,
  opened_at timestamptz,
  closed_at timestamptz,
  opening_cash_actual numeric,
  expected_cash numeric,
  actual_cash_counted numeric,
  cash_variance numeric,
  closing_note text
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
  from public.get_admin_session(p_session_token);

  return query
  select
    s.id,
    w.display_name,
    s.opened_at,
    s.closed_at,
    s.opening_cash_actual,
    s.expected_cash,
    s.actual_cash_counted,
    s.cash_variance,
    s.closing_note
  from public.shifts as s
  join public.workers as w
    on w.id = s.worker_id
  where s.branch_id = v_context.branch_id
    and s.status = 'closed'
    and s.closed_at is not null
    and (
      (s.closed_at at time zone 'Africa/Accra')::date
      = (now() at time zone 'Africa/Accra')::date
    )
  order by s.closed_at desc;
end;
$$;

grant execute on function public.get_admin_session(text) to anon, authenticated;
grant execute on function public.get_admin_dashboard_today(text) to anon, authenticated;
grant execute on function public.get_admin_sales_by_hour(text) to anon, authenticated;
grant execute on function public.get_admin_shifts_closed_today(text) to anon, authenticated;
