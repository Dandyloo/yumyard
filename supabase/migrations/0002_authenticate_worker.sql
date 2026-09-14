create extension if not exists pgcrypto;

drop function if exists public.authenticate_worker(text, text, text, text) cascade;
drop function if exists public.authenticate_worker(uuid, text, text, text) cascade;
drop function if exists public.authenticate_worker(text, text, text) cascade;
drop function if exists public.authenticate_worker(uuid, text, text) cascade;

create or replace function public.authenticate_worker(
  p_branch_slug text,
  p_username text,
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
    or coalesce(trim(p_username), '') = ''
    or coalesce(trim(p_pin), '') = ''
    or coalesce(trim(p_access_area), '') = '' then
    raise exception 'Branch, username, PIN, and access area are required';
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
    and lower(w.username) = lower(trim(p_username))
    and w.is_active = true
    and w.pin_hash = extensions.crypt(p_pin, w.pin_hash)
  limit 1;

  if not found then
    raise exception 'Invalid username or PIN';
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
      'username', w.username
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

revoke all on function public.authenticate_worker(text, text, text, text) from public;

grant execute
on function public.authenticate_worker(text, text, text, text)
to anon, authenticated;