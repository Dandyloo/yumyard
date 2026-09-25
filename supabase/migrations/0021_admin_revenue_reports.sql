-- Admin Revenue Reports. Two RPCs:
--   get_admin_revenue_summary - the four "accumulated income" cards
--   (today, week-to-date, month-to-date, year-to-date), all in
--   Africa/Accra local time so "today" genuinely resets at midnight
--   Ghana time regardless of where Postgres itself runs. Same
--   exclude-cancelled/voided definition as Task 2's dashboard, so a
--   given day's figure always matches between the two screens.
--
--   get_admin_revenue_trend - the history chart data, day or month
--   buckets going back N periods, generated the same way Task 2's
--   hourly chart was (generate_series left-joined to orders) so there's
--   always one row per bucket even when a day/month had zero sales.

drop function if exists public.get_admin_revenue_summary(text) cascade;
drop function if exists public.get_admin_revenue_trend(text, text, integer) cascade;

create or replace function public.get_admin_revenue_summary(
  p_session_token text
)
returns table (
  today_sales numeric,
  today_orders integer,
  week_to_date_sales numeric,
  week_to_date_orders integer,
  month_to_date_sales numeric,
  month_to_date_orders integer,
  year_to_date_sales numeric,
  year_to_date_orders integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_today date;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  v_today := (now() at time zone 'Africa/Accra')::date;

  return query
  select
    coalesce(sum(o.total) filter (
      where (o.created_at at time zone 'Africa/Accra')::date = v_today
    ), 0)::numeric,
    count(*) filter (
      where (o.created_at at time zone 'Africa/Accra')::date = v_today
    )::integer,
    coalesce(sum(o.total) filter (
      where (o.created_at at time zone 'Africa/Accra')::date >= date_trunc('week', v_today::timestamp)::date
    ), 0)::numeric,
    count(*) filter (
      where (o.created_at at time zone 'Africa/Accra')::date >= date_trunc('week', v_today::timestamp)::date
    )::integer,
    coalesce(sum(o.total) filter (
      where (o.created_at at time zone 'Africa/Accra')::date >= date_trunc('month', v_today::timestamp)::date
    ), 0)::numeric,
    count(*) filter (
      where (o.created_at at time zone 'Africa/Accra')::date >= date_trunc('month', v_today::timestamp)::date
    )::integer,
    coalesce(sum(o.total) filter (
      where (o.created_at at time zone 'Africa/Accra')::date >= date_trunc('year', v_today::timestamp)::date
    ), 0)::numeric,
    count(*) filter (
      where (o.created_at at time zone 'Africa/Accra')::date >= date_trunc('year', v_today::timestamp)::date
    )::integer
  from public.orders as o
  where o.branch_id = v_context.branch_id
    and o.status not in ('cancelled', 'voided')
    -- One year of lookback is enough to cover every filter above and
    -- keeps this from scanning the whole orders table as history grows.
    and o.created_at >= (v_today - interval '1 year');
end;
$$;

create or replace function public.get_admin_revenue_trend(
  p_session_token text,
  p_granularity text default 'day', -- 'day' or 'month'
  p_periods integer default 30
)
returns table (
  bucket_date date,
  sales numeric,
  orders integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_granularity text := lower(trim(coalesce(p_granularity, 'day')));
  v_periods integer := greatest(coalesce(p_periods, 30), 1);
  v_now_local date := (now() at time zone 'Africa/Accra')::date;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if v_granularity not in ('day', 'month') then
    raise exception 'Invalid granularity - must be day or month';
  end if;

  return query
  with buckets as (
    select generate_series(
      date_trunc(v_granularity, v_now_local::timestamp)
        - (('1 ' || v_granularity)::interval * (v_periods - 1)),
      date_trunc(v_granularity, v_now_local::timestamp),
      ('1 ' || v_granularity)::interval
    )::date as bucket_start
  )
  select
    b.bucket_start,
    coalesce(sum(o.total), 0)::numeric,
    count(o.id)::integer
  from buckets as b
  left join public.orders as o
    on o.branch_id = v_context.branch_id
    and o.status not in ('cancelled', 'voided')
    and date_trunc(v_granularity, (o.created_at at time zone 'Africa/Accra'))::date = b.bucket_start
  group by b.bucket_start
  order by b.bucket_start;
end;
$$;

grant execute on function public.get_admin_revenue_summary(text) to anon, authenticated;
grant execute on function public.get_admin_revenue_trend(text, text, integer) to anon, authenticated;
