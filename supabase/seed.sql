create extension if not exists pgcrypto;

do $$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_admin_id uuid;

  v_attieke_category_id uuid;
  v_banku_category_id uuid;
  v_extras_category_id uuid;
  v_drinks_category_id uuid;

  v_attieke_loaded_id uuid;
  v_attieke_fully_loaded_id uuid;
  v_attieke_overloaded_id uuid;

  v_banku_loaded_id uuid;
  v_banku_fully_loaded_id uuid;
  v_banku_overloaded_id uuid;
begin
  insert into public.tenants (
    name,
    slug
  )
  values (
    'Yum Yard',
    'yum-yard'
  )
  on conflict (slug)
  do update set
    name = excluded.name,
    updated_at = now()
  returning id into v_tenant_id;

  insert into public.branches (
    tenant_id,
    name,
    slug,
    address,
    phone,
    timezone,
    currency_code,
    is_active
  )
  values (
    v_tenant_id,
    'Yum Yard Abura',
    'abura',
    'Abura, Science Taxi Rank Exit, Cape Coast, Ghana',
    '0544603124',
    'Africa/Accra',
    'GHS',
    true
  )
  on conflict (tenant_id, slug)
  do update set
    name = excluded.name,
    address = excluded.address,
    phone = excluded.phone,
    timezone = excluded.timezone,
    currency_code = excluded.currency_code,
    is_active = excluded.is_active,
    updated_at = now()
  returning id into v_branch_id;

  /*
    DEVELOPMENT OWNER ACCOUNT ONLY.

    Username: admin
    Temporary PIN: 123456

    Change the PIN immediately in Supabase after running this seed
    on any environment that is not disposable local development.
  */
  insert into public.workers (
    tenant_id,
    branch_id,
    display_name,
    username,
    pin_hash,
    role,
    is_active
  )
  values (
    v_tenant_id,
    v_branch_id,
    'Yum Yard Owner',
    'admin',
    extensions.crypt('123456', extensions.gen_salt('bf')),
    'owner',
    true
  )
  on conflict (branch_id, username)
  do update set
    tenant_id = excluded.tenant_id,
    display_name = excluded.display_name,
    role = excluded.role,
    is_active = excluded.is_active,
    updated_at = now()
  returning id into v_admin_id;

  insert into public.riders (
    tenant_id,
    branch_id,
    display_name,
    phone,
    is_active
  )
  select
    v_tenant_id,
    v_branch_id,
    'Unassigned rider',
    null,
    true
  where not exists (
    select 1
    from public.riders
    where branch_id = v_branch_id
      and display_name = 'Unassigned rider'
  );

  insert into public.menu_categories (
    tenant_id,
    branch_id,
    name,
    slug,
    sort_order,
    is_active
  )
  values
    (v_tenant_id, v_branch_id, 'Attiéké Packs', 'attieke-packs', 10, true),
    (v_tenant_id, v_branch_id, 'Banku Packs', 'banku-packs', 20, true),
    (v_tenant_id, v_branch_id, 'Extras', 'extras', 30, true),
    (v_tenant_id, v_branch_id, 'Drinks', 'drinks', 40, true)
  on conflict (branch_id, slug)
  do update set
    name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

  select id
  into v_attieke_category_id
  from public.menu_categories
  where branch_id = v_branch_id
    and slug = 'attieke-packs';

  select id
  into v_banku_category_id
  from public.menu_categories
  where branch_id = v_branch_id
    and slug = 'banku-packs';

  select id
  into v_extras_category_id
  from public.menu_categories
  where branch_id = v_branch_id
    and slug = 'extras';

  select id
  into v_drinks_category_id
  from public.menu_categories
  where branch_id = v_branch_id
    and slug = 'drinks';

  insert into public.menu_items (
    tenant_id,
    branch_id,
    category_id,
    name,
    slug,
    description,
    base_price,
    requires_protein,
    is_available,
    is_archived,
    sort_order
  )
  values
    (
      v_tenant_id,
      v_branch_id,
      v_attieke_category_id,
      'Attiéké Loaded Pack',
      'attieke-loaded-pack',
      'Fried egg, fried plantain, half tilapia or chicken, sautéed vegetables and chili sauce.',
      65.00,
      true,
      true,
      false,
      10
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_attieke_category_id,
      'Attiéké Fully Loaded Pack',
      'attieke-fully-loaded-pack',
      'Fried egg, fried plantain, full tilapia or chicken, sautéed vegetables and chili sauce.',
      95.00,
      true,
      true,
      false,
      20
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_attieke_category_id,
      'Attiéké Overloaded Pack',
      'attieke-overloaded-pack',
      'More attiéké, fried egg, fried plantain, extra-big full tilapia or chicken, sautéed vegetables and chili sauce.',
      120.00,
      true,
      true,
      false,
      30
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_banku_category_id,
      'Banku Loaded Pack',
      'banku-loaded-pack',
      'Two banku balls, half tilapia or chicken, fried egg, shito, sautéed vegetables and pepper sauce.',
      55.00,
      true,
      true,
      false,
      10
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_banku_category_id,
      'Banku Fully Loaded Pack',
      'banku-fully-loaded-pack',
      'Two banku balls, full tilapia or chicken, fried egg, shito, sautéed vegetables and pepper sauce.',
      80.00,
      true,
      true,
      false,
      20
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_banku_category_id,
      'Banku Overloaded Pack',
      'banku-overloaded-pack',
      'Three banku balls, extra-big full tilapia or chicken, fried egg, shito and sautéed vegetables.',
      120.00,
      true,
      true,
      false,
      30
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_extras_category_id,
      'Fried Plantain',
      'extra-fried-plantain',
      'Extra fried plantain portion.',
      10.00,
      false,
      true,
      false,
      10
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_extras_category_id,
      'Fried Egg',
      'extra-fried-egg',
      'One extra fried egg.',
      5.00,
      false,
      true,
      false,
      20
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_extras_category_id,
      'Attiéké',
      'extra-attieke',
      'Standalone attiéké serving.',
      35.00,
      false,
      true,
      false,
      30
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_extras_category_id,
      'Avocado',
      'extra-avocado',
      'Fresh avocado add-on.',
      5.00,
      false,
      true,
      false,
      40
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_extras_category_id,
      'Banku',
      'extra-banku',
      'One extra banku ball.',
      5.00,
      false,
      true,
      false,
      50
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_extras_category_id,
      'Sausage',
      'extra-sausage',
      'One sausage add-on.',
      5.00,
      false,
      true,
      false,
      60
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_drinks_category_id,
      'Tigernut Juice',
      'tigernut-juice',
      'Fresh tigernut juice.',
      20.00,
      false,
      true,
      false,
      10
    ),
    (
      v_tenant_id,
      v_branch_id,
      v_drinks_category_id,
      'Pineapple Juice',
      'pineapple-juice',
      'Fresh pineapple juice.',
      15.00,
      false,
      true,
      false,
      20
    )
  on conflict (branch_id, slug)
  do update set
    category_id = excluded.category_id,
    name = excluded.name,
    description = excluded.description,
    base_price = excluded.base_price,
    requires_protein = excluded.requires_protein,
    is_available = excluded.is_available,
    is_archived = excluded.is_archived,
    sort_order = excluded.sort_order,
    updated_at = now();

  select id
  into v_attieke_loaded_id
  from public.menu_items
  where branch_id = v_branch_id
    and slug = 'attieke-loaded-pack';

  select id
  into v_attieke_fully_loaded_id
  from public.menu_items
  where branch_id = v_branch_id
    and slug = 'attieke-fully-loaded-pack';

  select id
  into v_attieke_overloaded_id
  from public.menu_items
  where branch_id = v_branch_id
    and slug = 'attieke-overloaded-pack';

  select id
  into v_banku_loaded_id
  from public.menu_items
  where branch_id = v_branch_id
    and slug = 'banku-loaded-pack';

  select id
  into v_banku_fully_loaded_id
  from public.menu_items
  where branch_id = v_branch_id
    and slug = 'banku-fully-loaded-pack';

  select id
  into v_banku_overloaded_id
  from public.menu_items
  where branch_id = v_branch_id
    and slug = 'banku-overloaded-pack';

  insert into public.menu_item_protein_options (
    menu_item_id,
    name,
    price_adjustment,
    is_active,
    sort_order
  )
  values
    (v_attieke_loaded_id, 'Tilapia', 0.00, true, 10),
    (v_attieke_loaded_id, 'Chicken', 0.00, true, 20),

    (v_attieke_fully_loaded_id, 'Tilapia', 0.00, true, 10),
    (v_attieke_fully_loaded_id, 'Chicken', 0.00, true, 20),

    (v_attieke_overloaded_id, 'Tilapia', 0.00, true, 10),
    (v_attieke_overloaded_id, 'Chicken', 0.00, true, 20),

    (v_banku_loaded_id, 'Tilapia', 0.00, true, 10),
    (v_banku_loaded_id, 'Chicken', 0.00, true, 20),

    (v_banku_fully_loaded_id, 'Tilapia', 0.00, true, 10),
    (v_banku_fully_loaded_id, 'Chicken', 0.00, true, 20),

    (v_banku_overloaded_id, 'Tilapia', 0.00, true, 10),
    (v_banku_overloaded_id, 'Chicken', 0.00, true, 20)
  on conflict (menu_item_id, name)
  do update set
    price_adjustment = excluded.price_adjustment,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order;

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
    v_tenant_id,
    v_branch_id,
    v_admin_id,
    'system',
    null,
    'foundation_seeded',
    jsonb_build_object(
      'branch_slug', 'abura',
      'menu_item_count', 14,
      'protein_option_count', 12
    )
  );
end;
$$;