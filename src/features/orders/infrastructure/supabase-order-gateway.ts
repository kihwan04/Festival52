import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CreateOrderCommand, CreatedOrder, OrderGateway } from "@/src/features/orders/application/order-service";
import type { AdminOrderAction, PublicOrder } from "@/src/features/orders/domain/order";
import { conflict, forbidden, notFound } from "@/src/shared/errors/app-error";

const createdOrderSchema = z.object({
  order_id: z.string().uuid(),
  order_number: z.string().min(2),
  public_token: z.string().uuid(),
  total_amount: z.number().int().nonnegative(),
  table_number: z.number().int().positive().nullable().optional(),
  duplicate: z.boolean(),
});

const publicOrderSchema: z.ZodType<PublicOrder> = z.object({
  order_number: z.string(),
  fulfillment_type: z.enum(["DINE_IN", "TAKEOUT"]),
  table_number: z.number().int().positive().nullable(),
  total_amount: z.number().int().nonnegative(),
  order_status: z.enum(["PENDING_PAYMENT", "PAID", "COOKING", "READY", "SERVED", "CANCELLED"]),
  payment_status: z.enum(["UNPAID", "CUSTOMER_MARKED_TRANSFERRED", "CONFIRMED", "REJECTED"]),
  items: z.array(z.object({ name: z.string(), quantity: z.number().int().positive(), subtotal: z.number().int().nonnegative() })),
});

export class SupabaseOrderGateway implements OrderGateway {
  constructor(private readonly client: SupabaseClient) {}

  async create(command: CreateOrderCommand): Promise<CreatedOrder> {
    const { data, error } = await this.client.rpc("create_festival_order", {
      p_qr_token: command.qrToken,
      p_fulfillment_type: command.fulfillmentType,
      p_client_request_id: command.clientRequestId,
      p_items: command.items.map((item) => ({ menu_item_id: item.menuItemId, quantity: item.quantity })),
    });
    if (error) throw mapCreateError(error.message);
    const parsed = createdOrderSchema.safeParse(data);
    if (!parsed.success) throw conflict("주문 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
    return { ...parsed.data, table_number: parsed.data.table_number ?? null };
  }

  async markTransferClaimed(publicToken: string): Promise<void> {
    const { error } = await this.client.rpc("mark_transfer_claimed", { p_public_token: publicToken });
    if (error) throw conflict("이미 처리됐거나 입금 요청이 불가능한 주문입니다.");
  }

  async findPublicOrder(publicToken: string): Promise<PublicOrder | null> {
    const { data, error } = await this.client.rpc("get_public_order", { p_public_token: publicToken });
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
  return conflict("주문을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
