create or replace function public.get_pos_session_and_shift(
  p_session_token text
)
returns table (
  session_id uuid,
  tenant_id uuid,
  branch_id uuid,
  worker_id uuid,
  worker_name text,
  worker_role text,
  shift_id uuid,
  shift_status text
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
    v_session.session_id,
    v_session.tenant_id,
    v_session.branch_id,
    v_session.worker_id,
    v_session.worker_name,
    v_session.worker_role,
    s.id,
    s.status
  from public.shifts as s
  where s.branch_id = v_session.branch_id
    and s.worker_id = v_session.worker_id
    and s.status = 'open'
  order by s.opened_at desc
  limit 1;

  if not found then
    raise exception 'An open shift is required before taking orders';
  end if;
end;
$$;

create or replace function public.get_order_payment_summary(
  p_order_id uuid
)
returns table (
  amount_paid numeric,
  balance_due numeric,
  payment_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(p.amount), 0)::numeric as amount_paid,
    greatest(
      o.total - coalesce(sum(p.amount), 0),
      0
    )::numeric as balance_due,
    case
      when coalesce(sum(p.amount), 0) <= 0 then 'unpaid'
      when coalesce(sum(p.amount), 0) < o.total then 'partially_paid'
      else 'paid'
    end::text as payment_status
  from public.orders as o
  left join public.payments as p
    on p.order_id = o.id
  where o.id = p_order_id
  group by o.id, o.total;
$$;

create or replace function public.create_pos_order(
  p_session_token text,
  p_fulfillment_type text,
  p_source text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_delivery_fee numeric,
  p_rider_id uuid,
  p_order_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_item jsonb;
  v_menu_item record;
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric := 0;
  v_delivery_fee numeric := 0;
  v_total numeric := 0;
  v_quantity integer;
  v_protein_choice text;
  v_protein_price_adjustment numeric := 0;
  v_line_total numeric;
  v_sequence integer;
  v_item_count integer := 0;
begin
  select *
  into v_context
  from public.get_pos_session_and_shift(p_session_token);

  if p_fulfillment_type not in ('walk-in', 'pickup', 'delivery', 'dine-in') then
    raise exception 'Invalid fulfillment type';
  end if;

  if p_source not in ('direct-pos', 'phone-call', 'whatsapp', 'hubtel', 'other') then
    raise exception 'Invalid order source';
  end if;

  if jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception 'An order must include at least one item';
  end if;

  if p_fulfillment_type = 'delivery' then
    if coalesce(trim(p_delivery_address), '') = '' then
      raise exception 'A delivery address or landmark is required for delivery orders';
    end if;

    if coalesce(p_delivery_fee, 0) < 0 then
      raise exception 'Delivery fee cannot be negative';
    end if;

    v_delivery_fee := round(coalesce(p_delivery_fee, 0), 2);

    if p_rider_id is not null and not exists (
      select 1
      from public.riders as r
      where r.id = p_rider_id
        and r.branch_id = v_context.branch_id
        and r.is_active = true
    ) then
      raise exception 'Selected rider is not active for this branch';
    end if;
  else
    v_delivery_fee := 0;

    if p_rider_id is not null then
      raise exception 'A rider can only be assigned to a delivery order';
    end if;
  end if;

  for v_item in
    select json_items.value
    from jsonb_array_elements(p_items) as json_items(value)
  loop
    v_item_count := v_item_count + 1;
    v_protein_price_adjustment := 0;

    if coalesce(v_item ->> 'menu_item_id', '') = '' then
      raise exception 'Each order item requires menu_item_id';
    end if;

    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception
      when others then
        raise exception 'Item quantity must be a whole number';
    end;

    if v_quantity <= 0 or v_quantity > 100 then
      raise exception 'Item quantity must be between 1 and 100';
    end if;

    select
      mi.id,
      mi.name,
      mi.base_price,
      mi.requires_protein
    into v_menu_item
    from public.menu_items as mi
    where mi.id = (v_item ->> 'menu_item_id')::uuid
      and mi.branch_id = v_context.branch_id
      and mi.is_available = true
      and mi.is_archived = false
    limit 1;

    if not found then
      raise exception 'One selected menu item is unavailable or invalid';
    end if;

    v_protein_choice := nullif(trim(v_item ->> 'protein_choice'), '');

    if v_menu_item.requires_protein and v_protein_choice is null then
      raise exception 'A protein choice is required for %', v_menu_item.name;
    end if;

    if not v_menu_item.requires_protein and v_protein_choice is not null then
      raise exception '% does not support a protein choice', v_menu_item.name;
    end if;

    if v_menu_item.requires_protein then
      select mpo.price_adjustment
      into v_protein_price_adjustment
      from public.menu_item_protein_options as mpo
      where mpo.menu_item_id = v_menu_item.id
        and mpo.name = v_protein_choice
        and mpo.is_active = true
      limit 1;

      if not found then
        raise exception 'Invalid protein choice for %', v_menu_item.name;
      end if;
    end if;

    v_line_total := round(
      (v_menu_item.base_price + coalesce(v_protein_price_adjustment, 0))
      * v_quantity,
      2
    );

    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_subtotal := round(v_subtotal, 2);
  v_total := round(v_subtotal + v_delivery_fee, 2);

  select count(*) + 1
  into v_sequence
  from public.orders as o
  where o.branch_id = v_context.branch_id
    and o.created_at::date = current_date;

  v_order_number := format(
    'YY-%s-%s',
    to_char(current_date, 'YYYYMMDD'),
    lpad(v_sequence::text, 3, '0')
  );

  insert into public.orders (
    tenant_id,
    branch_id,
    order_number,
    status,
    fulfillment_type,
    source,
    customer_name,
    customer_phone,
    delivery_address,
    delivery_fee,
    rider_id,
    order_notes,
    subtotal,
    total,
    created_by_worker_id,
    created_in_shift_id,
    last_updated_by_worker_id,
    last_updated_in_shift_id
  )
  values (
    v_context.tenant_id,
    v_context.branch_id,
    v_order_number,
    'confirmed',
    p_fulfillment_type,
    p_source,
    nullif(trim(p_customer_name), ''),
    nullif(trim(p_customer_phone), ''),
    case
      when p_fulfillment_type = 'delivery'
      then nullif(trim(p_delivery_address), '')
      else null
    end,
    v_delivery_fee,
    p_rider_id,
    nullif(trim(p_order_notes), ''),
    v_subtotal,
    v_total,
    v_context.worker_id,
    v_context.shift_id,
    v_context.worker_id,
    v_context.shift_id
  )
  returning id into v_order_id;

  for v_item in
    select json_items.value
    from jsonb_array_elements(p_items) as json_items(value)
  loop
    v_protein_price_adjustment := 0;
    v_quantity := (v_item ->> 'quantity')::integer;

    select
      mi.id,
      mi.name,
      mi.base_price,
      mi.requires_protein
    into v_menu_item
    from public.menu_items as mi
    where mi.id = (v_item ->> 'menu_item_id')::uuid
      and mi.branch_id = v_context.branch_id
      and mi.is_available = true
      and mi.is_archived = false
    limit 1;

    v_protein_choice := nullif(trim(v_item ->> 'protein_choice'), '');

    if v_menu_item.requires_protein then
      select mpo.price_adjustment
      into v_protein_price_adjustment
      from public.menu_item_protein_options as mpo
      where mpo.menu_item_id = v_menu_item.id
        and mpo.name = v_protein_choice
        and mpo.is_active = true
      limit 1;
    end if;

    v_line_total := round(
      (v_menu_item.base_price + coalesce(v_protein_price_adjustment, 0))
      * v_quantity,
      2
    );

    insert into public.order_items (
      order_id,
      menu_item_id,
      item_name,
      unit_price,
      quantity,
      protein_choice,
      line_total
    )
    values (
      v_order_id,
      v_menu_item.id,
      v_menu_item.name,
      round(
        v_menu_item.base_price + coalesce(v_protein_price_adjustment, 0),
        2
      ),
      v_quantity,
      v_protein_choice,
      v_line_total
    );
  end loop;

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
    v_context.shift_id,
    'order',
    v_order_id,
    'pos_order_created',
    jsonb_build_object(
      'order_number', v_order_number,
      'fulfillment_type', p_fulfillment_type,
      'source', p_source,
      'subtotal', v_subtotal,
      'delivery_fee', v_delivery_fee,
      'total', v_total,
      'item_count', v_item_count
    )
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'status', 'confirmed',
    'fulfillment_type', p_fulfillment_type,
    'subtotal', v_subtotal,
    'delivery_fee', v_delivery_fee,
    'total', v_total,
    'payment_status', 'unpaid',
    'amount_paid', 0,
    'balance_due', v_total,
    'created_by_worker_id', v_context.worker_id,
    'created_in_shift_id', v_context.shift_id
  );
end;
$$;

create or replace function public.record_order_payment(
  p_session_token text,
  p_order_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_order record;
  v_amount numeric;
  v_paid_before numeric := 0;
  v_paid_after numeric := 0;
  v_balance_due numeric := 0;
  v_payment_id uuid;
begin
  select *
  into v_context
  from public.get_pos_session_and_shift(p_session_token);

  if p_payment_method not in ('cash', 'momo', 'hubtel') then
    raise exception 'Invalid payment method';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  v_amount := round(p_amount, 2);

  select
    o.id,
    o.order_number,
    o.total,
    o.status
  into v_order
  from public.orders as o
  where o.id = p_order_id
    and o.branch_id = v_context.branch_id
  for update;

  if not found then
    raise exception 'Order not found for this branch';
  end if;

  if v_order.status in ('cancelled', 'voided') then
    raise exception 'Payment cannot be recorded for a cancelled or voided order';
  end if;

  select coalesce(sum(p.amount), 0)
  into v_paid_before
  from public.payments as p
  where p.order_id = v_order.id;

  if v_paid_before + v_amount > v_order.total then
    raise exception 'Payment exceeds the remaining balance';
  end if;

  insert into public.payments (
    tenant_id,
    branch_id,
    order_id,
    payment_method,
    amount,
    reference,
    received_by_worker_id,
    received_in_shift_id
  )
  values (
    v_context.tenant_id,
    v_context.branch_id,
    v_order.id,
    p_payment_method,
    v_amount,
    nullif(trim(p_reference), ''),
    v_context.worker_id,
    v_context.shift_id
  )
  returning id into v_payment_id;

  v_paid_after := round(v_paid_before + v_amount, 2);
  v_balance_due := round(v_order.total - v_paid_after, 2);

  update public.orders as o
  set
    last_updated_by_worker_id = v_context.worker_id,
    last_updated_in_shift_id = v_context.shift_id,
    updated_at = now()
  where o.id = v_order.id;

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
    v_context.shift_id,
    'payment',
    v_payment_id,
    'order_payment_recorded',
    jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'payment_method', p_payment_method,
      'amount', v_amount,
      'amount_paid_after', v_paid_after,
      'balance_due_after', v_balance_due
    )
  );

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'payment_method', p_payment_method,
    'payment_amount', v_amount,
    'amount_paid', v_paid_after,
    'balance_due', v_balance_due,
    'payment_status',
      case
        when v_paid_after >= v_order.total then 'paid'
        when v_paid_after > 0 then 'partially_paid'
        else 'unpaid'
      end
  );
end;
$$;

create or replace function public.update_pos_order_status(
  p_session_token text,
  p_order_id uuid,
  p_next_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_order record;
  v_transition_allowed boolean := false;
  v_completed_at timestamptz := null;
begin
  select *
  into v_context
  from public.get_pos_session_and_shift(p_session_token);

  if p_next_status not in (
    'confirmed',
    'preparing',
    'ready',
    'awaiting_pickup',
    'out_for_delivery',
    'completed',
    'cancelled'
  ) then
    raise exception 'Invalid next order status';
  end if;

  select
    o.id,
    o.order_number,
    o.status,
    o.fulfillment_type,
    o.total
  into v_order
  from public.orders as o
  where o.id = p_order_id
    and o.branch_id = v_context.branch_id
  for update;

  if not found then
    raise exception 'Order not found for this branch';
  end if;

  if v_order.status in ('completed', 'cancelled', 'voided') then
    raise exception 'This order is already final and cannot be changed';
  end if;

  if v_order.status = p_next_status then
    v_transition_allowed := true;

  elsif v_order.status = 'confirmed'
    and p_next_status in ('preparing', 'cancelled') then
    v_transition_allowed := true;

  elsif v_order.status = 'preparing'
    and p_next_status in ('ready', 'cancelled') then
    v_transition_allowed := true;

  elsif v_order.status = 'ready'
    and (
      (
        v_order.fulfillment_type = 'delivery'
        and p_next_status = 'out_for_delivery'
      )
      or (
        v_order.fulfillment_type in ('walk-in', 'pickup', 'dine-in')
        and p_next_status = 'awaiting_pickup'
      )
      or p_next_status in ('completed', 'cancelled')
    ) then
    v_transition_allowed := true;

  elsif v_order.status = 'awaiting_pickup'
    and p_next_status in ('completed', 'cancelled') then
    v_transition_allowed := true;

  elsif v_order.status = 'out_for_delivery'
    and p_next_status in ('completed', 'cancelled') then
    v_transition_allowed := true;
  end if;

  if not v_transition_allowed then
    raise exception 'Invalid status transition from % to %', v_order.status, p_next_status;
  end if;

  if p_next_status = 'completed' then
    v_completed_at := now();
  end if;

  update public.orders as o
  set
    status = p_next_status,
    completed_by_worker_id = case
      when p_next_status = 'completed' then v_context.worker_id
      else o.completed_by_worker_id
    end,
    completed_in_shift_id = case
      when p_next_status = 'completed' then v_context.shift_id
      else o.completed_in_shift_id
    end,
    completed_at = case
      when p_next_status = 'completed' then v_completed_at
      else o.completed_at
    end,
    last_updated_by_worker_id = v_context.worker_id,
    last_updated_in_shift_id = v_context.shift_id,
    updated_at = now()
  where o.id = v_order.id;

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
    v_context.shift_id,
    'order',
    v_order.id,
    'pos_order_status_updated',
    jsonb_build_object(
      'order_number', v_order.order_number,
      'previous_status', v_order.status,
      'next_status', p_next_status
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'previous_status', v_order.status,
    'status', p_next_status,
    'completed_at', v_completed_at
  );
end;
$$;

create or replace function public.handover_open_order(
  p_session_token text,
  p_order_id uuid,
  p_handover_note text,
  p_receiving_shift_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_order record;
  v_receiving_shift record;
begin
  select *
  into v_context
  from public.get_pos_session_and_shift(p_session_token);

  if coalesce(trim(p_handover_note), '') = '' then
    raise exception 'A handover note is required';
  end if;

  select
    o.id,
    o.order_number,
    o.status,
    o.created_in_shift_id,
    o.handed_over_to_shift_id
  into v_order
  from public.orders as o
  where o.id = p_order_id
    and o.branch_id = v_context.branch_id
  for update;

  if not found then
    raise exception 'Order not found for this branch';
  end if;

  if v_order.status in ('completed', 'cancelled', 'voided') then
    raise exception 'Only active orders can be handed over';
  end if;

  if p_receiving_shift_id is not null then
    select
      s.id,
      s.worker_id,
      s.status
    into v_receiving_shift
    from public.shifts as s
    where s.id = p_receiving_shift_id
      and s.branch_id = v_context.branch_id
      and s.status = 'open'
    limit 1;

    if not found then
      raise exception 'Receiving shift must be an active shift in this branch';
    end if;

    if v_receiving_shift.id = v_context.shift_id then
      raise exception 'An order cannot be handed over to the same shift';
    end if;
  end if;

  update public.orders as o
  set
    handed_over_from_shift_id = v_context.shift_id,
    handed_over_to_shift_id = p_receiving_shift_id,
    handed_over_at = now(),
    handover_note = trim(p_handover_note),
    last_updated_by_worker_id = v_context.worker_id,
    last_updated_in_shift_id = v_context.shift_id,
    updated_at = now()
  where o.id = v_order.id;

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
    v_context.shift_id,
    'order',
    v_order.id,
    'order_handed_over',
    jsonb_build_object(
      'order_number', v_order.order_number,
      'receiving_shift_id', p_receiving_shift_id,
      'handover_note', trim(p_handover_note)
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'handed_over_from_shift_id', v_context.shift_id,
    'handed_over_to_shift_id', p_receiving_shift_id,
    'handover_note', trim(p_handover_note)
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
  v_open_order_count integer := 0;
  v_unassigned_handover_count integer := 0;
  v_expected_cash numeric;
  v_actual_cash numeric;
  v_cash_variance numeric;
  v_admin_session record;
  v_requires_admin_approval boolean := false;
  v_approved_by_worker_id uuid := null;
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

  v_preview := public.get_shift_close_preview(p_session_token);
  v_open_order_count := coalesce((v_preview ->> 'open_order_count')::integer, 0);
  v_expected_cash := round(coalesce((v_preview ->> 'expected_cash')::numeric, 0), 2);
  v_cash_variance := round(v_actual_cash - v_expected_cash, 2);

  if v_cash_variance <> 0
    and coalesce(trim(p_closing_note), '') = '' then
    raise exception 'A closing note is required when actual cash differs from expected cash';
  end if;

  if v_open_order_count > 0 then
    select count(*)
    into v_unassigned_handover_count
    from public.orders as o
    where o.branch_id = v_context.branch_id
      and o.status not in ('completed', 'cancelled', 'voided')
      and (
        o.created_in_shift_id = v_shift.id
        or o.handed_over_to_shift_id = v_shift.id
      )
      and (
        o.handed_over_from_shift_id is distinct from v_shift.id
        or o.handover_note is null
        or trim(o.handover_note) = ''
      );

    if v_unassigned_handover_count > 0 then
      raise exception 'Active orders must be resolved or explicitly handed over before this shift can close';
    end if;

    select count(*)
    into v_unassigned_handover_count
    from public.orders as o
    where o.branch_id = v_context.branch_id
      and o.status not in ('completed', 'cancelled', 'voided')
      and o.handed_over_from_shift_id = v_shift.id
      and o.handed_over_to_shift_id is null;

    if v_unassigned_handover_count > 0 then
      v_requires_admin_approval := true;

      if coalesce(trim(p_admin_session_token), '') = '' then
        raise exception 'Owner/admin approval is required to close with unassigned handover orders';
      end if;

      select *
      into v_admin_session
      from public.current_worker_session(p_admin_session_token, 'admin');

      if not found
        or v_admin_session.branch_id <> v_context.branch_id
        or v_admin_session.worker_role not in ('owner', 'admin', 'manager') then
        raise exception 'A valid owner/admin session for this branch is required';
      end if;

      v_approved_by_worker_id := v_admin_session.worker_id;
    end if;
  end if;

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
    open_order_count_at_close = v_open_order_count,
    handover_order_count = case
      when v_open_order_count > 0 then v_open_order_count
      else 0
    end,
    closing_note = nullif(trim(p_closing_note), ''),
    requires_admin_approval = v_requires_admin_approval,
    approved_by_worker_id = v_approved_by_worker_id,
    approved_at = case
      when v_approved_by_worker_id is not null then now()
      else null
    end,
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
      'open_order_count', v_open_order_count,
      'requires_admin_approval', v_requires_admin_approval,
      'approved_by_worker_id', v_approved_by_worker_id,
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
    'open_order_count_at_close', v_open_order_count,
    'handover_order_count', case
      when v_open_order_count > 0 then v_open_order_count
      else 0
    end,
    'requires_admin_approval', v_requires_admin_approval
  );
end;
$$;

revoke all on function public.get_pos_session_and_shift(text) from public;
revoke all on function public.get_order_payment_summary(uuid) from public;
revoke all on function public.create_pos_order(text, text, text, text, text, text, numeric, uuid, text, jsonb) from public;
revoke all on function public.record_order_payment(text, uuid, text, numeric, text) from public;
revoke all on function public.update_pos_order_status(text, uuid, text) from public;
revoke all on function public.handover_open_order(text, uuid, text, uuid) from public;
revoke all on function public.close_worker_shift(text, numeric, text, text) from public;

grant execute on function public.create_pos_order(text, text, text, text, text, text, numeric, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.record_order_payment(text, uuid, text, numeric, text) to anon, authenticated;
grant execute on function public.update_pos_order_status(text, uuid, text) to anon, authenticated;
grant execute on function public.handover_open_order(text, uuid, text, uuid) to anon, authenticated;
grant execute on function public.close_worker_shift(text, numeric, text, text) to anon, authenticated;
grant execute on function public.get_shift_close_preview(text) to anon, authenticated;