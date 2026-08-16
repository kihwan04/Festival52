-- Supabase Auth is publicly reachable by design. Require a short-lived proof
-- signed by our server before the auth.users trigger provisions a team. This
-- keeps direct Auth API calls from bypassing password and signup-rate checks.

create or replace function private.handle_festival_operator_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_department text := trim(coalesce(new.raw_user_meta_data->>'festival_department_name', ''));
  v_team_name text := trim(coalesce(new.raw_user_meta_data->>'festival_team_name', ''));
  v_display_name text := trim(coalesce(new.raw_user_meta_data->>'festival_display_name', ''));
  v_signup_timestamp bigint;
  v_signup_signature text := coalesce(new.raw_user_meta_data->>'festival_signup_signature', '');
  v_slug text;
  v_team_id uuid;
begin
  if coalesce(new.raw_user_meta_data->>'festival_signup_version', '') <> '1'
     or char_length(v_department) not between 2 and 80
     or char_length(v_team_name) not between 2 and 80
     or char_length(v_display_name) not between 2 and 60
     or position('|' in v_department) > 0
     or position('|' in v_team_name) > 0
     or position('|' in v_display_name) > 0 then
    raise exception 'invalid festival signup metadata';
  end if;

  begin
    v_signup_timestamp := (new.raw_user_meta_data->>'festival_signup_timestamp')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid festival signup proof';
  end;

  perform private.verify_festival_signature(
    'signup-user-v1|' || v_signup_timestamp::text || '|' || lower(coalesce(new.email, '')) || '|' ||
    v_department || '|' || v_team_name || '|' || v_display_name,
    v_signup_timestamp,
    v_signup_signature
  );

  loop
    v_slug := 'team-' || encode(extensions.gen_random_bytes(8), 'hex');
    exit when not exists (select 1 from public.festival_teams where public_slug = v_slug);
  end loop;

  insert into public.festival_teams(public_slug, department_name, team_name)
  values (v_slug, v_department, v_team_name)
  returning id into v_team_id;

  insert into public.profiles(id, role, display_name, current_team_id)
  values (new.id, 'ADMIN', v_display_name, v_team_id);

  insert into public.festival_team_members(team_id, user_id, role)
  values (v_team_id, new.id, 'OWNER');

  insert into public.store_settings(
    team_id, singleton_key, stall_name, operating_hours, is_open, updated_by
  ) values (
    v_team_id, true, v_department, '17:00 — 23:30', false, new.id
  );

  insert into public.menu_categories(team_id, name, sort_order)
  values
    (v_team_id, '안주', 1),
    (v_team_id, '식사', 2),
    (v_team_id, '간식', 3),
    (v_team_id, '음료', 4);

  return new;
end;
$$;

revoke all on function private.handle_festival_operator_signup()
  from public, anon, authenticated;
