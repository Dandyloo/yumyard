-- Adds a safe, name-only worker listing for the profile+PIN login screen,
-- plus a PIN-only authenticate variant keyed by worker_id instead of
-- username. The worker table has no direct SELECT grant (see
-- 0009_lock_down_table_grants.sql), so the profile picker needs its own
-- SECURITY DEFINER RPC that exposes nothing beyond id/name/role.

drop function if exists public.list_branch_workers(text) cascade;
drop function if exists public.authenticate_worker_by_id(text, uuid, text, text) cascade;

create or replace function public.list_branch_workers(
  p_branch_slug text
)
returns table (
  worker_id uuid,
  display_name text,
  role text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(trim(p_branch_slug), '') = '' then
    raise exception 'Branch is required';
  end if;

  return query
  select
    w.id as worker_id,
    w.display_name,
    w.role
  from public.workers w
  join public.branches b
    on b.id = w.branch_id
  where lower(b.slug) = lower(trim(p_branch_slug))
    and w.is_active = true
  order by w.display_name asc;
end;
$$;

revoke all on function public.list_branch_workers(text) from public;

grant execute
on function public.list_branch_workers(text)
to anon, authenticated;

create or replace function public.authenticate_worker_by_id(
  p_branch_slug text,
  p_worker_id uuid,
  p_pin text,
  p_access_area text
)
returns table (
  worker_id uuid,
  worker_name text,
  worker_username text,
  worker_role text,
  branch_id uuid,
  branch_slug text,
  session_token text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_worker record;
  v_session_token text;
begin
  if coalesce(trim(p_branch_slug), '') = ''
    or p_worker_id is null
    or coalesce(trim(p_pin), '') = ''
    or coalesce(trim(p_access_area), '') = '' then
    raise exception 'Branch, profile, PIN, and access area are required';
  end if;

  select
    w.id,
    w.display_name,
    w.username,
    w.role,
    b.id as matched_branch_id,
    b.slug as matched_branch_slug
  into v_worker
  from public.workers w
  join public.branches b
    on b.id = w.branch_id
  where lower(b.slug) = lower(trim(p_branch_slug))
    and w.id = p_worker_id
    and w.is_active = true
    and w.pin_hash = extensions.crypt(p_pin, w.pin_hash)
  limit 1;

  if not found then
    raise exception 'Incorrect PIN';
  end if;

  if lower(trim(p_access_area)) = 'admin'
    and v_worker.role not in ('owner', 'admin', 'manager') then
    raise exception 'This user is not allowed to access the admin area';
  end if;

  if lower(trim(p_access_area)) = 'pos'
    and v_worker.role not in ('owner', 'admin', 'manager', 'cashier', 'supervisor') then
    raise exception 'This user is not allowed to access the POS area';
  end if;

  if lower(trim(p_access_area)) not in ('admin', 'pos') then
    raise exception 'Invalid access area. Use admin or pos';
  end if;

  v_session_token := encode(extensions.gen_random_bytes(32), 'hex');

  update public.workers
  set
    last_login_at = now(),
    updated_at = now()
  where id = v_worker.id;

  insert into public.audit_logs (
    tenant_id,
    branch_id,
    worker_id,
    entity_type,
    entity_id,
    action,
    details
  )
  select
    w.tenant_id,
    w.branch_id,
    w.id,
    'worker_session',
    w.id,
    'worker_authenticated',
    jsonb_build_object(
      'access_area', lower(trim(p_access_area)),
      'username', w.username,
      'login_method', 'profile_pin'
    )
  from public.workers w
  where w.id = v_worker.id;

  return query
  select
    v_worker.id::uuid,
    v_worker.display_name::text,
    v_worker.username::text,
    v_worker.role::text,
    v_worker.matched_branch_id::uuid,
    v_worker.matched_branch_slug::text,
    v_session_token::text;
end;
$$;

revoke all on function public.authenticate_worker_by_id(text, uuid, text, text) from public;

grant execute
on function public.authenticate_worker_by_id(text, uuid, text, text)
to anon, authenticated;
