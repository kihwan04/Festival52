import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TableBattleState } from "@/src/features/table-battle/domain/table-battle";
import type { SignedRequestProof } from "@/src/shared/security/request-signing";
import { conflict, rateLimited } from "@/src/shared/errors/app-error";

const eventStatusSchema = z.enum(["SCHEDULED", "REGISTRATION_OPEN", "REGISTRATION_LOCKED", "READY", "WORD_QUIZ", "FLOOR_GAME", "BOMB_GAME", "FINISHED", "CANCELLED"]);
const participantStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "ELIMINATED", "WINNER", "CANCELLED"]);
const stateSchema = z.object({
  table_number: z.number().int().positive(),
  eligible_amount: z.number().int().nonnegative(),
  server_now: z.string(),
  event: z.object({
    id: z.string().uuid(), title: z.string(), status: eventStatusSchema,
    starts_at: z.string().nullable(), registration_closes_at: z.string().nullable(),
    minimum_order_amount: z.number().int().nonnegative(), minimum_participants: z.number().int().positive(),
  }).nullable(),
  participant: z.object({
    status: participantStatusSchema, team_name: z.string(), eligible_amount_snapshot: z.number().int().nonnegative(), eliminated_round: z.number().int().nullable(), word_score: z.number().int().nonnegative(),
  }).nullable(),
  current_round: z.object({
    id: z.string().uuid(), type: z.enum(["WORD_QUIZ", "FLOOR_GAME", "BOMB_GAME"]), sequence: z.number().int().positive(),
    prompt: z.string().nullable(), hint: z.string().nullable(), advance_count: z.number().int().positive().nullable(), elimination_count: z.number().int().nonnegative().nullable(), submission_ends_at: z.string().nullable(),
    floor_map: z.array(z.array(z.boolean())).nullable(), floor_reveal_until: z.string().nullable(), floor_selection_ends_at: z.string().nullable(),
    answer_submitted: z.boolean(), choice_submitted: z.boolean(),
  }).nullable(),
  bomb: z.object({
    owner_table_number: z.number().int().positive(), version: z.number().int().nonnegative(),
    alive_tables: z.array(z.object({ table_number: z.number().int().positive(), team_name: z.string() })),
  }).nullable(),
  winner: z.object({ table_number: z.number().int().positive(), team_name: z.string(), reward_name: z.string().nullable() }).nullable(),
});

export class SupabaseTableBattleGateway {
  constructor(private readonly client: SupabaseClient) {}

  async getState(qrToken: string, proof: SignedRequestProof): Promise<TableBattleState> {
    return this.call("get_table_battle_state", {
      p_qr_token: qrToken, p_rate_key_hash: proof.rateKeyHash, p_request_timestamp: proof.requestTimestamp, p_signature: proof.signature,
    });
  }

  async join(qrToken: string, teamName: string, proof: SignedRequestProof): Promise<TableBattleState> {
    return this.call("request_table_battle_participation", {
      p_qr_token: qrToken, p_team_name: teamName, p_rate_key_hash: proof.rateKeyHash, p_request_timestamp: proof.requestTimestamp, p_signature: proof.signature,
    });
  }

  async submitWordAnswer(qrToken: string, answer: string, dictionaryVerified: boolean, proof: SignedRequestProof): Promise<TableBattleState> {
    return this.call("submit_table_battle_word_answer", {
      p_qr_token: qrToken, p_answer: answer, p_dictionary_verified: dictionaryVerified,
      p_rate_key_hash: proof.rateKeyHash, p_request_timestamp: proof.requestTimestamp, p_signature: proof.signature,
    });
  }

  async chooseFloorTile(qrToken: string, tileX: number, tileY: number, proof: SignedRequestProof): Promise<TableBattleState> {
    return this.call("choose_table_battle_floor_tile", {
      p_qr_token: qrToken, p_tile_x: tileX, p_tile_y: tileY, p_rate_key_hash: proof.rateKeyHash, p_request_timestamp: proof.requestTimestamp, p_signature: proof.signature,
    });
  }

  async transferBomb(qrToken: string, targetTableNumber: number, expectedVersion: number, proof: SignedRequestProof): Promise<TableBattleState> {
    return this.call("transfer_table_battle_bomb", {
      p_qr_token: qrToken, p_target_table_number: targetTableNumber, p_expected_version: expectedVersion,
      p_rate_key_hash: proof.rateKeyHash, p_request_timestamp: proof.requestTimestamp, p_signature: proof.signature,
    });
  }

  private async call(functionName: string, args: Record<string, unknown>): Promise<TableBattleState> {
    const { data, error } = await this.client.rpc(functionName, args);
    if (error) throw mapBattleError(error.message);
    const parsed = stateSchema.safeParse(data);
    if (!parsed.success) throw conflict("TABLE BATTLE 상태를 확인하지 못했습니다.");
    return mapState(parsed.data);
  }
}

function mapState(value: z.infer<typeof stateSchema>): TableBattleState {
  return {
    tableNumber: value.table_number, eligibleAmount: value.eligible_amount, serverNow: value.server_now,
    event: value.event && {
      id: value.event.id, title: value.event.title, status: value.event.status, startsAt: value.event.starts_at,
      registrationClosesAt: value.event.registration_closes_at, minimumOrderAmount: value.event.minimum_order_amount,
      minimumParticipants: value.event.minimum_participants,
    },
    participant: value.participant && {
      status: value.participant.status, teamName: value.participant.team_name,
      eligibleAmountSnapshot: value.participant.eligible_amount_snapshot, eliminatedRound: value.participant.eliminated_round, wordScore: value.participant.word_score,
    },
    currentRound: value.current_round && {
      id: value.current_round.id, type: value.current_round.type, sequence: value.current_round.sequence,
      prompt: value.current_round.prompt, hint: value.current_round.hint, advanceCount: value.current_round.advance_count, eliminationCount: value.current_round.elimination_count, submissionEndsAt: value.current_round.submission_ends_at,
      floorMap: value.current_round.floor_map, floorRevealUntil: value.current_round.floor_reveal_until,
      floorSelectionEndsAt: value.current_round.floor_selection_ends_at, answerSubmitted: value.current_round.answer_submitted,
      choiceSubmitted: value.current_round.choice_submitted,
    },
    bomb: value.bomb && {
      ownerTableNumber: value.bomb.owner_table_number, version: value.bomb.version,
      aliveTables: value.bomb.alive_tables.map((table) => ({ tableNumber: table.table_number, teamName: table.team_name })),
    },
    winner: value.winner && { tableNumber: value.winner.table_number, teamName: value.winner.team_name, rewardName: value.winner.reward_name },
  };
}

function mapBattleError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("rate limit")) return rateLimited("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  if (normalized.includes("inactive qr") || normalized.includes("invalid qr")) return conflict("사용할 수 없는 테이블 QR입니다.");
  if (normalized.includes("eligible")) return conflict("현재 테이블은 TABLE BATTLE 참가 조건을 충족하지 않았습니다.");
  if (normalized.includes("registration")) return conflict("현재는 참가 신청 시간이 아닙니다.");
  if (normalized.includes("participant")) return conflict("현재 참가 상태에서는 이 작업을 할 수 없습니다.");
  if (normalized.includes("bomb")) return conflict("폭탄 상태가 변경됐습니다. 화면을 다시 확인해 주세요.");
  return conflict("TABLE BATTLE 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
