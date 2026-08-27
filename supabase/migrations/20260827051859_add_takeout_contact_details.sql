-- Store only the contact information needed to hand off takeout orders.
-- Historical takeout orders remain valid with both fields null. All new
-- takeout orders use the v3 signed RPC below, which requires both fields.

alter table public.orders
  add column if not exists customer_name text,
  add column if not exists customer_phone text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_takeout_contact_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_takeout_contact_check check (
        (customer_name is null and customer_phone is null)
        or (
          fulfillment_type = 'TAKEOUT'
          and customer_name = trim(customer_name)
          and char_length(customer_name) between 1 and 40
          and customer_name !~ '[|[:cntrl:]]'
          and customer_phone ~ '^01[016789][0-9]{7,8}$'
        )
      ) not valid;
  end if;
end
$$;

alter table public.orders validate constraint orders_takeout_contact_check;

-- PII is useful only until pickup. Clear it for every completion/cancellation
-- path, including automatic unpaid-order expiry.
create or replace function private.clear_finished_order_contact()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('SERVED', 'CANCELLED') then
    new.customer_name := null;
    new.customer_phone := null;
  end if;
  return new;
end;
$$;

revoke all on function private.clear_finished_order_contact() from public, anon, authenticated;

drop trigger if exists clear_finished_order_contact on public.orders;
create trigger clear_finished_order_contact
before insert or update of status on public.orders
for each row execute function private.clear_finished_order_contact();

-- The v3 signature binds the normalized name and phone number so a valid
-- signed request cannot be replayed with altered contact details.
create or replace function public.create_festival_order(
  p_team_slug text,
  p_qr_token text,
  p_fulfillment_type text,
  p_client_request_id uuid,
  p_items jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_rate_key_hash text,
  p_request_timestamp bigint,
  p_signature text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order public.orders%rowtype;
  v_customer_name text := nullif(trim(coalesce(p_customer_name, '')), '');
  v_customer_phone text := nullif(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g'), '');
begin
  if p_fulfillment_type = 'TAKEOUT' then
    if v_customer_name is null
       or char_length(v_customer_name) > 40
       or v_customer_name ~ '[|[:cntrl:]]'
       or v_customer_phone is null
       or v_customer_phone !~ '^01[016789][0-9]{7,8}$' then
      raise exception 'invalid takeout contact';
    end if;
  elsif p_fulfillment_type = 'DINE_IN' then
    if v_customer_name is not null or v_customer_phone is not null then
      raise exception 'contact is only allowed for takeout';
    end if;
  else
    raise exception 'invalid fulfillment type';
  end if;

  perform private.verify_festival_signature(
    'order-v3|' || p_request_timestamp::text || '|' || p_client_request_id::text || '|' ||
    coalesce(p_team_slug, '') || '|' || coalesce(p_fulfillment_type, '') || '|' ||
    coalesce(p_qr_token, '') || '|' || coalesce(v_customer_name, '') || '|' ||
    coalesce(v_customer_phone, '') || '|' || coalesce(p_rate_key_hash, ''),
    p_request_timestamp,
    p_signature
  );

  v_result := private.create_festival_order_core_v2(
    p_team_slug, p_qr_token, p_fulfillment_type, p_client_request_id, p_items,
    p_rate_key_hash, 5, 3
  );

  select * into v_order
  from public.orders
  where id = (v_result->>'order_id')::uuid
  for update;
  if not found or v_order.fulfillment_type <> p_fulfillment_type then
    raise exception 'order contact target mismatch';
  end if;

  if p_fulfillment_type = 'TAKEOUT' then
    if v_order.customer_name is null and v_order.customer_phone is null then
      update public.orders
      set customer_name = v_customer_name,
          customer_phone = v_customer_phone,
          updated_at = clock_timestamp()
      where id = v_order.id;
    elsif v_order.customer_name is distinct from v_customer_name
       or v_order.customer_phone is distinct from v_customer_phone then
      raise exception 'duplicate order contact mismatch';
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function public.create_festival_order(
  text, text, text, uuid, jsonb, text, text, text, bigint, text
) from public, anon, authenticated;
grant execute on function public.create_festival_order(
  text, text, text, uuid, jsonb, text, text, text, bigint, text
) to anon;

-- Keep the original snapshot during zero-downtime rollout. The v2 snapshot
-- enriches only the authenticated operator's existing tenant-filtered rows.
create or replace function public.get_admin_dashboard_snapshot_v2()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_snapshot jsonb;
  v_orders jsonb;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  v_snapshot := public.get_admin_dashboard_snapshot();

  select coalesce(jsonb_agg(
    entry || jsonb_build_object(
      'customer_name', o.customer_name,
      'customer_phone', o.customer_phone
    ) order by position
  ), '[]'::jsonb)
  into v_orders
  from jsonb_array_elements(v_snapshot->'orders') with ordinality as listed(entry, position)
  join public.orders o
    on o.id = (entry->>'id')::uuid
   and o.team_id = v_team_id;

  return jsonb_set(v_snapshot, '{orders}', v_orders, false);
end;
$$;

revoke all on function public.get_admin_dashboard_snapshot_v2() from public, anon, authenticated;
grant execute on function public.get_admin_dashboard_snapshot_v2() to authenticated;
