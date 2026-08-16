-- Multi-team tenancy and secure self-service operator signup.
-- Existing production data is attached to one legacy team without changing
-- any customer-facing QR tokens or order identifiers.

create table public.festival_teams (
  id uuid primary key default gen_random_uuid(),
  public_slug text not null unique
    check (public_slug ~ '^team-[a-f0-9]{16}$'),
  department_name text not null
    check (char_length(trim(department_name)) between 2 and 80),
  team_name text not null
    check (char_length(trim(team_name)) between 2 and 80),
  is_active boolean not null default true,
  is_legacy boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create unique index festival_teams_one_legacy_idx
  on public.festival_teams ((is_legacy))
  where is_legacy = true;

insert into public.festival_teams(public_slug, department_name, team_name, is_legacy)
select
  'team-' || encode(extensions.gen_random_bytes(8), 'hex'),
  coalesce(nullif(trim(s.stall_name), ''), '축제 운영팀'),
  coalesce(nullif(trim(s.stall_name), ''), '축제 운영팀') || ' 운영팀',
  true
from (select stall_name from public.store_settings where singleton_key = true limit 1) s;

alter table public.profiles
  add column current_team_id uuid references public.festival_teams(id) on delete restrict;

update public.profiles
set current_team_id = (select id from public.festival_teams where is_legacy = true);

alter table public.profiles alter column current_team_id set not null;

create table public.festival_team_members (
  team_id uuid not null references public.festival_teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('OWNER', 'STAFF')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (team_id, user_id)
);

insert into public.festival_team_members(team_id, user_id, role)
select current_team_id, id, case when role = 'ADMIN' then 'OWNER' else 'STAFF' end
from public.profiles;

alter table public.festival_tables add column team_id uuid references public.festival_teams(id) on delete restrict;
alter table public.menu_items add column team_id uuid references public.festival_teams(id) on delete restrict;
alter table public.orders add column team_id uuid references public.festival_teams(id) on delete restrict;
alter table public.order_items add column team_id uuid references public.festival_teams(id) on delete restrict;
alter table public.payments add column team_id uuid references public.festival_teams(id) on delete restrict;
alter table public.inventory_adjustments add column team_id uuid references public.festival_teams(id) on delete restrict;
alter table public.audit_logs add column team_id uuid references public.festival_teams(id) on delete restrict;
alter table public.menu_categories add column team_id uuid references public.festival_teams(id) on delete restrict;
alter table public.store_settings add column team_id uuid references public.festival_teams(id) on delete restrict;

update public.festival_tables set team_id = (select id from public.festival_teams where is_legacy = true);
update public.menu_items set team_id = (select id from public.festival_teams where is_legacy = true);
update public.orders set team_id = (select id from public.festival_teams where is_legacy = true);
update public.order_items oi set team_id = o.team_id from public.orders o where o.id = oi.order_id;
update public.payments p set team_id = o.team_id from public.orders o where o.id = p.order_id;
update public.inventory_adjustments ia
set team_id = m.team_id
from public.menu_items m
where m.id = ia.menu_item_id;
update public.audit_logs set team_id = (select id from public.festival_teams where is_legacy = true);
update public.menu_categories set team_id = (select id from public.festival_teams where is_legacy = true);
update public.store_settings set team_id = (select id from public.festival_teams where is_legacy = true);

alter table public.festival_tables alter column team_id set not null;
alter table public.menu_items alter column team_id set not null;
alter table public.orders alter column team_id set not null;
alter table public.order_items alter column team_id set not null;
alter table public.payments alter column team_id set not null;
alter table public.inventory_adjustments alter column team_id set not null;
alter table public.audit_logs alter column team_id set not null;
alter table public.menu_categories alter column team_id set not null;
alter table public.store_settings alter column team_id set not null;

alter table public.festival_tables drop constraint if exists festival_tables_table_number_key;
alter table public.menu_categories drop constraint if exists menu_categories_name_key;
alter table public.store_settings drop constraint if exists store_settings_singleton_key_key;
alter table public.festival_tables add constraint festival_tables_team_number_key unique (team_id, table_number);
alter table public.menu_categories add constraint menu_categories_team_name_key unique (team_id, name);
alter table public.store_settings add constraint store_settings_team_singleton_key unique (team_id, singleton_key);

create index festival_team_members_user_idx on public.festival_team_members(user_id, team_id);
create index profiles_current_team_idx on public.profiles(current_team_id);
create index festival_tables_team_active_idx on public.festival_tables(team_id, is_active, table_number);
create index menu_items_team_status_sort_idx on public.menu_items(team_id, status, sort_order);
create index orders_team_created_idx on public.orders(team_id, created_at desc);
create index orders_team_status_created_idx on public.orders(team_id, status, created_at desc);
create index order_items_team_order_idx on public.order_items(team_id, order_id);
create index payments_team_status_confirmed_idx on public.payments(team_id, status, confirmed_at);
create index inventory_adjustments_team_created_idx on public.inventory_adjustments(team_id, created_at desc);
create index audit_logs_team_created_idx on public.audit_logs(team_id, created_at desc);
create index menu_categories_team_sort_idx on public.menu_categories(team_id, sort_order);
create index store_settings_team_idx on public.store_settings(team_id);

alter table public.festival_teams enable row level security;
alter table public.festival_team_members enable row level security;

create or replace function public.current_festival_team_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.current_team_id
  from public.profiles p
  where p.id = (select auth.uid())
    and exists (
      select 1
      from public.festival_team_members tm
      where tm.team_id = p.current_team_id
        and tm.user_id = p.id
        and tm.role in ('OWNER', 'STAFF')
    )
$$;

create or replace function public.is_festival_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_festival_team_id() is not null
$$;

revoke all on function public.current_festival_team_id() from public, anon, authenticated;
revoke all on function public.is_festival_admin() from public, anon, authenticated;
grant execute on function public.current_festival_team_id() to authenticated;
grant execute on function public.is_festival_admin() to authenticated;

drop policy if exists "admin reads profiles" on public.profiles;
create policy "operator reads own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "operator reads current team" on public.festival_teams
  for select to authenticated
  using (id = (select public.current_festival_team_id()));

create policy "operator reads current team members" on public.festival_team_members
  for select to authenticated
  using (team_id = (select public.current_festival_team_id()));

drop policy if exists "admin manages tables" on public.festival_tables;
create policy "operator reads team tables" on public.festival_tables
  for select to authenticated
  using (team_id = (select public.current_festival_team_id()));

drop policy if exists "admin manages menu" on public.menu_items;
create policy "operator reads team menu" on public.menu_items
  for select to authenticated
  using (team_id = (select public.current_festival_team_id()));

drop policy if exists "admin reads orders" on public.orders;
create policy "operator reads team orders" on public.orders
  for select to authenticated
  using (team_id = (select public.current_festival_team_id()));

drop policy if exists "admin reads order items" on public.order_items;
create policy "operator reads team order items" on public.order_items
  for select to authenticated
  using (team_id = (select public.current_festival_team_id()));

drop policy if exists "admin reads payments" on public.payments;
create policy "operator reads team payments" on public.payments
  for select to authenticated
  using (team_id = (select public.current_festival_team_id()));

drop policy if exists "admin reads inventory adjustments" on public.inventory_adjustments;
create policy "operator reads team inventory" on public.inventory_adjustments
  for select to authenticated
  using (team_id = (select public.current_festival_team_id()));

drop policy if exists "admin reads audit logs" on public.audit_logs;
create policy "operator reads team audit" on public.audit_logs
  for select to authenticated
  using (team_id = (select public.current_festival_team_id()));

drop policy if exists "admin manages categories" on public.menu_categories;
create policy "operator reads team categories" on public.menu_categories
  for select to authenticated
  using (team_id = (select public.current_festival_team_id()));

drop policy if exists "admin reads store settings" on public.store_settings;
create policy "operator reads team store settings" on public.store_settings
  for select to authenticated
  using (team_id = (select public.current_festival_team_id()));

revoke all on public.festival_teams, public.festival_team_members from anon, authenticated;
grant select on public.festival_teams, public.festival_team_members to authenticated;
revoke insert, update, delete on public.menu_categories from authenticated;

create or replace function public.authorize_festival_signup_attempt(
  p_rate_key_hash text,
  p_request_timestamp bigint,
  p_signature text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.verify_festival_signature(
    'signup-v1|' || p_request_timestamp::text || '|' || coalesce(p_rate_key_hash, ''),
    p_request_timestamp,
    p_signature
  );
  perform private.consume_festival_rate_limit('operator-signup', p_rate_key_hash, 3, 3600);
end;
$$;

revoke all on function public.authorize_festival_signup_attempt(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.authorize_festival_signup_attempt(text, bigint, text) to anon;

create or replace function private.handle_festival_operator_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_department text := trim(coalesce(new.raw_user_meta_data->>'festival_department_name', ''));
  v_team_name text := trim(coalesce(new.raw_user_meta_data->>'festival_team_name', ''));
  v_display_name text := trim(coalesce(new.raw_user_meta_data->>'festival_display_name', ''));
  v_slug text;
  v_team_id uuid;
begin
  if coalesce(new.raw_user_meta_data->>'festival_signup_version', '') <> '1'
     or char_length(v_department) not between 2 and 80
     or char_length(v_team_name) not between 2 and 80
     or char_length(v_display_name) not between 2 and 60 then
    raise exception 'invalid festival signup metadata';
  end if;

  loop
    v_slug := 'team-' || encode(extensions.gen_random_bytes(8), 'hex');
    exit when not exists (select 1 from public.festival_teams where public_slug = v_slug);
  end loop;

  insert into public.festival_teams(public_slug, department_name, team_name)
  values (v_slug, v_department, v_team_name)
  returning id into v_team_id;

  insert into public.profiles(id, role, display_name, current_team_id)
  values (new.id, 'ADMIN', v_display_name, v_team_id);

  insert into public.festival_team_members(team_id, user_id, role)
  values (v_team_id, new.id, 'OWNER');

  insert into public.store_settings(
    team_id, singleton_key, stall_name, operating_hours, is_open, updated_by
  ) values (
    v_team_id, true, v_department, '17:00 — 23:30', false, new.id
  );

  insert into public.menu_categories(team_id, name, sort_order)
  values
    (v_team_id, '안주', 1),
    (v_team_id, '식사', 2),
    (v_team_id, '간식', 3),
    (v_team_id, '음료', 4);

  return new;
end;
$$;

revoke all on function private.handle_festival_operator_signup()
  from public, anon, authenticated;

drop trigger if exists on_festival_operator_signup on auth.users;
create trigger on_festival_operator_signup
  after insert on auth.users
  for each row execute function private.handle_festival_operator_signup();

create or replace function public.resolve_festival_table(p_qr_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', ft.id,
    'table_number', ft.table_number,
    'team_slug', team.public_slug
  )
  from public.festival_tables ft
  join public.festival_teams team on team.id = ft.team_id
  where ft.qr_token = p_qr_token
    and ft.is_active = true
    and team.is_active = true
    and p_qr_token is not null
    and char_length(p_qr_token) >= 16
$$;

create or replace function public.get_public_menu(p_team_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'name', m.name,
    'description', m.description,
    'price', m.price,
    'image_url', m.image_url,
    'category', m.category,
    'status', case when m.stock_quantity = 0 then 'SOLD_OUT' else m.status end,
    'stock_quantity', m.stock_quantity,
    'sort_order', m.sort_order
  ) order by m.sort_order, m.name), '[]'::jsonb)
  from public.menu_items m
  join public.festival_teams team on team.id = m.team_id
  where team.public_slug = p_team_slug
    and team.is_active = true
    and m.status in ('AVAILABLE', 'SOLD_OUT')
$$;

create or replace function public.get_public_menu()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_public_menu(
    (select public_slug from public.festival_teams where is_legacy = true and is_active = true)
  )
$$;

create or replace function public.get_public_store_settings(p_team_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'stall_name', s.stall_name,
    'bank_name', s.bank_name,
    'account_number', s.account_number,
    'account_holder', s.account_holder,
    'operating_hours', s.operating_hours,
    'is_open', s.is_open,
    'configured', s.bank_name <> '' and s.account_number <> '' and s.account_holder <> ''
  )
  from public.store_settings s
  join public.festival_teams team on team.id = s.team_id
  where team.public_slug = p_team_slug
    and team.is_active = true
    and s.singleton_key = true
$$;

create or replace function public.get_public_store_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_public_store_settings(
    (select public_slug from public.festival_teams where is_legacy = true and is_active = true)
  )
$$;

create or replace function public.get_legacy_festival_team_slug()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public_slug
  from public.festival_teams
  where is_legacy = true and is_active = true
$$;

revoke all on function public.resolve_festival_table(text) from public, anon, authenticated;
revoke all on function public.get_public_menu(text) from public, anon, authenticated;
revoke all on function public.get_public_menu() from public, anon, authenticated;
revoke all on function public.get_public_store_settings(text) from public, anon, authenticated;
revoke all on function public.get_public_store_settings() from public, anon, authenticated;
revoke all on function public.get_legacy_festival_team_slug() from public, anon, authenticated;
grant execute on function public.resolve_festival_table(text) to anon;
grant execute on function public.get_public_menu(text) to anon;
grant execute on function public.get_public_menu() to anon;
grant execute on function public.get_public_store_settings(text) to anon;
grant execute on function public.get_public_store_settings() to anon;
grant execute on function public.get_legacy_festival_team_slug() to anon;

create or replace function private.create_festival_order_core_v2(
  p_team_slug text,
  p_qr_token text,
  p_fulfillment_type text,
  p_client_request_id uuid,
  p_items jsonb,
  p_rate_key_hash text,
  p_rate_max integer,
  p_pending_max integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_order public.orders%rowtype;
  v_table_id uuid;
  v_table_number integer;
  v_item jsonb;
  v_menu public.menu_items%rowtype;
  v_quantity integer;
  v_total_quantity integer := 0;
  v_total integer := 0;
  v_prefix text;
  v_open_count integer;
begin
  if p_fulfillment_type not in ('DINE_IN', 'TAKEOUT') then
    raise exception 'invalid fulfillment type';
  end if;

  if p_fulfillment_type = 'DINE_IN' then
    select ft.id, ft.table_number, ft.team_id
    into v_table_id, v_table_number, v_team_id
    from public.festival_tables ft
    join public.festival_teams team on team.id = ft.team_id
    where ft.qr_token = p_qr_token
      and ft.is_active = true
      and team.is_active = true
      and (p_team_slug is null or p_team_slug = '' or team.public_slug = p_team_slug);
    if not found then raise exception 'invalid or inactive qr'; end if;
  else
    select id into v_team_id
    from public.festival_teams
    where public_slug = p_team_slug and is_active = true;
    if not found then raise exception 'invalid team'; end if;
    v_table_id := null;
  end if;

  select * into v_order
  from public.orders
  where client_request_id = p_client_request_id
    and team_id = v_team_id;
  if found then
    return jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'public_token', v_order.public_token,
      'total_amount', v_order.total_amount,
      'expires_at', v_order.expires_at,
      'duplicate', true
    );
  end if;

  perform private.consume_festival_rate_limit('customer-order', p_rate_key_hash, p_rate_max, 60);

  select count(*) into v_open_count
  from public.orders o
  join public.payments p on p.order_id = o.id and p.team_id = o.team_id
  where o.team_id = v_team_id
    and o.submission_key_hash = lower(p_rate_key_hash)
    and o.status = 'PENDING_PAYMENT'
    and p.status = 'UNPAID'
    and o.created_at >= clock_timestamp() - interval '10 minutes';
  if v_open_count >= p_pending_max then raise exception 'too many unpaid orders'; end if;

  if not exists (
    select 1 from public.store_settings
    where team_id = v_team_id and singleton_key = true
      and bank_name <> '' and account_number <> '' and account_holder <> ''
  ) then raise exception 'store not configured'; end if;
  if not exists (
    select 1 from public.store_settings
    where team_id = v_team_id and singleton_key = true and is_open = true
  ) then raise exception 'store closed'; end if;

  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 20 then
    raise exception 'invalid items';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'menu_item_id') from jsonb_array_elements(p_items)) then
    raise exception 'duplicate menu item';
  end if;

  if p_fulfillment_type = 'DINE_IN' then
    select count(*) into v_open_count
    from public.orders o
    join public.payments p on p.order_id = o.id and p.team_id = o.team_id
    where o.team_id = v_team_id
      and o.table_id = v_table_id
      and o.status = 'PENDING_PAYMENT'
      and p.status = 'UNPAID'
      and o.created_at >= clock_timestamp() - interval '10 minutes';
    if v_open_count >= 12 then raise exception 'table has too many unpaid orders'; end if;
  else
    select count(*) into v_open_count
    from public.orders o
    join public.payments p on p.order_id = o.id and p.team_id = o.team_id
    where o.team_id = v_team_id
      and o.fulfillment_type = 'TAKEOUT'
      and o.status = 'PENDING_PAYMENT'
      and p.status = 'UNPAID'
      and o.created_at >= clock_timestamp() - interval '10 minutes';
    if v_open_count >= 30 then raise exception 'takeout has too many unpaid orders'; end if;
  end if;

  v_prefix := case when p_fulfillment_type = 'TAKEOUT' then 'P' else 'A' end;
  insert into public.orders(
    team_id, order_number, fulfillment_type, table_id, client_request_id,
    submission_key_hash, expires_at
  ) values (
    v_team_id,
    v_prefix || lpad(nextval('public.festival_order_number_seq')::text, 3, '0'),
    p_fulfillment_type,
    v_table_id,
    p_client_request_id,
    lower(p_rate_key_hash),
    clock_timestamp() + interval '10 minutes'
  ) returning * into v_order;

  for v_item in
    select value from jsonb_array_elements(p_items) order by value->>'menu_item_id'
  loop
    begin
      v_quantity := (v_item->>'quantity')::integer;
      select * into v_menu
      from public.menu_items
      where id = (v_item->>'menu_item_id')::uuid
        and team_id = v_team_id
      for update;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid order item';
    end;

    if not found or v_menu.status <> 'AVAILABLE' then raise exception 'menu unavailable'; end if;
    if v_quantity <= 0 or v_quantity > 10 then raise exception 'invalid quantity'; end if;
    v_total_quantity := v_total_quantity + v_quantity;
    if v_total_quantity > 20 then raise exception 'order quantity limit exceeded'; end if;
    if v_menu.stock_quantity < v_quantity then raise exception 'insufficient stock'; end if;

    update public.menu_items
    set stock_quantity = stock_quantity - v_quantity,
        status = case when stock_quantity - v_quantity = 0 then 'SOLD_OUT' else status end,
        updated_at = clock_timestamp()
    where id = v_menu.id and team_id = v_team_id;

    insert into public.order_items(
      team_id, order_id, menu_item_id, menu_name, unit_price, quantity, subtotal
    ) values (
      v_team_id, v_order.id, v_menu.id, v_menu.name, v_menu.price,
      v_quantity, v_menu.price * v_quantity
    );

    insert into public.inventory_adjustments(
      team_id, menu_item_id, quantity_change, reason, order_id
    ) values (
      v_team_id, v_menu.id, -v_quantity, '주문 재고 예약', v_order.id
    );
    v_total := v_total + v_menu.price * v_quantity;
  end loop;

  update public.orders
  set total_amount = v_total, updated_at = clock_timestamp()
  where id = v_order.id and team_id = v_team_id
  returning * into v_order;

  insert into public.payments(team_id, order_id, amount)
  values (v_team_id, v_order.id, v_total);

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'public_token', v_order.public_token,
    'total_amount', v_total,
    'table_number', v_table_number,
    'expires_at', v_order.expires_at,
    'duplicate', false
  );
exception when unique_violation then
  select * into v_order
  from public.orders
  where client_request_id = p_client_request_id and team_id = v_team_id;
  if not found then raise; end if;
  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'public_token', v_order.public_token,
    'total_amount', v_order.total_amount,
    'expires_at', v_order.expires_at,
    'duplicate', true
  );
end;
$$;

revoke all on function private.create_festival_order_core_v2(text, text, text, uuid, jsonb, text, integer, integer)
  from public, anon, authenticated;

create or replace function public.create_festival_order(
  p_qr_token text,
  p_fulfillment_type text,
  p_client_request_id uuid,
  p_items jsonb,
  p_rate_key_hash text,
  p_request_timestamp bigint,
  p_signature text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_legacy_slug text;
begin
  perform private.verify_festival_signature(
    'order-v1|' || p_request_timestamp::text || '|' || p_client_request_id::text || '|' ||
    coalesce(p_fulfillment_type, '') || '|' || coalesce(p_qr_token, '') || '|' || coalesce(p_rate_key_hash, ''),
    p_request_timestamp,
    p_signature
  );
  select public_slug into v_legacy_slug from public.festival_teams where is_legacy = true;
  return private.create_festival_order_core_v2(
    v_legacy_slug, p_qr_token, p_fulfillment_type, p_client_request_id, p_items,
    p_rate_key_hash, 5, 3
  );
end;
$$;

create or replace function public.create_festival_order(
  p_team_slug text,
  p_qr_token text,
  p_fulfillment_type text,
  p_client_request_id uuid,
  p_items jsonb,
  p_rate_key_hash text,
  p_request_timestamp bigint,
  p_signature text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.verify_festival_signature(
    'order-v2|' || p_request_timestamp::text || '|' || p_client_request_id::text || '|' ||
    coalesce(p_team_slug, '') || '|' || coalesce(p_fulfillment_type, '') || '|' ||
    coalesce(p_qr_token, '') || '|' || coalesce(p_rate_key_hash, ''),
    p_request_timestamp,
    p_signature
  );
  return private.create_festival_order_core_v2(
    p_team_slug, p_qr_token, p_fulfillment_type, p_client_request_id, p_items,
    p_rate_key_hash, 5, 3
  );
end;
$$;

revoke all on function public.create_festival_order(text, text, uuid, jsonb, text, bigint, text)
  from public, anon, authenticated;
revoke all on function public.create_festival_order(text, text, text, uuid, jsonb, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.create_festival_order(text, text, uuid, jsonb, text, bigint, text) to anon;
grant execute on function public.create_festival_order(text, text, text, uuid, jsonb, text, bigint, text) to anon;

create or replace function public.update_store_settings(
  p_stall_name text,
  p_bank_name text,
  p_account_number text,
  p_account_holder text,
  p_operating_hours text,
  p_is_open boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_settings public.store_settings%rowtype;
  v_previous jsonb;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
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

  select * into v_settings
  from public.store_settings
  where team_id = v_team_id and singleton_key = true
  for update;
  if not found then raise exception 'settings not found'; end if;
  v_previous := to_jsonb(v_settings) - 'updated_by';

  update public.store_settings
  set stall_name = trim(p_stall_name),
      bank_name = trim(p_bank_name),
      account_number = trim(p_account_number),
      account_holder = trim(p_account_holder),
      operating_hours = trim(p_operating_hours),
      is_open = p_is_open,
      updated_by = (select auth.uid()),
      updated_at = clock_timestamp()
  where team_id = v_team_id and singleton_key = true
  returning * into v_settings;

  insert into public.audit_logs(team_id, actor_id, entity_type, entity_id, action, previous_value, next_value)
  values (v_team_id, (select auth.uid()), 'STORE_SETTINGS', v_settings.id, 'UPDATE', v_previous, to_jsonb(v_settings) - 'updated_by');

  return jsonb_build_object(
    'stall_name', v_settings.stall_name,
    'bank_name', v_settings.bank_name,
    'account_number', v_settings.account_number,
    'account_holder', v_settings.account_holder,
    'operating_hours', v_settings.operating_hours,
    'is_open', v_settings.is_open,
    'configured', v_settings.bank_name <> '' and v_settings.account_number <> '' and v_settings.account_holder <> ''
  );
end;
$$;

create or replace function public.create_menu_category(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_team_id uuid := public.current_festival_team_id();
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if char_length(trim(p_name)) not between 1 and 30 then raise exception 'invalid category'; end if;
  insert into public.menu_categories(team_id, name, sort_order)
  values (
    v_team_id,
    trim(p_name),
    coalesce((select max(sort_order) + 1 from public.menu_categories where team_id = v_team_id), 0)
  );
end;
$$;

create or replace function public.rename_menu_category(p_previous_name text, p_next_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_team_id uuid := public.current_festival_team_id();
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if char_length(trim(p_next_name)) not between 1 and 30 then raise exception 'invalid category'; end if;
  update public.menu_categories
  set name = trim(p_next_name), updated_at = clock_timestamp()
  where team_id = v_team_id and name = p_previous_name;
  if not found then raise exception 'category not found'; end if;
  update public.menu_items
  set category = trim(p_next_name), updated_at = clock_timestamp()
  where team_id = v_team_id and category = p_previous_name;
end;
$$;

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
    where team_id = v_team_id and category = p_name and status <> 'ARCHIVED'
  ) then raise exception 'category is in use'; end if;
  delete from public.menu_categories where team_id = v_team_id and name = p_name;
  if not found then raise exception 'category not found'; end if;
end;
$$;

create or replace function public.create_festival_menu_item(
  p_name text,
  p_description text,
  p_price integer,
  p_category text,
  p_status text,
  p_stock_quantity integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_menu public.menu_items%rowtype;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if char_length(trim(p_name)) not between 1 and 80
     or char_length(coalesce(p_description, '')) > 500
     or p_price < 0 or p_stock_quantity < 0
     or p_status not in ('AVAILABLE', 'SOLD_OUT', 'HIDDEN') then
    raise exception 'invalid menu item';
  end if;
  if not exists (
    select 1 from public.menu_categories where team_id = v_team_id and name = trim(p_category)
  ) then raise exception 'category not found'; end if;

  insert into public.menu_items(
    team_id, name, description, price, category, status, stock_quantity, sort_order
  ) values (
    v_team_id, trim(p_name), trim(coalesce(p_description, '')), p_price, trim(p_category),
    case when p_stock_quantity = 0 then 'SOLD_OUT' else p_status end,
    p_stock_quantity,
    coalesce((select max(sort_order) + 1 from public.menu_items where team_id = v_team_id), 0)
  ) returning * into v_menu;

  insert into public.audit_logs(team_id, actor_id, entity_type, entity_id, action, next_value)
  values (v_team_id, (select auth.uid()), 'MENU_ITEM', v_menu.id, 'CREATE', to_jsonb(v_menu));
  if p_stock_quantity > 0 then
    insert into public.inventory_adjustments(team_id, menu_item_id, quantity_change, reason, admin_id)
    values (v_team_id, v_menu.id, p_stock_quantity, '초기 재고', (select auth.uid()));
  end if;
  return jsonb_build_object(
    'id', v_menu.id, 'name', v_menu.name, 'description', v_menu.description,
    'price', v_menu.price, 'category', v_menu.category, 'status', v_menu.status,
    'stock_quantity', v_menu.stock_quantity
  );
end;
$$;

create or replace function public.update_festival_menu_item(
  p_menu_item_id uuid,
  p_name text,
  p_description text,
  p_price integer,
  p_category text,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_menu public.menu_items%rowtype;
  v_previous jsonb;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if char_length(trim(p_name)) not between 1 and 80
     or char_length(coalesce(p_description, '')) > 500
     or p_price < 0
     or p_status not in ('AVAILABLE', 'SOLD_OUT', 'HIDDEN', 'ARCHIVED') then
    raise exception 'invalid menu item';
  end if;
  if not exists (
    select 1 from public.menu_categories where team_id = v_team_id and name = trim(p_category)
  ) then raise exception 'category not found'; end if;

  select * into v_menu
  from public.menu_items
  where id = p_menu_item_id and team_id = v_team_id
  for update;
  if not found then raise exception 'menu not found'; end if;
  v_previous := to_jsonb(v_menu);

  update public.menu_items
  set name = trim(p_name),
      description = trim(coalesce(p_description, '')),
      price = p_price,
      category = trim(p_category),
      status = case when stock_quantity = 0 and p_status = 'AVAILABLE' then 'SOLD_OUT' else p_status end,
      updated_at = clock_timestamp()
  where id = p_menu_item_id and team_id = v_team_id
  returning * into v_menu;

  insert into public.audit_logs(team_id, actor_id, entity_type, entity_id, action, previous_value, next_value)
  values (v_team_id, (select auth.uid()), 'MENU_ITEM', v_menu.id, 'UPDATE', v_previous, to_jsonb(v_menu));
  return jsonb_build_object(
    'id', v_menu.id, 'name', v_menu.name, 'description', v_menu.description,
    'price', v_menu.price, 'category', v_menu.category, 'status', v_menu.status,
    'stock_quantity', v_menu.stock_quantity
  );
end;
$$;

create or replace function public.adjust_menu_stock(
  p_menu_item_id uuid,
  p_quantity_change integer,
  p_reason text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_stock integer;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if p_quantity_change = 0 or char_length(trim(p_reason)) < 2 then raise exception 'reason required'; end if;
  update public.menu_items
  set stock_quantity = stock_quantity + p_quantity_change,
      status = case
        when stock_quantity + p_quantity_change = 0 then 'SOLD_OUT'
        when status = 'SOLD_OUT' and stock_quantity + p_quantity_change > 0 then 'AVAILABLE'
        else status
      end,
      updated_at = clock_timestamp()
  where id = p_menu_item_id
    and team_id = v_team_id
    and stock_quantity + p_quantity_change >= 0
  returning stock_quantity into v_stock;
  if not found then raise exception 'stock cannot be negative'; end if;
  insert into public.inventory_adjustments(team_id, menu_item_id, quantity_change, reason, admin_id)
  values (v_team_id, p_menu_item_id, p_quantity_change, trim(p_reason), (select auth.uid()));
  return v_stock;
end;
$$;

create or replace function public.configure_festival_tables(p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_number integer;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if p_count < 1 or p_count > 200 then raise exception 'table count out of range'; end if;

  for v_number in 1..p_count loop
    insert into public.festival_tables(team_id, table_number, qr_token, is_active)
    values (v_team_id, v_number, encode(extensions.gen_random_bytes(24), 'hex'), true)
    on conflict (team_id, table_number)
    do update set is_active = true, updated_at = clock_timestamp();
  end loop;

  update public.festival_tables
  set is_active = false, updated_at = clock_timestamp()
  where team_id = v_team_id and table_number > p_count and is_active = true;

  insert into public.audit_logs(team_id, actor_id, entity_type, entity_id, action, next_value)
  values (
    v_team_id, (select auth.uid()), 'FESTIVAL_TABLE', extensions.gen_random_uuid(),
    'CONFIGURE_TABLE_COUNT', jsonb_build_object('count', p_count)
  );

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'table_number', table_number,
      'qr_token', qr_token,
      'is_active', is_active
    ) order by table_number), '[]'::jsonb)
    from public.festival_tables
    where team_id = v_team_id
  );
end;
$$;

create or replace function public.rotate_festival_table_qr(p_table_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  update public.festival_tables
  set qr_token = v_token, updated_at = clock_timestamp()
  where id = p_table_id and team_id = v_team_id
  returning qr_token into v_token;
  if not found then raise exception 'table not found'; end if;
  insert into public.audit_logs(team_id, actor_id, entity_type, entity_id, action, next_value)
  values (v_team_id, (select auth.uid()), 'FESTIVAL_TABLE', p_table_id, 'ROTATE_QR', jsonb_build_object('rotated', true));
  return v_token;
end;
$$;

create or replace function public.admin_process_order(p_order_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_order public.orders%rowtype;
  v_previous jsonb;
  v_item record;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  select * into v_order
  from public.orders
  where id = p_order_id and team_id = v_team_id
  for update;
  if not found then raise exception 'order not found'; end if;
  v_previous := jsonb_build_object('status', v_order.status);

  if p_action = 'CONFIRM_PAYMENT' then
    if v_order.status <> 'PENDING_PAYMENT' or not exists (
      select 1 from public.payments
      where team_id = v_team_id and order_id = v_order.id and status = 'CUSTOMER_MARKED_TRANSFERRED'
    ) then raise exception 'invalid payment state'; end if;
    update public.payments
    set status = 'CONFIRMED', confirmed_at = clock_timestamp(),
        confirmed_by = (select auth.uid()), updated_at = clock_timestamp()
    where team_id = v_team_id and order_id = v_order.id;
    update public.orders
    set status = 'PAID', expires_at = null, updated_at = clock_timestamp()
    where id = v_order.id and team_id = v_team_id;
  elsif p_action = 'START_COOKING' and v_order.status = 'PAID' then
    update public.orders set status = 'COOKING', updated_at = clock_timestamp()
    where id = v_order.id and team_id = v_team_id;
  elsif p_action = 'MARK_READY' and v_order.status = 'COOKING' then
    update public.orders set status = 'READY', updated_at = clock_timestamp()
    where id = v_order.id and team_id = v_team_id;
  elsif p_action = 'MARK_SERVED' and v_order.status = 'READY' then
    update public.orders set status = 'SERVED', updated_at = clock_timestamp()
    where id = v_order.id and team_id = v_team_id;
  elsif p_action = 'CANCEL' and v_order.status not in ('SERVED', 'CANCELLED') then
    for v_item in
      select menu_item_id, quantity
      from public.order_items
      where team_id = v_team_id and order_id = v_order.id
    loop
      update public.menu_items
      set stock_quantity = stock_quantity + v_item.quantity,
          status = case when status = 'SOLD_OUT' then 'AVAILABLE' else status end,
          updated_at = clock_timestamp()
      where id = v_item.menu_item_id and team_id = v_team_id;
      insert into public.inventory_adjustments(
        team_id, menu_item_id, quantity_change, reason, admin_id, order_id
      ) values (
        v_team_id, v_item.menu_item_id, v_item.quantity,
        '주문 취소 재고 복구', (select auth.uid()), v_order.id
      );
    end loop;
    update public.payments
    set status = case when status = 'CONFIRMED' then status else 'REJECTED' end,
        updated_at = clock_timestamp()
    where team_id = v_team_id and order_id = v_order.id;
    update public.orders
    set status = 'CANCELLED', cancelled_at = clock_timestamp(), expires_at = null,
        updated_at = clock_timestamp()
    where id = v_order.id and team_id = v_team_id;
  else
    raise exception 'invalid state transition';
  end if;

  insert into public.audit_logs(team_id, actor_id, entity_type, entity_id, action, previous_value, next_value)
  select v_team_id, (select auth.uid()), 'ORDER', id, p_action, v_previous,
         jsonb_build_object('status', status)
  from public.orders
  where id = v_order.id and team_id = v_team_id;
end;
$$;

create or replace function private.expire_unpaid_festival_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_item record;
  v_expired integer := 0;
begin
  for v_order in
    select o.id, o.team_id
    from public.orders o
    join public.payments p on p.order_id = o.id and p.team_id = o.team_id
    where o.status = 'PENDING_PAYMENT'
      and p.status = 'UNPAID'
      and o.expires_at is not null
      and o.expires_at <= clock_timestamp()
    order by o.expires_at
    for update of o skip locked
  loop
    for v_item in
      select menu_item_id, sum(quantity)::integer as quantity
      from public.order_items
      where team_id = v_order.team_id and order_id = v_order.id
      group by menu_item_id
    loop
      update public.menu_items
      set stock_quantity = stock_quantity + v_item.quantity,
          status = case when status = 'SOLD_OUT' then 'AVAILABLE' else status end,
          updated_at = clock_timestamp()
      where id = v_item.menu_item_id and team_id = v_order.team_id;
      insert into public.inventory_adjustments(
        team_id, menu_item_id, quantity_change, reason, order_id
      ) values (
        v_order.team_id, v_item.menu_item_id, v_item.quantity,
        '미입금 10분 자동 취소 재고 복구', v_order.id
      );
    end loop;

    update public.payments
    set status = 'REJECTED', updated_at = clock_timestamp()
    where team_id = v_order.team_id and order_id = v_order.id and status = 'UNPAID';
    update public.orders
    set status = 'CANCELLED', cancelled_at = clock_timestamp(), expires_at = null,
        updated_at = clock_timestamp()
    where team_id = v_order.team_id and id = v_order.id and status = 'PENDING_PAYMENT';
    insert into public.audit_logs(
      team_id, actor_id, entity_type, entity_id, action, previous_value, next_value
    ) values (
      v_order.team_id, null, 'ORDER', v_order.id, 'AUTO_CANCEL_UNPAID',
      jsonb_build_object('status', 'PENDING_PAYMENT', 'payment_status', 'UNPAID'),
      jsonb_build_object('status', 'CANCELLED', 'payment_status', 'REJECTED')
    );
    v_expired := v_expired + 1;
  end loop;

  delete from private.festival_rate_limits
  where last_seen_at < clock_timestamp() - interval '24 hours';
  return v_expired;
end;
$$;

revoke all on function private.expire_unpaid_festival_orders() from public, anon, authenticated;

create or replace function public.get_admin_dashboard_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare v_team_id uuid := public.current_festival_team_id();
begin
  if v_team_id is null then raise exception 'admin required'; end if;

  return jsonb_build_object(
    'team', (
      select jsonb_build_object(
        'department_name', department_name,
        'team_name', team_name,
        'public_slug', public_slug
      )
      from public.festival_teams where id = v_team_id
    ),
    'orders', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'fulfillment_type', o.fulfillment_type,
        'table_number', t.table_number,
        'total_amount', o.total_amount,
        'status', o.status,
        'payment_status', p.status,
        'created_at', o.created_at,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'menu_name', oi.menu_name, 'quantity', oi.quantity
          ) order by oi.id), '[]'::jsonb)
          from public.order_items oi
          where oi.team_id = v_team_id and oi.order_id = o.id
        )
      ) order by o.created_at desc), '[]'::jsonb)
      from (
        select * from public.orders
        where team_id = v_team_id
        order by created_at desc limit 200
      ) o
      left join public.festival_tables t on t.id = o.table_id and t.team_id = v_team_id
      join public.payments p on p.order_id = o.id and p.team_id = v_team_id
    ),
    'menu', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'description', m.description,
        'price', m.price,
        'category', m.category,
        'status', m.status,
        'stock_quantity', m.stock_quantity,
        'reserved_quantity', coalesce(s.reserved_quantity, 0),
        'sold_quantity', coalesce(s.sold_quantity, 0)
      ) order by m.sort_order, m.name), '[]'::jsonb)
      from public.menu_items m
      left join lateral (
        select
          coalesce(sum(oi.quantity) filter (where o.status = 'PENDING_PAYMENT'), 0)::integer as reserved_quantity,
          coalesce(sum(oi.quantity) filter (where o.status not in ('PENDING_PAYMENT', 'CANCELLED')), 0)::integer as sold_quantity
        from public.order_items oi
        join public.orders o on o.id = oi.order_id and o.team_id = v_team_id
        where oi.team_id = v_team_id and oi.menu_item_id = m.id
      ) s on true
      where m.team_id = v_team_id
    ),
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'table_number', table_number, 'qr_token', qr_token, 'is_active', is_active
      ) order by table_number), '[]'::jsonb)
      from public.festival_tables where team_id = v_team_id
    ),
    'categories', (
      select coalesce(jsonb_agg(name order by sort_order, name), '[]'::jsonb)
      from public.menu_categories where team_id = v_team_id
    ),
    'settings', (
      select jsonb_build_object(
        'stall_name', stall_name,
        'bank_name', bank_name,
        'account_number', account_number,
        'account_holder', account_holder,
        'operating_hours', operating_hours,
        'is_open', is_open
      )
      from public.store_settings
      where team_id = v_team_id and singleton_key = true
    ),
    'daily_sales', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'sales_date', sales_date,
        'total_revenue', total_revenue,
        'confirmed_orders', confirmed_orders,
        'dine_in_orders', dine_in_orders,
        'takeout_orders', takeout_orders,
        'average_order_amount', average_order_amount
      ) order by sales_date desc), '[]'::jsonb)
      from (
        select
          (p.confirmed_at at time zone 'Asia/Seoul')::date as sales_date,
          coalesce(sum(p.amount), 0)::bigint as total_revenue,
          count(*)::bigint as confirmed_orders,
          count(*) filter (where o.fulfillment_type = 'DINE_IN')::bigint as dine_in_orders,
          count(*) filter (where o.fulfillment_type = 'TAKEOUT')::bigint as takeout_orders,
          coalesce(round(avg(p.amount)), 0)::bigint as average_order_amount
        from public.payments p
        join public.orders o on o.id = p.order_id and o.team_id = v_team_id
        where p.team_id = v_team_id
          and p.status = 'CONFIRMED'
          and p.confirmed_at is not null
        group by (p.confirmed_at at time zone 'Asia/Seoul')::date
      ) sales
    ),
    'synced_at', clock_timestamp()
  );
end;
$$;

revoke all on function public.update_store_settings(text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.create_menu_category(text) from public, anon, authenticated;
revoke all on function public.rename_menu_category(text, text) from public, anon, authenticated;
revoke all on function public.delete_menu_category(text) from public, anon, authenticated;
revoke all on function public.create_festival_menu_item(text, text, integer, text, text, integer) from public, anon, authenticated;
revoke all on function public.update_festival_menu_item(uuid, text, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.adjust_menu_stock(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.configure_festival_tables(integer) from public, anon, authenticated;
revoke all on function public.rotate_festival_table_qr(uuid) from public, anon, authenticated;
revoke all on function public.admin_process_order(uuid, text) from public, anon, authenticated;
revoke all on function public.get_admin_dashboard_snapshot() from public, anon, authenticated;

grant execute on function public.update_store_settings(text, text, text, text, text, boolean) to authenticated;
grant execute on function public.create_menu_category(text) to authenticated;
grant execute on function public.rename_menu_category(text, text) to authenticated;
grant execute on function public.delete_menu_category(text) to authenticated;
grant execute on function public.create_festival_menu_item(text, text, integer, text, text, integer) to authenticated;
grant execute on function public.update_festival_menu_item(uuid, text, text, integer, text, text) to authenticated;
grant execute on function public.adjust_menu_stock(uuid, integer, text) to authenticated;
grant execute on function public.configure_festival_tables(integer) to authenticated;
grant execute on function public.rotate_festival_table_qr(uuid) to authenticated;
grant execute on function public.admin_process_order(uuid, text) to authenticated;
grant execute on function public.get_admin_dashboard_snapshot() to authenticated;
