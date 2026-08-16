-- Initial setup is complete. Remove self-service administrator creation so the
-- production UI and Data API expose existing-operator login only.
revoke all on function public.festival_admin_setup_available()
  from public, anon, authenticated;
revoke all on function public.bootstrap_festival_admin(text)
  from public, anon, authenticated;
drop function public.festival_admin_setup_available();
drop function public.bootstrap_festival_admin(text);

-- Public customer RPCs are invoked with the anonymous publishable role. The
-- authenticated role is reserved for explicitly audited administrator RPCs.
revoke execute on function public.resolve_festival_table(text) from authenticated;
revoke execute on function public.get_public_menu() from authenticated;
revoke execute on function public.get_public_store_settings() from authenticated;
revoke execute on function public.get_public_order(uuid) from authenticated;
revoke execute on function public.mark_transfer_claimed(uuid) from authenticated;
