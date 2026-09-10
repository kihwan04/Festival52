-- TABLE BATTLE finale invariants.
-- Every state transition holds the event row lock, so concurrent taps cannot
-- create two winners, pass an expired bomb, or eliminate every participant.

create or replace function private.finish_table_battle_if_last(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.game_events%rowtype;
  v_winner public.game_participants%rowtype;
  v_survivors integer;
begin
  select * into v_event from public.game_events where id = p_event_id for update;
  if not found or v_event.status in ('FINISHED', 'CANCELLED') then return; end if;
  select count(*) into v_survivors from public.game_participants
  where event_id = p_event_id and status = 'APPROVED';
  if v_survivors <> 1 then return; end if;

  select * into v_winner from public.game_participants
  where event_id = p_event_id and status = 'APPROVED' for update;
  update public.game_rounds set status = 'FINISHED', ended_at = clock_timestamp()
  where event_id = p_event_id and status = 'ACTIVE';
  update public.game_participants set status = 'WINNER', updated_at = clock_timestamp()
  where id = v_winner.id;
  insert into public.game_rewards(event_id, team_id, winner_table_id, reward_name)
  values (p_event_id, v_event.team_id, v_winner.table_id, coalesce(v_event.reward_name, '운영 부스에서 상품 확인'))
  on conflict (event_id, winner_table_id) do nothing;
  update public.game_events
  set status = 'FINISHED', winner_table_id = v_winner.table_id,
    finished_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_event_id;
end;
$$;

-- A missed floor deadline may eliminate non-responders, but preserves at
-- least one table. This prevents an all-eliminated event from ever occurring.
create or replace function private.advance_table_battle_lucky_floor(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.game_events%rowtype;
  v_round public.game_rounds%rowtype;
  v_alive integer;
  v_missing integer;
  v_eliminate integer;
begin
  select * into v_event from public.game_events where id = p_event_id for update;
  if not found or v_event.status <> 'FLOOR_GAME' then return; end if;
  select * into v_round from public.game_rounds
  where event_id = p_event_id and type = 'FLOOR_GAME' and status = 'ACTIVE' for update;
  if not found or v_round.floor_selection_ends_at is null or v_round.floor_selection_ends_at > clock_timestamp() then return; end if;

  select count(*) into v_alive from public.game_participants
  where event_id = p_event_id and status = 'APPROVED';
  select count(*) into v_missing from public.game_participants participant
  where participant.event_id = p_event_id and participant.status = 'APPROVED'
    and not exists (select 1 from public.floor_choices choice_row where choice_row.round_id = v_round.id and choice_row.participant_id = participant.id);
  v_eliminate := least(v_missing, greatest(v_alive - 1, 0));
  if v_eliminate > 0 then
    with missing as (
      select participant.id, row_number() over (order by participant.requested_at, participant.id) as position
      from public.game_participants participant
      where participant.event_id = p_event_id and participant.status = 'APPROVED'
        and not exists (select 1 from public.floor_choices choice_row where choice_row.round_id = v_round.id and choice_row.participant_id = participant.id)
    )
    update public.game_participants participant
    set status = 'ELIMINATED', eliminated_round = v_round.sequence, updated_at = clock_timestamp()
    where participant.id in (select id from missing where position <= v_eliminate);
  end if;
  update public.game_rounds set status = 'FINISHED', ended_at = clock_timestamp() where id = v_round.id;
  update public.game_events set status = 'READY', updated_at = clock_timestamp() where id = p_event_id;
  perform private.finish_table_battle_if_last(p_event_id);
end;
$$;

create or replace function public.choose_table_battle_floor_tile(
  p_qr_token text, p_tile_x integer, p_tile_y integer, p_rate_key_hash text, p_request_timestamp bigint, p_signature text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_event public.game_events%rowtype;
  v_participant public.game_participants%rowtype;
  v_round public.game_rounds%rowtype;
  v_safe boolean;
  v_alive integer;
begin
  perform private.verify_table_battle_request('floor', p_qr_token, p_rate_key_hash, p_request_timestamp, p_signature);
  select * into v_context from private.table_battle_context(p_qr_token);
  select * into v_event from public.game_events where team_id = v_context.team_id and status = 'FLOOR_GAME' for update;
  if not found then return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number); end if;
  select * into v_round from public.game_rounds where event_id = v_event.id and type = 'FLOOR_GAME' and status = 'ACTIVE' for update;
  if not found then return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number); end if;
  if v_round.floor_selection_ends_at is null or v_round.floor_selection_ends_at <= clock_timestamp() then
    perform private.advance_table_battle_lucky_floor(v_event.id);
    return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number);
  end if;
  select * into v_participant from public.game_participants where event_id = v_event.id and table_id = v_context.table_id for update;
  if not found or v_participant.status <> 'APPROVED' then raise exception 'participant cannot choose floor'; end if;
  if exists (select 1 from public.floor_choices where round_id = v_round.id and participant_id = v_participant.id) then raise exception 'floor already selected'; end if;
  if p_tile_x not between 0 and 2 or p_tile_y not between 0 and 2 then raise exception 'invalid floor tile'; end if;
  select count(*) into v_alive from public.game_participants where event_id = v_event.id and status = 'APPROVED';
  -- Once only one participant remains, a mine is converted to a safe step.
  -- This preserves the immediate-explosion rule for every contested choice
  -- while guaranteeing a final champion.
  if v_alive <= 1 then
    v_safe := true;
  else
    begin v_safe := (v_round.floor_map -> p_tile_y ->> p_tile_x)::boolean; exception when others then v_safe := null; end;
  end if;
  if v_safe is null then raise exception 'invalid floor tile'; end if;
  insert into public.floor_choices(event_id, round_id, participant_id, tile_x, tile_y, is_safe)
  values (v_event.id, v_round.id, v_participant.id, p_tile_x, p_tile_y, v_safe);
  if not v_safe then
    update public.game_participants set status = 'ELIMINATED', eliminated_round = v_round.sequence, updated_at = clock_timestamp()
    where id = v_participant.id;
    select count(*) into v_alive from public.game_participants where event_id = v_event.id and status = 'APPROVED';
    if v_alive <= 1 then
      update public.game_rounds set status = 'FINISHED', ended_at = clock_timestamp() where id = v_round.id;
      update public.game_events set status = 'READY', updated_at = clock_timestamp() where id = v_event.id;
      perform private.finish_table_battle_if_last(v_event.id);
    end if;
  end if;
  return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number);
end;
$$;

-- Recheck the expiry under the same event lock used for the transfer. A late
-- tap therefore resolves the explosion instead of passing an already-expired
-- bomb, and versioning still rejects duplicated/concurrent passes.
create or replace function public.transfer_table_battle_bomb(
  p_qr_token text, p_target_table_number integer, p_expected_version integer, p_rate_key_hash text, p_request_timestamp bigint, p_signature text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_event public.game_events%rowtype;
  v_source public.game_participants%rowtype;
  v_target public.game_participants%rowtype;
  v_bomb public.bomb_states%rowtype;
begin
  perform private.verify_table_battle_request('bomb', p_qr_token, p_rate_key_hash, p_request_timestamp, p_signature);
  select * into v_context from private.table_battle_context(p_qr_token);
  select * into v_event from public.game_events where team_id = v_context.team_id and status = 'BOMB_GAME' for update;
  if not found then return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number); end if;
  select * into v_bomb from public.bomb_states where event_id = v_event.id for update;
  if not found then raise exception 'bomb state is unavailable'; end if;
  if v_bomb.explodes_at <= clock_timestamp() then
    perform private.advance_table_battle_bomb(v_event.id);
    return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number);
  end if;
  select * into v_source from public.game_participants where event_id = v_event.id and table_id = v_context.table_id for update;
  if not found or v_source.status <> 'APPROVED' then raise exception 'participant cannot transfer bomb'; end if;
  if v_bomb.owner_participant_id <> v_source.id or v_bomb.version <> p_expected_version then raise exception 'bomb version changed'; end if;
  select participant.* into v_target from public.game_participants participant
  join public.festival_tables table_row on table_row.id = participant.table_id
  where participant.event_id = v_event.id and participant.status = 'APPROVED'
    and table_row.team_id = v_context.team_id and table_row.table_number = p_target_table_number for update;
  if not found or v_target.id = v_source.id then raise exception 'invalid bomb target'; end if;
  insert into public.bomb_transfers(event_id, team_id, source_participant_id, target_participant_id, version)
  values (v_event.id, v_context.team_id, v_source.id, v_target.id, v_bomb.version + 1);
  update public.bomb_states set owner_participant_id = v_target.id, version = version + 1, updated_at = clock_timestamp()
  where event_id = v_event.id;
  return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number);
end;
$$;

create or replace function private.advance_table_battle_bomb(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.game_events%rowtype;
  v_bomb public.bomb_states%rowtype;
  v_loser public.game_participants%rowtype;
  v_next_owner uuid;
  v_survivors integer;
begin
  select * into v_event from public.game_events where id = p_event_id for update;
  if not found or v_event.status <> 'BOMB_GAME' then return; end if;
  select * into v_bomb from public.bomb_states where event_id = p_event_id for update;
  if not found or v_bomb.explodes_at > clock_timestamp() then return; end if;
  select * into v_loser from public.game_participants where id = v_bomb.owner_participant_id for update;
  if v_loser.status = 'APPROVED' then
    update public.game_participants
    set status = 'ELIMINATED', eliminated_round = coalesce((select sequence from public.game_rounds where event_id = p_event_id and status = 'ACTIVE'), 0), updated_at = clock_timestamp()
    where id = v_loser.id;
  end if;
  select count(*) into v_survivors from public.game_participants where event_id = p_event_id and status = 'APPROVED';
  if v_survivors = 1 then
    update public.game_events set status = 'READY', updated_at = clock_timestamp() where id = p_event_id;
    perform private.finish_table_battle_if_last(p_event_id);
    return;
  elsif v_survivors = 0 then
    -- Defensive close: a corrupted legacy event never leaves a live bomb.
    update public.game_rounds set status = 'FINISHED', ended_at = clock_timestamp() where event_id = p_event_id and status = 'ACTIVE';
    update public.game_events set status = 'FINISHED', finished_at = clock_timestamp(), updated_at = clock_timestamp() where id = p_event_id;
    return;
  end if;
  select id into v_next_owner from public.game_participants where event_id = p_event_id and status = 'APPROVED' order by random() limit 1;
  update public.bomb_states
  set owner_participant_id = v_next_owner, version = version + 1,
    explodes_at = clock_timestamp() + make_interval(secs => 5 + floor(random() * 8)::integer), updated_at = clock_timestamp()
  where event_id = p_event_id;
end;
$$;

create function public.get_admin_table_battle_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_event public.game_events%rowtype;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  select * into v_event from public.game_events
  where team_id = v_team_id
  order by case when status in ('REGISTRATION_OPEN', 'REGISTRATION_LOCKED', 'READY', 'WORD_QUIZ', 'FLOOR_GAME', 'BOMB_GAME') then 0 when status = 'SCHEDULED' then 1 else 2 end,
    business_date desc, created_at desc
  limit 1;
  if not found then return jsonb_build_object('event', null, 'participants', '[]'::jsonb); end if;
  return jsonb_build_object(
    'event', jsonb_build_object('id', v_event.id, 'title', v_event.title, 'status', v_event.status, 'reward_name', v_event.reward_name, 'winner_table_id', v_event.winner_table_id),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('id', participant.id, 'table_number', table_row.table_number, 'team_name', participant.team_name, 'status', participant.status, 'word_score', participant.word_score) order by table_row.table_number)
      from public.game_participants participant
      join public.festival_tables table_row on table_row.id = participant.table_id
      where participant.event_id = v_event.id
    ), '[]'::jsonb)
  );
end;
$$;

-- The operator can settle the prize from their own authenticated account.
-- The event lock and unique winner table prevent a split or overwritten win.
create function public.select_table_battle_winner(p_event_id uuid, p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_event public.game_events%rowtype;
  v_winner public.game_participants%rowtype;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  select * into v_event from public.game_events where id = p_event_id and team_id = v_team_id for update;
  if not found or v_event.status in ('FINISHED', 'CANCELLED') then raise exception 'game event cannot select winner'; end if;
  select * into v_winner from public.game_participants
  where id = p_participant_id and event_id = v_event.id and status in ('APPROVED', 'ELIMINATED', 'WINNER') for update;
  if not found then raise exception 'winner must be a game participant'; end if;
  update public.game_rounds set status = 'FINISHED', ended_at = clock_timestamp()
  where event_id = v_event.id and status = 'ACTIVE';
  update public.game_participants
  set status = case when id = v_winner.id then 'WINNER' when status = 'APPROVED' then 'ELIMINATED' else status end,
    updated_at = clock_timestamp()
  where event_id = v_event.id;
  insert into public.game_rewards(event_id, team_id, winner_table_id, reward_name)
  values (v_event.id, v_team_id, v_winner.table_id, coalesce(v_event.reward_name, '운영 부스에서 상품 확인'))
  on conflict (event_id, winner_table_id) do nothing;
  update public.game_events
  set status = 'FINISHED', winner_table_id = v_winner.table_id, finished_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_event.id;
end;
$$;

revoke all on function private.finish_table_battle_if_last(uuid) from public, anon, authenticated;
revoke all on function private.advance_table_battle_lucky_floor(uuid) from public, anon, authenticated;
revoke all on function private.advance_table_battle_bomb(uuid) from public, anon, authenticated;
revoke all on function public.choose_table_battle_floor_tile(text, integer, integer, text, bigint, text) from public, anon, authenticated;
revoke all on function public.transfer_table_battle_bomb(text, integer, integer, text, bigint, text) from public, anon, authenticated;
revoke all on function public.get_admin_table_battle_state() from public, anon, authenticated;
revoke all on function public.select_table_battle_winner(uuid, uuid) from public, anon, authenticated;
grant execute on function public.choose_table_battle_floor_tile(text, integer, integer, text, bigint, text) to anon;
grant execute on function public.transfer_table_battle_bomb(text, integer, integer, text, bigint, text) to anon;
grant execute on function public.get_admin_table_battle_state() to authenticated;
grant execute on function public.select_table_battle_winner(uuid, uuid) to authenticated;
