create or replace function private.valid_festival_menu_options(p_options jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_option jsonb;
begin
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) > 12 then
    return false;
  end if;
  if (select count(*) from jsonb_array_elements(p_options)) <>
     (select count(distinct value->>'id') from jsonb_array_elements(p_options)) then
    return false;
  end if;
  for v_option in select value from jsonb_array_elements(p_options)
  loop
    if jsonb_typeof(v_option) <> 'object'
       or jsonb_typeof(v_option->'id') <> 'string'
       or (v_option->>'id')::uuid is null
       or jsonb_typeof(v_option->'name') <> 'string'
       or char_length(trim(coalesce(v_option->>'name', ''))) not between 1 and 40
       or jsonb_typeof(v_option->'price_delta') <> 'number'
       or (v_option->>'price_delta')::numeric <> trunc((v_option->>'price_delta')::numeric)
       or (v_option->>'price_delta')::numeric not between 0 and 1000000 then
      return false;
    end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end;
$$;

revoke all on function private.valid_festival_menu_options(jsonb) from public, anon, authenticated;

alter table public.menu_items
  add column if not exists options jsonb not null default '[]'::jsonb;
alter table public.order_items
  add column if not exists selected_options jsonb not null default '[]'::jsonb;

alter table public.menu_items drop constraint if exists menu_items_options_check;
alter table public.menu_items add constraint menu_items_options_check
  check (private.valid_festival_menu_options(options));
alter table public.order_items drop constraint if exists order_items_selected_options_check;
alter table public.order_items add constraint order_items_selected_options_check
  check (private.valid_festival_menu_options(selected_options));

drop function if exists public.create_festival_menu_item(text, text, integer, text, text, integer);
create function public.create_festival_menu_item(
  p_name text,
  p_description text,
  p_price integer,
  p_category text,
  p_status text,
  p_stock_quantity integer,
  p_options jsonb default '[]'::jsonb
)
returns jsonb
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
     or p_status not in ('AVAILABLE', 'SOLD_OUT', 'HIDDEN')
     or not private.valid_festival_menu_options(p_options) then
    raise exception 'invalid menu item or options';
  end if;
  if not exists (
    select 1 from public.menu_categories where team_id = v_team_id and name = trim(p_category)
  ) then raise exception 'category not found'; end if;

  insert into public.menu_items(
    team_id, name, description, price, category, status, stock_quantity, sort_order, options
  ) values (
    v_team_id, trim(p_name), trim(coalesce(p_description, '')), p_price, trim(p_category),
    case when p_stock_quantity = 0 then 'SOLD_OUT' else p_status end,
    p_stock_quantity,
    coalesce((select max(sort_order) + 1 from public.menu_items where team_id = v_team_id), 0),
    p_options
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
    'stock_quantity', v_menu.stock_quantity, 'options', v_menu.options
  );
end;
$$;

drop function if exists public.update_festival_menu_item(uuid, text, text, integer, text, text);
create function public.update_festival_menu_item(
  p_menu_item_id uuid,
  p_name text,
  p_description text,
  p_price integer,
  p_category text,
  p_status text,
  p_options jsonb default '[]'::jsonb
)
returns jsonb
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
     or p_status not in ('AVAILABLE', 'SOLD_OUT', 'HIDDEN', 'ARCHIVED')
     or not private.valid_festival_menu_options(p_options) then
    raise exception 'invalid menu item or options';
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
      options = p_options,
      updated_at = clock_timestamp()
  where id = p_menu_item_id and team_id = v_team_id
  returning * into v_menu;

  insert into public.audit_logs(team_id, actor_id, entity_type, entity_id, action, previous_value, next_value)
  values (v_team_id, (select auth.uid()), 'MENU_ITEM', v_menu.id, 'UPDATE', v_previous, to_jsonb(v_menu));
  return jsonb_build_object(
    'id', v_menu.id, 'name', v_menu.name, 'description', v_menu.description,
    'price', v_menu.price, 'category', v_menu.category, 'status', v_menu.status,
    'stock_quantity', v_menu.stock_quantity, 'options', v_menu.options
  );
end;
$$;

revoke all on function public.create_festival_menu_item(text, text, integer, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.update_festival_menu_item(uuid, text, text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_festival_menu_item(text, text, integer, text, text, integer, jsonb) to authenticated;
grant execute on function public.update_festival_menu_item(uuid, text, text, integer, text, text, jsonb) to authenticated;

create or replace function private.create_festival_order_core_v2(
  p_team_slug text,
  p_qr_token text,
  p_fulfillment_type text,
  p_client_request_id uuid,
  p_items jsonb,
  p_rate_key_hash text,
  p_rate_max integer,
  p_pending_max integer
)
returns jsonb
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
  v_unit_price integer;
  v_option_ids jsonb;
  v_selected_options jsonb;
  v_option_total integer;
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
  where client_request_id = p_client_request_id and team_id = v_team_id;
  if found then
    return jsonb_build_object(
      'order_id', v_order.id, 'order_number', v_order.order_number,
      'public_token', v_order.public_token, 'total_amount', v_order.total_amount,
      'expires_at', v_order.expires_at, 'duplicate', true
    );
  end if;

  perform private.consume_festival_rate_limit('customer-order', p_rate_key_hash, p_rate_max, 60);
  select count(*) into v_open_count
  from public.orders o
  join public.payments p on p.order_id = o.id and p.team_id = o.team_id
  where o.team_id = v_team_id and o.submission_key_hash = lower(p_rate_key_hash)
    and o.status = 'PENDING_PAYMENT' and p.status = 'UNPAID'
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
  if exists (
    select 1
    from jsonb_array_elements(p_items)
    group by value->>'menu_item_id'
    having sum((value->>'quantity')::integer) > 10
  ) then raise exception 'order quantity limit exceeded'; end if;

  if p_fulfillment_type = 'DINE_IN' then
    select count(*) into v_open_count
    from public.orders o join public.payments p on p.order_id = o.id and p.team_id = o.team_id
    where o.team_id = v_team_id and o.table_id = v_table_id
      and o.status = 'PENDING_PAYMENT' and p.status = 'UNPAID'
      and o.created_at >= clock_timestamp() - interval '10 minutes';
    if v_open_count >= 12 then raise exception 'table has too many unpaid orders'; end if;
  else
    select count(*) into v_open_count
    from public.orders o join public.payments p on p.order_id = o.id and p.team_id = o.team_id
    where o.team_id = v_team_id and o.fulfillment_type = 'TAKEOUT'
      and o.status = 'PENDING_PAYMENT' and p.status = 'UNPAID'
      and o.created_at >= clock_timestamp() - interval '10 minutes';
    if v_open_count >= 30 then raise exception 'takeout has too many unpaid orders'; end if;
  end if;

  v_prefix := case when p_fulfillment_type = 'TAKEOUT' then 'P' else 'A' end;
  insert into public.orders(
    team_id, order_number, fulfillment_type, table_id, client_request_id,
    submission_key_hash, expires_at
  ) values (
    v_team_id, v_prefix || lpad(nextval('public.festival_order_number_seq')::text, 3, '0'),
    p_fulfillment_type, v_table_id, p_client_request_id, lower(p_rate_key_hash),
    clock_timestamp() + interval '10 minutes'
  ) returning * into v_order;

  for v_item in
    select value from jsonb_array_elements(p_items) order by value->>'menu_item_id'
  loop
    begin
      v_quantity := (v_item->>'quantity')::integer;
      if v_item ? 'option_ids' and jsonb_typeof(v_item->'option_ids') <> 'array' then
        raise exception 'invalid options';
      end if;
      v_option_ids := coalesce(v_item->'option_ids', '[]'::jsonb);
      select * into v_menu
      from public.menu_items
      where id = (v_item->>'menu_item_id')::uuid and team_id = v_team_id
      for update;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid order item';
    end;

    if not found or v_menu.status <> 'AVAILABLE' then raise exception 'menu unavailable'; end if;
    if v_quantity <= 0 or v_quantity > 10 then raise exception 'invalid quantity'; end if;
    v_total_quantity := v_total_quantity + v_quantity;
    if v_total_quantity > 20 then raise exception 'order quantity limit exceeded'; end if;
    if v_menu.stock_quantity < v_quantity then raise exception 'insufficient stock'; end if;
    if jsonb_array_length(v_option_ids) > 12
       or (select count(*) from jsonb_array_elements_text(v_option_ids)) <>
          (select count(distinct value) from jsonb_array_elements_text(v_option_ids)) then
      raise exception 'invalid options';
    end if;

    select coalesce(jsonb_agg(option_value order by position), '[]'::jsonb),
           coalesce(sum((option_value->>'price_delta')::integer), 0)::integer
    into v_selected_options, v_option_total
    from jsonb_array_elements(v_menu.options) with ordinality as configured(option_value, position)
    where exists (
      select 1 from jsonb_array_elements_text(v_option_ids) selected
      where selected.value = option_value->>'id'
    );
    if jsonb_array_length(v_selected_options) <> jsonb_array_length(v_option_ids) then
      raise exception 'invalid option selection';
    end if;
    v_unit_price := v_menu.price + v_option_total;

    update public.menu_items
    set stock_quantity = stock_quantity - v_quantity,
        status = case when stock_quantity - v_quantity = 0 then 'SOLD_OUT' else status end,
        updated_at = clock_timestamp()
    where id = v_menu.id and team_id = v_team_id;

    insert into public.order_items(
      team_id, order_id, menu_item_id, menu_name, unit_price, quantity, subtotal, selected_options
    ) values (
      v_team_id, v_order.id, v_menu.id, v_menu.name, v_unit_price,
      v_quantity, v_unit_price * v_quantity, v_selected_options
    );
    insert into public.inventory_adjustments(team_id, menu_item_id, quantity_change, reason, order_id)
    values (v_team_id, v_menu.id, -v_quantity, '주문 재고 예약', v_order.id);
    v_total := v_total + v_unit_price * v_quantity;
  end loop;

  update public.orders set total_amount = v_total, updated_at = clock_timestamp()
  where id = v_order.id and team_id = v_team_id returning * into v_order;
  insert into public.payments(team_id, order_id, amount) values (v_team_id, v_order.id, v_total);

  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number,
    'public_token', v_order.public_token, 'total_amount', v_total,
    'table_number', v_table_number, 'expires_at', v_order.expires_at, 'duplicate', false
  );
exception when unique_violation then
  select * into v_order from public.orders
  where client_request_id = p_client_request_id and team_id = v_team_id;
  if not found then raise; end if;
  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number,
    'public_token', v_order.public_token, 'total_amount', v_order.total_amount,
    'expires_at', v_order.expires_at, 'duplicate', true
  );
end;
$$;

revoke all on function private.create_festival_order_core_v2(text, text, text, uuid, jsonb, text, integer, integer) from public, anon, authenticated;

create or replace function public.get_public_menu(
  p_team_slug text,
  p_request_timestamp bigint,
  p_signature text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.verify_festival_signature(
    'public-menu-v1|' || p_request_timestamp::text || '|' || coalesce(p_team_slug, ''),
    p_request_timestamp, p_signature
  );
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'description', m.description, 'price', m.price,
      'image_url', m.image_url, 'category', m.category,
      'status', case when m.stock_quantity = 0 then 'SOLD_OUT' else m.status end,
      'stock_quantity', m.stock_quantity, 'sort_order', m.sort_order, 'options', m.options
    ) order by m.sort_order, m.name), '[]'::jsonb)
    from public.menu_items m
    join public.festival_teams team on team.id = m.team_id
    where team.public_slug = p_team_slug and team.is_active = true
      and m.status in ('AVAILABLE', 'SOLD_OUT')
  );
end;
$$;

create or replace function public.get_public_order(
  p_public_token uuid,
  p_rate_key_hash text,
  p_request_timestamp bigint,
  p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.verify_festival_signature(
    'public-order-v1|' || p_request_timestamp::text || '|' || p_public_token::text || '|' || coalesce(p_rate_key_hash, ''),
    p_request_timestamp, p_signature
  );
  perform private.consume_festival_rate_limit('public-order', p_rate_key_hash, 60, 60);
  return (
    select jsonb_build_object(
      'order_number', o.order_number, 'fulfillment_type', o.fulfillment_type,
      'table_number', t.table_number, 'total_amount', o.total_amount,
      'order_status', o.status, 'payment_status', p.status,
      'created_at', o.created_at, 'expires_at', o.expires_at,
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', oi.menu_name, 'quantity', oi.quantity, 'subtotal', oi.subtotal,
          'selected_options', oi.selected_options
        ) order by oi.id), '[]'::jsonb)
        from public.order_items oi where oi.team_id = o.team_id and oi.order_id = o.id
      )
    )
    from public.orders o
    join public.payments p on p.team_id = o.team_id and p.order_id = o.id
    left join public.festival_tables t on t.team_id = o.team_id and t.id = o.table_id
    join public.festival_teams team on team.id = o.team_id and team.is_active = true
    where o.public_token = p_public_token
  );
end;
$$;

create or replace function public.get_admin_dashboard_snapshot_v2()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_snapshot jsonb;
  v_orders jsonb;
  v_menu jsonb;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  v_snapshot := public.get_admin_dashboard_snapshot();

  select coalesce(jsonb_agg(
    entry || jsonb_build_object(
      'customer_name', o.customer_name,
      'customer_phone', o.customer_phone,
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'menu_name', oi.menu_name, 'quantity', oi.quantity,
          'selected_options', oi.selected_options
        ) order by oi.id), '[]'::jsonb)
        from public.order_items oi
        where oi.team_id = v_team_id and oi.order_id = o.id
      )
    ) order by position
  ), '[]'::jsonb)
  into v_orders
  from jsonb_array_elements(v_snapshot->'orders') with ordinality as listed(entry, position)
  join public.orders o on o.id = (entry->>'id')::uuid and o.team_id = v_team_id;

  select coalesce(jsonb_agg(
    entry || jsonb_build_object('options', m.options) order by position
  ), '[]'::jsonb)
  into v_menu
  from jsonb_array_elements(v_snapshot->'menu') with ordinality as listed(entry, position)
  join public.menu_items m on m.id = (entry->>'id')::uuid and m.team_id = v_team_id;

  return jsonb_set(jsonb_set(v_snapshot, '{orders}', v_orders, false), '{menu}', v_menu, false);
end;
$$;

revoke all on function public.get_public_menu(text, bigint, text) from public, anon, authenticated;
revoke all on function public.get_public_order(uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.get_admin_dashboard_snapshot_v2() from public, anon, authenticated;
grant execute on function public.get_public_menu(text, bigint, text) to anon;
grant execute on function public.get_public_order(uuid, text, bigint, text) to anon;
grant execute on function public.get_admin_dashboard_snapshot_v2() to authenticated;
