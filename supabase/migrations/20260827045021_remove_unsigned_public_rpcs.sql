-- Run only after the application version using the signed RPC signatures is
-- live. Removing the compatibility entry points means the publishable key
-- alone can no longer read order/account data or mutate payment claims.

revoke all on function public.resolve_festival_table(text) from public, anon, authenticated;
revoke all on function public.get_public_menu(text) from public, anon, authenticated;
revoke all on function public.get_public_menu() from public, anon, authenticated;
revoke all on function public.get_public_store_settings(text) from public, anon, authenticated;
revoke all on function public.get_public_store_settings() from public, anon, authenticated;
revoke all on function public.get_legacy_festival_team_slug() from public, anon, authenticated;
revoke all on function public.get_public_order(uuid) from public, anon, authenticated;
revoke all on function public.mark_transfer_claimed(uuid) from public, anon, authenticated;
revoke all on function public.create_festival_order(text, text, uuid, jsonb, text, bigint, text) from public, anon, authenticated;
revoke all on function public.create_festival_order(text, text, text, uuid, jsonb, text, bigint, text) from public, anon, authenticated;
revoke all on function public.get_admin_sales_by_day() from public, anon, authenticated;

drop function public.resolve_festival_table(text);
drop function public.get_public_menu(text);
drop function public.get_public_menu();
drop function public.get_public_store_settings(text);
drop function public.get_public_store_settings();
drop function public.get_legacy_festival_team_slug();
drop function public.get_public_order(uuid);
drop function public.mark_transfer_claimed(uuid);
drop function public.create_festival_order(text, text, uuid, jsonb, text, bigint, text);
drop function public.create_festival_order(text, text, text, uuid, jsonb, text, bigint, text);
drop function public.get_admin_sales_by_day();

create or replace function public.delete_menu_category(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_team_id uuid := public.current_festival_team_id();
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if exists (
    select 1 from public.menu_items
    where team_id = v_team_id and category = p_name
  ) then raise exception 'category is in use'; end if;
  delete from public.menu_categories
  where team_id = v_team_id and name = p_name;
  if not found then raise exception 'category not found'; end if;
end;
$$;

revoke all on function public.delete_menu_category(text) from public, anon, authenticated;
grant execute on function public.delete_menu_category(text) to authenticated;
