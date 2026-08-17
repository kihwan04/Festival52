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
    'table_daily_sales', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'sales_date', sales_date,
        'table_number', table_number,
        'ordered_amount', ordered_amount,
        'confirmed_amount', confirmed_amount,
        'order_count', order_count,
        'confirmed_orders', confirmed_orders
      ) order by sales_date desc, table_number), '[]'::jsonb)
      from (
        select
          coalesce(ordered.sales_date, confirmed.sales_date) as sales_date,
          t.table_number,
          coalesce(ordered.ordered_amount, 0)::bigint as ordered_amount,
          coalesce(confirmed.confirmed_amount, 0)::bigint as confirmed_amount,
          coalesce(ordered.order_count, 0)::bigint as order_count,
          coalesce(confirmed.confirmed_orders, 0)::bigint as confirmed_orders
        from (
          select
            (o.created_at at time zone 'Asia/Seoul')::date as sales_date,
            o.table_id,
            sum(o.total_amount)::bigint as ordered_amount,
            count(*)::bigint as order_count
          from public.orders o
          where o.team_id = v_team_id
            and o.fulfillment_type = 'DINE_IN'
            and o.table_id is not null
            and o.status <> 'CANCELLED'
          group by (o.created_at at time zone 'Asia/Seoul')::date, o.table_id
        ) ordered
        full outer join (
          select
            (p.confirmed_at at time zone 'Asia/Seoul')::date as sales_date,
            o.table_id,
            sum(p.amount)::bigint as confirmed_amount,
            count(*)::bigint as confirmed_orders
          from public.payments p
          join public.orders o on o.id = p.order_id and o.team_id = v_team_id
          where p.team_id = v_team_id
            and p.status = 'CONFIRMED'
            and p.confirmed_at is not null
            and o.fulfillment_type = 'DINE_IN'
            and o.table_id is not null
          group by (p.confirmed_at at time zone 'Asia/Seoul')::date, o.table_id
        ) confirmed
          on confirmed.sales_date = ordered.sales_date
          and confirmed.table_id = ordered.table_id
        join public.festival_tables t
          on t.id = coalesce(ordered.table_id, confirmed.table_id)
          and t.team_id = v_team_id
      ) table_sales
    ),
    'synced_at', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_admin_dashboard_snapshot() from public, anon, authenticated;
grant execute on function public.get_admin_dashboard_snapshot() to authenticated;
