-- The original constraint hardcoded protein option names to a starter
-- seed pair ('Tilapia', 'Chicken') only. That directly blocks Task 3's
-- requirement that admins can create arbitrary protein/options with
-- price adjustments (e.g. "Goat", "Beef", "Fish"). Replace it with a
-- simple non-empty check - real uniqueness/validation already happens
-- in admin_create_protein_option()/admin_update_protein_option().
alter table public.menu_item_protein_options
  drop constraint menu_item_protein_options_name_check;

alter table public.menu_item_protein_options
  add constraint menu_item_protein_options_name_check
  check (btrim(name) <> '');
