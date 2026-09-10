import { getPublicSupabase } from "@/src/lib/supabase/server";
import { invalidInput, serviceUnavailable } from "@/src/shared/errors/app-error";
import { handleController, parseJson } from "@/src/shared/http/route-handler";
import { signTableBattleRequest } from "@/src/shared/security/request-signing";
import { SupabaseTableBattleGateway } from "@/src/features/table-battle/infrastructure/supabase-table-battle-gateway";
import { isOfficialKoreanNoun } from "@/src/features/table-battle/infrastructure/korean-dictionary";
import { tableBattleBombTransferSchema, tableBattleFloorChoiceSchema, tableBattleJoinSchema, tableBattleStateQuerySchema, tableBattleWordAnswerSchema } from "@/src/features/table-battle/presentation/schemas";

function publicGateway() {
  const client = getPublicSupabase();
  if (!client) throw serviceUnavailable("TABLE BATTLE 서비스가 아직 연결되지 않았습니다.");
  return new SupabaseTableBattleGateway(client);
}

export function getTableBattleStateController(request: Request) {
  return handleController(async () => {
    const params = tableBattleStateQuerySchema.safeParse({ qrToken: new URL(request.url).searchParams.get("qrToken") });
    if (!params.success) throw invalidInput("테이블 QR 정보를 다시 확인해 주세요.");
    const proof = await signTableBattleRequest(request, "state", params.data.qrToken);
    return { body: await publicGateway().getState(params.data.qrToken, proof) };
  });
}

export function joinTableBattleController(request: Request) {
  return handleController(async () => {
    const command = await parseJson(request, tableBattleJoinSchema, "팀 이름을 다시 확인해 주세요.");
    return { body: await publicGateway().join(command.qrToken, command.teamName, await signTableBattleRequest(request, "join", command.qrToken)) };
  });
}

export function submitTableBattleWordAnswerController(request: Request) {
  return handleController(async () => {
    const command = await parseJson(request, tableBattleWordAnswerSchema, "정답을 다시 확인해 주세요.");
    if (!await isOfficialKoreanNoun(command.answer)) throw invalidInput("국립국어원 한국어기초사전에 등재된 명사만 입력할 수 있어요.");
    return { body: await publicGateway().submitWordAnswer(command.qrToken, command.answer, true, await signTableBattleRequest(request, "word", command.qrToken)) };
  });
}

export function chooseTableBattleFloorTileController(request: Request) {
  return handleController(async () => {
    const command = await parseJson(request, tableBattleFloorChoiceSchema, "바닥 위치를 다시 선택해 주세요.");
    return { body: await publicGateway().chooseFloorTile(command.qrToken, command.tileX, command.tileY, await signTableBattleRequest(request, "floor", command.qrToken)) };
  });
}

export function transferTableBattleBombController(request: Request) {
  return handleController(async () => {
    const command = await parseJson(request, tableBattleBombTransferSchema, "폭탄을 넘길 테이블을 다시 확인해 주세요.");
    return { body: await publicGateway().transferBomb(command.qrToken, command.targetTableNumber, command.expectedVersion, await signTableBattleRequest(request, "bomb", command.qrToken)) };
  });
}
