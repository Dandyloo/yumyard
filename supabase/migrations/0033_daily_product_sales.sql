-- 0033: Per-product "how many sold" for a day.
--  * admin_daily_product_sales(token, date): any past/present calendar day (Africa/Accra), for the Admin "Daily Sales" tab.
--  * pos_day_product_sales(token): since the last day close (matches the Close Day totals), for the POS close-day screen.
-- Cancelled / voided orders are excluded, same rule as every other sales figure.
-- (Applied live to project ebfiocmxdirsxtmgiudu as "daily_product_sales".)

create or replace function public.branch_product_sales(p_branch_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_items jsonb;
  v_totals record;
begin
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.cat_sort, t.item_sort, t.item_name), '[]'::jsonb)
  into v_items
  from (
    select
      oi.menu_item_id as item_id,
      coalesce(mi.name, oi.item_name) as item_name,
      coalesce(c.name, 'Other') as category_name,
      coalesce(c.sort_order, 999) as cat_sort,
      coalesce(mi.sort_order, 999) as item_sort,
      sum(oi.quantity)::integer as quantity,
      sum(oi.line_total) as revenue,
      count(distinct oi.order_id)::integer as orders,
      (
        select coalesce(jsonb_agg(jsonb_build_object('name', p.protein, 'quantity', p.qty) order by p.qty desc), '[]'::jsonb)
        from (
          select oi2.protein_choice as protein, sum(oi2.quantity)::integer as qty
          from public.order_items oi2
          join public.orders o2 on o2.id = oi2.order_id
          where oi2.menu_item_id is not distinct from oi.menu_item_id
            and oi2.item_name = oi.item_name
            and oi2.protein_choice is not null
            and o2.branch_id = p_branch_id
            and o2.status not in ('cancelled', 'voided')
            and o2.created_at >= p_from and o2.created_at < p_to
          group by oi2.protein_choice
        ) p
      ) as proteins
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join public.menu_items mi on mi.id = oi.menu_item_id
    left join public.menu_categories c on c.id = mi.category_id
    where o.branch_id = p_branch_id
      and o.status not in ('cancelled', 'voided')
      and o.created_at >= p_from and o.created_at < p_to
    group by oi.menu_item_id, oi.item_name, mi.name, mi.sort_order, c.name, c.sort_order
  ) t;

  select
    count(*) filter (where o.status not in ('cancelled', 'voided'))::integer as orders_count,
    coalesce(sum(o.total) filter (where o.status not in ('cancelled', 'voided')), 0) as sales,
    count(*) filter (where o.status = 'cancelled')::integer as cancelled_count
  into v_totals
  from public.orders o
  where o.branch_id = p_branch_id and o.created_at >= p_from and o.created_at < p_to;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'orders_count', v_totals.orders_count,
    'total_sales', v_totals.sales,
    'cancelled_count', v_totals.cancelled_count,
    'total_units', (select coalesce(sum((x->>'quantity')::integer), 0) from jsonb_array_elements(v_items) x),
    'items', v_items
  );
end;
$function$;

revoke all on function public.branch_product_sales(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.admin_daily_product_sales(p_session_token text, p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_context record;
  v_date date := coalesce(p_date, (now() at time zone 'Africa/Accra')::date);
  v_from timestamptz := (v_date::timestamp) at time zone 'Africa/Accra';
begin
  select * into v_context from public.get_admin_session(p_session_token);

  return public.branch_product_sales(v_context.branch_id, v_from, v_from + interval '1 day')
    || jsonb_build_object('date', v_date, 'is_today', v_date = (now() at time zone 'Africa/Accra')::date);
end;
$function$;

create or replace function public.pos_day_product_sales(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_session record;
  v_since timestamptz;
begin
  select * into v_session from public.current_worker_session(p_session_token, 'pos');

  select coalesce(
    (select bdc.closed_at from public.business_day_closes bdc where bdc.branch_id = v_session.branch_id order by bdc.closed_at desc limit 1),
    ((now() at time zone 'Africa/Accra')::date)::timestamp at time zone 'Africa/Accra'
  ) into v_since;

  return public.branch_product_sales(v_session.branch_id, v_since, now() + interval '1 minute');
end;
$function$;

grant execute on function public.admin_daily_product_sales(text, date) to anon, authenticated;
grant execute on function public.pos_day_product_sales(text) to anon, authenticated;
