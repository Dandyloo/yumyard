create or replace function public.admin_delete_category(p_session_token text, p_category_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_context record;
  v_live_items int;
begin
  select * into v_context from public.get_admin_session(p_session_token);

  if not exists (
    select 1 from public.menu_categories
    where id = p_category_id and branch_id = v_context.branch_id
  ) then
    raise exception 'Category not found for this branch';
  end if;

  select count(*) into v_live_items
  from public.menu_items
  where category_id = p_category_id
    and branch_id = v_context.branch_id
    and coalesce(is_archived, false) = false;

  if v_live_items > 0 then
    raise exception 'This category still has % item(s). Move or archive them first.', v_live_items;
  end if;

  -- Archived items stay for order history (FK is ON DELETE SET NULL)
  delete from public.menu_categories
  where id = p_category_id and branch_id = v_context.branch_id;
end;
$function$;

revoke all on function public.admin_delete_category(text, uuid) from public;
grant execute on function public.admin_delete_category(text, uuid) to anon, authenticated;
