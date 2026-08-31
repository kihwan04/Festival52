-- Web Push subscriptions are capability URLs. Keep them behind signed RPCs,
-- isolate every row by team and order, and delete them as soon as they are no
-- longer useful.

create table public.order_push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  team_id uuid not null,
  order_id uuid not null,
  endpoint text not null,
  endpoint_hash text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint order_push_subscriptions_team_order_fkey
    foreign key (team_id, order_id)
    references public.orders(team_id, id)
    on delete cascade,
  constraint order_push_subscriptions_endpoint_hash_check
    check (endpoint_hash ~ '^[a-f0-9]{64}$'),
  constraint order_push_subscriptions_endpoint_check
    check (
      char_length(endpoint) between 40 and 2048
      and endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
    ),
  constraint order_push_subscriptions_p256dh_check
    check (char_length(p256dh) between 80 and 160 and p256dh ~ '^[A-Za-z0-9_-]+$'),
  constraint order_push_subscriptions_auth_check
    check (char_length(auth) between 16 and 64 and auth ~ '^[A-Za-z0-9_-]+$'),
  constraint order_push_subscriptions_order_endpoint_key
    unique (team_id, order_id, endpoint_hash)
);

create index order_push_subscriptions_team_order_idx
  on public.order_push_subscriptions(team_id, order_id);

alter table public.order_push_subscriptions enable row level security;
revoke all on table public.order_push_subscriptions from public, anon, authenticated;

create or replace function public.register_order_push_subscription(
  p_public_token uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_rate_key_hash text,
  p_request_timestamp bigint,
  p_signature text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_endpoint text := trim(coalesce(p_endpoint, ''));
  v_endpoint_hash text;
  v_p256dh_hash text;
  v_auth_hash text;
begin
  if p_public_token is null
     or char_length(v_endpoint) not between 40 and 2048
     or v_endpoint !~ '^https://(fcm\.googleapis\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
     or p_p256dh is null
     or char_length(p_p256dh) not between 80 and 160
     or p_p256dh !~ '^[A-Za-z0-9_-]+$'
     or p_auth is null
     or char_length(p_auth) not between 16 and 64
     or p_auth !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'invalid push subscription';
  end if;

  v_endpoint_hash := encode(extensions.digest(convert_to(v_endpoint, 'UTF8'), 'sha256'), 'hex');
  v_p256dh_hash := encode(extensions.digest(convert_to(p_p256dh, 'UTF8'), 'sha256'), 'hex');
  v_auth_hash := encode(extensions.digest(convert_to(p_auth, 'UTF8'), 'sha256'), 'hex');

  perform private.verify_festival_signature(
    'push-subscribe-v1|' || p_request_timestamp::text || '|' || p_public_token::text || '|' ||
    v_endpoint_hash || '|' || v_p256dh_hash || '|' || v_auth_hash || '|' ||
    coalesce(p_rate_key_hash, ''),
    p_request_timestamp,
    p_signature
  );
  perform private.consume_festival_rate_limit('push-subscribe', p_rate_key_hash, 8, 60);

  select o.* into v_order
  from public.orders o
  join public.festival_teams team on team.id = o.team_id and team.is_active = true
  where o.public_token = p_public_token
  for update of o;

  if not found or v_order.status not in ('PENDING_PAYMENT', 'PAID', 'COOKING') then
    raise exception 'order no longer accepts push subscriptions';
  end if;

  delete from public.order_push_subscriptions
  where team_id = v_order.team_id
    and order_id = v_order.id
    and created_at < clock_timestamp() - interval '48 hours';

  if not exists (
    select 1
    from public.order_push_subscriptions
    where team_id = v_order.team_id
      and order_id = v_order.id
      and endpoint_hash = v_endpoint_hash
  ) and (
    select count(*)
    from public.order_push_subscriptions
    where team_id = v_order.team_id and order_id = v_order.id
  ) >= 5 then
    raise exception 'too many push subscriptions';
  end if;

  insert into public.order_push_subscriptions(
    team_id, order_id, endpoint, endpoint_hash, p256dh, auth
  ) values (
    v_order.team_id, v_order.id, v_endpoint, v_endpoint_hash, p_p256dh, p_auth
  )
  on conflict (team_id, order_id, endpoint_hash) do update
  set endpoint = excluded.endpoint,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      updated_at = clock_timestamp();
end;
$$;

create or replace function public.get_order_push_delivery_batch(p_order_id uuid)
returns table (
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  public_token uuid,
  order_number text,
  fulfillment_type text,
  stall_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if not exists (
    select 1 from public.orders
    where id = p_order_id and team_id = v_team_id and status = 'READY'
  ) then
    raise exception 'push target not ready';
  end if;

  return query
  select ps.id, ps.endpoint, ps.p256dh, ps.auth,
         o.public_token, o.order_number, o.fulfillment_type,
         coalesce(s.stall_name, team.team_name)
  from public.order_push_subscriptions ps
  join public.orders o on o.team_id = ps.team_id and o.id = ps.order_id
  join public.festival_teams team on team.id = o.team_id and team.is_active = true
  left join public.store_settings s on s.team_id = o.team_id and s.singleton_key = true
  where ps.team_id = v_team_id and ps.order_id = p_order_id
  order by ps.created_at
  limit 5;
end;
$$;

create or replace function public.finish_order_push_delivery(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_deleted integer;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if not exists (
    select 1 from public.orders where id = p_order_id and team_id = v_team_id
  ) then
    raise exception 'order not found';
  end if;

  delete from public.order_push_subscriptions
  where team_id = v_team_id and order_id = p_order_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function private.clear_terminal_order_push_subscriptions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('SERVED', 'CANCELLED') and old.status is distinct from new.status then
    delete from public.order_push_subscriptions
    where team_id = new.team_id and order_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists clear_terminal_order_push_subscriptions on public.orders;
create trigger clear_terminal_order_push_subscriptions
after update of status on public.orders
for each row execute function private.clear_terminal_order_push_subscriptions();

revoke all on function public.register_order_push_subscription(uuid, text, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.get_order_push_delivery_batch(uuid) from public, anon, authenticated;
revoke all on function public.finish_order_push_delivery(uuid) from public, anon, authenticated;
revoke all on function private.clear_terminal_order_push_subscriptions() from public, anon, authenticated;

grant execute on function public.register_order_push_subscription(uuid, text, text, text, text, bigint, text) to anon;
grant execute on function public.get_order_push_delivery_batch(uuid) to authenticated;
grant execute on function public.finish_order_push_delivery(uuid) to authenticated;
