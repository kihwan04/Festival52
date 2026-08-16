-- Production hardening: signed order writes, durable rate limiting,
-- automatic unpaid-order expiry, and a single-query admin dashboard.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.festival_rate_limits (
  scope text not null,
  key_hash text not null check (char_length(key_hash) = 64),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  last_seen_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

revoke all on private.festival_rate_limits from public, anon, authenticated;
create index if not exists festival_rate_limits_last_seen_idx
  on private.festival_rate_limits(last_seen_at);

alter table public.orders
  add column if not exists submission_key_hash text,
  add column if not exists expires_at timestamptz;

update public.orders o
set expires_at = o.created_at + interval '10 minutes'
where o.status = 'PENDING_PAYMENT'
  and o.expires_at is null
  and exists (
    select 1 from public.payments p
    where p.order_id = o.id and p.status = 'UNPAID'
  );

create index if not exists orders_created_at_idx
  on public.orders(created_at desc);
create index if not exists orders_unpaid_expiry_idx
  on public.orders(expires_at)
  where status = 'PENDING_PAYMENT' and expires_at is not null;
create index if not exists orders_submission_pending_idx
  on public.orders(submission_key_hash, created_at desc)
  where status = 'PENDING_PAYMENT' and submission_key_hash is not null;
create index if not exists payments_confirmed_sales_idx
  on public.payments(confirmed_at)
  where status = 'CONFIRMED';

create or replace function private.festival_request_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'festival_request_signing_v1'
  order by created_at desc
  limit 1
$$;

revoke all on function private.festival_request_secret() from public, anon, authenticated;

create or replace function private.verify_festival_signature(
  p_message text,
  p_request_timestamp bigint,
  p_signature text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_expected text;
  v_now bigint := floor(extract(epoch from clock_timestamp()))::bigint;
begin
  if p_request_timestamp is null
     or abs(v_now - p_request_timestamp) > 120
     or p_signature is null
     or char_length(p_signature) <> 64 then
    raise exception 'invalid request signature';
  end if;

  v_secret := private.festival_request_secret();
  if v_secret is null or char_length(v_secret) < 32 then
    raise exception 'request signing is not configured';
  end if;

  v_expected := encode(
    extensions.hmac(
      convert_to(p_message, 'UTF8'),
      convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  if lower(p_signature) <> v_expected then
    raise exception 'invalid request signature';
  end if;
end;
$$;

revoke all on function private.verify_festival_signature(text, bigint, text) from public, anon, authenticated;

create or replace function private.consume_festival_rate_limit(
  p_scope text,
  p_key_hash text,
  p_max_requests integer,
  p_window_seconds integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit private.festival_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_scope is null or char_length(p_scope) not between 2 and 40
     or p_key_hash is null or char_length(p_key_hash) <> 64
     or p_max_requests < 1 or p_max_requests > 1000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit input';
  end if;

  insert into private.festival_rate_limits(scope, key_hash, request_count)
  values (p_scope, lower(p_key_hash), 0)
  on conflict (scope, key_hash) do nothing;

  select * into v_limit
  from private.festival_rate_limits
  where scope = p_scope and key_hash = lower(p_key_hash)
  for update;

  if v_limit.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    update private.festival_rate_limits
    set window_started_at = v_now, request_count = 1, last_seen_at = v_now
    where scope = p_scope and key_hash = lower(p_key_hash);
  elsif v_limit.request_count >= p_max_requests then
    raise exception 'rate limit exceeded';
  else
    update private.festival_rate_limits
    set request_count = request_count + 1, last_seen_at = v_now
    where scope = p_scope and key_hash = lower(p_key_hash);
  end if;
end;
$$;

revoke all on function private.consume_festival_rate_limit(text, text, integer, integer) from public, anon, authenticated;

create or replace function public.authorize_festival_login_attempt(
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
    'login-v1|' || p_request_timestamp::text || '|' || coalesce(p_rate_key_hash, ''),
    p_request_timestamp,
    p_signature
  );
  perform private.consume_festival_rate_limit('admin-login', p_rate_key_hash, 10, 900);
end;
$$;

revoke all on function public.authorize_festival_login_attempt(text, bigint, text) from public, anon, authenticated;
grant execute on function public.authorize_festival_login_attempt(text, bigint, text) to anon, authenticated;

create or replace function private.create_festival_order_core(
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
  select * into v_order
  from public.orders
  where client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'public_token', v_order.public_token,
      'total_amount', v_order.total_amount,
      'duplicate', true
    );
  end if;

  perform private.consume_festival_rate_limit('customer-order', p_rate_key_hash, p_rate_max, 60);

  select count(*) into v_open_count
  from public.orders o
  join public.payments p on p.order_id = o.id
  where o.submission_key_hash = lower(p_rate_key_hash)
    and o.status = 'PENDING_PAYMENT'
    and p.status = 'UNPAID'
    and o.created_at >= clock_timestamp() - interval '10 minutes';
  if v_open_count >= p_pending_max then
    raise exception 'too many unpaid orders';
  end if;

  if not exists (
    select 1 from public.store_settings
    where singleton_key = true
      and bank_name <> '' and account_number <> '' and account_holder <> ''
  ) then
    raise exception 'store not configured';
  end if;
  if not exists (
    select 1 from public.store_settings
    where singleton_key = true and is_open = true
  ) then
    raise exception 'store closed';
  end if;
  if p_fulfillment_type not in ('DINE_IN', 'TAKEOUT') then
    raise exception 'invalid fulfillment type';
  end if;
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
    select id, table_number into v_table_id, v_table_number
    from public.festival_tables
    where qr_token = p_qr_token and is_active = true;
    if not found then raise exception 'invalid or inactive qr'; end if;

    select count(*) into v_open_count
    from public.orders o
    join public.payments p on p.order_id = o.id
    where o.table_id = v_table_id
      and o.status = 'PENDING_PAYMENT'
      and p.status = 'UNPAID'
      and o.created_at >= clock_timestamp() - interval '10 minutes';
    if v_open_count >= 12 then raise exception 'table has too many unpaid orders'; end if;
  else
    v_table_id := null;
    select count(*) into v_open_count
    from public.orders o
    join public.payments p on p.order_id = o.id
    where o.fulfillment_type = 'TAKEOUT'
      and o.status = 'PENDING_PAYMENT'
      and p.status = 'UNPAID'
      and o.created_at >= clock_timestamp() - interval '10 minutes';
    if v_open_count >= 30 then raise exception 'takeout has too many unpaid orders'; end if;
  end if;

  v_prefix := case when p_fulfillment_type = 'TAKEOUT' then 'P' else 'A' end;
  insert into public.orders(
    order_number,
    fulfillment_type,
    table_id,
    client_request_id,
    submission_key_hash,
    expires_at
  ) values (
    v_prefix || lpad(nextval('public.festival_order_number_seq')::text, 3, '0'),
    p_fulfillment_type,
    v_table_id,
    p_client_request_id,
    lower(p_rate_key_hash),
    clock_timestamp() + interval '10 minutes'
  ) returning * into v_order;

  for v_item in
    select value from jsonb_array_elements(p_items)
    order by value->>'menu_item_id'
  loop
    begin
      v_quantity := (v_item->>'quantity')::integer;
      select * into v_menu
      from public.menu_items
      where id = (v_item->>'menu_item_id')::uuid
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
    where id = v_menu.id;

    insert into public.order_items(order_id, menu_item_id, menu_name, unit_price, quantity, subtotal)
    values (v_order.id, v_menu.id, v_menu.name, v_menu.price, v_quantity, v_menu.price * v_quantity);

    insert into public.inventory_adjustments(menu_item_id, quantity_change, reason, order_id)
    values (v_menu.id, -v_quantity, '주문 재고 예약', v_order.id);

    v_total := v_total + v_menu.price * v_quantity;
  end loop;

  update public.orders
  set total_amount = v_total, updated_at = clock_timestamp()
  where id = v_order.id
  returning * into v_order;

  insert into public.payments(order_id, amount)
  values (v_order.id, v_total);

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
  select * into v_order from public.orders where client_request_id = p_client_request_id;
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

revoke all on function private.create_festival_order_core(text, text, uuid, jsonb, text, integer, integer)
  from public, anon, authenticated;

-- Temporary backward-compatible entry point. A follow-up migration removes it
-- after the signed application version is live.
create or replace function public.create_festival_order(
  p_qr_token text,
  p_fulfillment_type text,
  p_client_request_id uuid,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_key text;
begin
  v_legacy_key := encode(
    extensions.digest(
      convert_to('legacy|' || coalesce(p_fulfillment_type, '') || '|' || coalesce(p_qr_token, 'TAKEOUT'), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  return private.create_festival_order_core(
    p_qr_token,
    p_fulfillment_type,
    p_client_request_id,
    p_items,
    v_legacy_key,
    case when p_fulfillment_type = 'TAKEOUT' then 30 else 12 end,
    case when p_fulfillment_type = 'TAKEOUT' then 30 else 12 end
  );
end;
$$;

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
begin
  perform private.verify_festival_signature(
    'order-v1|' || p_request_timestamp::text || '|' || p_client_request_id::text || '|' ||
    coalesce(p_fulfillment_type, '') || '|' || coalesce(p_qr_token, '') || '|' || coalesce(p_rate_key_hash, ''),
    p_request_timestamp,
    p_signature
  );
  return private.create_festival_order_core(
    p_qr_token,
    p_fulfillment_type,
    p_client_request_id,
    p_items,
    p_rate_key_hash,
    5,
    3
  );
end;
$$;

revoke all on function public.create_festival_order(text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_festival_order(text, text, uuid, jsonb, text, bigint, text) from public, anon, authenticated;
grant execute on function public.create_festival_order(text, text, uuid, jsonb) to anon, authenticated;
grant execute on function public.create_festival_order(text, text, uuid, jsonb, text, bigint, text) to anon, authenticated;

create or replace function public.mark_transfer_claimed(p_public_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments p
  set status = 'CUSTOMER_MARKED_TRANSFERRED',
      customer_claimed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  from public.orders o
  where p.order_id = o.id
    and o.public_token = p_public_token
    and p.status = 'UNPAID'
    and o.status = 'PENDING_PAYMENT'
    and (o.expires_at is null or o.expires_at > clock_timestamp());
  if not found then raise exception 'payment cannot be claimed'; end if;

  update public.orders
  set expires_at = null, updated_at = clock_timestamp()
  where public_token = p_public_token and status = 'PENDING_PAYMENT';
end;
$$;

revoke all on function public.mark_transfer_claimed(uuid) from public, anon, authenticated;
grant execute on function public.mark_transfer_claimed(uuid) to anon, authenticated;

create or replace function public.get_public_order(p_public_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_number', o.order_number,
    'fulfillment_type', o.fulfillment_type,
    'table_number', t.table_number,
    'total_amount', o.total_amount,
    'order_status', o.status,
    'payment_status', p.status,
    'created_at', o.created_at,
    'expires_at', o.expires_at,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', oi.menu_name,
        'quantity', oi.quantity,
        'subtotal', oi.subtotal
      )), '[]'::jsonb)
      from public.order_items oi
      where oi.order_id = o.id
    )
  )
  from public.orders o
  join public.payments p on p.order_id = o.id
  left join public.festival_tables t on t.id = o.table_id
  where o.public_token = p_public_token
$$;

revoke all on function public.get_public_order(uuid) from public, anon, authenticated;
grant execute on function public.get_public_order(uuid) to anon, authenticated;

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
    select o.id
    from public.orders o
    join public.payments p on p.order_id = o.id
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
      where order_id = v_order.id
      group by menu_item_id
    loop
      update public.menu_items
      set stock_quantity = stock_quantity + v_item.quantity,
          status = case when status = 'SOLD_OUT' then 'AVAILABLE' else status end,
          updated_at = clock_timestamp()
      where id = v_item.menu_item_id;

      insert into public.inventory_adjustments(
        menu_item_id,
        quantity_change,
        reason,
        order_id
      ) values (
        v_item.menu_item_id,
        v_item.quantity,
        '미입금 10분 자동 취소 재고 복구',
        v_order.id
      );
    end loop;

    update public.payments
    set status = 'REJECTED', updated_at = clock_timestamp()
    where order_id = v_order.id and status = 'UNPAID';

    update public.orders
    set status = 'CANCELLED',
        cancelled_at = clock_timestamp(),
        expires_at = null,
        updated_at = clock_timestamp()
    where id = v_order.id and status = 'PENDING_PAYMENT';

    insert into public.audit_logs(actor_id, entity_type, entity_id, action, previous_value, next_value)
    values (
      null,
      'ORDER',
      v_order.id,
      'AUTO_CANCEL_UNPAID',
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

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'festival-expire-unpaid-orders') then
    perform cron.unschedule('festival-expire-unpaid-orders');
  end if;
  perform cron.schedule(
    'festival-expire-unpaid-orders',
    '* * * * *',
    $cron$select private.expire_unpaid_festival_orders();$cron$
  );
end;
$$;

create or replace function public.get_admin_dashboard_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_festival_admin() then raise exception 'admin required'; end if;

  return jsonb_build_object(
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
            'menu_name', oi.menu_name,
            'quantity', oi.quantity
          ) order by oi.id), '[]'::jsonb)
          from public.order_items oi
          where oi.order_id = o.id
        )
      ) order by o.created_at desc), '[]'::jsonb)
      from (
        select * from public.orders order by created_at desc limit 200
      ) o
      left join public.festival_tables t on t.id = o.table_id
      join public.payments p on p.order_id = o.id
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
        join public.orders o on o.id = oi.order_id
        where oi.menu_item_id = m.id
      ) s on true
    ),
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'table_number', table_number,
        'qr_token', qr_token,
        'is_active', is_active
      ) order by table_number), '[]'::jsonb)
      from public.festival_tables
    ),
    'categories', (
      select coalesce(jsonb_agg(name order by sort_order, name), '[]'::jsonb)
      from public.menu_categories
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
      where singleton_key = true
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
        join public.orders o on o.id = p.order_id
        where p.status = 'CONFIRMED' and p.confirmed_at is not null
        group by (p.confirmed_at at time zone 'Asia/Seoul')::date
      ) sales
    ),
    'synced_at', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_admin_dashboard_snapshot() from public, anon, authenticated;
grant execute on function public.get_admin_dashboard_snapshot() to authenticated;
