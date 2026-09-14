create extension if not exists pgcrypto;

create type public.worker_role as enum ('owner', 'supervisor', 'cashier');
create type public.shift_status as enum ('open', 'closing_review', 'closed');
create type public.order_status as enum (
  'confirmed',
  'preparing',
  'ready',
  'awaiting_pickup',
  'out_for_delivery',
  'completed',
  'cancelled',
  'voided'
);
create type public.fulfillment_type as enum ('walk_in', 'pickup', 'delivery', 'dine_in');
create type public.order_source as enum ('direct_pos', 'phone_call', 'whatsapp', 'hubtel', 'other');
create type public.payment_method as enum ('cash', 'momo', 'hubtel');
create type public.payment_status as enum ('unpaid', 'partially_paid', 'paid', 'refunded');
create type public.stock_movement_type as enum (
  'opening_count',
  'received',
  'sale_usage',
  'waste',
  'adjustment',
  'staff_meal',
  'count_correction'
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  slug text not null,
  address text,
  phone text,
  timezone text not null default 'Africa/Accra',
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  display_name text not null,
  username text not null,
  pin_hash text not null,
  role public.worker_role not null default 'cashier',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, username)
);

create table public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  session_type text not null check (session_type in ('pos', 'admin')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  worker_id uuid not null references public.workers(id),
  status public.shift_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,

  opening_cash_expected numeric(12, 2) not null default 0 check (opening_cash_expected >= 0),
  opening_cash_actual numeric(12, 2) not null default 0 check (opening_cash_actual >= 0),
  opening_cash_variance numeric(12, 2) not null default 0,
  opening_cash_source_shift_id uuid references public.shifts(id),

  cash_sales_total numeric(12, 2) not null default 0,
  momo_sales_total numeric(12, 2) not null default 0,
  hubtel_sales_total numeric(12, 2) not null default 0,
  delivery_fee_total numeric(12, 2) not null default 0,
  cash_paid_in_total numeric(12, 2) not null default 0,
  cash_paid_out_total numeric(12, 2) not null default 0,
  cash_refund_total numeric(12, 2) not null default 0,

  expected_cash numeric(12, 2) not null default 0,
  actual_cash_counted numeric(12, 2),
  cash_variance numeric(12, 2),

  open_order_count_at_close integer not null default 0,
  handover_order_count integer not null default 0,
  closing_note text,
  requires_admin_approval boolean not null default false,
  approved_by_worker_id uuid references public.workers(id),
  approved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    (status = 'closed' and closed_at is not null and actual_cash_counted is not null)
    or status in ('open', 'closing_review')
  )
);

create unique index shifts_one_open_shift_per_branch
  on public.shifts(branch_id)
  where status in ('open', 'closing_review');

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  category_id uuid references public.menu_categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(12, 2) not null check (price >= 0),
  image_url text,
  requires_protein boolean not null default false,
  is_active boolean not null default true,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menu_item_protein_options (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name text not null,
  price_delta numeric(12, 2) not null default 0,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (menu_item_id, name)
);

create table public.riders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  display_name text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  default_fee numeric(12, 2) not null default 0 check (default_fee >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_number text not null,
  status public.order_status not null default 'confirmed',
  fulfillment_type public.fulfillment_type not null,
  source public.order_source not null default 'direct_pos',
  payment_status public.payment_status not null default 'unpaid',

  created_by_worker_id uuid not null references public.workers(id),
  created_in_shift_id uuid not null references public.shifts(id),

  handed_over_from_shift_id uuid references public.shifts(id),
  handed_over_to_shift_id uuid references public.shifts(id),
  handed_over_at timestamptz,
  handover_note text,

  customer_name text,
  customer_phone text,
  delivery_address text,
  delivery_zone_id uuid references public.delivery_zones(id),
  delivery_fee numeric(12, 2) not null default 0 check (delivery_fee >= 0),
  rider_id uuid references public.riders(id),
  rider_name_snapshot text,

  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  notes text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_worker_id uuid references public.workers(id),
  cancellation_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (branch_id, order_number)
);

create index orders_branch_status_created_at_idx
  on public.orders(branch_id, status, created_at desc);

create index orders_created_in_shift_idx
  on public.orders(created_in_shift_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  item_name_snapshot text not null,
  protein_name_snapshot text,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  method public.payment_method not null,
  amount numeric(12, 2) not null check (amount > 0),
  received_by_worker_id uuid not null references public.workers(id),
  received_in_shift_id uuid not null references public.shifts(id),
  received_at timestamptz not null default now(),
  reference text,
  notes text,
  created_at timestamptz not null default now()
);

create index payments_shift_method_idx
  on public.payments(received_in_shift_id, method);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  worker_id uuid not null references public.workers(id),
  movement_type text not null check (movement_type in ('paid_in', 'paid_out', 'refund')),
  amount numeric(12, 2) not null check (amount > 0),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  unit_name text not null,
  current_quantity numeric(12, 3) not null default 0,
  low_stock_threshold numeric(12, 3) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, name)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  shift_id uuid references public.shifts(id),
  worker_id uuid references public.workers(id),
  movement_type public.stock_movement_type not null,
  quantity_change numeric(12, 3) not null,
  unit_cost numeric(12, 2),
  reason text,
  reference_type text,
  reference_id uuid,
  created_at timestamptz not null default now()
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  fulfillment_type public.fulfillment_type,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity_required numeric(12, 3) not null check (quantity_required > 0),
  created_at timestamptz not null default now(),
  unique (recipe_id, inventory_item_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  worker_id uuid references public.workers(id),
  shift_id uuid references public.shifts(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workers_set_updated_at
before update on public.workers
for each row execute procedure public.set_updated_at();

create trigger shifts_set_updated_at
before update on public.shifts
for each row execute procedure public.set_updated_at();

create trigger menu_items_set_updated_at
before update on public.menu_items
for each row execute procedure public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute procedure public.set_updated_at();

create trigger inventory_items_set_updated_at
before update on public.inventory_items
for each row execute procedure public.set_updated_at();

alter table public.tenants enable row level security;
alter table public.branches enable row level security;
alter table public.workers enable row level security;
alter table public.device_sessions enable row level security;
alter table public.shifts enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_item_protein_options enable row level security;
alter table public.riders enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.cash_movements enable row level security;
alter table public.inventory_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.audit_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

create or replace function public.authenticate_worker(
  p_branch_slug text,
  p_username text,
  p_pin text,
  p_session_type text default 'pos'
)
returns table (
  session_token text,
  expires_at timestamptz,
  worker_id uuid,
  worker_name text,
  worker_role public.worker_role,
  branch_id uuid,
  tenant_id uuid,
  active_shift_id uuid,
  active_shift_worker_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
  v_branch public.branches%rowtype;
  v_token text;
  v_active_shift public.shifts%rowtype;
begin
  if p_session_type not in ('pos', 'admin') then
    raise exception 'Invalid session type';
  end if;

  select *
  into v_branch
  from public.branches
  where slug = lower(trim(p_branch_slug));

  if not found then
    raise exception 'Branch not found';
  end if;

  select *
  into v_worker
  from public.workers
  where branch_id = v_branch.id
    and username = lower(trim(p_username))
    and is_active = true;

  if not found or crypt(p_pin, v_worker.pin_hash) <> v_worker.pin_hash then
    raise exception 'Invalid username or PIN';
  end if;

  if p_session_type = 'admin'
     and v_worker.role not in ('owner', 'supervisor') then
    raise exception 'Admin access is not allowed for this worker';
  end if;

  select *
  into v_active_shift
  from public.shifts
  where branch_id = v_branch.id
    and status in ('open', 'closing_review')
  order by opened_at desc
  limit 1;

  v_token := encode(gen_random_bytes(32), 'hex');

  insert into public.device_sessions (
    branch_id,
    worker_id,
    session_type,
    token_hash,
    expires_at
  )
  values (
    v_branch.id,
    v_worker.id,
    p_session_type,
    encode(digest(v_token, 'sha256'), 'hex'),
    now() + interval '12 hours'
  );

  return query
  select
    v_token,
    now() + interval '12 hours',
    v_worker.id,
    v_worker.display_name,
    v_worker.role,
    v_branch.id,
    v_branch.tenant_id,
    v_active_shift.id,
    v_active_shift.worker_id;
end;
$$;

create or replace function public.validate_device_session(
  p_session_token text,
  p_required_session_type text default null
)
returns table (
  worker_id uuid,
  worker_name text,
  worker_role public.worker_role,
  branch_id uuid,
  tenant_id uuid,
  session_type text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    w.id,
    w.display_name,
    w.role,
    s.branch_id,
    w.tenant_id,
    s.session_type
  from public.device_sessions s
  join public.workers w on w.id = s.worker_id
  where s.token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and w.is_active = true
    and (p_required_session_type is null or s.session_type = p_required_session_type)
  limit 1;
end;
$$;

create or replace function public.open_shift(
  p_session_token text,
  p_opening_cash_actual numeric,
  p_opening_cash_note text default null
)
returns public.shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_open_shift public.shifts%rowtype;
  v_last_closed_shift public.shifts%rowtype;
  v_new_shift public.shifts%rowtype;
  v_expected numeric(12,2);
begin
  select *
  into v_session
  from public.validate_device_session(p_session_token, 'pos');

  if not found then
    raise exception 'Invalid or expired POS session';
  end if;

  select *
  into v_open_shift
  from public.shifts
  where branch_id = v_session.branch_id
    and status in ('open', 'closing_review')
  order by opened_at desc
  limit 1;

  if found then
    if v_open_shift.worker_id = v_session.worker_id then
      return v_open_shift;
    end if;

    raise exception 'Another worker already has an active shift';
  end if;

  select *
  into v_last_closed_shift
  from public.shifts
  where branch_id = v_session.branch_id
    and status = 'closed'
  order by closed_at desc
  limit 1;

  v_expected := coalesce(v_last_closed_shift.actual_cash_counted, 0);

  insert into public.shifts (
    tenant_id,
    branch_id,
    worker_id,
    opening_cash_expected,
    opening_cash_actual,
    opening_cash_variance,
    opening_cash_source_shift_id,
    expected_cash,
    closing_note
  )
  values (
    v_session.tenant_id,
    v_session.branch_id,
    v_session.worker_id,
    v_expected,
    p_opening_cash_actual,
    p_opening_cash_actual - v_expected,
    v_last_closed_shift.id,
    p_opening_cash_actual,
    p_opening_cash_note
  )
  returning * into v_new_shift;

  insert into public.audit_logs (
    tenant_id,
    branch_id,
    worker_id,
    shift_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_session.tenant_id,
    v_session.branch_id,
    v_session.worker_id,
    v_new_shift.id,
    'shift_opened',
    'shift',
    v_new_shift.id,
    jsonb_build_object(
      'opening_cash_expected', v_expected,
      'opening_cash_actual', p_opening_cash_actual,
      'opening_cash_note', p_opening_cash_note
    )
  );

  return v_new_shift;
end;
$$;

create or replace function public.get_shift_close_preview(
  p_session_token text
)
returns table (
  shift_id uuid,
  worker_name text,
  opened_at timestamptz,
  opening_cash_actual numeric,
  cash_payments numeric,
  momo_payments numeric,
  hubtel_payments numeric,
  delivery_fee_total numeric,
  cash_paid_in numeric,
  cash_paid_out numeric,
  cash_refunds numeric,
  expected_cash numeric,
  active_order_count integer,
  active_order_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_shift public.shifts%rowtype;
begin
  select *
  into v_session
  from public.validate_device_session(p_session_token, 'pos');

  if not found then
    raise exception 'Invalid or expired POS session';
  end if;

  select *
  into v_shift
  from public.shifts
  where branch_id = v_session.branch_id
    and worker_id = v_session.worker_id
    and status in ('open', 'closing_review')
  order by opened_at desc
  limit 1;

  if not found then
    raise exception 'No active shift found for this worker';
  end if;

  return query
  with payment_totals as (
    select
      coalesce(sum(amount) filter (where method = 'cash'), 0)::numeric(12,2) as cash_total,
      coalesce(sum(amount) filter (where method = 'momo'), 0)::numeric(12,2) as momo_total,
      coalesce(sum(amount) filter (where method = 'hubtel'), 0)::numeric(12,2) as hubtel_total
    from public.payments
    where received_in_shift_id = v_shift.id
  ),
  movement_totals as (
    select
      coalesce(sum(amount) filter (where movement_type = 'paid_in'), 0)::numeric(12,2) as paid_in_total,
      coalesce(sum(amount) filter (where movement_type = 'paid_out'), 0)::numeric(12,2) as paid_out_total,
      coalesce(sum(amount) filter (where movement_type = 'refund'), 0)::numeric(12,2) as refund_total
    from public.cash_movements
    where shift_id = v_shift.id
  ),
  active_orders as (
    select
      count(*)::integer as order_count,
      coalesce(sum(total), 0)::numeric(12,2) as total_amount
    from public.orders
    where branch_id = v_session.branch_id
      and created_in_shift_id = v_shift.id
      and status not in ('completed', 'cancelled', 'voided')
  ),
  delivery_totals as (
    select coalesce(sum(delivery_fee), 0)::numeric(12,2) as delivery_total
    from public.orders
    where created_in_shift_id = v_shift.id
      and status <> 'cancelled'
  )
  select
    v_shift.id,
    v_session.worker_name,
    v_shift.opened_at,
    v_shift.opening_cash_actual,
    payment_totals.cash_total,
    payment_totals.momo_total,
    payment_totals.hubtel_total,
    delivery_totals.delivery_total,
    movement_totals.paid_in_total,
    movement_totals.paid_out_total,
    movement_totals.refund_total,
    (
      v_shift.opening_cash_actual
      + payment_totals.cash_total
      + movement_totals.paid_in_total
      - movement_totals.paid_out_total
      - movement_totals.refund_total
    )::numeric(12,2),
    active_orders.order_count,
    active_orders.total_amount
  from payment_totals, movement_totals, active_orders, delivery_totals;
end;
$$;

create or replace function public.close_shift(
  p_session_token text,
  p_actual_cash_counted numeric,
  p_closing_note text default null,
  p_handover_order_ids uuid[] default array[]::uuid[],
  p_admin_session_token text default null
)
returns public.shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_shift public.shifts%rowtype;
  v_preview record;
  v_active_order_ids uuid[];
  v_admin_session record;
  v_requires_admin_approval boolean := false;
  v_closed_shift public.shifts%rowtype;
begin
  select *
  into v_session
  from public.validate_device_session(p_session_token, 'pos');

  if not found then
    raise exception 'Invalid or expired POS session';
  end if;

  select *
  into v_shift
  from public.shifts
  where branch_id = v_session.branch_id
    and worker_id = v_session.worker_id
    and status in ('open', 'closing_review')
  order by opened_at desc
  limit 1;

  if not found then
    raise exception 'No open shift found for this worker';
  end if;

  select array_agg(id order by created_at)
  into v_active_order_ids
  from public.orders
  where branch_id = v_session.branch_id
    and created_in_shift_id = v_shift.id
    and status not in ('completed', 'cancelled', 'voided');

  if coalesce(array_length(v_active_order_ids, 1), 0) > 0 then
    if p_handover_order_ids is null
       or coalesce(array_length(p_handover_order_ids, 1), 0) <> array_length(v_active_order_ids, 1)
       or exists (
         select 1
         from unnest(v_active_order_ids) as active_order_id
         where not (active_order_id = any(p_handover_order_ids))
       ) then
      raise exception 'All active orders must be handed over before closing this shift';
    end if;

    v_requires_admin_approval := true;

    select *
    into v_admin_session
    from public.validate_device_session(p_admin_session_token, 'admin');

    if not found or v_admin_session.branch_id <> v_session.branch_id then
      raise exception 'Owner or supervisor approval is required to close with handed-over orders';
    end if;

    update public.orders
    set
      handed_over_from_shift_id = v_shift.id,
      handed_over_at = now(),
      handover_note = coalesce(handover_note, 'Handed over during shift close'),
      updated_at = now()
    where id = any(p_handover_order_ids);
  end if;

  select *
  into v_preview
  from public.get_shift_close_preview(p_session_token);

  update public.shifts
  set
    status = 'closed',
    closed_at = now(),
    cash_sales_total = v_preview.cash_payments,
    momo_sales_total = v_preview.momo_payments,
    hubtel_sales_total = v_preview.hubtel_payments,
    delivery_fee_total = v_preview.delivery_fee_total,
    cash_paid_in_total = v_preview.cash_paid_in,
    cash_paid_out_total = v_preview.cash_paid_out,
    cash_refund_total = v_preview.cash_refunds,
    expected_cash = v_preview.expected_cash,
    actual_cash_counted = p_actual_cash_counted,
    cash_variance = p_actual_cash_counted - v_preview.expected_cash,
    open_order_count_at_close = v_preview.active_order_count,
    handover_order_count = coalesce(array_length(p_handover_order_ids, 1), 0),
    closing_note = p_closing_note,
    requires_admin_approval = v_requires_admin_approval,
    approved_by_worker_id = case when v_requires_admin_approval then v_admin_session.worker_id else null end,
    approved_at = case when v_requires_admin_approval then now() else null end,
    updated_at = now()
  where id = v_shift.id
  returning * into v_closed_shift;

  insert into public.audit_logs (
    tenant_id,
    branch_id,
    worker_id,
    shift_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_session.tenant_id,
    v_session.branch_id,
    v_session.worker_id,
    v_shift.id,
    'shift_closed',
    'shift',
    v_shift.id,
    jsonb_build_object(
      'actual_cash_counted', p_actual_cash_counted,
      'expected_cash', v_preview.expected_cash,
      'cash_variance', p_actual_cash_counted - v_preview.expected_cash,
      'active_order_count', v_preview.active_order_count,
      'handover_order_count', coalesce(array_length(p_handover_order_ids, 1), 0),
      'requires_admin_approval', v_requires_admin_approval
    )
  );

  return v_closed_shift;
end;
$$;

grant usage on schema public to anon;
grant execute on function public.authenticate_worker(text, text, text, text) to anon;
grant execute on function public.validate_device_session(text, text) to anon;
grant execute on function public.open_shift(text, numeric, text) to anon;
grant execute on function public.get_shift_close_preview(text) to anon;
grant execute on function public.close_shift(text, numeric, text, uuid[], text) to anon;