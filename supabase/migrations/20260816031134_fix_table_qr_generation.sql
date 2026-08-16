create or replace function public.configure_festival_tables(p_count integer)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_number integer;
begin
  if not public.is_festival_admin() then raise exception 'admin required'; end if;
  if p_count < 1 or p_count > 200 then raise exception 'table count out of range'; end if;

  for v_number in 1..p_count loop
    insert into public.festival_tables(table_number, qr_token, is_active)
    values (v_number, encode(extensions.gen_random_bytes(24), 'hex'), true)
    on conflict (table_number) do update set is_active = true, updated_at = now();
  end loop;

  update public.festival_tables
  set is_active = false, updated_at = now()
  where table_number > p_count and is_active = true;

  insert into public.audit_logs(actor_id, entity_type, entity_id, action, next_value)
  values (auth.uid(), 'FESTIVAL_TABLE', gen_random_uuid(), 'CONFIGURE_TABLE_COUNT', jsonb_build_object('count', p_count));

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'table_number', table_number,
      'qr_token', qr_token,
      'is_active', is_active
    ) order by table_number), '[]'::jsonb)
    from public.festival_tables
  );
end; $$;

create or replace function public.rotate_festival_table_qr(p_table_id uuid)
returns text language plpgsql security definer set search_path = public
as $$
declare v_token text;
begin
  if not public.is_festival_admin() then raise exception 'admin required'; end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  update public.festival_tables
  set qr_token = v_token, updated_at = now()
  where id = p_table_id
  returning qr_token into v_token;
  if not found then raise exception 'table not found'; end if;

  insert into public.audit_logs(actor_id, entity_type, entity_id, action, next_value)
  values (auth.uid(), 'FESTIVAL_TABLE', p_table_id, 'ROTATE_QR', jsonb_build_object('rotated', true));
  return v_token;
end; $$;

revoke all on function public.configure_festival_tables(integer) from public, anon, authenticated;
revoke all on function public.rotate_festival_table_qr(uuid) from public, anon, authenticated;
grant execute on function public.configure_festival_tables(integer) to authenticated;
grant execute on function public.rotate_festival_table_qr(uuid) to authenticated;
