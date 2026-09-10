-- TABLE BATTLE rule refinement: timed consonant quiz scoring and a hidden,
-- luck-only mine floor. The floor map remains database-only at every point.

alter table public.game_participants
  add column if not exists word_score integer not null default 0 check (word_score >= 0);

alter table public.game_rounds
  add column if not exists submission_ends_at timestamptz,
  add column if not exists elimination_count integer check (elimination_count is null or elimination_count >= 0);

alter table public.word_quiz_answers
  add column if not exists score integer not null default 0 check (score >= 0);

create index if not exists game_participants_event_score_idx
  on public.game_participants(event_id, word_score, requested_at);

create or replace function private.table_battle_elimination_count(p_alive_count integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_alive_count <= 2 then 0
    when p_alive_count <= 4 then 1
    when p_alive_count <= 7 then 2
    when p_alive_count <= 11 then 3
    else least(p_alive_count - 2, greatest(1, ceil(p_alive_count * 0.4)::integer))
  end
$$;

create or replace function private.random_lucky_floor_map(p_size integer default 3, p_mines integer default 3)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  with ranked as (
    select cell.position,
      row_number() over (order by random()) <= p_mines as is_mine
    from generate_series(0, p_size * p_size - 1) as cell(position)
  ), rows as (
    select (position / p_size) as row_number,
      jsonb_agg(to_jsonb(not is_mine) order by position) as tiles
    from ranked
    group by (position / p_size)
  )
  select jsonb_agg(tiles order by row_number) from rows
$$;

-- Finishes the event automatically when the luck round leaves zero or one
-- survivor. This avoids an operator race after an immediate mine explosion.
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

  select count(*) into v_survivors
  from public.game_participants
  where event_id = p_event_id and status = 'APPROVED';
  if v_survivors > 1 then return; end if;

  if v_survivors = 1 then
    select * into v_winner from public.game_participants
    where event_id = p_event_id and status = 'APPROVED' for update;
    update public.game_participants set status = 'WINNER', updated_at = clock_timestamp()
    where id = v_winner.id;
    insert into public.game_rewards(event_id, team_id, winner_table_id, reward_name)
    values (p_event_id, v_event.team_id, v_winner.table_id, coalesce(v_event.reward_name, '운영 부스에서 상품 확인'))
    on conflict (event_id, winner_table_id) do nothing;
    update public.game_events
    set status = 'FINISHED', winner_table_id = v_winner.table_id,
      finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_event_id;
  else
    update public.game_events
    set status = 'FINISHED', finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_event_id;
  end if;
end;
$$;

create or replace function private.advance_table_battle_word_quiz(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.game_events%rowtype;
  v_round public.game_rounds%rowtype;
  v_alive integer;
  v_eliminate integer;
begin
  select * into v_event from public.game_events where id = p_event_id for update;
  if not found or v_event.status <> 'WORD_QUIZ' then return; end if;
  select * into v_round from public.game_rounds
  where event_id = p_event_id and type = 'WORD_QUIZ' and status = 'ACTIVE' for update;
  if not found or v_round.submission_ends_at is null or v_round.submission_ends_at > clock_timestamp() then return; end if;

  select count(*) into v_alive from public.game_participants
  where event_id = p_event_id and status = 'APPROVED';
  v_eliminate := private.table_battle_elimination_count(v_alive);

  if v_eliminate > 0 then
    with ranked as (
      select participant.id,
        row_number() over (
          order by participant.word_score asc,
            coalesce((select max(answer_row.received_at) from public.word_quiz_answers answer_row
              where answer_row.round_id = v_round.id
                and answer_row.participant_id = participant.id
                and answer_row.is_correct), 'infinity'::timestamptz) desc,
            participant.requested_at asc
        ) as position
      from public.game_participants participant
      where participant.event_id = p_event_id and participant.status = 'APPROVED'
    )
    update public.game_participants participant
    set status = 'ELIMINATED', eliminated_round = v_round.sequence, updated_at = clock_timestamp()
    where participant.id in (select id from ranked where position <= v_eliminate);
  end if;

  update public.game_rounds
  set status = 'FINISHED', elimination_count = v_eliminate, ended_at = clock_timestamp()
  where id = v_round.id;
  update public.game_events set status = 'READY', updated_at = clock_timestamp() where id = p_event_id;
  perform private.finish_table_battle_if_last(p_event_id);
end;
$$;

create or replace function private.advance_table_battle_lucky_floor(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.game_events%rowtype;
  v_round public.game_rounds%rowtype;
begin
  select * into v_event from public.game_events where id = p_event_id for update;
  if not found or v_event.status <> 'FLOOR_GAME' then return; end if;
  select * into v_round from public.game_rounds
  where event_id = p_event_id and type = 'FLOOR_GAME' and status = 'ACTIVE' for update;
  if not found or v_round.floor_selection_ends_at is null or v_round.floor_selection_ends_at > clock_timestamp() then return; end if;

  -- Not choosing before the short deadline is a loss just like a mine hit.
  update public.game_participants participant
  set status = 'ELIMINATED', eliminated_round = v_round.sequence, updated_at = clock_timestamp()
  where participant.event_id = p_event_id and participant.status = 'APPROVED'
    and not exists (
      select 1 from public.floor_choices choice_row
      where choice_row.round_id = v_round.id and choice_row.participant_id = participant.id
    );
  update public.game_rounds set status = 'FINISHED', ended_at = clock_timestamp() where id = v_round.id;
  update public.game_events set status = 'READY', updated_at = clock_timestamp() where id = p_event_id;
  perform private.finish_table_battle_if_last(p_event_id);
end;
$$;

create or replace function private.advance_table_battle_clock(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  select status into v_status from public.game_events where id = p_event_id;
  if v_status = 'WORD_QUIZ' then
    perform private.advance_table_battle_word_quiz(p_event_id);
  elsif v_status = 'FLOOR_GAME' then
    perform private.advance_table_battle_lucky_floor(p_event_id);
  elsif v_status = 'BOMB_GAME' then
    perform private.advance_table_battle_bomb(p_event_id);
  end if;
end;
$$;

-- The map is intentionally never serialized. Suppressing it in this central
-- payload also protects public RPC callers from learning it before choosing.
create or replace function private.table_battle_state_payload(p_team_id uuid, p_table_id uuid, p_table_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.game_events%rowtype;
  v_participant public.game_participants%rowtype;
  v_round public.game_rounds%rowtype;
  v_amount integer := 0;
  v_bomb jsonb := null;
  v_winner jsonb := null;
  v_event_json jsonb := null;
  v_participant_json jsonb := null;
  v_round_json jsonb := null;
begin
  select * into v_event
  from public.game_events
  where team_id = p_team_id
  order by case when status in ('SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_LOCKED', 'READY', 'WORD_QUIZ', 'FLOOR_GAME', 'BOMB_GAME') then 0 when status = 'FINISHED' then 1 else 2 end,
    business_date desc, scheduled_at desc nulls last, created_at desc
  limit 1;
  if found then
    perform private.advance_table_battle_clock(v_event.id);
    select * into v_event from public.game_events where id = v_event.id;
    v_amount := private.table_battle_eligible_amount(p_team_id, p_table_id, v_event.business_date);
    select * into v_participant from public.game_participants where event_id = v_event.id and table_id = p_table_id;
    select * into v_round from public.game_rounds where event_id = v_event.id and status = 'ACTIVE' order by sequence desc limit 1;
    v_event_json := jsonb_build_object(
      'id', v_event.id, 'title', v_event.title, 'status', v_event.status, 'starts_at', v_event.scheduled_at,
      'registration_closes_at', v_event.registration_closes_at, 'minimum_order_amount', v_event.minimum_order_amount,
      'minimum_participants', v_event.minimum_participants
    );
    if v_participant.id is not null then
      v_participant_json := jsonb_build_object('status', v_participant.status, 'team_name', v_participant.team_name,
        'eligible_amount_snapshot', v_participant.eligible_amount_snapshot, 'eliminated_round', v_participant.eliminated_round,
        'word_score', v_participant.word_score);
    end if;
    if v_round.id is not null then
      v_round_json := jsonb_build_object(
        'id', v_round.id, 'type', v_round.type, 'sequence', v_round.sequence, 'prompt', v_round.prompt, 'hint', v_round.hint,
        'advance_count', v_round.advance_count, 'elimination_count', v_round.elimination_count,
        'submission_ends_at', v_round.submission_ends_at,
        'floor_map', null, 'floor_reveal_until', null, 'floor_selection_ends_at', v_round.floor_selection_ends_at,
        'answer_submitted', v_participant.id is not null and exists (select 1 from public.word_quiz_answers where round_id = v_round.id and participant_id = v_participant.id and is_correct),
        'choice_submitted', v_participant.id is not null and exists (select 1 from public.floor_choices where round_id = v_round.id and participant_id = v_participant.id)
      );
    end if;
    select jsonb_build_object(
      'owner_table_number', owner_table.table_number, 'version', bomb.version,
      'alive_tables', coalesce((select jsonb_agg(jsonb_build_object('table_number', alive_table.table_number, 'team_name', alive_participant.team_name) order by alive_table.table_number)
        from public.game_participants alive_participant
        join public.festival_tables alive_table on alive_table.id = alive_participant.table_id
        where alive_participant.event_id = v_event.id and alive_participant.status = 'APPROVED'), '[]'::jsonb)
    ) into v_bomb
    from public.bomb_states bomb
    join public.game_participants owner_participant on owner_participant.id = bomb.owner_participant_id
    join public.festival_tables owner_table on owner_table.id = owner_participant.table_id
    where bomb.event_id = v_event.id;
  else
    v_amount := private.table_battle_eligible_amount(p_team_id, p_table_id, (clock_timestamp() at time zone 'Asia/Seoul')::date);
  end if;

  select jsonb_build_object('table_number', winner_table.table_number, 'team_name', winner_participant.team_name, 'reward_name', reward.reward_name)
  into v_winner
  from public.game_events event_row
  join public.game_participants winner_participant on winner_participant.event_id = event_row.id and winner_participant.table_id = event_row.winner_table_id
  join public.festival_tables winner_table on winner_table.id = event_row.winner_table_id
  left join public.game_rewards reward on reward.event_id = event_row.id and reward.winner_table_id = event_row.winner_table_id
  where event_row.team_id = p_team_id and event_row.status = 'FINISHED'
    and (v_event.id is null or event_row.id = v_event.id)
  order by event_row.finished_at desc nulls last limit 1;

  return jsonb_build_object('table_number', p_table_number, 'eligible_amount', v_amount, 'server_now', clock_timestamp(),
    'event', v_event_json, 'participant', v_participant_json, 'current_round', v_round_json, 'bomb', v_bomb, 'winner', v_winner);
end;
$$;

drop function if exists public.submit_table_battle_word_answer(text, text, text, bigint, text);

create function public.submit_table_battle_word_answer(
  p_qr_token text, p_answer text, p_dictionary_verified boolean,
  p_rate_key_hash text, p_request_timestamp bigint, p_signature text
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
  v_correct boolean;
  v_rank integer;
  v_score integer;
begin
  perform private.verify_table_battle_request('word', p_qr_token, p_rate_key_hash, p_request_timestamp, p_signature);
  select * into v_context from private.table_battle_context(p_qr_token);
  if char_length(trim(coalesce(p_answer, ''))) not between 1 and 80 then raise exception 'invalid answer'; end if;
  if p_dictionary_verified is not true then raise exception 'dictionary noun verification failed'; end if;
  perform private.advance_table_battle_clock((select id from public.game_events where team_id = v_context.team_id and status = 'WORD_QUIZ' limit 1));
  select * into v_event from public.game_events where team_id = v_context.team_id and status = 'WORD_QUIZ' for update;
  if not found then return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number); end if;
  select * into v_participant from public.game_participants where event_id = v_event.id and table_id = v_context.table_id for update;
  if not found or v_participant.status <> 'APPROVED' then raise exception 'participant cannot answer'; end if;
  select * into v_round from public.game_rounds where event_id = v_event.id and type = 'WORD_QUIZ' and status = 'ACTIVE' for update;
  if not found or v_round.submission_ends_at is null or v_round.submission_ends_at <= clock_timestamp() then raise exception 'word quiz is closed'; end if;
  if exists (select 1 from public.word_quiz_answers where round_id = v_round.id and participant_id = v_participant.id and is_correct) then raise exception 'participant already answered'; end if;
  select exists (
    select 1 from jsonb_array_elements_text(v_round.accepted_answers) as answer_row(value)
    where lower(trim(answer_row.value)) = lower(trim(p_answer))
  ) into v_correct;
  if not v_correct then
    insert into public.word_quiz_answers(event_id, round_id, participant_id, answer, is_correct, score)
    values (v_event.id, v_round.id, v_participant.id, trim(p_answer), false, 0);
  else
    select count(*) + 1 into v_rank from public.word_quiz_answers where round_id = v_round.id and answer_rank is not null;
    v_score := greatest(1, ceil(extract(epoch from (v_round.submission_ends_at - clock_timestamp())))::integer);
    insert into public.word_quiz_answers(event_id, round_id, participant_id, answer, is_correct, answer_rank, score)
    values (v_event.id, v_round.id, v_participant.id, trim(p_answer), true, v_rank, v_score);
    update public.game_participants set word_score = word_score + v_score, updated_at = clock_timestamp() where id = v_participant.id;
  end if;
  return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number);
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
begin
  perform private.verify_table_battle_request('floor', p_qr_token, p_rate_key_hash, p_request_timestamp, p_signature);
  select * into v_context from private.table_battle_context(p_qr_token);
  perform private.advance_table_battle_clock((select id from public.game_events where team_id = v_context.team_id and status = 'FLOOR_GAME' limit 1));
  select * into v_event from public.game_events where team_id = v_context.team_id and status = 'FLOOR_GAME' for update;
  if not found then return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number); end if;
  select * into v_participant from public.game_participants where event_id = v_event.id and table_id = v_context.table_id for update;
  if not found or v_participant.status <> 'APPROVED' then raise exception 'participant cannot choose floor'; end if;
  select * into v_round from public.game_rounds where event_id = v_event.id and type = 'FLOOR_GAME' and status = 'ACTIVE' for update;
  if not found or v_round.floor_selection_ends_at is null or v_round.floor_selection_ends_at <= clock_timestamp() then raise exception 'floor selection is closed'; end if;
  if exists (select 1 from public.floor_choices where round_id = v_round.id and participant_id = v_participant.id) then raise exception 'floor already selected'; end if;
  if p_tile_x not between 0 and 2 or p_tile_y not between 0 and 2 then raise exception 'invalid floor tile'; end if;
  begin v_safe := (v_round.floor_map -> p_tile_y ->> p_tile_x)::boolean; exception when others then v_safe := null; end;
  if v_safe is null then raise exception 'invalid floor tile'; end if;
  insert into public.floor_choices(event_id, round_id, participant_id, tile_x, tile_y, is_safe)
  values (v_event.id, v_round.id, v_participant.id, p_tile_x, p_tile_y, v_safe);
  if not v_safe then
    update public.game_participants set status = 'ELIMINATED', eliminated_round = v_round.sequence, updated_at = clock_timestamp()
    where id = v_participant.id;
  end if;
  return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number);
end;
$$;

-- Existing operator RPC, narrowed to the revised rules. WORD_QUIZ uses a
-- 15-second server timer; FLOOR_GAME always creates a fresh hidden 3x3 map.
create or replace function public.start_table_battle_round(
  p_event_id uuid, p_round_type text, p_prompt text default null, p_hint text default null,
  p_accepted_answers jsonb default '[]'::jsonb, p_floor_map jsonb default null,
  p_advance_count integer default null, p_floor_reveal_seconds integer default 0,
  p_floor_selection_seconds integer default 5
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id();
  v_event public.game_events%rowtype;
  v_active public.game_rounds%rowtype;
  v_round_id uuid;
  v_next_sequence integer;
  v_alive integer;
  v_owner uuid;
  v_elimination integer;
  v_duration integer;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if p_round_type not in ('WORD_QUIZ', 'FLOOR_GAME', 'BOMB_GAME') then raise exception 'invalid round type'; end if;
  select * into v_event from public.game_events where id = p_event_id and team_id = v_team_id for update;
  if not found or v_event.status in ('FINISHED', 'CANCELLED') then raise exception 'game event cannot start'; end if;
  perform private.advance_table_battle_clock(v_event.id);
  select * into v_event from public.game_events where id = p_event_id for update;
  if v_event.status in ('WORD_QUIZ', 'FLOOR_GAME', 'BOMB_GAME') then raise exception 'current round is still active'; end if;
  select * into v_active from public.game_rounds where event_id = v_event.id and status = 'ACTIVE' for update;
  if found then raise exception 'current round is still active'; end if;

  select count(*) into v_alive from public.game_participants where event_id = v_event.id and status = 'APPROVED';
  if v_event.status in ('SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_LOCKED', 'READY') and v_alive < v_event.minimum_participants then raise exception 'not enough approved participants'; end if;
  if v_alive < 2 then raise exception 'not enough surviving participants'; end if;
  if p_round_type = 'WORD_QUIZ' and (char_length(trim(coalesce(p_prompt, ''))) = 0 or jsonb_typeof(p_accepted_answers) <> 'array' or jsonb_array_length(p_accepted_answers) = 0) then raise exception 'invalid consonant quiz'; end if;
  if p_round_type = 'FLOOR_GAME' and p_floor_selection_seconds not between 3 and 10 then raise exception 'invalid floor duration'; end if;
  v_duration := case when p_round_type = 'FLOOR_GAME' then p_floor_selection_seconds else 0 end;
  v_elimination := case when p_round_type = 'WORD_QUIZ' then private.table_battle_elimination_count(v_alive) else null end;

  select coalesce(max(sequence), 0) + 1 into v_next_sequence from public.game_rounds where event_id = v_event.id;
  insert into public.game_rounds(event_id, team_id, sequence, type, prompt, hint, accepted_answers, advance_count, floor_map, floor_reveal_until, floor_selection_ends_at, submission_ends_at, elimination_count)
  values (
    v_event.id, v_team_id, v_next_sequence, p_round_type, nullif(trim(coalesce(p_prompt, '')), ''), nullif(trim(coalesce(p_hint, '')), ''),
    case when p_round_type = 'WORD_QUIZ' then p_accepted_answers else '[]'::jsonb end,
    null,
    case when p_round_type = 'FLOOR_GAME' then private.random_lucky_floor_map(3, 3) else null end,
    null,
    case when p_round_type = 'FLOOR_GAME' then clock_timestamp() + make_interval(secs => v_duration) else null end,
    case when p_round_type = 'WORD_QUIZ' then clock_timestamp() + make_interval(secs => 15) else null end,
    v_elimination
  ) returning id into v_round_id;
  update public.game_events set status = p_round_type, started_at = coalesce(started_at, clock_timestamp()), updated_at = clock_timestamp() where id = v_event.id;
  if p_round_type = 'BOMB_GAME' then
    select id into v_owner from public.game_participants where event_id = v_event.id and status = 'APPROVED' order by random() limit 1;
    insert into public.bomb_states(event_id, team_id, owner_participant_id, version, explodes_at)
    values (v_event.id, v_team_id, v_owner, 0, clock_timestamp() + make_interval(secs => 5 + floor(random() * 8)::integer))
    on conflict (event_id) do update set owner_participant_id = excluded.owner_participant_id, version = bomb_states.version + 1, explodes_at = excluded.explodes_at, updated_at = clock_timestamp();
  end if;
  return v_round_id;
end;
$$;

revoke all on function private.table_battle_elimination_count(integer) from public, anon, authenticated;
revoke all on function private.random_lucky_floor_map(integer, integer) from public, anon, authenticated;
revoke all on function private.finish_table_battle_if_last(uuid) from public, anon, authenticated;
revoke all on function private.advance_table_battle_word_quiz(uuid) from public, anon, authenticated;
revoke all on function private.advance_table_battle_lucky_floor(uuid) from public, anon, authenticated;
revoke all on function private.advance_table_battle_clock(uuid) from public, anon, authenticated;
revoke all on function private.table_battle_state_payload(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.submit_table_battle_word_answer(text, text, boolean, text, bigint, text) from public, anon, authenticated;
revoke all on function public.choose_table_battle_floor_tile(text, integer, integer, text, bigint, text) from public, anon, authenticated;
revoke all on function public.start_table_battle_round(uuid, text, text, text, jsonb, jsonb, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.submit_table_battle_word_answer(text, text, boolean, text, bigint, text) to anon;
grant execute on function public.choose_table_battle_floor_tile(text, integer, integer, text, bigint, text) to anon;
grant execute on function public.start_table_battle_round(uuid, text, text, text, jsonb, jsonb, integer, integer, integer) to authenticated;
