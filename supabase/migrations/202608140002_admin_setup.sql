create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 30),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.menu_categories(name, sort_order)
select category, row_number() over (order by min(sort_order), category)::integer
from public.menu_items
where trim(category) <> ''
group by category
on conflict (name) do nothing;

alter table public.menu_categories enable row level security;

grant select, insert on public.menu_categories to authenticated;

drop policy if exists "admin manages categories" on public.menu_categories;
create policy "admin manages categories" on public.menu_categories
for all to authenticated
using (public.is_festival_admin())
with check (public.is_festival_admin());

create or replace function public.configure_festival_tables(p_count integer)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_number integer;
begin
  if not public.is_festival_admin() then raise exception 'admin required'; end if;
  if p_count < 1 or p_count > 200 then raise exception 'table count out of range'; end if;

  for v_number in 1..p_count loop
    insert into public.festival_tables(table_number, qr_token, is_active)
    values (v_number, encode(gen_random_bytes(24), 'hex'), true)
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
  v_token := encode(gen_random_bytes(24), 'hex');
  update public.festival_tables
  set qr_token = v_token, updated_at = now()
  where id = p_table_id
  returning qr_token into v_token;
  if not found then raise exception 'table not found'; end if;

  insert into public.audit_logs(actor_id, entity_type, entity_id, action, next_value)
  values (auth.uid(), 'FESTIVAL_TABLE', p_table_id, 'ROTATE_QR', jsonb_build_object('rotated', true));
  return v_token;
end; $$;

create or replace function public.rename_menu_category(p_previous_name text, p_next_name text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_festival_admin() then raise exception 'admin required'; end if;
  if char_length(trim(p_next_name)) < 1 or char_length(trim(p_next_name)) > 30 then raise exception 'invalid category'; end if;
  update public.menu_categories set name = trim(p_next_name), updated_at = now() where name = p_previous_name;
  if not found then raise exception 'category not found'; end if;
  update public.menu_items set category = trim(p_next_name), updated_at = now() where category = p_previous_name;
end; $$;

create or replace function public.delete_menu_category(p_name text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_festival_admin() then raise exception 'admin required'; end if;
  if exists(select 1 from public.menu_items where category = p_name and status <> 'ARCHIVED') then
    raise exception 'category is in use';
  end if;
  delete from public.menu_categories where name = p_name;
  if not found then raise exception 'category not found'; end if;
end; $$;

revoke all on function public.configure_festival_tables(integer) from public;
revoke all on function public.rotate_festival_table_qr(uuid) from public;
revoke all on function public.rename_menu_category(text, text) from public;
revoke all on function public.delete_menu_category(text) from public;
grant execute on function public.configure_festival_tables(integer) to authenticated;
grant execute on function public.rotate_festival_table_qr(uuid) to authenticated;
grant execute on function public.rename_menu_category(text, text) to authenticated;
grant execute on function public.delete_menu_category(text) to authenticated;

alter publication supabase_realtime add table public.festival_tables;
alter publication supabase_realtime add table public.menu_categories;
