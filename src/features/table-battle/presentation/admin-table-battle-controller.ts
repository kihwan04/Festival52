import { z } from "zod";
import { requireAdminSession } from "@/src/shared/auth/admin-session";
import { conflict } from "@/src/shared/errors/app-error";
import { handleController, parseJson } from "@/src/shared/http/route-handler";

const participantSchema = z.object({
  id: z.string().uuid(),
  table_number: z.number().int().positive(),
  team_name: z.string().min(2).max(30),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "ELIMINATED", "WINNER", "CANCELLED"]),
  word_score: z.number().int().nonnegative(),
});

const databaseStateSchema = z.object({
  event: z.object({
    id: z.string().uuid(), title: z.string(), status: z.string(), reward_name: z.string().nullable(), winner_table_id: z.string().uuid().nullable(),
  }).nullable(),
  participants: z.array(participantSchema),
});

const winnerSchema = z.object({ eventId: z.string().uuid(), participantId: z.string().uuid() });

export type AdminTableBattleState = {
  event: { id: string; title: string; status: string; rewardName: string | null; winnerTableId: string | null } | null;
  participants: Array<{ id: string; tableNumber: number; teamName: string; status: string; wordScore: number }>;
};

export function getAdminTableBattleController() {
  return handleController(async () => ({ body: await loadAdminTableBattleState() }));
}

export function selectAdminTableBattleWinnerController(request: Request) {
  return handleController(async () => {
    const [command, session] = await Promise.all([parseJson(request, winnerSchema, "우승 테이블을 다시 선택해 주세요."), requireAdminSession()]);
    const { error } = await session.client.rpc("select_table_battle_winner", { p_event_id: command.eventId, p_participant_id: command.participantId });
    if (error) throw conflict("우승 테이블을 확정하지 못했습니다. 현재 게임 상태를 다시 확인해 주세요.");
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
    },
    participants: parsed.data.participants.map((participant) => ({
      id: participant.id, tableNumber: participant.table_number, teamName: participant.team_name,
      status: participant.status, wordScore: participant.word_score,
    })),
  };
}
