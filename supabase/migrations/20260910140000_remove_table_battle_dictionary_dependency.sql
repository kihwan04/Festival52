-- TABLE BATTLE runs without an external dictionary service. Correctness is
-- determined only from the answer list configured by an authenticated operator
-- when the round is created, and all caller-supplied verification flags are
-- removed from the public RPC contract.

drop function if exists public.submit_table_battle_word_answer(text, text, boolean, text, bigint, text);

create function public.submit_table_battle_word_answer(
  p_qr_token text, p_answer text,
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

revoke all on function public.submit_table_battle_word_answer(text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.submit_table_battle_word_answer(text, text, text, bigint, text) to anon;
