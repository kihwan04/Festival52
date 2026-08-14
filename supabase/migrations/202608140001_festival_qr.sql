create extension if not exists pgcrypto;

create sequence if not exists public.festival_order_number_seq start 1;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('ADMIN', 'STAFF')),
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);

create table if not exists public.festival_tables (
  id uuid primary key default gen_random_uuid(),
  table_number integer not null unique check (table_number > 0),
  qr_token text not null unique check (char_length(qr_token) >= 16),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  price integer not null check (price >= 0),
  image_url text,
  category text not null default '안주',
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'SOLD_OUT', 'HIDDEN', 'ARCHIVED')),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  fulfillment_type text not null check (fulfillment_type in ('DINE_IN', 'TAKEOUT')),
  table_id uuid references public.festival_tables(id),
  public_token uuid not null default gen_random_uuid() unique,
  client_request_id uuid not null unique,
  total_amount integer not null default 0 check (total_amount >= 0),
  status text not null default 'PENDING_PAYMENT' check (status in ('PENDING_PAYMENT', 'PAID', 'COOKING', 'READY', 'SERVED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint orders_fulfillment_table_check check (
    (fulfillment_type = 'DINE_IN' and table_id is not null) or
    (fulfillment_type = 'TAKEOUT')
  )
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  menu_name text not null,
  unit_price integer not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  subtotal integer not null check (subtotal >= 0 and subtotal = unit_price * quantity),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  method text not null default 'BANK_TRANSFER' check (method = 'BANK_TRANSFER'),
  amount integer not null check (amount >= 0),
  status text not null default 'UNPAID' check (status in ('UNPAID', 'CUSTOMER_MARKED_TRANSFERRED', 'CONFIRMED', 'REJECTED')),
  customer_claimed_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  quantity_change integer not null check (quantity_change <> 0),
  reason text not null check (char_length(reason) between 2 and 240),
  admin_id uuid references public.profiles(id),
  order_id uuid references public.orders(id),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  previous_value jsonb,
  next_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists orders_status_created_at_idx on public.orders(status, created_at desc);
create index if not exists orders_table_id_idx on public.orders(table_id);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists inventory_adjustments_menu_idx on public.inventory_adjustments(menu_item_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.festival_tables enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_adjustments enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.is_festival_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role in ('ADMIN', 'STAFF')) $$;

drop policy if exists "admin reads profiles" on public.profiles;
create policy "admin reads profiles" on public.profiles for select to authenticated using (public.is_festival_admin());
drop policy if exists "admin manages tables" on public.festival_tables;
create policy "admin manages tables" on public.festival_tables for all to authenticated using (public.is_festival_admin()) with check (public.is_festival_admin());
drop policy if exists "admin manages menu" on public.menu_items;
create policy "admin manages menu" on public.menu_items for all to authenticated using (public.is_festival_admin()) with check (public.is_festival_admin());
drop policy if exists "admin reads orders" on public.orders;
create policy "admin reads orders" on public.orders for select to authenticated using (public.is_festival_admin());
drop policy if exists "admin reads order items" on public.order_items;
create policy "admin reads order items" on public.order_items for select to authenticated using (public.is_festival_admin());
drop policy if exists "admin reads payments" on public.payments;
create policy "admin reads payments" on public.payments for select to authenticated using (public.is_festival_admin());
drop policy if exists "admin reads inventory adjustments" on public.inventory_adjustments;
create policy "admin reads inventory adjustments" on public.inventory_adjustments for select to authenticated using (public.is_festival_admin());
drop policy if exists "admin reads audit logs" on public.audit_logs;
create policy "admin reads audit logs" on public.audit_logs for select to authenticated using (public.is_festival_admin());

create or replace function public.resolve_festival_table(p_qr_token text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_table public.festival_tables%rowtype;
begin
  if p_qr_token is null or char_length(p_qr_token) < 16 then return null; end if;
  select * into v_table from public.festival_tables where qr_token = p_qr_token and is_active = true;
  if not found then return null; end if;
  return jsonb_build_object('id', v_table.id, 'table_number', v_table.table_number);
end; $$;

create or replace function public.get_public_menu()
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'description', description, 'price', price, 'image_url', image_url,
    'category', category, 'status', case when stock_quantity = 0 then 'SOLD_OUT' else status end,
    'stock_quantity', stock_quantity, 'sort_order', sort_order
  ) order by sort_order, name), '[]'::jsonb)
  from public.menu_items where status in ('AVAILABLE', 'SOLD_OUT')
$$;

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
    return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'public_token', v_order.public_token, 'total_amount', v_order.total_amount, 'duplicate', true);
  end if;

  if p_fulfillment_type not in ('DINE_IN', 'TAKEOUT') then raise exception 'invalid fulfillment type'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then raise exception 'invalid items'; end if;

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

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_quantity := (v_item->>'quantity')::integer;
      select * into v_menu from public.menu_items where id = (v_item->>'menu_item_id')::uuid for update;
    exception when others then
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
  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'public_token', v_order.public_token, 'total_amount', v_total, 'table_number', v_table_number, 'duplicate', false);
exception when unique_violation then
  select * into v_order from public.orders where client_request_id = p_client_request_id;
  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'public_token', v_order.public_token, 'total_amount', v_order.total_amount, 'duplicate', true);
end; $$;

create or replace function public.mark_transfer_claimed(p_public_token uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.payments p set status = 'CUSTOMER_MARKED_TRANSFERRED', customer_claimed_at = now(), updated_at = now()
  from public.orders o where p.order_id = o.id and o.public_token = p_public_token and p.status = 'UNPAID' and o.status = 'PENDING_PAYMENT';
  if not found then raise exception 'payment cannot be claimed'; end if;
end; $$;

create or replace function public.get_public_order(p_public_token uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'order_number', o.order_number, 'fulfillment_type', o.fulfillment_type, 'table_number', t.table_number,
    'total_amount', o.total_amount, 'order_status', o.status, 'payment_status', p.status, 'created_at', o.created_at,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', oi.menu_name, 'quantity', oi.quantity, 'subtotal', oi.subtotal)), '[]'::jsonb) from public.order_items oi where oi.order_id = o.id)
  ) from public.orders o join public.payments p on p.order_id = o.id left join public.festival_tables t on t.id = o.table_id
  where o.public_token = p_public_token
$$;

create or replace function public.admin_process_order(p_order_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_order public.orders%rowtype; v_previous jsonb; v_item record;
begin
  if not public.is_festival_admin() then raise exception 'admin required'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  v_previous := jsonb_build_object('status', v_order.status);

  if p_action = 'CONFIRM_PAYMENT' then
    if v_order.status <> 'PENDING_PAYMENT' or not exists(select 1 from public.payments where order_id = v_order.id and status = 'CUSTOMER_MARKED_TRANSFERRED') then raise exception 'invalid payment state'; end if;
    update public.payments set status = 'CONFIRMED', confirmed_at = now(), confirmed_by = auth.uid(), updated_at = now() where order_id = v_order.id;
    update public.orders set status = 'PAID', updated_at = now() where id = v_order.id;
  elsif p_action = 'START_COOKING' and v_order.status = 'PAID' then
    update public.orders set status = 'COOKING', updated_at = now() where id = v_order.id;
  elsif p_action = 'MARK_READY' and v_order.status = 'COOKING' then
    update public.orders set status = 'READY', updated_at = now() where id = v_order.id;
  elsif p_action = 'MARK_SERVED' and v_order.status = 'READY' then
    update public.orders set status = 'SERVED', updated_at = now() where id = v_order.id;
  elsif p_action = 'CANCEL' and v_order.status not in ('SERVED', 'CANCELLED') then
    for v_item in select menu_item_id, quantity from public.order_items where order_id = v_order.id loop
      update public.menu_items set stock_quantity = stock_quantity + v_item.quantity,
        status = case when status = 'SOLD_OUT' then 'AVAILABLE' else status end, updated_at = now() where id = v_item.menu_item_id;
      insert into public.inventory_adjustments(menu_item_id, quantity_change, reason, admin_id, order_id)
      values (v_item.menu_item_id, v_item.quantity, '주문 취소 재고 복구', auth.uid(), v_order.id);
    end loop;
    update public.orders set status = 'CANCELLED', cancelled_at = now(), updated_at = now() where id = v_order.id;
  else raise exception 'invalid state transition';
  end if;

  insert into public.audit_logs(actor_id, entity_type, entity_id, action, previous_value, next_value)
  select auth.uid(), 'ORDER', id, p_action, v_previous, jsonb_build_object('status', status) from public.orders where id = v_order.id;
end; $$;

create or replace function public.adjust_menu_stock(p_menu_item_id uuid, p_quantity_change integer, p_reason text)
returns integer language plpgsql security definer set search_path = public
as $$
declare v_stock integer;
begin
  if not public.is_festival_admin() then raise exception 'admin required'; end if;
  if p_quantity_change = 0 or char_length(trim(p_reason)) < 2 then raise exception 'reason required'; end if;
  update public.menu_items set stock_quantity = stock_quantity + p_quantity_change,
    status = case when stock_quantity + p_quantity_change = 0 then 'SOLD_OUT' when status = 'SOLD_OUT' and stock_quantity + p_quantity_change > 0 then 'AVAILABLE' else status end,
    updated_at = now()
  where id = p_menu_item_id and stock_quantity + p_quantity_change >= 0 returning stock_quantity into v_stock;
  if not found then raise exception 'stock cannot be negative'; end if;
  insert into public.inventory_adjustments(menu_item_id, quantity_change, reason, admin_id) values (p_menu_item_id, p_quantity_change, trim(p_reason), auth.uid());
  return v_stock;
end; $$;

revoke all on function public.create_festival_order(text, text, uuid, jsonb) from public;
revoke all on function public.mark_transfer_claimed(uuid) from public;
revoke all on function public.get_public_order(uuid) from public;
grant execute on function public.resolve_festival_table(text) to anon, authenticated;
grant execute on function public.get_public_menu() to anon, authenticated;
grant execute on function public.create_festival_order(text, text, uuid, jsonb) to service_role;
grant execute on function public.mark_transfer_claimed(uuid) to service_role;
grant execute on function public.get_public_order(uuid) to anon, authenticated, service_role;
grant execute on function public.admin_process_order(uuid, text) to authenticated;
grant execute on function public.adjust_menu_stock(uuid, integer, text) to authenticated;

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.payments;
alter publication supabase_realtime add table public.menu_items;
