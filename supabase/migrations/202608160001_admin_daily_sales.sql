create or replace function public.get_admin_sales_by_day()
returns table (
  sales_date date,
  total_revenue bigint,
  confirmed_orders bigint,
  dine_in_orders bigint,
  takeout_orders bigint,
  average_order_amount bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (p.confirmed_at at time zone 'Asia/Seoul')::date as sales_date,
    sum(o.total_amount)::bigint as total_revenue,
    count(*)::bigint as confirmed_orders,
    count(*) filter (where o.fulfillment_type = 'DINE_IN')::bigint as dine_in_orders,
    count(*) filter (where o.fulfillment_type = 'TAKEOUT')::bigint as takeout_orders,
    round(avg(o.total_amount))::bigint as average_order_amount
  from public.orders o
  join public.payments p on p.order_id = o.id
  where p.status = 'CONFIRMED'
    and p.confirmed_at is not null
    and o.status <> 'CANCELLED'
  group by (p.confirmed_at at time zone 'Asia/Seoul')::date
  order by sales_date desc;
$$;

revoke all on function public.get_admin_sales_by_day() from public, anon;
grant execute on function public.get_admin_sales_by_day() to authenticated;
