-- TABLE BATTLE is isolated from the order domain. Public players use only a
-- table QR token; every table, payment amount, participant status, and game
-- result is resolved and decided in the database.

create table public.game_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.festival_teams(id) on delete cascade,
  title text not null default 'TABLE BATTLE' check (char_length(trim(title)) between 1 and 80),
  business_date date not null default ((clock_timestamp() at time zone 'Asia/Seoul')::date),
  scheduled_at timestamptz,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_LOCKED', 'READY', 'WORD_QUIZ', 'FLOOR_GAME', 'BOMB_GAME', 'FINISHED', 'CANCELLED')),
  minimum_order_amount integer not null default 10000 check (minimum_order_amount between 0 and 1000000),
  minimum_participants integer not null default 2 check (minimum_participants between 2 and 100),
  winner_table_id uuid references public.festival_tables(id) on delete restrict,
  reward_name text check (reward_name is null or char_length(trim(reward_name)) between 1 and 120),
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (registration_opens_at is null or registration_closes_at is null or registration_opens_at < registration_closes_at)
);

create table public.game_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.game_events(id) on delete cascade,
  team_id uuid not null references public.festival_teams(id) on delete cascade,
  table_id uuid not null references public.festival_tables(id) on delete restrict,
  team_name text not null check (char_length(trim(team_name)) between 2 and 30 and team_name !~ '[[:cntrl:]<>]'),
  eligible_amount_snapshot integer not null check (eligible_amount_snapshot >= 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'ELIMINATED', 'WINNER', 'CANCELLED')),
  requested_at timestamptz not null default clock_timestamp(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz,
  rejected_by uuid references public.profiles(id) on delete set null,
  eliminated_round integer,
  updated_at timestamptz not null default clock_timestamp(),
  unique (event_id, table_id)
);

create table public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.game_events(id) on delete cascade,
  team_id uuid not null references public.festival_teams(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  type text not null check (type in ('WORD_QUIZ', 'FLOOR_GAME', 'BOMB_GAME')),
  status text not null default 'ACTIVE' check (status in ('PENDING', 'ACTIVE', 'FINISHED', 'CANCELLED')),
  prompt text,
  hint text,
  accepted_answers jsonb not null default '[]'::jsonb check (jsonb_typeof(accepted_answers) = 'array'),
  advance_count integer check (advance_count is null or advance_count > 0),
  floor_map jsonb check (floor_map is null or jsonb_typeof(floor_map) = 'array'),
  floor_reveal_until timestamptz,
  floor_selection_ends_at timestamptz,
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (event_id, sequence)
);

create unique index game_rounds_one_active_idx on public.game_rounds(event_id) where status = 'ACTIVE';

create table public.word_quiz_answers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.game_events(id) on delete cascade,
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  participant_id uuid not null references public.game_participants(id) on delete cascade,
  answer text not null check (char_length(trim(answer)) between 1 and 80),
  is_correct boolean not null,
  answer_rank integer check (answer_rank is null or answer_rank > 0),
  received_at timestamptz not null default clock_timestamp()
);

create unique index word_quiz_answers_one_valid_answer_idx
  on public.word_quiz_answers(round_id, participant_id) where is_correct;
create unique index word_quiz_answers_unique_rank_idx
  on public.word_quiz_answers(round_id, answer_rank) where answer_rank is not null;

create table public.floor_choices (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.game_events(id) on delete cascade,
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  participant_id uuid not null references public.game_participants(id) on delete cascade,
  tile_x integer not null check (tile_x between 0 and 7),
  tile_y integer not null check (tile_y between 0 and 7),
  is_safe boolean not null,
  chosen_at timestamptz not null default clock_timestamp(),
  unique (round_id, participant_id)
);

create table public.bomb_states (
  event_id uuid primary key references public.game_events(id) on delete cascade,
  team_id uuid not null references public.festival_teams(id) on delete cascade,
  owner_participant_id uuid not null references public.game_participants(id) on delete restrict,
  version integer not null default 0 check (version >= 0),
  explodes_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.bomb_transfers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.game_events(id) on delete cascade,
  team_id uuid not null references public.festival_teams(id) on delete cascade,
  source_participant_id uuid not null references public.game_participants(id) on delete restrict,
  target_participant_id uuid not null references public.game_participants(id) on delete restrict,
  version integer not null check (version >= 0),
  transferred_at timestamptz not null default clock_timestamp(),
  unique (event_id, version)
);

create table public.game_rewards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.game_events(id) on delete cascade,
  team_id uuid not null references public.festival_teams(id) on delete cascade,
  winner_table_id uuid not null references public.festival_tables(id) on delete restrict,
  reward_name text not null check (char_length(trim(reward_name)) between 1 and 120),
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'REDEEMED', 'CANCELLED')),
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  unique (event_id, winner_table_id)
);

create index game_events_team_state_time_idx on public.game_events(team_id, status, business_date, scheduled_at);
create index game_participants_event_status_idx on public.game_participants(event_id, status, table_id);
create index game_participants_team_table_idx on public.game_participants(team_id, table_id);
create index game_rounds_event_status_idx on public.game_rounds(event_id, status, sequence);
create index word_quiz_answers_round_received_idx on public.word_quiz_answers(round_id, received_at);
create index floor_choices_round_participant_idx on public.floor_choices(round_id, participant_id);
create index bomb_transfers_event_time_idx on public.bomb_transfers(event_id, transferred_at desc);
create index game_rewards_team_status_idx on public.game_rewards(team_id, status);

alter table public.game_events enable row level security;
alter table public.game_participants enable row level security;
alter table public.game_rounds enable row level security;
alter table public.word_quiz_answers enable row level security;
alter table public.floor_choices enable row level security;
alter table public.bomb_states enable row level security;
alter table public.bomb_transfers enable row level security;
alter table public.game_rewards enable row level security;

create policy "operator reads team game events" on public.game_events for select to authenticated using (team_id = (select public.current_festival_team_id()));
create policy "operator reads team game participants" on public.game_participants for select to authenticated using (team_id = (select public.current_festival_team_id()));
create policy "operator reads team game rounds" on public.game_rounds for select to authenticated using (team_id = (select public.current_festival_team_id()));
create policy "operator reads team game answers" on public.word_quiz_answers for select to authenticated using (event_id in (select id from public.game_events where team_id = (select public.current_festival_team_id())));
create policy "operator reads team floor choices" on public.floor_choices for select to authenticated using (event_id in (select id from public.game_events where team_id = (select public.current_festival_team_id())));
create policy "operator reads team bomb state" on public.bomb_states for select to authenticated using (team_id = (select public.current_festival_team_id()));
create policy "operator reads team bomb transfers" on public.bomb_transfers for select to authenticated using (team_id = (select public.current_festival_team_id()));
create policy "operator reads team rewards" on public.game_rewards for select to authenticated using (team_id = (select public.current_festival_team_id()));

revoke all on public.game_events, public.game_participants, public.game_rounds, public.word_quiz_answers, public.floor_choices, public.bomb_states, public.bomb_transfers, public.game_rewards from public, anon, authenticated;

create function private.table_battle_context(p_qr_token text)
returns table(team_id uuid, table_id uuid, table_number integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
    select table_row.team_id, table_row.id, table_row.table_number
    from public.festival_tables table_row
    join public.festival_teams festival_team on festival_team.id = table_row.team_id
    where table_row.qr_token = p_qr_token and table_row.is_active and festival_team.is_active;
  if not found then raise exception 'invalid or inactive qr'; end if;
end;
$$;

create function private.table_battle_eligible_amount(p_team_id uuid, p_table_id uuid, p_business_date date)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(payment.amount), 0)::integer
  from public.orders order_row
  join public.payments payment on payment.team_id = order_row.team_id and payment.order_id = order_row.id
  where order_row.team_id = p_team_id
    and order_row.table_id = p_table_id
    and order_row.fulfillment_type = 'DINE_IN'
    and order_row.status <> 'CANCELLED'
    and payment.status = 'CONFIRMED'
    and payment.confirmed_at is not null
    and (payment.confirmed_at at time zone 'Asia/Seoul')::date = p_business_date
$$;

create function private.verify_table_battle_request(
  p_action text, p_qr_token text, p_rate_key_hash text, p_request_timestamp bigint, p_signature text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_action not in ('state', 'join', 'word', 'floor', 'bomb') then raise exception 'invalid table battle action'; end if;
  perform private.verify_festival_signature(
    'table-battle-' || p_action || '-v1|' || p_request_timestamp::text || '|' || p_qr_token || '|' || coalesce(p_rate_key_hash, ''),
    p_request_timestamp, p_signature
  );
  perform private.consume_festival_rate_limit('table-battle-' || p_action, p_rate_key_hash, case when p_action = 'state' then 120 else 30 end, 60);
end;
$$;

-- A clock is advanced only under the event row lock. It is invoked from state
-- reads and all player actions, so a reconnect cannot retain a stale bomb.
create function private.advance_table_battle_bomb(p_event_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.game_events%rowtype;
  v_bomb public.bomb_states%rowtype;
  v_loser public.game_participants%rowtype;
  v_next_owner uuid;
  v_survivors integer;
  v_winner public.game_participants%rowtype;
begin
  select * into v_event from public.game_events where id = p_event_id for update;
  if not found or v_event.status <> 'BOMB_GAME' then return; end if;
  select * into v_bomb from public.bomb_states where event_id = p_event_id for update;
  if not found or v_bomb.explodes_at > clock_timestamp() then return; end if;

  select * into v_loser from public.game_participants where id = v_bomb.owner_participant_id for update;
  if v_loser.status = 'APPROVED' then
    update public.game_participants set status = 'ELIMINATED', eliminated_round = coalesce((select sequence from public.game_rounds where event_id = p_event_id and status = 'ACTIVE'), 0), updated_at = clock_timestamp() where id = v_loser.id;
  end if;
  select count(*) into v_survivors from public.game_participants where event_id = p_event_id and status = 'APPROVED';
  if v_survivors <= 1 then
    select * into v_winner from public.game_participants where event_id = p_event_id and status = 'APPROVED' for update;
    if found then
      update public.game_participants set status = 'WINNER', updated_at = clock_timestamp() where id = v_winner.id;
      update public.game_events set status = 'FINISHED', winner_table_id = v_winner.table_id, finished_at = clock_timestamp(), updated_at = clock_timestamp() where id = p_event_id;
      insert into public.game_rewards(event_id, team_id, winner_table_id, reward_name)
      values (p_event_id, v_event.team_id, v_winner.table_id, coalesce(v_event.reward_name, '운영 부스에서 상품 확인'))
      on conflict (event_id, winner_table_id) do nothing;
    else
      update public.game_events set status = 'FINISHED', finished_at = clock_timestamp(), updated_at = clock_timestamp() where id = p_event_id;
    end if;
    return;
  end if;
  select id into v_next_owner from public.game_participants where event_id = p_event_id and status = 'APPROVED' order by random() limit 1;
  update public.bomb_states
  set owner_participant_id = v_next_owner, version = version + 1,
      explodes_at = clock_timestamp() + make_interval(secs => 5 + floor(random() * 8)::integer), updated_at = clock_timestamp()
  where event_id = p_event_id;
end;
$$;

create function private.table_battle_state_payload(p_team_id uuid, p_table_id uuid, p_table_number integer)
returns jsonb
language plpgsql security definer set search_path = ''
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
    perform private.advance_table_battle_bomb(v_event.id);
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
        'eligible_amount_snapshot', v_participant.eligible_amount_snapshot, 'eliminated_round', v_participant.eliminated_round);
    end if;
    if v_round.id is not null then
      v_round_json := jsonb_build_object(
        'id', v_round.id, 'type', v_round.type, 'sequence', v_round.sequence, 'prompt', v_round.prompt, 'hint', v_round.hint,
        'advance_count', v_round.advance_count,
        'floor_map', case when v_round.type = 'FLOOR_GAME' and v_round.floor_reveal_until > clock_timestamp() then v_round.floor_map else null end,
        'floor_reveal_until', v_round.floor_reveal_until, 'floor_selection_ends_at', v_round.floor_selection_ends_at,
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

create function public.get_table_battle_state(
  p_qr_token text, p_rate_key_hash text, p_request_timestamp bigint, p_signature text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_context record;
begin
  perform private.verify_table_battle_request('state', p_qr_token, p_rate_key_hash, p_request_timestamp, p_signature);
  select * into v_context from private.table_battle_context(p_qr_token);
  return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number);
end;
$$;

create function public.request_table_battle_participation(
  p_qr_token text, p_team_name text, p_rate_key_hash text, p_request_timestamp bigint, p_signature text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_context record;
  v_event public.game_events%rowtype;
  v_amount integer;
begin
  perform private.verify_table_battle_request('join', p_qr_token, p_rate_key_hash, p_request_timestamp, p_signature);
  select * into v_context from private.table_battle_context(p_qr_token);
  if char_length(trim(coalesce(p_team_name, ''))) not between 2 and 30 or p_team_name ~ '[[:cntrl:]<>]' then raise exception 'invalid team name'; end if;
  select * into v_event from public.game_events
  where team_id = v_context.team_id and status not in ('FINISHED', 'CANCELLED')
  order by business_date, scheduled_at nulls last, created_at limit 1 for update;
  if not found then raise exception 'no active game event'; end if;
  if v_event.status <> 'REGISTRATION_OPEN' then raise exception 'registration is not open'; end if;
  if v_event.registration_closes_at is not null and v_event.registration_closes_at <= clock_timestamp() then raise exception 'registration is closed'; end if;
  v_amount := private.table_battle_eligible_amount(v_context.team_id, v_context.table_id, v_event.business_date);
  if v_amount < v_event.minimum_order_amount then raise exception 'not eligible'; end if;
  insert into public.game_participants(event_id, team_id, table_id, team_name, eligible_amount_snapshot)
  values (v_event.id, v_context.team_id, v_context.table_id, trim(p_team_name), v_amount)
  on conflict (event_id, table_id) do nothing;
  return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number);
end;
$$;

create function public.submit_table_battle_word_answer(
  p_qr_token text, p_answer text, p_rate_key_hash text, p_request_timestamp bigint, p_signature text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_context record; v_event public.game_events%rowtype; v_participant public.game_participants%rowtype;
  v_round public.game_rounds%rowtype; v_correct boolean; v_rank integer;
begin
  perform private.verify_table_battle_request('word', p_qr_token, p_rate_key_hash, p_request_timestamp, p_signature);
  select * into v_context from private.table_battle_context(p_qr_token);
  if char_length(trim(coalesce(p_answer, ''))) not between 1 and 80 then raise exception 'invalid answer'; end if;
  select * into v_event from public.game_events where team_id = v_context.team_id and status = 'WORD_QUIZ' for update;
  if not found then raise exception 'word quiz is not active'; end if;
  select * into v_participant from public.game_participants where event_id = v_event.id and table_id = v_context.table_id for update;
  if not found or v_participant.status <> 'APPROVED' then raise exception 'participant cannot answer'; end if;
  select * into v_round from public.game_rounds where event_id = v_event.id and type = 'WORD_QUIZ' and status = 'ACTIVE' for update;
  if not found then raise exception 'word quiz is not active'; end if;
  if exists (select 1 from public.word_quiz_answers where round_id = v_round.id and participant_id = v_participant.id and is_correct) then raise exception 'participant already answered'; end if;
  select exists (select 1 from jsonb_array_elements_text(v_round.accepted_answers) as answer_row(value) where lower(trim(answer_row.value)) = lower(trim(p_answer))) into v_correct;
  if not v_correct then
    insert into public.word_quiz_answers(event_id, round_id, participant_id, answer, is_correct) values (v_event.id, v_round.id, v_participant.id, trim(p_answer), false);
  else
    select count(*) + 1 into v_rank from public.word_quiz_answers where round_id = v_round.id and answer_rank is not null;
    insert into public.word_quiz_answers(event_id, round_id, participant_id, answer, is_correct, answer_rank)
    values (v_event.id, v_round.id, v_participant.id, trim(p_answer), true, case when v_rank <= v_round.advance_count then v_rank else null end);
    if v_rank > v_round.advance_count then
      update public.game_participants set status = 'ELIMINATED', eliminated_round = v_round.sequence, updated_at = clock_timestamp() where id = v_participant.id;
    end if;
  end if;
  return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number);
end;
$$;

create function public.choose_table_battle_floor_tile(
  p_qr_token text, p_tile_x integer, p_tile_y integer, p_rate_key_hash text, p_request_timestamp bigint, p_signature text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_context record; v_event public.game_events%rowtype; v_participant public.game_participants%rowtype;
  v_round public.game_rounds%rowtype; v_safe boolean;
begin
  perform private.verify_table_battle_request('floor', p_qr_token, p_rate_key_hash, p_request_timestamp, p_signature);
  select * into v_context from private.table_battle_context(p_qr_token);
  select * into v_event from public.game_events where team_id = v_context.team_id and status = 'FLOOR_GAME' for update;
  if not found then raise exception 'floor game is not active'; end if;
  select * into v_participant from public.game_participants where event_id = v_event.id and table_id = v_context.table_id for update;
  if not found or v_participant.status <> 'APPROVED' then raise exception 'participant cannot choose floor'; end if;
  select * into v_round from public.game_rounds where event_id = v_event.id and type = 'FLOOR_GAME' and status = 'ACTIVE' for update;
  if not found or v_round.floor_selection_ends_at is null or v_round.floor_selection_ends_at <= clock_timestamp() then raise exception 'floor selection is closed'; end if;
  if v_round.floor_reveal_until is not null and v_round.floor_reveal_until > clock_timestamp() then raise exception 'floor is still being revealed'; end if;
  if exists (select 1 from public.floor_choices where round_id = v_round.id and participant_id = v_participant.id) then raise exception 'floor already selected'; end if;
  begin v_safe := (v_round.floor_map -> p_tile_y ->> p_tile_x)::boolean; exception when others then v_safe := null; end;
  if v_safe is null then raise exception 'invalid floor tile'; end if;
  insert into public.floor_choices(event_id, round_id, participant_id, tile_x, tile_y, is_safe) values (v_event.id, v_round.id, v_participant.id, p_tile_x, p_tile_y, v_safe);
  if not v_safe then update public.game_participants set status = 'ELIMINATED', eliminated_round = v_round.sequence, updated_at = clock_timestamp() where id = v_participant.id; end if;
  return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number);
end;
$$;

create function public.transfer_table_battle_bomb(
  p_qr_token text, p_target_table_number integer, p_expected_version integer, p_rate_key_hash text, p_request_timestamp bigint, p_signature text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_context record; v_event public.game_events%rowtype; v_source public.game_participants%rowtype;
  v_target public.game_participants%rowtype; v_bomb public.bomb_states%rowtype;
begin
  perform private.verify_table_battle_request('bomb', p_qr_token, p_rate_key_hash, p_request_timestamp, p_signature);
  select * into v_context from private.table_battle_context(p_qr_token);
  perform private.advance_table_battle_bomb((select id from public.game_events where team_id = v_context.team_id and status = 'BOMB_GAME' limit 1));
  select * into v_event from public.game_events where team_id = v_context.team_id and status = 'BOMB_GAME' for update;
  if not found then raise exception 'bomb game is not active'; end if;
  select * into v_source from public.game_participants where event_id = v_event.id and table_id = v_context.table_id for update;
  if not found or v_source.status <> 'APPROVED' then raise exception 'participant cannot transfer bomb'; end if;
  select * into v_bomb from public.bomb_states where event_id = v_event.id for update;
  if not found or v_bomb.owner_participant_id <> v_source.id or v_bomb.version <> p_expected_version then raise exception 'bomb version changed'; end if;
  select participant.* into v_target from public.game_participants participant join public.festival_tables table_row on table_row.id = participant.table_id
  where participant.event_id = v_event.id and participant.status = 'APPROVED' and table_row.team_id = v_context.team_id and table_row.table_number = p_target_table_number for update;
  if not found or v_target.id = v_source.id then raise exception 'invalid bomb target'; end if;
  insert into public.bomb_transfers(event_id, team_id, source_participant_id, target_participant_id, version)
  values (v_event.id, v_context.team_id, v_source.id, v_target.id, v_bomb.version + 1);
  update public.bomb_states set owner_participant_id = v_target.id, version = version + 1, updated_at = clock_timestamp() where event_id = v_event.id;
  return private.table_battle_state_payload(v_context.team_id, v_context.table_id, v_context.table_number);
end;
$$;

-- Administrator RPCs deliberately repeat the payment/table eligibility check
-- at approval time. The customer can never turn their own PENDING request
-- into an approved participant.
create function public.create_table_battle_event(
  p_title text, p_business_date date, p_scheduled_at timestamptz, p_registration_opens_at timestamptz,
  p_registration_closes_at timestamptz, p_minimum_order_amount integer default 10000,
  p_minimum_participants integer default 2, p_reward_name text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_team_id uuid := public.current_festival_team_id(); v_event_id uuid;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 80 or p_minimum_order_amount < 0 or p_minimum_participants not between 2 and 100 then raise exception 'invalid event'; end if;
  insert into public.game_events(team_id, title, business_date, scheduled_at, registration_opens_at, registration_closes_at, minimum_order_amount, minimum_participants, reward_name, created_by)
  values (v_team_id, trim(p_title), p_business_date, p_scheduled_at, p_registration_opens_at, p_registration_closes_at, p_minimum_order_amount, p_minimum_participants, nullif(trim(coalesce(p_reward_name, '')), ''), (select auth.uid())) returning id into v_event_id;
  return v_event_id;
end;
$$;

create function public.review_table_battle_participant(p_event_id uuid, p_participant_id uuid, p_decision text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_team_id uuid := public.current_festival_team_id(); v_event public.game_events%rowtype; v_participant public.game_participants%rowtype; v_amount integer;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if p_decision not in ('APPROVE', 'REJECT', 'CANCEL_APPROVAL') then raise exception 'invalid review decision'; end if;
  select * into v_event from public.game_events where id = p_event_id and team_id = v_team_id for update;
  if not found then raise exception 'game event not found'; end if;
  select * into v_participant from public.game_participants where id = p_participant_id and event_id = v_event.id for update;
  if not found then raise exception 'participant not found'; end if;
  if p_decision = 'APPROVE' then
    if v_event.status not in ('REGISTRATION_OPEN', 'REGISTRATION_LOCKED', 'READY') or v_participant.status <> 'PENDING' then raise exception 'participant cannot be approved'; end if;
    if not exists (select 1 from public.festival_tables where id = v_participant.table_id and team_id = v_team_id and is_active) then raise exception 'inactive table'; end if;
    v_amount := private.table_battle_eligible_amount(v_team_id, v_participant.table_id, v_event.business_date);
    if v_amount < v_event.minimum_order_amount then raise exception 'not eligible'; end if;
    update public.game_participants set status = 'APPROVED', eligible_amount_snapshot = v_amount, approved_at = clock_timestamp(), approved_by = (select auth.uid()), updated_at = clock_timestamp() where id = v_participant.id;
  elsif p_decision = 'REJECT' then
    if v_participant.status <> 'PENDING' then raise exception 'participant cannot be rejected'; end if;
    update public.game_participants set status = 'REJECTED', rejected_at = clock_timestamp(), rejected_by = (select auth.uid()), updated_at = clock_timestamp() where id = v_participant.id;
  else
    if v_participant.status <> 'APPROVED' then raise exception 'approval cannot be cancelled'; end if;
    update public.game_participants set status = 'CANCELLED', updated_at = clock_timestamp() where id = v_participant.id;
  end if;
end;
$$;

-- Operators use this sequencer to move the event forward. It preserves the
-- same participant rows throughout every round, which makes reconnect state
-- deterministic and allows multiple FLOOR_GAME sub-rounds before the final.
create function public.start_table_battle_round(
  p_event_id uuid, p_round_type text, p_prompt text default null, p_hint text default null,
  p_accepted_answers jsonb default '[]'::jsonb, p_floor_map jsonb default null,
  p_advance_count integer default null, p_floor_reveal_seconds integer default 3,
  p_floor_selection_seconds integer default 3
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_team_id uuid := public.current_festival_team_id(); v_event public.game_events%rowtype;
  v_active public.game_rounds%rowtype; v_round_id uuid; v_next_sequence integer; v_alive integer;
  v_owner uuid; v_map_width integer; v_map_height integer;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if p_round_type not in ('WORD_QUIZ', 'FLOOR_GAME', 'BOMB_GAME') then raise exception 'invalid round type'; end if;
  select * into v_event from public.game_events where id = p_event_id and team_id = v_team_id for update;
  if not found or v_event.status in ('FINISHED', 'CANCELLED') then raise exception 'game event cannot start'; end if;
  select * into v_active from public.game_rounds where event_id = v_event.id and status = 'ACTIVE' for update;

  if found and v_active.type = 'WORD_QUIZ' then
    update public.game_participants participant
    set status = 'ELIMINATED', eliminated_round = v_active.sequence, updated_at = clock_timestamp()
    where participant.event_id = v_event.id and participant.status = 'APPROVED'
      and not exists (select 1 from public.word_quiz_answers answer_row where answer_row.round_id = v_active.id and answer_row.participant_id = participant.id and answer_row.answer_rank is not null);
  elsif found and v_active.type = 'FLOOR_GAME' then
    update public.game_participants participant
    set status = 'ELIMINATED', eliminated_round = v_active.sequence, updated_at = clock_timestamp()
    where participant.event_id = v_event.id and participant.status = 'APPROVED'
      and not exists (select 1 from public.floor_choices choice_row where choice_row.round_id = v_active.id and choice_row.participant_id = participant.id and choice_row.is_safe);
  end if;
  if v_active.id is not null then update public.game_rounds set status = 'FINISHED', ended_at = clock_timestamp() where id = v_active.id; end if;

  select count(*) into v_alive from public.game_participants where event_id = v_event.id and status = 'APPROVED';
  if v_event.status in ('SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_LOCKED', 'READY') and v_alive < v_event.minimum_participants then raise exception 'not enough approved participants'; end if;
  if v_alive < 2 then raise exception 'not enough surviving participants'; end if;
  if p_round_type = 'WORD_QUIZ' and (jsonb_typeof(p_accepted_answers) <> 'array' or jsonb_array_length(p_accepted_answers) = 0 or coalesce(p_advance_count, 0) not between 1 and v_alive) then raise exception 'invalid word quiz'; end if;
  if p_round_type = 'FLOOR_GAME' then
    if jsonb_typeof(p_floor_map) <> 'array' or jsonb_array_length(p_floor_map) not between 2 and 8 then raise exception 'invalid floor map'; end if;
    select jsonb_array_length(p_floor_map -> 0) into v_map_width;
    select count(*) into v_map_height from jsonb_array_elements(p_floor_map) as row_value(value)
    where jsonb_typeof(row_value.value) = 'array' and jsonb_array_length(row_value.value) = v_map_width;
    if v_map_width not between 2 and 8 or v_map_height <> jsonb_array_length(p_floor_map)
      or exists (select 1 from jsonb_array_elements(p_floor_map) as row_value(value), jsonb_array_elements(row_value.value) as tile_value(value) where jsonb_typeof(tile_value.value) <> 'boolean') then raise exception 'invalid floor map'; end if;
    if p_floor_reveal_seconds not between 1 and 10 or p_floor_selection_seconds not between 1 and 15 then raise exception 'invalid floor duration'; end if;
  end if;

  select coalesce(max(sequence), 0) + 1 into v_next_sequence from public.game_rounds where event_id = v_event.id;
  insert into public.game_rounds(event_id, team_id, sequence, type, prompt, hint, accepted_answers, advance_count, floor_map, floor_reveal_until, floor_selection_ends_at)
  values (
    v_event.id, v_team_id, v_next_sequence, p_round_type, nullif(trim(coalesce(p_prompt, '')), ''), nullif(trim(coalesce(p_hint, '')), ''),
    case when p_round_type = 'WORD_QUIZ' then p_accepted_answers else '[]'::jsonb end,
    case when p_round_type = 'WORD_QUIZ' then p_advance_count else null end,
    case when p_round_type = 'FLOOR_GAME' then p_floor_map else null end,
    case when p_round_type = 'FLOOR_GAME' then clock_timestamp() + make_interval(secs => p_floor_reveal_seconds) else null end,
    case when p_round_type = 'FLOOR_GAME' then clock_timestamp() + make_interval(secs => p_floor_reveal_seconds + p_floor_selection_seconds) else null end
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

create function public.set_table_battle_registration_status(p_event_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_team_id uuid := public.current_festival_team_id();
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  if p_status not in ('REGISTRATION_OPEN', 'REGISTRATION_LOCKED', 'READY') then raise exception 'invalid registration status'; end if;
  update public.game_events set status = p_status, updated_at = clock_timestamp()
  where id = p_event_id and team_id = v_team_id and status not in ('FINISHED', 'CANCELLED');
  if not found then raise exception 'game event cannot change registration status'; end if;
end;
$$;

create function public.close_table_battle_event(p_event_id uuid, p_cancel boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_team_id uuid := public.current_festival_team_id(); v_event public.game_events%rowtype; v_winner public.game_participants%rowtype; v_count integer;
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  select * into v_event from public.game_events where id = p_event_id and team_id = v_team_id for update;
  if not found or v_event.status in ('FINISHED', 'CANCELLED') then raise exception 'game event cannot close'; end if;
  update public.game_rounds set status = 'CANCELLED', ended_at = clock_timestamp() where event_id = v_event.id and status = 'ACTIVE';
  if p_cancel then
    update public.game_events set status = 'CANCELLED', finished_at = clock_timestamp(), updated_at = clock_timestamp() where id = v_event.id;
    return;
  end if;
  select count(*) into v_count from public.game_participants where event_id = v_event.id and status = 'APPROVED';
  if v_count = 1 then
    select * into v_winner from public.game_participants where event_id = v_event.id and status = 'APPROVED' for update;
    update public.game_participants set status = 'WINNER', updated_at = clock_timestamp() where id = v_winner.id;
    insert into public.game_rewards(event_id, team_id, winner_table_id, reward_name)
    values (v_event.id, v_team_id, v_winner.table_id, coalesce(v_event.reward_name, '운영 부스에서 상품 확인')) on conflict (event_id, winner_table_id) do nothing;
    update public.game_events set status = 'FINISHED', winner_table_id = v_winner.table_id, finished_at = clock_timestamp(), updated_at = clock_timestamp() where id = v_event.id;
  else
    update public.game_events set status = 'FINISHED', finished_at = clock_timestamp(), updated_at = clock_timestamp() where id = v_event.id;
  end if;
end;
$$;

create function public.redeem_table_battle_reward(p_reward_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_team_id uuid := public.current_festival_team_id();
begin
  if v_team_id is null then raise exception 'admin required'; end if;
  update public.game_rewards set status = 'REDEEMED', redeemed_at = clock_timestamp(), redeemed_by = (select auth.uid())
  where id = p_reward_id and team_id = v_team_id and status = 'AVAILABLE';
  if not found then raise exception 'reward cannot be redeemed'; end if;
end;
$$;

revoke all on function private.table_battle_context(text) from public, anon, authenticated;
revoke all on function private.table_battle_eligible_amount(uuid, uuid, date) from public, anon, authenticated;
revoke all on function private.verify_table_battle_request(text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function private.advance_table_battle_bomb(uuid) from public, anon, authenticated;
revoke all on function private.table_battle_state_payload(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_table_battle_state(text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.request_table_battle_participation(text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.submit_table_battle_word_answer(text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.choose_table_battle_floor_tile(text, integer, integer, text, bigint, text) from public, anon, authenticated;
revoke all on function public.transfer_table_battle_bomb(text, integer, integer, text, bigint, text) from public, anon, authenticated;
revoke all on function public.create_table_battle_event(text, date, timestamptz, timestamptz, timestamptz, integer, integer, text) from public, anon, authenticated;
revoke all on function public.review_table_battle_participant(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_table_battle_registration_status(uuid, text) from public, anon, authenticated;
revoke all on function public.start_table_battle_round(uuid, text, text, text, jsonb, jsonb, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.close_table_battle_event(uuid, boolean) from public, anon, authenticated;
revoke all on function public.redeem_table_battle_reward(uuid) from public, anon, authenticated;
grant execute on function public.get_table_battle_state(text, text, bigint, text) to anon;
grant execute on function public.request_table_battle_participation(text, text, text, bigint, text) to anon;
grant execute on function public.submit_table_battle_word_answer(text, text, text, bigint, text) to anon;
grant execute on function public.choose_table_battle_floor_tile(text, integer, integer, text, bigint, text) to anon;
grant execute on function public.transfer_table_battle_bomb(text, integer, integer, text, bigint, text) to anon;
grant execute on function public.create_table_battle_event(text, date, timestamptz, timestamptz, timestamptz, integer, integer, text) to authenticated;
grant execute on function public.review_table_battle_participant(uuid, uuid, text) to authenticated;
grant execute on function public.set_table_battle_registration_status(uuid, text) to authenticated;
grant execute on function public.start_table_battle_round(uuid, text, text, text, jsonb, jsonb, integer, integer, integer) to authenticated;
grant execute on function public.close_table_battle_event(uuid, boolean) to authenticated;
grant execute on function public.redeem_table_battle_reward(uuid) to authenticated;
