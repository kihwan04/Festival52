import { z } from "zod";

export const createOrderSchema = z.object({
  teamSlug: z.string().regex(/^team-[a-f0-9]{16}$/),
  qrToken: z.string().min(16).max(160).nullable(),
  fulfillmentType: z.enum(["DINE_IN", "TAKEOUT"]),
  clientRequestId: z.string().uuid(),
  items: z.array(z.object({ menuItemId: z.string().uuid(), quantity: z.number().int().min(1).max(10) })).min(1).max(20),
}).superRefine((value, context) => {
  if (value.fulfillmentType === "DINE_IN" && !value.qrToken) context.addIssue({ code: z.ZodIssueCode.custom, path: ["qrToken"], message: "테이블 주문에는 QR 토큰이 필요합니다." });
  if (new Set(value.items.map((item) => item.menuItemId)).size !== value.items.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "같은 메뉴가 중복되어 있습니다." });
  if (value.items.reduce((sum, item) => sum + item.quantity, 0) > 20) context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "한 주문은 총 20개까지 가능합니다." });
});

export const transferClaimSchema = z.object({ publicToken: z.string().uuid() });
export const adminOrderActionSchema = z.object({ action: z.enum(["CONFIRM_PAYMENT", "START_COOKING", "MARK_READY", "MARK_SERVED", "CANCEL"]) });
