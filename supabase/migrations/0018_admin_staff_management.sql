-- Admin Staff Management (Phase 3, Task 4).
--
-- Safety nets baked in here (none of this is in the spec verbatim, but
-- all of it prevents a very real self-lockout on a system that today has
-- exactly one worker row):
--   - current_worker_session() already re-checks workers.is_active on
--     every request (see 0003/0012), so deactivating someone kills their
--     access immediately - no extra work needed there.
--   - A PIN reset is different: current_worker_session() never re-checks
--     the PIN, only the session token, so an old session would otherwise
--     keep working right through a reset. admin_reset_worker_pin()
--     explicitly revokes every session for that worker so the "forces a
--     new login" requirement actually holds.
--   - Deactivating or demoting the LAST remaining owner/admin/manager for
--     a branch (including yourself) is blocked outright - that would
--     lock everyone out of the admin app with no way back in short of a
--     direct DB edit.

drop function if exists public.admin_is_last_admin_worker(uuid, uuid) cascade;
drop function if exists public.get_admin_staff(text) cascade;
drop function if exists public.admin_create_worker(text, text, text, text, text) cascade;
drop function if exists public.admin_update_worker(text, uuid, text, text) cascade;
drop function if exists public.admin_set_worker_active(text, uuid, boolean) cascade;
drop function if exists public.admin_reset_worker_pin(text, uuid, text) cascade;

create or replace function public.admin_is_last_admin_worker(
  p_branch_id uuid,
  p_worker_id uuid
)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1
    from public.workers w
    where w.branch_id = p_branch_id
      and w.id <> p_worker_id
      and w.is_active = true
      and w.role in ('owner', 'admin', 'manager')
  );
$$;

create or replace function public.get_admin_staff(
  p_session_token text
)
returns table (
  worker_id uuid,
  display_name text,
  username text,
  role text,
  is_active boolean,
  last_login_at timestamptz,
  last_shift_date timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  return query
  select
    w.id,
    w.display_name,
    w.username,
    w.role,
    w.is_active,
    w.last_login_at,
    (
      select max(s.opened_at)
      from public.shifts as s
      where s.worker_id = w.id
    ) as last_shift_date,
    w.created_at
  from public.workers as w
  where w.branch_id = v_context.branch_id
  order by w.is_active desc, w.display_name asc;
end;
$$;

create or replace function public.admin_create_worker(
  p_session_token text,
  p_display_name text,
  p_username text,
  p_pin text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_display_name text := trim(coalesce(p_display_name, ''));
  v_username text := lower(trim(coalesce(p_username, '')));
  v_role text := lower(trim(coalesce(p_role, '')));
  v_id uuid;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if v_display_name = '' then
    raise exception 'Name is required';
  end if;

  if v_username = '' then
    raise exception 'Username is required';
  end if;

  if v_role not in ('owner', 'admin', 'manager', 'supervisor', 'cashier') then
    raise exception 'Role must be one of owner, admin, manager, supervisor, cashier';
  end if;

  if coalesce(p_pin, '') !~ '^[0-9]{4,8}$' then
    raise exception 'PIN must be 4 to 8 digits';
  end if;

  begin
    insert into public.workers (
      tenant_id, branch_id, display_name, username, pin_hash, role, is_active
    ) values (
      v_context.tenant_id,
      v_context.branch_id,
      v_display_name,
      v_username,
      extensions.crypt(p_pin, extensions.gen_salt('bf', 6)),
      v_role,
      true
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'That username is already taken on this branch';
  end;

  return v_id;
end;
$$;

create or replace function public.admin_update_worker(
  p_session_token text,
  p_worker_id uuid,
  p_display_name text,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_display_name text := trim(coalesce(p_display_name, ''));
  v_role text := lower(trim(coalesce(p_role, '')));
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if v_display_name = '' then
    raise exception 'Name is required';
  end if;

  if v_role not in ('owner', 'admin', 'manager', 'supervisor', 'cashier') then
    raise exception 'Role must be one of owner, admin, manager, supervisor, cashier';
  end if;

  if v_role not in ('owner', 'admin', 'manager')
    and public.admin_is_last_admin_worker(v_context.branch_id, p_worker_id) then
    raise exception 'Cannot change this role - they are the only remaining owner, admin, or manager for this branch';
  end if;

  update public.workers
  set
    display_name = v_display_name,
    role = v_role,
    updated_at = now()
  where id = p_worker_id
    and branch_id = v_context.branch_id;

  if not found then
    raise exception 'Worker not found for this branch';
  end if;
end;
$$;

create or replace function public.admin_set_worker_active(
  p_session_token text,
  p_worker_id uuid,
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

  if p_is_active = false and p_worker_id = v_context.worker_id then
    raise exception 'You cannot deactivate your own account';
  end if;

  if p_is_active = false
    and public.admin_is_last_admin_worker(v_context.branch_id, p_worker_id) then
    raise exception 'Cannot deactivate the only remaining owner, admin, or manager for this branch';
  end if;

  update public.workers
  set is_active = p_is_active, updated_at = now()
  where id = p_worker_id
    and branch_id = v_context.branch_id;

  if not found then
    raise exception 'Worker not found for this branch';
  end if;
end;
$$;

-- Only owner/manager can reset PINs, per the Task 4 spec (deliberately
-- narrower than "admin access" in general - an admin-role worker cannot
-- reset another worker's PIN, only owner/manager can).
create or replace function public.admin_reset_worker_pin(
  p_session_token text,
  p_worker_id uuid,
  p_new_pin text
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

  if v_context.worker_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can reset a PIN';
  end if;

  if coalesce(p_new_pin, '') !~ '^[0-9]{4,8}$' then
    raise exception 'PIN must be 4 to 8 digits';
  end if;

  update public.workers
  set
    pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 6)),
    updated_at = now()
  where id = p_worker_id
    and branch_id = v_context.branch_id;

  if not found then
    raise exception 'Worker not found for this branch';
  end if;

  -- Force a new login on every device this worker was signed into,
  -- POS and admin alike - current_worker_session() never re-checks the
  -- PIN itself, only the token, so this is the only thing that actually
  -- invalidates a session still using the old PIN.
  update public.worker_sessions
  set revoked_at = now(), revoked_reason = 'PIN reset by admin'
  where worker_id = p_worker_id
    and revoked_at is null;
end;
$$;

grant execute on function public.get_admin_staff(text) to anon, authenticated;
grant execute on function public.admin_create_worker(text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_update_worker(text, uuid, text, text) to anon, authenticated;
grant execute on function public.admin_set_worker_active(text, uuid, boolean) to anon, authenticated;
grant execute on function public.admin_reset_worker_pin(text, uuid, text) to anon, authenticated;
