-- Manual TABLE BATTLE controls. Operators decide when the registration and
-- each round begin; every approval still rechecks the table's confirmed
-- DINE_IN payment amount in the database.

update public.game_events
set minimum_order_amount = 10000, updated_at = clock_timestamp()
where status not in ('FINISHED', 'CANCELLED') and minimum_order_amount < 10000;

create or replace function public.create_table_battle_event(
  p_title text, p_business_date date, p_scheduled_at timestamptz, p_registration_opens_at timestamptz,
  p_registration_closes_at timestamptz, p_minimum_order_amount integer default 10000,
  p_minimum_participants integer default 2, p_reward_name text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_team_id uuid := public.current_festival_team_id(); v_event_id uuid;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 80 or p_minimum_participants not between 2 and 100 then raise exception 'invalid event'; end if;
  insert into public.game_events(team_id, title, business_date, scheduled_at, registration_opens_at, registration_closes_at, minimum_order_amount, minimum_participants, reward_name, created_by)
  values (v_team_id, trim(p_title), p_business_date, p_scheduled_at, p_registration_opens_at, p_registration_closes_at, greatest(10000, coalesce(p_minimum_order_amount, 10000)), p_minimum_participants, nullif(trim(coalesce(p_reward_name, '')), ''), (select auth.uid())) returning id into v_event_id;
  return v_event_id;
end;
$$;

create or replace function public.create_table_battle_event_now(p_title text default 'TABLE BATTLE', p_reward_name text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_event_id uuid;
begin
  v_event_id := public.create_table_battle_event(
    coalesce(nullif(trim(p_title), ''), 'TABLE BATTLE'),
    (clock_timestamp() at time zone 'Asia/Seoul')::date, clock_timestamp(), clock_timestamp(), null,
    10000, 2, p_reward_name
  );
  update public.game_events
  set status = 'REGISTRATION_OPEN', registration_opens_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_event_id;
  return v_event_id;
end;
$$;

create or replace function public.get_admin_table_battle_state()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_team_id uuid := public.current_festival_team_id(); v_event public.game_events%rowtype;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  select * into v_event from public.game_events
  where team_id = v_team_id
  order by case when status in ('REGISTRATION_OPEN', 'REGISTRATION_LOCKED', 'READY', 'WORD_QUIZ', 'FLOOR_GAME', 'BOMB_GAME') then 0 when status = 'SCHEDULED' then 1 else 2 end,
    business_date desc, created_at desc
  limit 1;
  if not found then return jsonb_build_object('event', null, 'participants', '[]'::jsonb); end if;
  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id, 'title', v_event.title, 'status', v_event.status, 'reward_name', v_event.reward_name, 'winner_table_id', v_event.winner_table_id,
      'minimum_order_amount', greatest(10000, v_event.minimum_order_amount),
      'round_count', (select count(*) from public.game_rounds where event_id = v_event.id),
      'last_round_type', (select type from public.game_rounds where event_id = v_event.id order by sequence desc limit 1)
    ),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', participant.id, 'table_number', table_row.table_number, 'team_name', participant.team_name, 'status', participant.status, 'word_score', participant.word_score,
        'eligible_amount', private.table_battle_eligible_amount(v_team_id, participant.table_id, v_event.business_date)
      ) order by table_row.table_number)
      from public.game_participants participant
      join public.festival_tables table_row on table_row.id = participant.table_id
      where participant.event_id = v_event.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_table_battle_event(text, date, timestamptz, timestamptz, timestamptz, integer, integer, text) from public, anon, authenticated;
revoke all on function public.create_table_battle_event_now(text, text) from public, anon, authenticated;
revoke all on function public.review_table_battle_participant(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_table_battle_registration_status(uuid, text) from public, anon, authenticated;
revoke all on function public.start_table_battle_round(uuid, text, text, text, jsonb, jsonb, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.get_admin_table_battle_state() from public, anon, authenticated;
grant execute on function public.create_table_battle_event_now(text, text) to authenticated;
grant execute on function public.review_table_battle_participant(uuid, uuid, text) to authenticated;
grant execute on function public.set_table_battle_registration_status(uuid, text) to authenticated;
grant execute on function public.start_table_battle_round(uuid, text, text, text, jsonb, jsonb, integer, integer, integer) to authenticated;
grant execute on function public.get_admin_table_battle_state() to authenticated;
