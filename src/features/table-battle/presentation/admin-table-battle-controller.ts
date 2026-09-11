import { z } from "zod";
import { requireAdminSession } from "@/src/shared/auth/admin-session";
import { conflict, invalidInput } from "@/src/shared/errors/app-error";
import { handleController, parseJson } from "@/src/shared/http/route-handler";

const participantSchema = z.object({
  id: z.string().uuid(),
  table_number: z.number().int().positive(),
  team_name: z.string().min(2).max(30),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "ELIMINATED", "WINNER", "CANCELLED"]),
  word_score: z.number().int().nonnegative(),
  eligible_amount: z.number().int().nonnegative(),
});

const databaseStateSchema = z.object({
  event: z.object({
    id: z.string().uuid(), title: z.string(), status: z.string(), reward_name: z.string().nullable(), winner_table_id: z.string().uuid().nullable(),
    minimum_order_amount: z.number().int().min(10_000), round_count: z.number().int().nonnegative(), last_round_type: z.enum(["WORD_QUIZ", "FLOOR_GAME", "BOMB_GAME"]).nullable(),
  }).nullable(),
  participants: z.array(participantSchema),
});

const battleCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_EVENT"), title: z.string().trim().min(1).max(80).default("TABLE BATTLE"), rewardName: z.string().trim().max(120).optional() }),
  z.object({ action: z.literal("REVIEW"), eventId: z.string().uuid(), participantId: z.string().uuid(), decision: z.enum(["APPROVE", "REJECT"]) }),
  z.object({ action: z.literal("SET_REGISTRATION"), eventId: z.string().uuid(), status: z.enum(["REGISTRATION_OPEN", "REGISTRATION_LOCKED", "READY"]) }),
  z.object({
    action: z.literal("START_ROUND"), eventId: z.string().uuid(), roundType: z.enum(["WORD_QUIZ", "FLOOR_GAME", "BOMB_GAME"]),
    prompt: z.string().trim().min(1).max(80).optional(), hint: z.string().trim().max(120).optional(),
    answers: z.array(z.string().trim().min(1).max(80)).min(1).max(10).optional(),
  }),
  z.object({ action: z.literal("SELECT_WINNER"), eventId: z.string().uuid(), participantId: z.string().uuid() }),
]);

export type AdminTableBattleState = {
  event: { id: string; title: string; status: string; rewardName: string | null; winnerTableId: string | null; minimumOrderAmount: number; roundCount: number; lastRoundType: "WORD_QUIZ" | "FLOOR_GAME" | "BOMB_GAME" | null } | null;
  participants: Array<{ id: string; tableNumber: number; teamName: string; status: string; wordScore: number; eligibleAmount: number }>;
};

export function getAdminTableBattleController() {
  return handleController(async () => ({ body: await loadAdminTableBattleState() }));
}

export function operateAdminTableBattleController(request: Request) {
  return handleController(async () => {
    const [command, session] = await Promise.all([parseJson(request, battleCommandSchema, "게임 운영 요청을 다시 확인해 주세요."), requireAdminSession()]);
    let error = null;
    if (command.action === "CREATE_EVENT") {
      ({ error } = await session.client.rpc("create_table_battle_event_now", { p_title: command.title, p_reward_name: command.rewardName || null }));
    } else if (command.action === "REVIEW") {
      ({ error } = await session.client.rpc("review_table_battle_participant", { p_event_id: command.eventId, p_participant_id: command.participantId, p_decision: command.decision }));
    } else if (command.action === "SET_REGISTRATION") {
      ({ error } = await session.client.rpc("set_table_battle_registration_status", { p_event_id: command.eventId, p_status: command.status }));
    } else if (command.action === "START_ROUND") {
      if (command.roundType === "WORD_QUIZ" && (!command.prompt || !command.answers?.length)) {
        throw invalidInput("초성퀴즈 문제와 정답을 하나 이상 입력해 주세요.");
      }
      ({ error } = await session.client.rpc("start_table_battle_round", {
        p_event_id: command.eventId, p_round_type: command.roundType,
        p_prompt: command.roundType === "WORD_QUIZ" ? command.prompt ?? null : null,
        p_hint: command.roundType === "WORD_QUIZ" ? command.hint || null : null,
        p_accepted_answers: command.roundType === "WORD_QUIZ" ? command.answers ?? [] : [],
        p_floor_map: null, p_advance_count: null, p_floor_reveal_seconds: 0, p_floor_selection_seconds: 5,
      }));
    } else {
      ({ error } = await session.client.rpc("select_table_battle_winner", { p_event_id: command.eventId, p_participant_id: command.participantId }));
    }
    if (error) throw conflict("게임 운영 요청을 처리하지 못했습니다. 참가 조건과 현재 진행 상태를 다시 확인해 주세요.");
    return { body: await loadAdminTableBattleState(session.client) };
  });
}

async function loadAdminTableBattleState(existingClient?: Awaited<ReturnType<typeof requireAdminSession>>["client"]): Promise<AdminTableBattleState> {
  const session = existingClient ? null : await requireAdminSession();
  const client = existingClient ?? session!.client;
  const { data, error } = await client.rpc("get_admin_table_battle_state");
  if (error) throw conflict("TABLE BATTLE 운영 현황을 불러오지 못했습니다.");
  const parsed = databaseStateSchema.safeParse(data);
  if (!parsed.success) throw conflict("TABLE BATTLE 운영 현황을 확인하지 못했습니다.");
  return {
    event: parsed.data.event && {
      id: parsed.data.event.id, title: parsed.data.event.title, status: parsed.data.event.status,
      rewardName: parsed.data.event.reward_name, winnerTableId: parsed.data.event.winner_table_id,
      minimumOrderAmount: parsed.data.event.minimum_order_amount, roundCount: parsed.data.event.round_count, lastRoundType: parsed.data.event.last_round_type,
    },
    participants: parsed.data.participants.map((participant) => ({
      id: participant.id, tableNumber: participant.table_number, teamName: participant.team_name,
      status: participant.status, wordScore: participant.word_score, eligibleAmount: participant.eligible_amount,
    })),
  };
}
