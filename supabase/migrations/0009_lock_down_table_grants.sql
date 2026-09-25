-- 0009: Catch-up / security hardening migration.
--
-- Context: an audit of the live database (done while implementing Task 1's
-- close-shift rule) found that the live schema has drifted substantially
-- from what's recorded in migrations 0001-0007 - most likely because
-- changes were applied directly against the database (dashboard SQL
-- editor / CLI ad hoc) without being captured back into migration files.
-- Notable drift includes: enum types (worker_role, order_status, etc.)
-- were replaced with text + check constraints; several tables from 0001
-- (device_sessions, delivery_zones, inventory_items, stock_movements,
-- recipes, recipe_ingredients) do not exist live; several columns were
-- renamed or added (order_notes, completed_by_worker_id,
-- completed_in_shift_id, etc.); and several functions referenced by later
-- migrations (create_pos_order, update_pos_order_status,
-- get_pos_session_and_shift, record_order_payment, handover_open_order,
-- get_order_payment_summary) exist live but have no corresponding
-- migration file at all.
--
-- The single concrete BUG found (not just drift) is fixed here:
--
--   Every core table in the public schema currently grants full
--   SELECT/INSERT/UPDATE/DELETE/TRUNCATE to both `anon` and
--   `authenticated`, directly contradicting the
--   `revoke all on all tables in schema public from anon, authenticated;`
--   statement in migration 0001. In practice this is currently masked
--   because Row Level Security is enabled on every one of these tables
--   with zero policies defined, which defaults to deny-all for
--   non-owner roles - verified empirically (anon cannot SELECT or INSERT
--   against public.workers, public.orders, etc.). But this is an
--   accident of RLS-with-no-policy, not an intentional access control
--   layer: the moment anyone adds a single permissive policy to any of
--   these tables for an unrelated feature, the pre-existing blanket
--   grants would immediately expose full read/write access to that
--   table for any anon or authenticated caller. This closes that gap by
--   restoring the intended posture: all business tables are reachable
--   only through SECURITY DEFINER RPC functions with explicit
--   `grant execute`, never through direct table access.
--
-- The public menu-browsing tables (menu_categories, menu_items,
-- menu_item_protein_options) are the one deliberate exception - they
-- have existing RLS policies that scope anon SELECT to active/available
-- rows for the customer-facing menu - so their SELECT grant to anon is
-- preserved. Everything else (including SELECT) is revoked from anon
-- and authenticated on every other public table.
--
-- Recommendation: run `supabase db pull` (or `supabase db diff`) against
-- this project to generate a full, byte-accurate baseline migration that
-- captures the rest of the drift (renamed columns, removed enums, unused
-- tables, undocumented functions). This migration intentionally does not
-- attempt to hand-transcribe that whole diff - only fixes the confirmed
-- security bug - to avoid introducing transcription errors into a
-- reconciliation that the CLI can generate exactly.

revoke all on public.tenants from anon, authenticated;
revoke all on public.branches from anon, authenticated;
revoke all on public.workers from anon, authenticated;
revoke all on public.worker_sessions from anon, authenticated;
revoke all on public.shifts from anon, authenticated;
revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
revoke all on public.payments from anon, authenticated;
revoke all on public.cash_movements from anon, authenticated;
revoke all on public.riders from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;

-- Menu browsing tables: revoke everything, then re-grant only SELECT,
-- which the existing RLS policies further scope to active/available rows.
revoke all on public.menu_categories from anon, authenticated;
revoke all on public.menu_items from anon, authenticated;
revoke all on public.menu_item_protein_options from anon, authenticated;

grant select on public.menu_categories to anon, authenticated;
grant select on public.menu_items to anon, authenticated;
grant select on public.menu_item_protein_options to anon, authenticated;

-- Belt-and-suspenders: make sure no sequences are exposed either
-- (all tables use gen_random_uuid(), so this should be a no-op today,
-- but keeps future serial/identity columns from being silently exposed).
revoke all on all sequences in schema public from anon, authenticated;
