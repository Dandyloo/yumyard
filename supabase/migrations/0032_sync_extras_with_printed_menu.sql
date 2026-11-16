-- 0032: Sync Extras with the client's printed menu (Oct 2026): Drinks / Proteins / Sides / Sauces.
-- "Extras" becomes "Extra Sides"; new "Extra Proteins" and "Extra Sauces" categories; Fried Plantain
-- is not on the printed menu so it is archived (hidden from POS, history preserved).
-- (Applied live to project ebfiocmxdirsxtmgiudu as "sync_extras_with_printed_menu".)
do $$
declare
  v_extras uuid := 'e7f2ceed-2925-4d3c-acc4-3d73329b3085';
  v_drinks uuid := '826cdfb6-7d77-421e-81d8-7394470bf2f6';
  v_tenant uuid; v_branch uuid;
  v_prot uuid; v_sauce uuid;
begin
  select tenant_id, branch_id into v_tenant, v_branch from public.menu_categories where id = v_extras;

  update public.menu_categories set name = 'Extra Sides', slug = 'extra-sides', sort_order = 6 where id = v_extras;

  insert into public.menu_categories (tenant_id, branch_id, name, slug, sort_order, is_active)
  values (v_tenant, v_branch, 'Extra Proteins', 'extra-proteins', 5, true) returning id into v_prot;
  insert into public.menu_categories (tenant_id, branch_id, name, slug, sort_order, is_active)
  values (v_tenant, v_branch, 'Extra Sauces', 'extra-sauces', 7, true) returning id into v_sauce;

  update public.menu_categories set sort_order = 8 where id = v_drinks;

  update public.menu_items set category_id = v_prot, sort_order = 1 where name = 'Chicken (3pcs)' and branch_id = v_branch;
  update public.menu_items set category_id = v_prot, sort_order = 2 where name = 'Fried Egg' and branch_id = v_branch;
  update public.menu_items set category_id = v_prot, sort_order = 3 where name = 'Sausage' and branch_id = v_branch;
  update public.menu_items set sort_order = 1 where name = 'Attiéké' and category_id = v_extras;
  update public.menu_items set sort_order = 2 where name = 'Rice' and category_id = v_extras;
  update public.menu_items set sort_order = 3 where name = 'Yam' and category_id = v_extras;
  update public.menu_items set sort_order = 4 where name = 'Kelewele' and category_id = v_extras;
  update public.menu_items set sort_order = 5 where name = 'Avocado' and category_id = v_extras;
  update public.menu_items set sort_order = 6 where name = 'Banku' and category_id = v_extras;
  update public.menu_items set category_id = v_sauce, sort_order = 1 where name = 'Pepper Sauce/Shito' and branch_id = v_branch;
  update public.menu_items set is_archived = true, is_available = false where name = 'Fried Plantain' and branch_id = v_branch;
  update public.menu_items set sort_order = 1 where name = 'Tigernut Juice' and category_id = v_drinks;
  update public.menu_items set sort_order = 2 where name = 'Pineapple Juice' and category_id = v_drinks;
  update public.menu_items set sort_order = 3 where name = 'Pineapple Ginger Juice' and category_id = v_drinks;
  update public.menu_items set sort_order = 4 where name = 'Water' and category_id = v_drinks;
end $$;
