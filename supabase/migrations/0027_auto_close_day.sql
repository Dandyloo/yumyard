-- 0027: Automatic day close at 01:00 (Africa/Accra = UTC, no DST).
--
-- auto_close_branch_day(branch, except_worker):
--   * paid active orders   -> completed
--   * unpaid active orders -> cancelled ("Cancelled automatically at day close (unpaid)")
--   * partly paid orders   -> left open (money is against them; settle by hand)
--   * open shifts          -> force-closed (expected cash recorded, flagged force_closed + auto_closed),
--                             their sessions revoked
--   * business_day_closes row with auto_closed = true, closed_by_worker_id = null,
--     cash_handed_over = 0 and the WHOLE drawer total carried into opening_float_for_next_day,
--     so the first worker tomorrow has to count it.
--   Does nothing if nothing happened since the last close.
-- auto_close_all_branches(): called by pg_cron at 01:00 every day.
-- auto_close_if_overdue(): safety net, run from get_shift_opening_context (sign-in). If a shift was
--   opened before the most recent 01:00 cutoff, the next sign-in triggers the same close.

alter table public.business_day_closes
  alter column closed_by_worker_id drop not null,
  add column if not exists auto_closed boolean not null default false;

alter table public.shifts
  add column if not exists auto_closed boolean not null default false;

create or replace function public.auto_close_branch_day(p_branch_id uuid, p_except_worker_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant_id uuid;
  v_open integer;
  v_closed_since integer;
  v_active integer;
  v_since timestamptz;
  v_completed integer := 0;
  v_cancelled integer := 0;
  v_partial_left integer := 0;
  v_forced integer := 0;
  v_totals record;
  v_drawer numeric;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('auto_close_day:' || p_branch_id::text));

  select b.tenant_id into v_tenant_id from public.branches b where b.id = p_branch_id;
  if v_tenant_id is null then
    return null;
  end if;

  select bdc.closed_at into v_since
  from public.business_day_closes bdc
  where bdc.branch_id = p_branch_id
  order by bdc.closed_at desc limit 1;

  select count(*) into v_open
  from public.shifts s where s.branch_id = p_branch_id and s.status in ('open', 'closing_review');

  select count(*) into v_closed_since
  from public.shifts s
  where s.branch_id = p_branch_id and s.status = 'closed' and (v_since is null or s.closed_at > v_since);

  select count(*) into v_active
  from public.orders o
  where o.branch_id = p_branch_id and o.status not in ('completed', 'cancelled', 'voided');

  if v_open = 0 and v_closed_since = 0 and v_active = 0 then
    return null;
  end if;

  update public.orders o
  set status = 'completed', completed_at = now()
  where o.branch_id = p_branch_id
    and o.status not in ('completed', 'cancelled', 'voided')
    and coalesce((select sum(p.amount) from public.payments p where p.order_id = o.id), 0) >= o.total;
  get diagnostics v_completed = row_count;

  update public.orders o
  set status = 'cancelled', cancelled_at = now(),
      cancellation_reason = 'Cancelled automatically at day close (unpaid)'
  where o.branch_id = p_branch_id
    and o.status not in ('completed', 'cancelled', 'voided')
    and coalesce((select sum(p.amount) from public.payments p where p.order_id = o.id), 0) <= 0;
  get diagnostics v_cancelled = row_count;

  select count(*) into v_partial_left
  from public.orders o
  where o.branch_id = p_branch_id and o.status not in ('completed', 'cancelled', 'voided');

  update public.worker_sessions ws
  set revoked_at = now(), revoked_reason = 'Shift closed at automatic day close'
  where ws.revoked_at is null
    and (p_except_worker_id is null or ws.worker_id <> p_except_worker_id)
    and ws.worker_id in (
      select s.worker_id from public.shifts s
      where s.branch_id = p_branch_id and s.status in ('open', 'closing_review')
    );

  update public.shifts s
  set
    status = 'closed',
    closed_at = now(),
    cash_sales_total = (select cash from public.shift_cash_snapshot(s.id)),
    momo_sales_total = (select momo from public.shift_cash_snapshot(s.id)),
    hubtel_sales_total = (select hubtel from public.shift_cash_snapshot(s.id)),
    delivery_fee_total = 0,
    cash_paid_in_total = (select paid_in from public.shift_cash_snapshot(s.id)),
    cash_paid_out_total = (select paid_out from public.shift_cash_snapshot(s.id)),
    cash_refund_total = (select refunds from public.shift_cash_snapshot(s.id)),
    expected_cash = (select round(s.opening_cash_actual + cash + paid_in - paid_out - refunds, 2) from public.shift_cash_snapshot(s.id)),
    actual_cash_counted = (select round(s.opening_cash_actual + cash + paid_in - paid_out - refunds, 2) from public.shift_cash_snapshot(s.id)),
    cash_variance = 0,
    open_order_count_at_close = 0,
    handover_order_count = 0,
    requires_admin_approval = false,
    force_closed = true,
    auto_closed = true,
    closing_note = 'Auto-closed at end of day - cash not counted',
    updated_at = now()
  where s.branch_id = p_branch_id and s.status in ('open', 'closing_review');
  get diagnostics v_forced = row_count;

  select
    count(*) filter (where s.status = 'closed') as shifts_count,
    coalesce(sum(o.total) filter (where o.status not in ('cancelled', 'voided')), 0) as total_sales,
    count(o.id) filter (where o.status not in ('cancelled', 'voided')) as total_orders
  into v_totals
  from public.shifts s
  left join public.orders o
    on o.branch_id = p_branch_id
    and (o.created_in_shift_id = s.id or o.handed_over_to_shift_id = s.id)
  where s.branch_id = p_branch_id and s.status = 'closed' and (v_since is null or s.closed_at > v_since);

  v_drawer := coalesce(public.get_branch_drawer_cash(p_branch_id), 0);

  insert into public.business_day_closes (
    tenant_id, branch_id, business_date, closed_by_worker_id, auto_closed,
    shifts_count, total_sales, total_orders, cash_handed_over, opening_float_for_next_day, notes
  )
  values (
    v_tenant_id, p_branch_id, (now() at time zone 'Africa/Accra')::date, null, true,
    coalesce(v_totals.shifts_count, 0), coalesce(v_totals.total_sales, 0), coalesce(v_totals.total_orders, 0),
    0, v_drawer,
    'Auto-closed. Cash was not counted or handed over; the full drawer total is carried into the next opening float.'
  )
  returning id into v_id;

  insert into public.audit_logs (tenant_id, branch_id, entity_type, entity_id, action, details)
  values (
    v_tenant_id, p_branch_id, 'business_day_close', v_id, 'business_day_auto_closed',
    jsonb_build_object(
      'force_closed_shifts', v_forced,
      'auto_completed_orders', v_completed,
      'auto_cancelled_orders', v_cancelled,
      'partly_paid_orders_left_open', v_partial_left,
      'drawer_cash_carried_over', v_drawer
    )
  );

  return v_id;
end;
$function$;

create or replace function public.auto_close_all_branches()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  b record;
  v_count integer := 0;
begin
  for b in select id from public.branches loop
    if public.auto_close_branch_day(b.id) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.auto_close_if_overdue(p_branch_id uuid, p_except_worker_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_cut timestamptz;
begin
  v_cut := (date_trunc('day', now() at time zone 'Africa/Accra') + interval '1 hour') at time zone 'Africa/Accra';
  if v_cut > now() then
    v_cut := v_cut - interval '1 day';
  end if;

  if exists (
    select 1 from public.shifts s
    where s.branch_id = p_branch_id and s.status in ('open', 'closing_review') and s.opened_at < v_cut
  ) then
    perform public.auto_close_branch_day(p_branch_id, p_except_worker_id);
  end if;
end;
$function$;

revoke all on function public.auto_close_branch_day(uuid, uuid) from public, anon, authenticated;
revoke all on function public.auto_close_all_branches() from public, anon, authenticated;
revoke all on function public.auto_close_if_overdue(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_shift_opening_context(p_session_token text)
returns table(
  active_shift_id uuid, active_shift_worker_id uuid, active_shift_worker_name text, active_shift_opened_at timestamptz,
  previous_shift_id uuid, previous_worker_name text, previous_shift_closed_at timestamptz,
  inherited_cash numeric, requires_opening_cash boolean, after_day_close boolean,
  day_close_business_date date, other_open_shift_count integer
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

  perform public.auto_close_if_overdue(v_session.branch_id, v_session.worker_id);

  select s.id, s.worker_id, w.display_name, s.opened_at
  into v_own_shift
  from public.shifts as s
  join public.workers as w on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.worker_id = v_session.worker_id
    and s.status in ('open', 'closing_review')
  order by s.opened_at desc
  limit 1;

  select count(*)::integer into v_others
  from public.shifts as s
  where s.branch_id = v_session.branch_id
    and s.worker_id <> v_session.worker_id
    and s.status in ('open', 'closing_review');

  if v_own_shift.id is not null then
    return query
    select v_own_shift.id, v_own_shift.worker_id, v_own_shift.display_name, v_own_shift.opened_at,
      null::uuid, null::text, null::timestamptz, null::numeric, false, false, null::date, v_others;
    return;
  end if;

  if v_others > 0 then
    return query
    select null::uuid, null::uuid, null::text, null::timestamptz,
      null::uuid, null::text, null::timestamptz, 0::numeric, false, false, null::date, v_others;
    return;
  end if;

  select * into v_context from public.get_shift_inheritance_context(v_session.branch_id);

  return query
  select null::uuid, null::uuid, null::text, null::timestamptz,
    v_context.previous_shift_id, v_context.previous_worker_name, v_context.previous_shift_closed_at,
    v_context.expected_opening_cash, true,
    v_context.after_day_close, v_context.day_close_business_date, 0;
end;
$function$;

-- Schedule (needs pg_cron; Supabase runs cron in UTC, which equals Accra time).
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'yumyard-auto-close-day';
select cron.schedule('yumyard-auto-close-day', '0 1 * * *', $$select public.auto_close_all_branches();$$);
