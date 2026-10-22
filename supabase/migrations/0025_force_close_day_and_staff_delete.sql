-- 0025: Force-close the day without every worker closing their shift; staff deletion.
--
-- * shifts.force_closed / force_closed_by_worker_id: marks shifts closed on a worker's behalf
--   (expected cash is recorded as counted; note says "cash not counted"). Reused by auto-close.
-- * close_business_day(..., p_force): force mode
--     - fully paid active orders -> completed
--     - unpaid active orders     -> cancelled ("Cancelled automatically at day close (unpaid)")
--     - partly paid orders       -> BLOCK (must be settled by hand)
--     - open shifts              -> force-closed, those workers' sessions revoked
-- * get_close_day_preview: adds can_force_close + order counts so the UI can warn first.
-- * workers.deleted_at + admin_delete_worker(): soft delete (history in orders/shifts/payments is kept),
--   frees the username, scrambles the PIN, revokes sessions. get_admin_staff hides deleted rows.

alter table public.shifts
  add column if not exists force_closed boolean not null default false,
  add column if not exists force_closed_by_worker_id uuid references public.workers(id);

alter table public.workers
  add column if not exists deleted_at timestamptz;

create or replace function public.shift_cash_snapshot(p_shift_id uuid)
returns table(cash numeric, momo numeric, hubtel numeric, paid_in numeric, paid_out numeric, refunds numeric)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  select
    coalesce((select sum(p.amount) filter (where p.payment_method = 'cash') from public.payments p where p.received_in_shift_id = p_shift_id), 0),
    coalesce((select sum(p.amount) filter (where p.payment_method = 'momo') from public.payments p where p.received_in_shift_id = p_shift_id), 0),
    coalesce((select sum(p.amount) filter (where p.payment_method = 'hubtel') from public.payments p where p.received_in_shift_id = p_shift_id), 0),
    coalesce((select sum(cm.amount) filter (where cm.movement_type = 'paid_in') from public.cash_movements cm where cm.shift_id = p_shift_id), 0),
    coalesce((select sum(cm.amount) filter (where cm.movement_type = 'paid_out') from public.cash_movements cm where cm.shift_id = p_shift_id), 0),
    coalesce((select sum(cm.amount) filter (where cm.movement_type = 'refund') from public.cash_movements cm where cm.shift_id = p_shift_id), 0);
$function$;

revoke all on function public.shift_cash_snapshot(uuid) from public, anon, authenticated;

drop function if exists public.get_close_day_preview(text);

create function public.get_close_day_preview(p_session_token text)
returns table(
  can_close boolean, blocked_reason text, business_date date, shifts_count integer,
  total_sales numeric, total_orders integer, last_shift_worker_name text,
  last_shift_closed_at timestamptz, last_shift_actual_cash_counted numeric,
  drawer_cash_total numeric, open_shift_count integer, open_shift_workers text,
  can_force_close boolean, force_blocked_reason text,
  paid_active_order_count integer, unpaid_active_order_count integer, partial_active_order_count integer
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_session record;
  v_active_shift_count integer;
  v_open_workers text;
  v_paid integer;
  v_unpaid integer;
  v_partial integer;
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

  select
    count(*) filter (where paid >= total),
    count(*) filter (where paid <= 0 and paid < total),
    count(*) filter (where paid > 0 and paid < total)
  into v_paid, v_unpaid, v_partial
  from (
    select o.total, coalesce((select sum(p.amount) from public.payments p where p.order_id = o.id), 0) as paid
    from public.orders o
    where o.branch_id = v_session.branch_id
      and o.status not in ('completed', 'cancelled', 'voided')
  ) x;

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
    (v_active_shift_count = 0 and (v_paid + v_unpaid + v_partial) = 0),
    case
      when v_active_shift_count > 0 then 'These shifts are still open: ' || v_open_workers || '.'
      when (v_paid + v_unpaid + v_partial) > 0 then (v_paid + v_unpaid + v_partial)::text || ' active order(s) are still in progress.'
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
    v_open_workers,
    (v_partial = 0),
    case when v_partial > 0 then v_partial::text || ' order(s) are partly paid and need to be completed or refunded by hand first.' else null end,
    v_paid, v_unpaid, v_partial;
end;
$function$;

drop function if exists public.close_business_day(text, numeric, numeric, text);

create function public.close_business_day(
  p_session_token text,
  p_cash_handed_over numeric,
  p_opening_float_for_next_day numeric default 0,
  p_notes text default null,
  p_force boolean default false
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
  v_partial integer;
  v_completed integer := 0;
  v_cancelled integer := 0;
  v_forced_shifts integer := 0;
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

  if p_cash_handed_over is null or p_cash_handed_over < 0 then
    raise exception 'Cash handed over must be zero or greater';
  end if;

  if p_opening_float_for_next_day is null or p_opening_float_for_next_day < 0 then
    raise exception 'Opening float for next day must be zero or greater';
  end if;

  if p_force then
    select count(*) into v_partial
    from public.orders o
    where o.branch_id = v_session.branch_id
      and o.status not in ('completed', 'cancelled', 'voided')
      and coalesce((select sum(p.amount) from public.payments p where p.order_id = o.id), 0) > 0
      and coalesce((select sum(p.amount) from public.payments p where p.order_id = o.id), 0) < o.total;

    if v_partial > 0 then
      raise exception '% order(s) are partly paid and must be completed or refunded by hand before closing the day.', v_partial;
    end if;

    update public.orders o
    set status = 'completed', completed_at = now(), completed_by_worker_id = v_session.worker_id,
        last_updated_by_worker_id = v_session.worker_id
    where o.branch_id = v_session.branch_id
      and o.status not in ('completed', 'cancelled', 'voided')
      and coalesce((select sum(p.amount) from public.payments p where p.order_id = o.id), 0) >= o.total;
    get diagnostics v_completed = row_count;

    update public.orders o
    set status = 'cancelled', cancelled_at = now(), cancelled_by_worker_id = v_session.worker_id,
        cancellation_reason = 'Cancelled automatically at day close (unpaid)',
        last_updated_by_worker_id = v_session.worker_id
    where o.branch_id = v_session.branch_id
      and o.status not in ('completed', 'cancelled', 'voided');
    get diagnostics v_cancelled = row_count;

    update public.worker_sessions ws
    set revoked_at = now(), revoked_reason = 'Shift closed at day close'
    where ws.revoked_at is null
      and ws.worker_id <> v_session.worker_id
      and ws.worker_id in (
        select s.worker_id from public.shifts s
        where s.branch_id = v_session.branch_id and s.status in ('open', 'closing_review')
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
      force_closed_by_worker_id = v_session.worker_id,
      closing_note = 'Force-closed at day close by ' || v_session.worker_name || ' - cash not counted',
      updated_at = now()
    where s.branch_id = v_session.branch_id
      and s.status in ('open', 'closing_review');
    get diagnostics v_forced_shifts = row_count;
  else
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
      'closed_by_role', v_session.worker_role,
      'forced', p_force,
      'force_closed_shifts', v_forced_shifts,
      'auto_completed_orders', v_completed,
      'auto_cancelled_orders', v_cancelled
    )
  );

  return v_id;
end;
$function$;

create or replace function public.admin_delete_worker(p_session_token text, p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_context record;
  v_worker record;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if v_context.worker_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can delete a staff account';
  end if;

  if p_worker_id = v_context.worker_id then
    raise exception 'You cannot delete your own account';
  end if;

  select * into v_worker
  from public.workers w
  where w.id = p_worker_id and w.branch_id = v_context.branch_id and w.deleted_at is null;

  if not found then
    raise exception 'Worker not found for this branch';
  end if;

  if public.admin_is_last_admin_worker(v_context.branch_id, p_worker_id) then
    raise exception 'Cannot delete the only remaining owner, admin, or manager for this branch';
  end if;

  if exists (
    select 1 from public.shifts s
    where s.worker_id = p_worker_id and s.status in ('open', 'closing_review')
  ) then
    raise exception '% has an open shift. Close it (or close the day) before deleting this account.', v_worker.display_name;
  end if;

  update public.worker_sessions
  set revoked_at = now(), revoked_reason = 'Account deleted by admin'
  where worker_id = p_worker_id and revoked_at is null;

  update public.workers
  set
    is_active = false,
    deleted_at = now(),
    username = left(username, 40) || '.deleted.' || left(replace(id::text, '-', ''), 8),
    pin_hash = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 6)),
    updated_at = now()
  where id = p_worker_id;

  insert into public.audit_logs (tenant_id, branch_id, worker_id, entity_type, entity_id, action, details)
  values (
    v_context.tenant_id, v_context.branch_id, v_context.worker_id, 'worker', p_worker_id, 'worker_deleted',
    jsonb_build_object('display_name', v_worker.display_name, 'role', v_worker.role)
  );
end;
$function$;

create or replace function public.get_admin_staff(p_session_token text)
returns table(worker_id uuid, display_name text, username text, role text, is_active boolean, last_login_at timestamptz, last_shift_date timestamptz, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_context record;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  return query
  select
    w.id, w.display_name, w.username, w.role, w.is_active, w.last_login_at,
    (select max(s.opened_at) from public.shifts as s where s.worker_id = w.id) as last_shift_date,
    w.created_at
  from public.workers as w
  where w.branch_id = v_context.branch_id
    and w.deleted_at is null
  order by w.is_active desc, w.display_name asc;
end;
$function$;
