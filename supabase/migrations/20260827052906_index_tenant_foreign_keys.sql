-- Composite tenant foreign keys need matching leading-column indexes for fast
-- joins, cascades, and concurrent operator lookups.
create index if not exists audit_logs_team_actor_idx
  on public.audit_logs(team_id, actor_id);

create index if not exists inventory_adjustments_team_admin_idx
  on public.inventory_adjustments(team_id, admin_id);
create index if not exists inventory_adjustments_team_menu_idx
  on public.inventory_adjustments(team_id, menu_item_id);
create index if not exists inventory_adjustments_team_order_idx
  on public.inventory_adjustments(team_id, order_id);

create index if not exists menu_items_team_category_idx
  on public.menu_items(team_id, category);
create index if not exists order_items_team_menu_idx
  on public.order_items(team_id, menu_item_id);
create index if not exists orders_team_table_idx
  on public.orders(team_id, table_id);

create index if not exists payments_team_confirmer_idx
  on public.payments(team_id, confirmed_by);
create index if not exists payments_team_order_idx
  on public.payments(team_id, order_id);

create index if not exists profiles_current_team_membership_idx
  on public.profiles(current_team_id, id);
create index if not exists store_settings_team_updater_idx
  on public.store_settings(team_id, updated_by);
