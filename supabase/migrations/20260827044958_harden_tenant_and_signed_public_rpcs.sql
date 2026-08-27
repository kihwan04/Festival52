-- Festival-day hardening.
--
-- 1. Make tenant ownership a database invariant instead of relying only on
--    application code and RLS.
-- 2. Require a live Supabase Auth session for every operator action so a
--    signed-out access token cannot keep using the administrator RPCs.
-- 3. Add server-signed replacements for every customer-facing RPC. The old
--    signatures remain temporarily for zero-downtime deployment and are
--    removed by the following migration after the application is published.

-- Bounds are duplicated in the API and the database. This keeps a compromised
-- or outdated client from creating values that can overflow totals or make the
-- festival dashboard unusable.
alter table public.festival_tables
  add constraint festival_tables_number_bounds_check
    check (table_number between 1 and 200) not valid,
  add constraint festival_tables_qr_token_format_check
    check (qr_token ~ '^[a-f0-9]{32,64}$') not valid;

alter table public.menu_items
  add constraint menu_items_price_bounds_check
    check (price between 0 and 10000000) not valid,
  add constraint menu_items_stock_bounds_check
    check (stock_quantity between 0 and 100000) not valid,
  add constraint menu_items_description_bounds_check
    check (char_length(description) <= 500) not valid,
  add constraint menu_items_image_url_bounds_check
    check (image_url is null or (char_length(image_url) <= 2048 and image_url ~ '^https://')) not valid;

alter table public.orders
  add constraint orders_total_bounds_check
    check (total_amount between 0 and 200000000) not valid,
  add constraint orders_submission_hash_format_check
    check (submission_key_hash is null or submission_key_hash ~ '^[a-f0-9]{64}$') not valid,
  add constraint orders_cancelled_state_check
    check ((status = 'CANCELLED') = (cancelled_at is not null)) not valid;

alter table public.order_items
  add constraint order_items_name_bounds_check
    check (char_length(menu_name) between 1 and 80) not valid,
  add constraint order_items_price_bounds_check
    check (unit_price between 0 and 10000000) not valid,
  add constraint order_items_quantity_bounds_check
    check (quantity between 1 and 10) not valid;

alter table public.payments
  add constraint payments_amount_bounds_check
    check (amount between 0 and 200000000) not valid,
  add constraint payments_confirmation_state_check
    check (
      (status = 'CONFIRMED' and confirmed_at is not null and confirmed_by is not null)
      or (status <> 'CONFIRMED' and confirmed_at is null and confirmed_by is null)
    ) not valid;

alter table public.inventory_adjustments
  add constraint inventory_adjustments_quantity_bounds_check
    check (quantity_change between -100000 and 100000 and quantity_change <> 0) not valid,
  add constraint inventory_adjustments_reason_trimmed_check
    check (reason = trim(reason) and char_length(reason) between 2 and 240) not valid;

alter table public.audit_logs
  add constraint audit_logs_entity_type_bounds_check
    check (char_length(entity_type) between 1 and 60) not valid,
  add constraint audit_logs_action_bounds_check
    check (char_length(action) between 1 and 60) not valid,
  add constraint audit_logs_payload_bounds_check
    check (
      coalesce(pg_column_size(previous_value), 0) <= 65536
      and coalesce(pg_column_size(next_value), 0) <= 65536
    ) not valid;

-- Composite unique keys are intentionally explicit. They allow every child
-- row to reference both the record id and its team id, preventing an accidental
-- or malicious cross-team relation even from privileged database code.
alter table public.festival_tables
  add constraint festival_tables_team_id_id_key unique (team_id, id);
alter table public.menu_items
  add constraint menu_items_team_id_id_key unique (team_id, id);
alter table public.orders
  add constraint orders_team_id_id_key unique (team_id, id);

alter table public.profiles
  add constraint profiles_current_team_membership_fkey
  foreign key (current_team_id, id)
  references public.festival_team_members(team_id, user_id)
  deferrable initially deferred not valid;

alter table public.orders
  add constraint orders_team_table_fkey
  foreign key (team_id, table_id)
  references public.festival_tables(team_id, id)
  on delete restrict not valid;

alter table public.menu_items
  add constraint menu_items_team_category_fkey
  foreign key (team_id, category)
  references public.menu_categories(team_id, name)
  on update cascade on delete restrict not valid;

alter table public.order_items
  add constraint order_items_team_order_fkey
  foreign key (team_id, order_id)
  references public.orders(team_id, id)
  on delete restrict not valid,
  add constraint order_items_team_menu_fkey
  foreign key (team_id, menu_item_id)
  references public.menu_items(team_id, id)
  on delete restrict not valid;

alter table public.payments
  add constraint payments_team_order_fkey
  foreign key (team_id, order_id)
  references public.orders(team_id, id)
  on delete restrict not valid,
  add constraint payments_team_confirmer_fkey
  foreign key (team_id, confirmed_by)
  references public.festival_team_members(team_id, user_id)
  on delete restrict not valid;

alter table public.inventory_adjustments
  add constraint inventory_adjustments_team_menu_fkey
  foreign key (team_id, menu_item_id)
  references public.menu_items(team_id, id)
  on delete restrict not valid,
  add constraint inventory_adjustments_team_order_fkey
  foreign key (team_id, order_id)
  references public.orders(team_id, id)
  on delete restrict not valid,
  add constraint inventory_adjustments_team_admin_fkey
  foreign key (team_id, admin_id)
  references public.festival_team_members(team_id, user_id)
  on delete restrict not valid;

alter table public.audit_logs
  add constraint audit_logs_team_actor_fkey
  foreign key (team_id, actor_id)
  references public.festival_team_members(team_id, user_id)
  on delete restrict not valid;

alter table public.store_settings
  add constraint store_settings_team_updater_fkey
  foreign key (team_id, updated_by)
  references public.festival_team_members(team_id, user_id)
  on delete restrict not valid;

alter table public.festival_tables validate constraint festival_tables_number_bounds_check;
alter table public.festival_tables validate constraint festival_tables_qr_token_format_check;
alter table public.menu_items validate constraint menu_items_price_bounds_check;
alter table public.menu_items validate constraint menu_items_stock_bounds_check;
alter table public.menu_items validate constraint menu_items_description_bounds_check;
alter table public.menu_items validate constraint menu_items_image_url_bounds_check;
alter table public.orders validate constraint orders_total_bounds_check;
alter table public.orders validate constraint orders_submission_hash_format_check;
alter table public.orders validate constraint orders_cancelled_state_check;
alter table public.order_items validate constraint order_items_name_bounds_check;
alter table public.order_items validate constraint order_items_price_bounds_check;
alter table public.order_items validate constraint order_items_quantity_bounds_check;
alter table public.payments validate constraint payments_amount_bounds_check;
alter table public.payments validate constraint payments_confirmation_state_check;
alter table public.inventory_adjustments validate constraint inventory_adjustments_quantity_bounds_check;
alter table public.inventory_adjustments validate constraint inventory_adjustments_reason_trimmed_check;
alter table public.audit_logs validate constraint audit_logs_entity_type_bounds_check;
alter table public.audit_logs validate constraint audit_logs_action_bounds_check;
alter table public.audit_logs validate constraint audit_logs_payload_bounds_check;
alter table public.profiles validate constraint profiles_current_team_membership_fkey;
alter table public.orders validate constraint orders_team_table_fkey;
alter table public.menu_items validate constraint menu_items_team_category_fkey;
alter table public.order_items validate constraint order_items_team_order_fkey;
alter table public.order_items validate constraint order_items_team_menu_fkey;
alter table public.payments validate constraint payments_team_order_fkey;
alter table public.payments validate constraint payments_team_confirmer_fkey;
alter table public.inventory_adjustments validate constraint inventory_adjustments_team_menu_fkey;
alter table public.inventory_adjustments validate constraint inventory_adjustments_team_order_fkey;
alter table public.inventory_adjustments validate constraint inventory_adjustments_team_admin_fkey;
alter table public.audit_logs validate constraint audit_logs_team_actor_fkey;
alter table public.store_settings validate constraint store_settings_team_updater_fkey;

create or replace function public.current_festival_team_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.current_team_id
  from public.profiles p
  join public.festival_teams team on team.id = p.current_team_id
  where p.id = (select auth.uid())
    and team.is_active = true
    and exists (
      select 1
      from public.festival_team_members tm
      where tm.team_id = p.current_team_id
        and tm.user_id = p.id
        and tm.role in ('OWNER', 'STAFF')
    )
    and exists (
      select 1
      from auth.sessions session
      where session.id = nullif((select auth.jwt()->>'session_id'), '')::uuid
        and session.user_id = p.id
        and (session.not_after is null or session.not_after > clock_timestamp())
    )
$$;

revoke all on function public.current_festival_team_id() from public, anon, authenticated;
grant execute on function public.current_festival_team_id() to authenticated;

create or replace function public.resolve_festival_table(
  p_qr_token text,
  p_request_timestamp bigint,
  p_signature text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.verify_festival_signature(
    'resolve-table-v1|' || p_request_timestamp::text || '|' || coalesce(p_qr_token, ''),
    p_request_timestamp,
    p_signature
  );
  return (
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
      and p_qr_token ~ '^[a-f0-9]{32,64}$'
  );
end;
$$;

create or replace function public.get_public_menu(
  p_team_slug text,
  p_request_timestamp bigint,
  p_signature text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.verify_festival_signature(
    'public-menu-v1|' || p_request_timestamp::text || '|' || coalesce(p_team_slug, ''),
    p_request_timestamp,
    p_signature
  );
  return (
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
  );
end;
$$;

create or replace function public.get_public_menu(
  p_request_timestamp bigint,
  p_signature text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_team_slug text;
begin
  perform private.verify_festival_signature(
    'public-menu-legacy-v1|' || p_request_timestamp::text,
    p_request_timestamp,
    p_signature
  );
  select public_slug into v_team_slug
  from public.festival_teams
  where is_legacy = true and is_active = true;
  return (
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
    where team.public_slug = v_team_slug
      and team.is_active = true
      and m.status in ('AVAILABLE', 'SOLD_OUT')
  );
end;
$$;

create or replace function public.get_public_store_settings(
  p_team_slug text,
  p_request_timestamp bigint,
  p_signature text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.verify_festival_signature(
    'public-settings-v1|' || p_request_timestamp::text || '|' || coalesce(p_team_slug, ''),
    p_request_timestamp,
    p_signature
  );
  return (
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
  );
end;
$$;

create or replace function public.get_public_store_settings(
  p_request_timestamp bigint,
  p_signature text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_team_slug text;
begin
  perform private.verify_festival_signature(
    'public-settings-legacy-v1|' || p_request_timestamp::text,
    p_request_timestamp,
    p_signature
  );
  select public_slug into v_team_slug
  from public.festival_teams
  where is_legacy = true and is_active = true;
  return (
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
    where team.public_slug = v_team_slug
      and team.is_active = true
      and s.singleton_key = true
  );
end;
$$;

create or replace function public.get_legacy_festival_team_slug(
  p_request_timestamp bigint,
  p_signature text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.verify_festival_signature(
    'legacy-team-v1|' || p_request_timestamp::text,
    p_request_timestamp,
    p_signature
  );
  return (
    select public_slug
    from public.festival_teams
    where is_legacy = true and is_active = true
  );
end;
$$;

create or replace function public.get_public_order(
  p_public_token uuid,
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
    'public-order-v1|' || p_request_timestamp::text || '|' || p_public_token::text || '|' || coalesce(p_rate_key_hash, ''),
    p_request_timestamp,
    p_signature
  );
  perform private.consume_festival_rate_limit('public-order', p_rate_key_hash, 60, 60);
  return (
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
        ) order by oi.id), '[]'::jsonb)
        from public.order_items oi
        where oi.team_id = o.team_id and oi.order_id = o.id
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

create or replace function public.mark_transfer_claimed(
  p_public_token uuid,
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
    'transfer-v1|' || p_request_timestamp::text || '|' || p_public_token::text || '|' || coalesce(p_rate_key_hash, ''),
    p_request_timestamp,
    p_signature
  );
  perform private.consume_festival_rate_limit('transfer-claim', p_rate_key_hash, 10, 60);

  if exists (
    select 1
    from public.orders o
    join public.payments p on p.team_id = o.team_id and p.order_id = o.id
    join public.festival_teams team on team.id = o.team_id and team.is_active = true
    where o.public_token = p_public_token
      and o.status = 'PENDING_PAYMENT'
      and p.status = 'CUSTOMER_MARKED_TRANSFERRED'
  ) then
    return;
  end if;

  update public.payments p
  set status = 'CUSTOMER_MARKED_TRANSFERRED',
      customer_claimed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  from public.orders o, public.festival_teams team
  where p.team_id = o.team_id
    and p.order_id = o.id
    and team.id = o.team_id
    and team.is_active = true
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

revoke all on function public.resolve_festival_table(text, bigint, text) from public, anon, authenticated;
revoke all on function public.get_public_menu(text, bigint, text) from public, anon, authenticated;
revoke all on function public.get_public_menu(bigint, text) from public, anon, authenticated;
revoke all on function public.get_public_store_settings(text, bigint, text) from public, anon, authenticated;
revoke all on function public.get_public_store_settings(bigint, text) from public, anon, authenticated;
revoke all on function public.get_legacy_festival_team_slug(bigint, text) from public, anon, authenticated;
revoke all on function public.get_public_order(uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.mark_transfer_claimed(uuid, text, bigint, text) from public, anon, authenticated;

grant execute on function public.resolve_festival_table(text, bigint, text) to anon;
grant execute on function public.get_public_menu(text, bigint, text) to anon;
grant execute on function public.get_public_menu(bigint, text) to anon;
grant execute on function public.get_public_store_settings(text, bigint, text) to anon;
grant execute on function public.get_public_store_settings(bigint, text) to anon;
grant execute on function public.get_legacy_festival_team_slug(bigint, text) to anon;
grant execute on function public.get_public_order(uuid, text, bigint, text) to anon;
grant execute on function public.mark_transfer_claimed(uuid, text, bigint, text) to anon;

-- Preserve deny-by-default behavior for every future object in the exposed
-- schema. Explicit grants above are the complete browser/API surface.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
