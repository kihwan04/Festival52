import { z } from "zod";

const qrTokenSchema = z.string().min(16).max(160);

export const tableBattleStateQuerySchema = z.object({ qrToken: qrTokenSchema });
export const tableBattleJoinSchema = z.object({
  qrToken: qrTokenSchema,
  teamName: z.string().trim().min(2, "팀 이름은 2자 이상 입력해 주세요.").max(30, "팀 이름은 30자까지 입력할 수 있어요.")
    .refine((value) => /^[\p{L}\p{N}\s&!._-]+$/u.test(value), "팀 이름에는 문자, 숫자와 기본 기호만 사용할 수 있어요."),
});
export const tableBattleWordAnswerSchema = z.object({
  qrToken: qrTokenSchema,
  answer: z.string().trim().min(1).max(80),
});
export const tableBattleFloorChoiceSchema = z.object({
  qrToken: qrTokenSchema,
  tileX: z.number().int().min(0).max(7),
  tileY: z.number().int().min(0).max(7),
});
export const tableBattleBombTransferSchema = z.object({
  qrToken: qrTokenSchema,
  targetTableNumber: z.number().int().positive().max(500),
  expectedVersion: z.number().int().nonnegative(),
});
