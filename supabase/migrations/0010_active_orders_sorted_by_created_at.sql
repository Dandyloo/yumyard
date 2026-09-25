-- 0010: Order list ordering.
--
-- get_pos_active_orders() previously sorted by a status-priority bucket
-- (confirmed, preparing, ready, ...) and then created_at ascending within
-- each bucket. Per spec, active orders should always be newest-first by
-- created_at, full stop - and a status change must never reorder the
-- list. Since no function in this schema ever writes to orders.created_at
-- (update_pos_order_status only touches status/completed_*/updated_at/
-- last_updated_*), sorting purely by created_at desc guarantees both
-- requirements: newest-first, and status transitions are a no-op for
-- position in the list.

create or replace function public.get_pos_active_orders(
  p_session_token text
)
returns table (
  order_id uuid,
  order_number text,
  status text,
  fulfillment_type text,
  source text,
  customer_name text,
  customer_phone text,
  delivery_address text,
  rider_id uuid,
  rider_name text,
  order_notes text,
  subtotal numeric,
  delivery_fee numeric,
  total numeric,
  amount_paid numeric,
  balance_due numeric,
  payment_status text,
  created_at timestamptz,
  created_by_worker_name text,
  created_in_shift_id uuid,
  handed_over_from_shift_id uuid,
  handed_over_to_shift_id uuid,
  handover_note text
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
  from public.get_pos_session_and_shift(p_session_token);

  return query
  select
    o.id,
    o.order_number,
    o.status,
    o.fulfillment_type,
    o.source,
    o.customer_name,
    o.customer_phone,
    o.delivery_address,
    o.rider_id,
    r.display_name,
    o.order_notes,
    o.subtotal,
    o.delivery_fee,
    o.total,
    coalesce(payment_totals.amount_paid, 0)::numeric,
    greatest(
      o.total - coalesce(payment_totals.amount_paid, 0),
      0
    )::numeric,
    case
      when coalesce(payment_totals.amount_paid, 0) <= 0 then 'unpaid'
      when coalesce(payment_totals.amount_paid, 0) < o.total then 'partially_paid'
      else 'paid'
    end::text,
    o.created_at,
    creator.display_name,
    o.created_in_shift_id,
    o.handed_over_from_shift_id,
    o.handed_over_to_shift_id,
    o.handover_note
  from public.orders as o
  join public.workers as creator
    on creator.id = o.created_by_worker_id
  left join public.riders as r
    on r.id = o.rider_id
  left join lateral (
    select coalesce(sum(p.amount), 0) as amount_paid
    from public.payments as p
    where p.order_id = o.id
  ) as payment_totals
    on true
  where o.branch_id = v_context.branch_id
    and o.status not in ('completed', 'cancelled', 'voided')
    and (
      o.created_in_shift_id = v_context.shift_id
      or o.handed_over_to_shift_id = v_context.shift_id
    )
  order by o.created_at desc;
end;
$$;

revoke all on function public.get_pos_active_orders(text) from public;
grant execute on function public.get_pos_active_orders(text) to anon, authenticated;
