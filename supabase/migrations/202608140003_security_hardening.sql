-- New Supabase projects no longer guarantee Data API grants. Remove platform
-- defaults first, then expose only the operations required by this app.
revoke all on public.profiles, public.festival_tables, public.menu_items,
  public.orders, public.order_items, public.payments,
  public.inventory_adjustments, public.audit_logs, public.menu_categories
from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.festival_tables to authenticated;
grant select, insert, update on public.menu_items to authenticated;
grant select on public.orders, public.order_items, public.payments,
  public.inventory_adjustments, public.audit_logs to authenticated;
grant select, insert on public.menu_categories to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.resolve_festival_table(text) to anon, authenticated;
grant execute on function public.get_public_menu() to anon, authenticated;
grant execute on function public.create_festival_order(text, text, uuid, jsonb) to anon, authenticated;
grant execute on function public.mark_transfer_claimed(uuid) to anon, authenticated;
grant execute on function public.get_public_order(uuid) to anon, authenticated;

grant execute on function public.is_festival_admin() to authenticated;
grant execute on function public.admin_process_order(uuid, text) to authenticated;
grant execute on function public.adjust_menu_stock(uuid, integer, text) to authenticated;
grant execute on function public.configure_festival_tables(integer) to authenticated;
grant execute on function public.rotate_festival_table_qr(uuid) to authenticated;
grant execute on function public.rename_menu_category(text, text) to authenticated;
grant execute on function public.delete_menu_category(text) to authenticated;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

create index if not exists audit_logs_actor_id_idx on public.audit_logs(actor_id) where actor_id is not null;
create index if not exists inventory_adjustments_admin_id_idx on public.inventory_adjustments(admin_id) where admin_id is not null;
create index if not exists payments_confirmed_by_idx on public.payments(confirmed_by) where confirmed_by is not null;
