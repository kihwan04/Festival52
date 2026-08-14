-- Final operational model: singleton store settings, auditable menu writes,
-- explicit Data API privileges, and deterministic inventory locking.

create table if not exists public.store_settings (
  id uuid primary key default gen_random_uuid(),
  singleton_key boolean not null default true unique check (singleton_key),
  stall_name text not null default '컴공 52' check (char_length(stall_name) between 1 and 80),
  bank_name text not null default '' check (char_length(bank_name) <= 40),
  account_number text not null default '' check (char_length(account_number) <= 60),
  account_holder text not null default '' check (char_length(account_holder) <= 60),
  operating_hours text not null default '17:00 — 23:30' check (char_length(operating_hours) between 1 and 80),
  is_open boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.store_settings(singleton_key)
values (true)
on conflict (singleton_key) do nothing;

create index if not exists store_settings_updated_by_idx
  on public.store_settings(updated_by) where updated_by is not null;

alter table public.store_settings enable row level security;
drop policy if exists "admin reads store settings" on public.store_settings;
create policy "admin reads store settings" on public.store_settings
  for select to authenticated using ((select public.is_festival_admin()));

create or replace function public.get_public_store_settings()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'stall_name', stall_name,
    'bank_name', bank_name,
    'account_number', account_number,
    'account_holder', account_holder,
    'operating_hours', operating_hours,
    'is_open', is_open,
    'configured', bank_name <> '' and account_number <> '' and account_holder <> ''
  )
  from public.store_settings
  where singleton_key = true
$$;

create or replace function public.update_store_settings(
  p_stall_name text,
  p_bank_name text,
  p_account_number text,
  p_account_holder text,
  p_operating_hours text,
  p_is_open boolean
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_settings public.store_settings%rowtype;
  v_previous jsonb;
begin
  if not public.is_festival_admin() then raise exception 'admin required'; end if;
  if char_length(trim(p_stall_name)) not between 1 and 80
    or char_length(trim(p_bank_name)) > 40
    or char_length(trim(p_account_number)) > 60
    or char_length(trim(p_account_holder)) > 60
    or char_length(trim(p_operating_hours)) not between 1 and 80 then
    raise exception 'invalid store settings';
  end if;
  if p_is_open and (trim(p_bank_name) = '' or trim(p_account_number) = '' or trim(p_account_holder) = '') then
    raise exception 'store not configured';
  end if;

  select * into v_settings from public.store_settings where singleton_key = true for update;
  v_previous := to_jsonb(v_settings) - 'updated_by';
  update public.store_settings
  set stall_name = trim(p_stall_name), bank_name = trim(p_bank_name), account_number = trim(p_account_number),
      account_holder = trim(p_account_holder), operating_hours = trim(p_operating_hours), is_open = p_is_open,
      updated_by = auth.uid(), updated_at = now()
  where singleton_key = true
  returning * into v_settings;

  insert into public.audit_logs(actor_id, entity_type, entity_id, action, previous_value, next_value)
  values (auth.uid(), 'STORE_SETTINGS', v_settings.id, 'UPDATE', v_previous, to_jsonb(v_settings) - 'updated_by');
  return jsonb_build_object(
    'stall_name', v_settings.stall_name, 'bank_name', v_settings.bank_name,
    'account_number', v_settings.account_number, 'account_holder', v_settings.account_holder,
    'operating_hours', v_settings.operating_hours, 'is_open', v_settings.is_open,
    'configured', v_settings.bank_name <> '' and v_settings.account_number <> '' and v_settings.account_holder <> ''
  );
end; $$;

create or replace function public.create_festival_menu_item(
  p_name text,
  p_description text,
  p_price integer,
  p_category text,
  p_status text,
  p_stock_quantity integer
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_menu public.menu_items%rowtype;
begin
  if not public.is_festival_admin() then raise exception 'admin required'; end if;
  if char_length(trim(p_name)) not between 1 and 80 or char_length(p_description) > 500
    or p_price < 0 or p_stock_quantity < 0 or p_status not in ('AVAILABLE', 'SOLD_OUT', 'HIDDEN') then
    raise exception 'invalid menu item';
  end if;
  if not exists(select 1 from public.menu_categories where name = trim(p_category)) then raise exception 'category not found'; end if;

  insert into public.menu_items(name, description, price, category, status, stock_quantity,
    sort_order)
  values (trim(p_name), trim(p_description), p_price, trim(p_category),
    case when p_stock_quantity = 0 then 'SOLD_OUT' else p_status end, p_stock_quantity,
    coalesce((select max(sort_order) + 1 from public.menu_items), 0))
  returning * into v_menu;

  insert into public.audit_logs(actor_id, entity_type, entity_id, action, next_value)
  values (auth.uid(), 'MENU_ITEM', v_menu.id, 'CREATE', to_jsonb(v_menu));
  if p_stock_quantity > 0 then
    insert into public.inventory_adjustments(menu_item_id, quantity_change, reason, admin_id)
    values (v_menu.id, p_stock_quantity, '초기 재고', auth.uid());
  end if;
  return jsonb_build_object('id', v_menu.id, 'name', v_menu.name, 'description', v_menu.description,
    'price', v_menu.price, 'category', v_menu.category, 'status', v_menu.status, 'stock_quantity', v_menu.stock_quantity);
end; $$;

create or replace function public.update_festival_menu_item(
  p_menu_item_id uuid,
  p_name text,
  p_description text,
  p_price integer,
  p_category text,
  p_status text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_menu public.menu_items%rowtype; v_previous jsonb;
begin
  if not public.is_festival_admin() then raise exception 'admin required'; end if;
  if char_length(trim(p_name)) not between 1 and 80 or char_length(p_description) > 500
    or p_price < 0 or p_status not in ('AVAILABLE', 'SOLD_OUT', 'HIDDEN', 'ARCHIVED') then
    raise exception 'invalid menu item';
  end if;
  if not exists(select 1 from public.menu_categories where name = trim(p_category)) then raise exception 'category not found'; end if;

  select * into v_menu from public.menu_items where id = p_menu_item_id for update;
  if not found then raise exception 'menu not found'; end if;
  v_previous := to_jsonb(v_menu);
  update public.menu_items
  set name = trim(p_name), description = trim(p_description), price = p_price, category = trim(p_category),
      status = case when stock_quantity = 0 and p_status = 'AVAILABLE' then 'SOLD_OUT' else p_status end,
      updated_at = now()
  where id = p_menu_item_id returning * into v_menu;
  insert into public.audit_logs(actor_id, entity_type, entity_id, action, previous_value, next_value)
  values (auth.uid(), 'MENU_ITEM', v_menu.id, 'UPDATE', v_previous, to_jsonb(v_menu));
  return jsonb_build_object('id', v_menu.id, 'name', v_menu.name, 'description', v_menu.description,
    'price', v_menu.price, 'category', v_menu.category, 'status', v_menu.status, 'stock_quantity', v_menu.stock_quantity);
end; $$;

create or replace function public.create_festival_order(
  p_qr_token text,
  p_fulfillment_type text,
  p_client_request_id uuid,
  p_items jsonb
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_table_id uuid;
  v_table_number integer;
  v_item jsonb;
  v_menu public.menu_items%rowtype;
  v_quantity integer;
  v_total integer := 0;
  v_prefix text;
begin
  select * into v_order from public.orders where client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
      'public_token', v_order.public_token, 'total_amount', v_order.total_amount, 'duplicate', true);
  end if;

  if not exists(select 1 from public.store_settings where singleton_key = true and bank_name <> '' and account_number <> '' and account_holder <> '') then
    raise exception 'store not configured';
  end if;
  if not exists(select 1 from public.store_settings where singleton_key = true and is_open = true) then
    raise exception 'store closed';
  end if;
  if p_fulfillment_type not in ('DINE_IN', 'TAKEOUT') then raise exception 'invalid fulfillment type'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then raise exception 'invalid items'; end if;
  if (select count(*) from jsonb_array_elements(p_items)) <> (select count(distinct value->>'menu_item_id') from jsonb_array_elements(p_items)) then
    raise exception 'duplicate menu item';
  end if;

  if p_fulfillment_type = 'DINE_IN' then
    select id, table_number into v_table_id, v_table_number from public.festival_tables where qr_token = p_qr_token and is_active = true;
    if not found then raise exception 'invalid or inactive qr'; end if;
  else
    v_table_id := null;
  end if;

  v_prefix := case when p_fulfillment_type = 'TAKEOUT' then 'P' else 'A' end;
  insert into public.orders(order_number, fulfillment_type, table_id, client_request_id)
  values (v_prefix || lpad(nextval('public.festival_order_number_seq')::text, 3, '0'), p_fulfillment_type, v_table_id, p_client_request_id)
  returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_items) order by value->>'menu_item_id'
  loop
    begin
      v_quantity := (v_item->>'quantity')::integer;
      select * into v_menu from public.menu_items where id = (v_item->>'menu_item_id')::uuid for update;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid order item';
    end;
    if not found or v_menu.status <> 'AVAILABLE' then raise exception 'menu unavailable'; end if;
    if v_quantity <= 0 or v_quantity > 30 then raise exception 'invalid quantity'; end if;
    if v_menu.stock_quantity < v_quantity then raise exception 'insufficient stock'; end if;

    update public.menu_items set stock_quantity = stock_quantity - v_quantity,
      status = case when stock_quantity - v_quantity = 0 then 'SOLD_OUT' else status end,
      updated_at = now() where id = v_menu.id;
    insert into public.order_items(order_id, menu_item_id, menu_name, unit_price, quantity, subtotal)
    values (v_order.id, v_menu.id, v_menu.name, v_menu.price, v_quantity, v_menu.price * v_quantity);
    insert into public.inventory_adjustments(menu_item_id, quantity_change, reason, order_id)
    values (v_menu.id, -v_quantity, '주문 재고 예약', v_order.id);
    v_total := v_total + v_menu.price * v_quantity;
  end loop;

  update public.orders set total_amount = v_total, updated_at = now() where id = v_order.id returning * into v_order;
  insert into public.payments(order_id, amount) values (v_order.id, v_total);
  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
    'public_token', v_order.public_token, 'total_amount', v_total, 'table_number', v_table_number, 'duplicate', false);
exception when unique_violation then
  select * into v_order from public.orders where client_request_id = p_client_request_id;
  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
    'public_token', v_order.public_token, 'total_amount', v_order.total_amount, 'duplicate', true);
end; $$;

-- Explicit privileges are required for new public-schema objects on current projects.
revoke all on public.store_settings from anon, authenticated;
grant select on public.store_settings to authenticated;
revoke insert, update, delete on public.menu_items from authenticated;
grant select on public.menu_items to authenticated;

revoke all on function public.get_public_store_settings() from public, anon, authenticated;
revoke all on function public.update_store_settings(text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.create_festival_menu_item(text, text, integer, text, text, integer) from public, anon, authenticated;
revoke all on function public.update_festival_menu_item(uuid, text, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.create_festival_order(text, text, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.get_public_store_settings() to anon, authenticated;
grant execute on function public.update_store_settings(text, text, text, text, text, boolean) to authenticated;
grant execute on function public.create_festival_menu_item(text, text, integer, text, text, integer) to authenticated;
grant execute on function public.update_festival_menu_item(uuid, text, text, integer, text, text) to authenticated;
grant execute on function public.create_festival_order(text, text, uuid, jsonb) to anon, authenticated;

alter publication supabase_realtime add table public.store_settings;
