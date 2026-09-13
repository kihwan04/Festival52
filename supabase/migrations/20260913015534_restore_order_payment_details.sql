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
      'payment_details', (select jsonb_build_object('bank_name', s.bank_name, 'account_number', s.account_number, 'account_holder', s.account_holder) from public.store_settings s where s.team_id = o.team_id),
      'menu_path', case when t.is_active then '/t/' || t.qr_token else '/s/' || team.public_slug end,
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
