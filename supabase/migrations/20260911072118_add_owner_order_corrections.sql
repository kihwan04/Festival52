-- Owner-only manual sales. These are already-confirmed records and do not
-- affect menu inventory because they are not tied to a menu item.

alter table public.order_items alter column menu_item_id drop not null;

create or replace function public.is_festival_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.festival_team_members member
    where member.team_id = public.current_festival_team_id()
      and member.user_id = (select auth.uid())
      and member.role = 'OWNER'
  )
$$;

create or replace function public.owner_create_manual_order(
  p_label text,
  p_amount integer,
  p_fulfillment_type text default 'TAKEOUT',
  p_table_number integer default null,
  p_client_request_id uuid default extensions.gen_random_uuid()
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_table_id uuid;
  v_order_id uuid;
  v_order_number text;
begin
  if not public.is_festival_owner() or v_team_id is null then raise exception 'owner required'; end if;
  if char_length(trim(coalesce(p_label, ''))) not between 1 and 80 then raise exception 'invalid manual label'; end if;
  if p_amount not between 100 and 10000000 then raise exception 'invalid manual amount'; end if;
  if p_fulfillment_type not in ('DINE_IN', 'TAKEOUT') then raise exception 'invalid fulfillment type'; end if;

  if p_fulfillment_type = 'DINE_IN' then
    if p_table_number is null then raise exception 'table required'; end if;
    select id into v_table_id
    from public.festival_tables
    where team_id = v_team_id and table_number = p_table_number and is_active;
    if not found then raise exception 'invalid table'; end if;
  elsif p_table_number is not null then
    raise exception 'takeout cannot have table';
  end if;

  if p_client_request_id is null then raise exception 'request id required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_team_id::text || p_client_request_id::text, 0));
  select id into v_order_id from public.orders where team_id = v_team_id and client_request_id = p_client_request_id;
  if found then return v_order_id; end if;
  v_order_number := 'M' || lpad(nextval('public.festival_order_number_seq')::text, 3, '0');
  insert into public.orders(team_id, order_number, fulfillment_type, table_id, client_request_id, total_amount, status, created_at, updated_at)
  values (v_team_id, v_order_number, p_fulfillment_type, v_table_id, p_client_request_id, p_amount, 'SERVED', clock_timestamp(), clock_timestamp())
  returning id into v_order_id;

  insert into public.order_items(team_id, order_id, menu_item_id, menu_name, unit_price, quantity, subtotal, selected_options)
  values (v_team_id, v_order_id, null, trim(p_label), p_amount, 1, p_amount, '[]'::jsonb);

  insert into public.payments(team_id, order_id, method, amount, status, confirmed_at, confirmed_by)
  values (v_team_id, v_order_id, 'BANK_TRANSFER', p_amount, 'CONFIRMED', clock_timestamp(), (select auth.uid()));

  insert into public.audit_logs(team_id, actor_id, entity_type, entity_id, action, next_value)
  values (v_team_id, (select auth.uid()), 'ORDER', v_order_id, 'OWNER_MANUAL_ENTRY', jsonb_build_object('order_number', v_order_number, 'label', trim(p_label), 'amount', p_amount));
  return v_order_id;
end;
$$;

revoke all on function public.is_festival_owner() from public, anon, authenticated;
revoke all on function public.owner_create_manual_order(text, integer, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.is_festival_owner() to authenticated;
grant execute on function public.owner_create_manual_order(text, integer, text, integer, uuid) to authenticated;
