-- Admin Order History (Phase 3, Task 5).
--
-- payment_status here is deliberately the exact same case expression as
-- get_pos_active_orders() (0004/0012) - same buckets (unpaid /
-- partially_paid / paid), same threshold logic against sum(payments) vs
-- total, so a given order reads identically whether you're looking at it
-- from the POS or from admin history.
--
-- There's no dedicated status-history table. Every status transition is
-- already captured in audit_logs (pos_order_created /
-- pos_order_status_updated, from 0004/0011) with enough in `details` to
-- reconstruct a clean timeline, so the detail RPC reads from there
-- instead of adding a new table.

drop function if exists public.get_admin_order_history(text, date, date, uuid, text, text, integer, integer) cascade;
drop function if exists public.get_admin_order_detail(text, uuid) cascade;

create or replace function public.get_admin_order_history(
  p_session_token text,
  p_date_from date default null,
  p_date_to date default null,
  p_worker_id uuid default null,
  p_status_bucket text default 'all', -- all | active | completed | cancelled
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  order_id uuid,
  order_number text,
  created_at timestamptz,
  worker_name text,
  fulfillment_type text,
  total numeric,
  payment_status text,
  status text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_bucket text := lower(trim(coalesce(p_status_bucket, 'all')));
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if v_bucket not in ('all', 'active', 'completed', 'cancelled') then
    raise exception 'Invalid status filter';
  end if;

  return query
  with matching_orders as (
    select o.*
    from public.orders as o
    where o.branch_id = v_context.branch_id
      and (
        p_date_from is null
        or (o.created_at at time zone 'Africa/Accra')::date >= p_date_from
      )
      and (
        p_date_to is null
        or (o.created_at at time zone 'Africa/Accra')::date <= p_date_to
      )
      and (p_worker_id is null or o.created_by_worker_id = p_worker_id)
      and (
        v_bucket = 'all'
        or (v_bucket = 'active' and o.status not in ('completed', 'cancelled', 'voided'))
        or (v_bucket = 'completed' and o.status = 'completed')
        or (v_bucket = 'cancelled' and o.status = 'cancelled')
      )
      and (
        v_search is null
        or o.order_number ilike '%' || v_search || '%'
        or o.customer_name ilike '%' || v_search || '%'
        or o.customer_phone ilike '%' || v_search || '%'
      )
  )
  select
    mo.id,
    mo.order_number,
    mo.created_at,
    creator.display_name,
    mo.fulfillment_type,
    mo.total,
    case
      when coalesce(payment_totals.amount_paid, 0) <= 0 then 'unpaid'
      when coalesce(payment_totals.amount_paid, 0) < mo.total then 'partially_paid'
      else 'paid'
    end::text,
    mo.status,
    count(*) over ()
  from matching_orders as mo
  join public.workers as creator
    on creator.id = mo.created_by_worker_id
  left join lateral (
    select coalesce(sum(p.amount), 0) as amount_paid
    from public.payments as p
    where p.order_id = mo.id
  ) as payment_totals
    on true
  order by mo.created_at desc
  limit greatest(coalesce(p_limit, 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.get_admin_order_detail(
  p_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_order record;
  v_result jsonb;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  select o.*, creator.display_name as creator_name, canceller.display_name as canceller_name
  into v_order
  from public.orders as o
  join public.workers as creator
    on creator.id = o.created_by_worker_id
  left join public.workers as canceller
    on canceller.id = o.cancelled_by_worker_id
  where o.id = p_order_id
    and o.branch_id = v_context.branch_id;

  if not found then
    raise exception 'Order not found for this branch';
  end if;

  select jsonb_build_object(
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'status', v_order.status,
    'fulfillmentType', v_order.fulfillment_type,
    'source', v_order.source,
    'customerName', v_order.customer_name,
    'customerPhone', v_order.customer_phone,
    'deliveryAddress', v_order.delivery_address,
    'deliveryFee', v_order.delivery_fee,
    'orderNotes', v_order.order_notes,
    'subtotal', v_order.subtotal,
    'total', v_order.total,
    'createdAt', v_order.created_at,
    'createdByWorkerName', v_order.creator_name,
    'completedAt', v_order.completed_at,
    'cancelledAt', v_order.cancelled_at,
    'cancelledByWorkerName', v_order.canceller_name,
    'cancellationReason', v_order.cancellation_reason,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
          'itemName', oi.item_name,
          'unitPrice', oi.unit_price,
          'quantity', oi.quantity,
          'proteinChoice', oi.protein_choice,
          'lineTotal', oi.line_total
        )
        order by oi.created_at
      )
      from public.order_items as oi
      where oi.order_id = v_order.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pay.id,
          'paymentMethod', pay.payment_method,
          'amount', pay.amount,
          'reference', pay.reference,
          'receivedAt', pay.received_at,
          'receivedByWorkerName', w.display_name
        )
        order by pay.received_at
      )
      from public.payments as pay
      join public.workers as w
        on w.id = pay.received_by_worker_id
      where pay.order_id = v_order.id
    ), '[]'::jsonb),
    'statusHistory', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'action', al.action,
          'details', al.details,
          'workerName', w.display_name,
          'at', al.created_at
        )
        order by al.created_at
      )
      from public.audit_logs as al
      left join public.workers as w
        on w.id = al.worker_id
      where al.entity_type = 'order'
        and al.entity_id = v_order.id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_admin_order_history(text, date, date, uuid, text, text, integer, integer) to anon, authenticated;
grant execute on function public.get_admin_order_detail(text, uuid) to anon, authenticated;
