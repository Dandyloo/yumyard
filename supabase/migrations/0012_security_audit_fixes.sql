-- 0012: Task 6 security audit fixes.
--
-- Two concrete findings from a full audit of every SECURITY DEFINER
-- function granted to anon/authenticated (via Supabase's security
-- advisor plus manual review of every function body):
--
-- 1. get_order_payment_summary(p_order_id uuid) took NO session token
--    and was not scoped to any branch. Since it's SECURITY DEFINER and
--    anon has EXECUTE, any unauthenticated caller who obtains an order
--    UUID (from a receipt, a shared URL, a QR code, enumeration, etc.)
--    could call it directly via PostgREST and read that order's
--    payment_status/amount_paid/balance_due for ANY order in ANY
--    branch/tenant - no login required. Every other financial RPC in
--    this schema requires a session token and scopes by branch; this
--    one didn't. Fixed by requiring p_session_token and scoping the
--    lookup to the caller's own branch, matching every other function.
--    This is a breaking signature change (old 1-arg version is dropped)
--    - any caller needs to start passing a session token.
--
-- 2. set_updated_at() (the updated_at trigger function) had no pinned
--    search_path, flagged by the linter as "Function Search Path
--    Mutable". Low practical risk here (no dynamic SQL, no user input),
--    but cheap and correct to fix along with everything else touched
--    in this audit - pinning search_path on every function is the
--    established pattern in this schema.
--
-- Everything else the advisor flagged (RLS enabled with no policy on
-- every core table; SECURITY DEFINER functions executable by
-- anon/authenticated) is the intentional design of this schema: direct
-- table access is fully revoked (migration 0009), so RLS-with-no-policy
-- is a deliberate belt-and-suspenders deny-all, and the RPCs are meant
-- to be the only way in. Manually reviewed every other RPC body
-- (handover_open_order, open_worker_shift, claim_handover_orders_for_shift,
-- get_active_worker_shift, get_shift_opening_context,
-- get_pending_handover_orders, record_order_payment, create_pos_order,
-- update_pos_order_status, close_worker_shift) and confirmed each one
-- resolves worker/shift/branch from the session token server-side, with
-- no client-supplied identity parameter anywhere - no other spoofing or
-- cross-branch leak path found.

drop function if exists public.get_order_payment_summary(uuid);

create or replace function public.get_order_payment_summary(
  p_session_token text,
  p_order_id uuid
)
returns table (
  amount_paid numeric,
  balance_due numeric,
  payment_status text
)
language plpgsql
stable
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
    and o.branch_id = v_session.branch_id
  group by o.id, o.total;
end;
$$;

revoke all on function public.get_order_payment_summary(text, uuid) from public;
grant execute on function public.get_order_payment_summary(text, uuid) to anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
