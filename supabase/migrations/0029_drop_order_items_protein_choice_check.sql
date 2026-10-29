-- Protein options are admin-managed (menu_item_protein_options); a hardcoded
-- Tilapia/Chicken whitelist blocks any new option such as "Fish".
alter table public.order_items drop constraint if exists order_items_protein_choice_check;
