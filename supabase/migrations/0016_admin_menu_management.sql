-- Admin Menu Management (Phase 3, Task 3). The POS side only ever reads
-- menu_categories/menu_items/menu_item_protein_options through public RLS
-- policies scoped to is_active/is_available rows (see 0001/0009) - there
-- were no RPCs for these tables at all before this migration, and no way
-- for an admin to see or touch an inactive/archived row. Everything here
-- is a SECURITY DEFINER RPC gated by an admin session token, mirroring
-- get_admin_session() from 0015.
--
-- No destructive deletes anywhere: categories are enabled/disabled via
-- is_active, items via is_available (temporarily 86'd) and is_archived
-- (retired for good) - archived items must stay in the table so historical
-- orders that reference them keep working.

create extension if not exists unaccent with schema extensions;

drop function if exists public.admin_slugify(text) cascade;
drop function if exists public.admin_unique_slug(text, text, uuid) cascade;
drop function if exists public.get_admin_menu(text) cascade;
drop function if exists public.admin_create_category(text, text) cascade;
drop function if exists public.admin_update_category(text, uuid, text) cascade;
drop function if exists public.admin_set_category_active(text, uuid, boolean) cascade;
drop function if exists public.admin_reorder_categories(text, uuid[]) cascade;
drop function if exists public.admin_create_menu_item(text, uuid, text, numeric, boolean) cascade;
drop function if exists public.admin_update_menu_item(text, uuid, text, uuid, numeric, boolean) cascade;
drop function if exists public.admin_set_menu_item_availability(text, uuid, boolean) cascade;
drop function if exists public.admin_set_menu_item_archived(text, uuid, boolean) cascade;
drop function if exists public.admin_create_protein_option(text, uuid, text, numeric) cascade;
drop function if exists public.admin_update_protein_option(text, uuid, text, numeric) cascade;
drop function if exists public.admin_set_protein_option_active(text, uuid, boolean) cascade;

-- Small helper: turn "Attiéké Packs" into "attieke-packs". unaccent() ships
-- in the extensions schema already on the search_path of every function
-- below.
create or replace function public.admin_slugify(p_text text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(
      lower(unaccent(coalesce(p_text, ''))),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$;

-- Appends -2, -3, ... to the slugified name until it's unique among the
-- given table's rows for this branch (excluding the row being edited).
create or replace function public.admin_unique_slug(
  p_table_name text,
  p_base_name text,
  p_branch_id uuid,
  p_exclude_id uuid default null
)
returns text
language plpgsql
as $$
declare
  v_base text := public.admin_slugify(p_base_name);
  v_candidate text;
  v_suffix int := 1;
  v_exists boolean;
begin
  if v_base = '' then
    v_base := 'item';
  end if;

  v_candidate := v_base;

  loop
    execute format(
      'select exists(select 1 from public.%I where branch_id = $1 and slug = $2 and ($3 is null or id <> $3))',
      p_table_name
    )
    into v_exists
    using p_branch_id, v_candidate, p_exclude_id;

    exit when not v_exists;

    v_suffix := v_suffix + 1;
    v_candidate := v_base || '-' || v_suffix;
  end loop;

  return v_candidate;
end;
$$;

-- One call, everything the Menu screen needs: every category (active and
-- inactive) and every item (available/unavailable, archived and not),
-- each item carrying its protein options nested. Small dataset (a
-- handful of categories/items per branch) so one aggregated JSON payload
-- beats juggling three separate fetches client-side.
create or replace function public.get_admin_menu(
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_result jsonb;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'slug', c.slug,
          'sortOrder', c.sort_order,
          'isActive', c.is_active
        )
        order by c.sort_order, c.name
      )
      from public.menu_categories as c
      where c.branch_id = v_context.branch_id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'categoryId', i.category_id,
          'name', i.name,
          'slug', i.slug,
          'description', i.description,
          'basePrice', i.base_price,
          'requiresProtein', i.requires_protein,
          'isAvailable', i.is_available,
          'isArchived', i.is_archived,
          'sortOrder', i.sort_order,
          'proteinOptions', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', po.id,
                'name', po.name,
                'priceAdjustment', po.price_adjustment,
                'isActive', po.is_active,
                'sortOrder', po.sort_order
              )
              order by po.sort_order, po.name
            )
            from public.menu_item_protein_options as po
            where po.menu_item_id = i.id
          ), '[]'::jsonb)
        )
        order by i.sort_order, i.name
      )
      from public.menu_items as i
      where i.branch_id = v_context.branch_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- --- Categories -------------------------------------------------------

create or replace function public.admin_create_category(
  p_session_token text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_name text := trim(coalesce(p_name, ''));
  v_next_sort int;
  v_slug text;
  v_id uuid;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if v_name = '' then
    raise exception 'Category name is required';
  end if;

  select coalesce(max(sort_order), 0) + 1
  into v_next_sort
  from public.menu_categories
  where branch_id = v_context.branch_id;

  v_slug := public.admin_unique_slug('menu_categories', v_name, v_context.branch_id);

  insert into public.menu_categories (
    tenant_id, branch_id, name, slug, sort_order, is_active
  ) values (
    v_context.tenant_id, v_context.branch_id, v_name, v_slug, v_next_sort, true
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_update_category(
  p_session_token text,
  p_category_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_name text := trim(coalesce(p_name, ''));
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if v_name = '' then
    raise exception 'Category name is required';
  end if;

  update public.menu_categories
  set
    name = v_name,
    slug = public.admin_unique_slug('menu_categories', v_name, v_context.branch_id, p_category_id),
    updated_at = now()
  where id = p_category_id
    and branch_id = v_context.branch_id;

  if not found then
    raise exception 'Category not found for this branch';
  end if;
end;
$$;

create or replace function public.admin_set_category_active(
  p_session_token text,
  p_category_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  update public.menu_categories
  set is_active = p_is_active, updated_at = now()
  where id = p_category_id
    and branch_id = v_context.branch_id;

  if not found then
    raise exception 'Category not found for this branch';
  end if;
end;
$$;

-- Reassigns sort_order 1..N to match the order of the ids array. Any
-- category for this branch not included is left as-is (defensive, but
-- the admin UI always sends the full list).
create or replace function public.admin_reorder_categories(
  p_session_token text,
  p_category_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_owned_count int;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  select count(*)
  into v_owned_count
  from public.menu_categories
  where branch_id = v_context.branch_id
    and id = any(p_category_ids);

  if v_owned_count <> coalesce(array_length(p_category_ids, 1), 0) then
    raise exception 'One or more categories do not belong to this branch';
  end if;

  update public.menu_categories as c
  set sort_order = ordered.position, updated_at = now()
  from (
    select id, row_number() over () as position
    from unnest(p_category_ids) as id
  ) as ordered
  where c.id = ordered.id;
end;
$$;

-- --- Menu items ---------------------------------------------------------

create or replace function public.admin_create_menu_item(
  p_session_token text,
  p_category_id uuid,
  p_name text,
  p_base_price numeric,
  p_requires_protein boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_name text := trim(coalesce(p_name, ''));
  v_next_sort int;
  v_slug text;
  v_id uuid;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if v_name = '' then
    raise exception 'Item name is required';
  end if;

  if p_base_price is null or p_base_price < 0 then
    raise exception 'Price must be zero or greater';
  end if;

  if not exists (
    select 1 from public.menu_categories
    where id = p_category_id and branch_id = v_context.branch_id
  ) then
    raise exception 'Category not found for this branch';
  end if;

  select coalesce(max(sort_order), 0) + 1
  into v_next_sort
  from public.menu_items
  where branch_id = v_context.branch_id;

  v_slug := public.admin_unique_slug('menu_items', v_name, v_context.branch_id);

  insert into public.menu_items (
    tenant_id, branch_id, category_id, name, slug, base_price,
    requires_protein, is_available, is_archived, sort_order
  ) values (
    v_context.tenant_id, v_context.branch_id, p_category_id, v_name, v_slug,
    p_base_price, coalesce(p_requires_protein, false), true, false, v_next_sort
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_update_menu_item(
  p_session_token text,
  p_item_id uuid,
  p_name text,
  p_category_id uuid,
  p_base_price numeric,
  p_requires_protein boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_name text := trim(coalesce(p_name, ''));
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if v_name = '' then
    raise exception 'Item name is required';
  end if;

  if p_base_price is null or p_base_price < 0 then
    raise exception 'Price must be zero or greater';
  end if;

  if not exists (
    select 1 from public.menu_categories
    where id = p_category_id and branch_id = v_context.branch_id
  ) then
    raise exception 'Category not found for this branch';
  end if;

  update public.menu_items
  set
    name = v_name,
    slug = public.admin_unique_slug('menu_items', v_name, v_context.branch_id, p_item_id),
    category_id = p_category_id,
    base_price = p_base_price,
    requires_protein = coalesce(p_requires_protein, false),
    updated_at = now()
  where id = p_item_id
    and branch_id = v_context.branch_id;

  if not found then
    raise exception 'Item not found for this branch';
  end if;
end;
$$;

create or replace function public.admin_set_menu_item_availability(
  p_session_token text,
  p_item_id uuid,
  p_is_available boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  update public.menu_items
  set is_available = p_is_available, updated_at = now()
  where id = p_item_id
    and branch_id = v_context.branch_id;

  if not found then
    raise exception 'Item not found for this branch';
  end if;
end;
$$;

-- Archive is separate from availability: an unavailable item is a
-- temporary 86, an archived item is retired for good but its row (and
-- every historical order_item pointing at it) must never be deleted.
create or replace function public.admin_set_menu_item_archived(
  p_session_token text,
  p_item_id uuid,
  p_is_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  update public.menu_items
  set
    is_archived = p_is_archived,
    -- Archiving also pulls it off the POS grid immediately; unarchiving
    -- doesn't automatically re-list it as available, so a re-added item
    -- always needs a deliberate "make available" step.
    is_available = case when p_is_archived then false else is_available end,
    updated_at = now()
  where id = p_item_id
    and branch_id = v_context.branch_id;

  if not found then
    raise exception 'Item not found for this branch';
  end if;
end;
$$;

-- --- Protein options ------------------------------------------------------

create or replace function public.admin_create_protein_option(
  p_session_token text,
  p_menu_item_id uuid,
  p_name text,
  p_price_adjustment numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_name text := trim(coalesce(p_name, ''));
  v_next_sort int;
  v_id uuid;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if v_name = '' then
    raise exception 'Option name is required';
  end if;

  if not exists (
    select 1 from public.menu_items
    where id = p_menu_item_id and branch_id = v_context.branch_id
  ) then
    raise exception 'Item not found for this branch';
  end if;

  select coalesce(max(sort_order), 0) + 1
  into v_next_sort
  from public.menu_item_protein_options
  where menu_item_id = p_menu_item_id;

  insert into public.menu_item_protein_options (
    menu_item_id, name, price_adjustment, is_active, sort_order
  ) values (
    p_menu_item_id, v_name, coalesce(p_price_adjustment, 0), true, v_next_sort
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_update_protein_option(
  p_session_token text,
  p_option_id uuid,
  p_name text,
  p_price_adjustment numeric
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_name text := trim(coalesce(p_name, ''));
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if v_name = '' then
    raise exception 'Option name is required';
  end if;

  update public.menu_item_protein_options as po
  set
    name = v_name,
    price_adjustment = coalesce(p_price_adjustment, 0)
  from public.menu_items as i
  where po.id = p_option_id
    and i.id = po.menu_item_id
    and i.branch_id = v_context.branch_id;

  if not found then
    raise exception 'Option not found for this branch';
  end if;
end;
$$;

create or replace function public.admin_set_protein_option_active(
  p_session_token text,
  p_option_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  update public.menu_item_protein_options as po
  set is_active = p_is_active
  from public.menu_items as i
  where po.id = p_option_id
    and i.id = po.menu_item_id
    and i.branch_id = v_context.branch_id;

  if not found then
    raise exception 'Option not found for this branch';
  end if;
end;
$$;

grant execute on function public.get_admin_menu(text) to anon, authenticated;
grant execute on function public.admin_create_category(text, text) to anon, authenticated;
grant execute on function public.admin_update_category(text, uuid, text) to anon, authenticated;
grant execute on function public.admin_set_category_active(text, uuid, boolean) to anon, authenticated;
grant execute on function public.admin_reorder_categories(text, uuid[]) to anon, authenticated;
grant execute on function public.admin_create_menu_item(text, uuid, text, numeric, boolean) to anon, authenticated;
grant execute on function public.admin_update_menu_item(text, uuid, text, uuid, numeric, boolean) to anon, authenticated;
grant execute on function public.admin_set_menu_item_availability(text, uuid, boolean) to anon, authenticated;
grant execute on function public.admin_set_menu_item_archived(text, uuid, boolean) to anon, authenticated;
grant execute on function public.admin_create_protein_option(text, uuid, text, numeric) to anon, authenticated;
grant execute on function public.admin_update_protein_option(text, uuid, text, numeric) to anon, authenticated;
grant execute on function public.admin_set_protein_option_active(text, uuid, boolean) to anon, authenticated;
