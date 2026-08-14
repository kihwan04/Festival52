create or replace function public.festival_admin_setup_available()
returns boolean language sql stable security definer set search_path = public
as $$
  select not exists(select 1 from public.profiles)
$$;

create or replace function public.bootstrap_festival_admin(p_display_name text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if char_length(trim(p_display_name)) < 1 or char_length(trim(p_display_name)) > 60 then raise exception 'invalid display name'; end if;

  lock table public.profiles in exclusive mode;
  if exists(select 1 from public.profiles) then raise exception 'admin setup already completed'; end if;

  insert into public.profiles(id, role, display_name)
  values (auth.uid(), 'ADMIN', trim(p_display_name));
end; $$;

revoke all on function public.festival_admin_setup_available() from public, anon, authenticated;
revoke all on function public.bootstrap_festival_admin(text) from public, anon, authenticated;
grant execute on function public.festival_admin_setup_available() to anon, authenticated;
grant execute on function public.bootstrap_festival_admin(text) to authenticated;
