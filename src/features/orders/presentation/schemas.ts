import { z } from "zod";

const customerNameSchema = z.string().trim().min(1).max(40)
  .refine((value) => Array.from(value).every((character) => {
    const code = character.charCodeAt(0);
    return character !== "|" && code >= 32 && code !== 127;
  }), "이름에 사용할 수 없는 문자가 포함되어 있습니다.");
const customerPhoneSchema = z.string()
  .transform((value) => value.replace(/[^0-9]/g, ""))
  .refine((value) => /^01[016789][0-9]{7,8}$/.test(value), "휴대폰 번호를 확인해 주세요.");

export const createOrderSchema = z.object({
  teamSlug: z.string().regex(/^team-[a-f0-9]{16}$/),
  qrToken: z.string().min(16).max(160).nullable(),
  fulfillmentType: z.enum(["DINE_IN", "TAKEOUT"]),
  clientRequestId: z.string().uuid(),
  customerName: customerNameSchema.nullable(),
  customerPhone: customerPhoneSchema.nullable(),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().min(1).max(10),
    optionIds: z.array(z.string().uuid()).max(12).default([]).refine((ids) => new Set(ids).size === ids.length),
  })).min(1).max(20),
}).superRefine((value, context) => {
  if (value.fulfillmentType === "DINE_IN" && !value.qrToken) context.addIssue({ code: z.ZodIssueCode.custom, path: ["qrToken"], message: "테이블 주문에는 QR 토큰이 필요합니다." });
  if (value.fulfillmentType === "TAKEOUT" && (!value.customerName || !value.customerPhone)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["customerName"], message: "포장 주문에는 이름과 휴대폰 번호가 필요합니다." });
  if (value.fulfillmentType === "DINE_IN" && (value.customerName || value.customerPhone)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["customerName"], message: "연락처는 포장 주문에만 입력할 수 있습니다." });
  const lineKeys = value.items.map((item) => `${item.menuItemId}:${[...item.optionIds].sort().join(",")}`);
  if (new Set(lineKeys).size !== lineKeys.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "같은 메뉴와 옵션 조합이 중복되어 있습니다." });
  if (value.items.reduce((sum, item) => sum + item.quantity, 0) > 20) context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "한 주문은 총 20개까지 가능합니다." });
});

export const transferClaimSchema = z.object({ publicToken: z.string().uuid() });
export const adminOrderActionSchema = z.object({ action: z.enum(["CONFIRM_PAYMENT", "START_COOKING", "MARK_READY", "MARK_SERVED", "CANCEL"]) });
export const ownerManualOrderSchema = z.object({
  clientRequestId: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  amount: z.number().int().min(100).max(10_000_000),
  fulfillmentType: z.enum(["DINE_IN", "TAKEOUT"]),
  tableNumber: z.number().int().positive().max(200).nullable(),
}).superRefine((value, context) => {
  if (value.fulfillmentType === "DINE_IN" && value.tableNumber === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tableNumber"], message: "테이블 번호를 선택해 주세요." });
  if (value.fulfillmentType === "TAKEOUT" && value.tableNumber !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tableNumber"], message: "포장 주문에는 테이블 번호를 입력할 수 없습니다." });
});
