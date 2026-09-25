-- 0013's authenticate_worker_by_id was modeled on the original
-- authenticate_worker body from 0002, which never persisted a session row.
-- 0003 later redefined authenticate_worker to revoke prior sessions and
-- insert into worker_sessions - that version is the one current_worker_session()
-- actually checks. This migration brings authenticate_worker_by_id in line
-- with that real session-issuing behavior so profile+PIN logins validate
-- correctly afterwards.

drop function if exists public.authenticate_worker_by_id(text, uuid, text, text) cascade;

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
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_worker record;
  v_session_token text;
  v_token_hash text;
  v_session_expires_at timestamptz := now() + interval '12 hours';
begin
  if coalesce(trim(p_branch_slug), '') = ''
    or p_worker_id is null
    or coalesce(trim(p_pin), '') = ''
    or coalesce(trim(p_access_area), '') = '' then
    raise exception 'Branch, profile, PIN, and access area are required';
  end if;

  if lower(trim(p_access_area)) not in ('admin', 'pos') then
    raise exception 'Invalid access area. Use admin or pos';
  end if;

  select
    w.id,
    w.tenant_id,
    w.branch_id,
    w.display_name,
    w.username,
    w.role,
    b.slug as matched_branch_slug
  into v_worker
  from public.workers w
  join public.branches b
    on b.id = w.branch_id
  where lower(b.slug) = lower(trim(p_branch_slug))
    and w.id = p_worker_id
    and w.is_active = true
    and b.is_active = true
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

  update public.worker_sessions as ws
  set
    revoked_at = now(),
    revoked_reason = 'Superseded by new login'
  where ws.worker_id = v_worker.id
    and ws.access_area = lower(trim(p_access_area))
    and ws.revoked_at is null;

  v_session_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := public.hash_session_token(v_session_token);

  insert into public.worker_sessions (
    tenant_id,
    branch_id,
    worker_id,
    access_area,
    token_hash,
    expires_at
  )
  values (
    v_worker.tenant_id,
    v_worker.branch_id,
    v_worker.id,
    lower(trim(p_access_area)),
    v_token_hash,
    v_session_expires_at
  );

  update public.workers as w
  set
    last_login_at = now(),
    updated_at = now()
  where w.id = v_worker.id;

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
    v_worker.tenant_id,
    v_worker.branch_id,
    v_worker.id,
    'worker_session',
    v_worker.id,
    'worker_authenticated',
    jsonb_build_object(
      'access_area', lower(trim(p_access_area)),
      'username', v_worker.username,
      'login_method', 'profile_pin',
      'session_expires_at', v_session_expires_at
    )
  );

  return query
  select
    v_worker.id::uuid,
    v_worker.display_name::text,
    v_worker.username::text,
    v_worker.role::text,
    v_worker.branch_id::uuid,
    v_worker.matched_branch_slug::text,
    v_session_token::text,
    v_session_expires_at;
end;
$$;

revoke all on function public.authenticate_worker_by_id(text, uuid, text, text) from public;

grant execute
on function public.authenticate_worker_by_id(text, uuid, text, text)
to anon, authenticated;
