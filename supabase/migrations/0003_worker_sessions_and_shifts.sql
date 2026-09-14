create extension if not exists pgcrypto;

create table if not exists public.worker_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,

  access_area text not null
    check (access_area in ('pos', 'admin')),

  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,

  ip_hint text,
  user_agent_hint text
);

create index if not exists worker_sessions_active_lookup_idx
  on public.worker_sessions(token_hash)
  where revoked_at is null;

create index if not exists worker_sessions_worker_active_idx
  on public.worker_sessions(worker_id, expires_at desc)
  where revoked_at is null;

alter table public.shifts
  add column if not exists opening_confirmed_at timestamptz,
  add column if not exists closed_by_session_id uuid
    references public.worker_sessions(id)
    on delete set null;

alter table public.orders
  add column if not exists last_updated_by_worker_id uuid
    references public.workers(id)
    on delete set null,
  add column if not exists last_updated_in_shift_id uuid
    references public.shifts(id)
    on delete set null;

create or replace function public.hash_session_token(
  p_session_token text
)
returns text
language sql
immutable
strict
set search_path = public, extensions
as $$
  select encode(extensions.digest(p_session_token, 'sha256'), 'hex');
$$;

create or replace function public.current_worker_session(
  p_session_token text,
  p_required_access_area text default null
)
returns table (
  session_id uuid,
  tenant_id uuid,
  branch_id uuid,
  worker_id uuid,
  worker_name text,
  worker_username text,
  worker_role text,
  access_area text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_hash text;
begin
  if coalesce(trim(p_session_token), '') = '' then
    raise exception 'A session token is required';
  end if;

  if p_required_access_area is not null
    and lower(trim(p_required_access_area)) not in ('pos', 'admin') then
    raise exception 'Invalid required access area';
  end if;

  v_token_hash := public.hash_session_token(p_session_token);

  return query
  select
    ws.id,
    ws.tenant_id,
    ws.branch_id,
    w.id,
    w.display_name,
    w.username,
    w.role,
    ws.access_area,
    ws.expires_at
  from public.worker_sessions ws
  join public.workers w
    on w.id = ws.worker_id
  join public.branches b
    on b.id = ws.branch_id
  where ws.token_hash = v_token_hash
    and ws.revoked_at is null
    and ws.expires_at > now()
    and w.is_active = true
    and b.is_active = true
    and (
      p_required_access_area is null
      or ws.access_area = lower(trim(p_required_access_area))
    )
  limit 1;

  if not found then
    raise exception 'Your session is invalid, locked, or expired. Sign in again.';
  end if;

  update public.worker_sessions
  set last_seen_at = now()
  where token_hash = v_token_hash
    and revoked_at is null;
end;
$$;

drop function if exists public.authenticate_worker(text, text, text, text);

create or replace function public.authenticate_worker(
  p_branch_slug text,
  p_username text,
  p_pin text,
  p_access_area text
)
returns table (
  worker_id uuid,
  worker_name text,
  worker_username text,
  worker_role text,
  branch_id uuid,
  branch_slug text,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_worker record;
  v_session_token text;
  v_token_hash text;
  v_session_expires_at timestamptz := now() + interval '12 hours';
begin
  if coalesce(trim(p_branch_slug), '') = ''
    or coalesce(trim(p_username), '') = ''
    or coalesce(trim(p_pin), '') = ''
    or coalesce(trim(p_access_area), '') = '' then
    raise exception 'Branch, username, PIN, and access area are required';
  end if;

  if lower(trim(p_access_area)) not in ('admin', 'pos') then
    raise exception 'Invalid access area. Use admin or pos';
  end if;

  select
    w.id,
    w.tenant_id,
    w.branch_id,
    w.display_name,
    w.username,
    w.role,
    b.slug as matched_branch_slug
  into v_worker
  from public.workers as w
  join public.branches as b
    on b.id = w.branch_id
  where lower(b.slug) = lower(trim(p_branch_slug))
    and lower(w.username) = lower(trim(p_username))
    and w.is_active = true
    and b.is_active = true
    and w.pin_hash = extensions.crypt(p_pin, w.pin_hash)
  limit 1;

  if not found then
    raise exception 'Invalid username or PIN';
  end if;

  if lower(trim(p_access_area)) = 'admin'
    and v_worker.role not in ('owner', 'admin', 'manager') then
    raise exception 'This user is not allowed to access the admin area';
  end if;

  if lower(trim(p_access_area)) = 'pos'
    and v_worker.role not in ('owner', 'admin', 'manager', 'cashier', 'supervisor') then
    raise exception 'This user is not allowed to access the POS area';
  end if;

  update public.worker_sessions as ws
  set
    revoked_at = now(),
    revoked_reason = 'Superseded by new login'
  where ws.worker_id = v_worker.id
    and ws.access_area = lower(trim(p_access_area))
    and ws.revoked_at is null;

  v_session_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := public.hash_session_token(v_session_token);

  insert into public.worker_sessions (
    tenant_id,
    branch_id,
    worker_id,
    access_area,
    token_hash,
    expires_at
  )
  values (
    v_worker.tenant_id,
    v_worker.branch_id,
    v_worker.id,
    lower(trim(p_access_area)),
    v_token_hash,
    v_session_expires_at
  );

  update public.workers as w
  set
    last_login_at = now(),
    updated_at = now()
  where w.id = v_worker.id;

  insert into public.audit_logs (
    tenant_id,
    branch_id,
    worker_id,
    entity_type,
    entity_id,
    action,
    details
  )
  values (
    v_worker.tenant_id,
    v_worker.branch_id,
    v_worker.id,
    'worker_session',
    v_worker.id,
    'worker_authenticated',
    jsonb_build_object(
      'access_area', lower(trim(p_access_area)),
      'username', v_worker.username,
      'session_expires_at', v_session_expires_at
    )
  );

  return query
  select
    v_worker.id::uuid,
    v_worker.display_name::text,
    v_worker.username::text,
    v_worker.role::text,
    v_worker.branch_id::uuid,
    v_worker.matched_branch_slug::text,
    v_session_token::text,
    v_session_expires_at;
end;
$$;

create or replace function public.lock_worker_session(
  p_session_token text,
  p_reason text default 'Locked from tablet'
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session record;
begin
  select *
  into v_session
  from public.current_worker_session(p_session_token, null);

  update public.worker_sessions
  set
    revoked_at = now(),
    revoked_reason = coalesce(nullif(trim(p_reason), ''), 'Locked from tablet')
  where id = v_session.session_id
    and revoked_at is null;

  insert into public.audit_logs (
    tenant_id,
    branch_id,
    worker_id,
    entity_type,
    entity_id,
    action,
    details
  )
  values (
    v_session.tenant_id,
    v_session.branch_id,
    v_session.worker_id,
    'worker_session',
    v_session.session_id,
    'worker_session_locked',
    jsonb_build_object(
      'reason', coalesce(nullif(trim(p_reason), ''), 'Locked from tablet')
    )
  );

  return true;
end;
$$;

create or replace function public.get_shift_opening_context(
  p_session_token text
)
returns table (
  active_shift_id uuid,
  active_shift_worker_id uuid,
  active_shift_worker_name text,
  active_shift_opened_at timestamptz,
  previous_shift_id uuid,
  previous_worker_name text,
  previous_shift_closed_at timestamptz,
  inherited_cash numeric,
  requires_opening_cash boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session record;
  v_active_shift record;
  v_previous_shift record;
begin
  select *
  into v_session
  from public.current_worker_session(p_session_token, 'pos');

  select
    s.id,
    s.worker_id,
    w.display_name,
    s.opened_at
  into v_active_shift
  from public.shifts s
  join public.workers w
    on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.status in ('open', 'closing_review')
  order by s.opened_at desc
  limit 1;

  if found then
    return query
    select
      v_active_shift.id::uuid,
      v_active_shift.worker_id::uuid,
      v_active_shift.display_name::text,
      v_active_shift.opened_at::timestamptz,
      null::uuid,
      null::text,
      null::timestamptz,
      null::numeric,
      false;
    return;
  end if;

  select
    s.id,
    w.display_name,
    s.closed_at,
    coalesce(s.actual_cash_counted, 0) as actual_cash_counted
  into v_previous_shift
  from public.shifts s
  join public.workers w
    on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.status = 'closed'
  order by s.closed_at desc
  limit 1;

  return query
  select
    null::uuid,
    null::uuid,
    null::text,
    null::timestamptz,
    v_previous_shift.id::uuid,
    v_previous_shift.display_name::text,
    v_previous_shift.closed_at::timestamptz,
    coalesce(v_previous_shift.actual_cash_counted, 0)::numeric,
    true;
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
  v_previous_shift record;
  v_expected_opening_cash numeric := 0;
  v_actual_opening_cash numeric;
  v_shift_id uuid;
begin
  select *
  into v_session
  from public.current_worker_session(p_session_token, 'pos');

  if p_opening_cash_actual is null or p_opening_cash_actual < 0 then
    raise exception 'Opening cash must be zero or greater';
  end if;

  v_actual_opening_cash := round(p_opening_cash_actual, 2);

  select
    s.id,
    s.worker_id,
    w.display_name,
    s.status,
    s.opened_at,
    s.opening_cash_expected,
    s.opening_cash_actual,
    s.opening_cash_variance,
    s.opening_cash_source_shift_id
  into v_existing_shift
  from public.shifts s
  join public.workers w
    on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.status in ('open', 'closing_review')
  order by s.opened_at desc
  limit 1;

  if found then
    if v_existing_shift.worker_id = v_session.worker_id then
      return query
      select
        v_existing_shift.id::uuid,
        v_existing_shift.worker_id::uuid,
        v_existing_shift.display_name::text,
        v_existing_shift.status::text,
        v_existing_shift.opened_at::timestamptz,
        v_existing_shift.opening_cash_expected::numeric,
        v_existing_shift.opening_cash_actual::numeric,
        v_existing_shift.opening_cash_variance::numeric,
        v_existing_shift.opening_cash_source_shift_id::uuid;
      return;
    end if;

    raise exception 'Another worker has an active shift. The current shift must be closed before you can open yours.';
  end if;

  select
    s.id,
    coalesce(s.actual_cash_counted, 0) as actual_cash_counted
  into v_previous_shift
  from public.shifts s
  where s.branch_id = v_session.branch_id
    and s.status = 'closed'
  order by s.closed_at desc
  limit 1;

  if found then
    v_expected_opening_cash := v_previous_shift.actual_cash_counted;
  end if;

  insert into public.shifts (
    tenant_id,
    branch_id,
    worker_id,
    status,
    opened_at,
    opening_confirmed_at,
    opening_cash_expected,
    opening_cash_actual,
    opening_cash_variance,
    opening_cash_source_shift_id,
    closing_note
  )
  values (
    v_session.tenant_id,
    v_session.branch_id,
    v_session.worker_id,
    'open',
    now(),
    now(),
    v_expected_opening_cash,
    v_actual_opening_cash,
    round(v_actual_opening_cash - v_expected_opening_cash, 2),
    case when found then v_previous_shift.id else null end,
    nullif(trim(p_opening_note), '')
  )
  returning id into v_shift_id;

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
    v_session.tenant_id,
    v_session.branch_id,
    v_session.worker_id,
    v_shift_id,
    'shift',
    v_shift_id,
    'shift_opened',
    jsonb_build_object(
      'opening_cash_expected', v_expected_opening_cash,
      'opening_cash_actual', v_actual_opening_cash,
      'opening_cash_variance', round(v_actual_opening_cash - v_expected_opening_cash, 2),
      'opening_note', nullif(trim(p_opening_note), '')
    )
  );

  return query
  select
    s.id,
    s.worker_id,
    w.display_name,
    s.status,
    s.opened_at,
    s.opening_cash_expected,
    s.opening_cash_actual,
    s.opening_cash_variance,
    s.opening_cash_source_shift_id
  from public.shifts s
  join public.workers w
    on w.id = s.worker_id
  where s.id = v_shift_id;
end;
$$;

create or replace function public.get_active_worker_shift(
  p_session_token text
)
returns table (
  shift_id uuid,
  worker_id uuid,
  worker_name text,
  status text,
  opened_at timestamptz,
  opening_cash_expected numeric,
  opening_cash_actual numeric,
  opening_cash_variance numeric
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
  from public.current_worker_session(p_session_token, 'pos');

  return query
  select
    s.id,
    s.worker_id,
    w.display_name,
    s.status,
    s.opened_at,
    s.opening_cash_expected,
    s.opening_cash_actual,
    s.opening_cash_variance
  from public.shifts s
  join public.workers w
    on w.id = s.worker_id
  where s.branch_id = v_session.branch_id
    and s.worker_id = v_session.worker_id
    and s.status in ('open', 'closing_review')
  order by s.opened_at desc
  limit 1;
end;
$$;

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
      o.created_in_shift_id = v_shift.id
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

revoke all on function public.hash_session_token(text) from public;
revoke all on function public.current_worker_session(text, text) from public;
revoke all on function public.authenticate_worker(text, text, text, text) from public;
revoke all on function public.lock_worker_session(text, text) from public;
revoke all on function public.get_shift_opening_context(text) from public;
revoke all on function public.open_worker_shift(text, numeric, text) from public;
revoke all on function public.get_active_worker_shift(text) from public;
revoke all on function public.get_shift_close_preview(text) from public;

grant execute on function public.authenticate_worker(text, text, text, text) to anon, authenticated;
grant execute on function public.lock_worker_session(text, text) to anon, authenticated;
grant execute on function public.get_shift_opening_context(text) to anon, authenticated;
grant execute on function public.open_worker_shift(text, numeric, text) to anon, authenticated;
grant execute on function public.get_active_worker_shift(text) to anon, authenticated;
grant execute on function public.get_shift_close_preview(text) to anon, authenticated;