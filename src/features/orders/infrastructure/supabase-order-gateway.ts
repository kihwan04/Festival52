import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CreateOrderCommand, CreatedOrder, CreateOrderSecurity, OrderGateway } from "@/src/features/orders/application/order-service";
import type { AdminOrderAction, PublicOrder } from "@/src/features/orders/domain/order";
import { conflict, forbidden, notFound, rateLimited } from "@/src/shared/errors/app-error";

const createdOrderSchema = z.object({
  order_id: z.string().uuid(),
  order_number: z.string().min(2),
  public_token: z.string().uuid(),
  total_amount: z.number().int().nonnegative(),
  table_number: z.number().int().positive().nullable().optional(),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  duplicate: z.boolean(),
});

const publicOrderSchema = z.object({
  order_number: z.string(),
  fulfillment_type: z.enum(["DINE_IN", "TAKEOUT"]),
  table_number: z.number().int().positive().nullable(),
  total_amount: z.number().int().nonnegative(),
  order_status: z.enum(["PENDING_PAYMENT", "PAID", "COOKING", "READY", "SERVED", "CANCELLED"]),
  payment_status: z.enum(["UNPAID", "CUSTOMER_MARKED_TRANSFERRED", "CONFIRMED", "REJECTED"]),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  items: z.array(z.object({
    name: z.string(), quantity: z.number().int().positive(), subtotal: z.number().int().nonnegative(),
    selected_options: z.array(z.object({ name: z.string(), price_delta: z.number().int().nonnegative() })).default([]),
  }).transform((item) => ({
    name: item.name,
    quantity: item.quantity,
    subtotal: item.subtotal,
    selectedOptions: item.selected_options.map((option) => ({ name: option.name, priceDelta: option.price_delta })),
  }))),
});

export class SupabaseOrderGateway implements OrderGateway {
  constructor(private readonly client: SupabaseClient) {}

  async create(command: CreateOrderCommand, security: CreateOrderSecurity): Promise<CreatedOrder> {
    const { data, error } = await this.client.rpc("create_festival_order", {
      p_team_slug: command.teamSlug,
      p_qr_token: command.qrToken,
      p_fulfillment_type: command.fulfillmentType,
      p_client_request_id: command.clientRequestId,
      p_items: command.items.map((item) => ({ menu_item_id: item.menuItemId, quantity: item.quantity, option_ids: item.optionIds })),
      p_customer_name: command.customerName,
      p_customer_phone: command.customerPhone,
      p_rate_key_hash: security.rateKeyHash,
      p_request_timestamp: security.requestTimestamp,
      p_signature: security.signature,
    });
    if (error) throw mapCreateError(error.message);
    const parsed = createdOrderSchema.safeParse(data);
    if (!parsed.success) throw conflict("주문 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
    return { ...parsed.data, table_number: parsed.data.table_number ?? null, expires_at: parsed.data.expires_at ?? null };
  }

  async markTransferClaimed(publicToken: string, security: CreateOrderSecurity): Promise<void> {
    const { error } = await this.client.rpc("mark_transfer_claimed", {
      p_public_token: publicToken,
      p_rate_key_hash: security.rateKeyHash,
      p_request_timestamp: security.requestTimestamp,
      p_signature: security.signature,
    });
    if (!error) return;
    if (error.message.toLowerCase().includes("rate limit")) throw rateLimited("입금 확인 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
    throw conflict("이미 처리됐거나 입금 요청이 불가능한 주문입니다.");
  }

  async findPublicOrder(publicToken: string, security: CreateOrderSecurity): Promise<PublicOrder | null> {
    const { data, error } = await this.client.rpc("get_public_order", {
      p_public_token: publicToken,
      p_rate_key_hash: security.rateKeyHash,
      p_request_timestamp: security.requestTimestamp,
      p_signature: security.signature,
    });
    if (error?.message.toLowerCase().includes("rate limit")) throw rateLimited("주문 상태 확인이 너무 잦습니다. 잠시 후 다시 시도해 주세요.");
    if (error) throw notFound("주문을 찾을 수 없습니다.");
    if (!data) return null;
    const parsed = publicOrderSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  }

  async process(orderId: string, action: AdminOrderAction): Promise<void> {
    const { error } = await this.client.rpc("admin_process_order", { p_order_id: orderId, p_action: action });
    if (!error) return;
    if (error.message.toLowerCase().includes("admin")) throw forbidden();
    throw conflict("현재 주문 상태에서는 해당 작업을 수행할 수 없습니다.");
  }
}

function mapCreateError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("store closed") || normalized.includes("store not configured")) return conflict("현재 주문을 받고 있지 않습니다.");
  if (normalized.includes("stock")) return conflict("남은 재고가 부족합니다. 메뉴를 다시 확인해 주세요.");
  if (normalized.includes("qr")) return conflict("사용할 수 없는 테이블 QR입니다.");
  if (normalized.includes("unavailable")) return conflict("현재 주문할 수 없는 메뉴가 포함되어 있습니다.");
  if (normalized.includes("rate limit") || normalized.includes("too many unpaid")) return rateLimited("주문 요청이 너무 많습니다. 기존 주문을 입금 처리하거나 잠시 후 다시 시도해 주세요.");
  if (normalized.includes("quantity limit") || normalized.includes("invalid quantity")) return conflict("한 주문은 메뉴별 10개, 전체 20개까지 가능합니다.");
  if (normalized.includes("contact")) return conflict("포장 주문의 이름과 휴대폰 번호를 다시 확인해 주세요.");
  if (normalized.includes("option")) return conflict("선택한 옵션이 변경되었습니다. 메뉴를 새로고침해 다시 선택해 주세요.");
  if (normalized.includes("signature") || normalized.includes("signing")) return conflict("주문 보안 확인에 실패했습니다. 화면을 새로고침해 주세요.");
  return conflict("주문을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
