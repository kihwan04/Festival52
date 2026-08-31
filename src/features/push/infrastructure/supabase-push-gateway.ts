import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { PushGateway } from "@/src/features/push/application/push-service";
import type { OrderPushDeliveryTarget, OrderPushSubscriptionInput } from "@/src/features/push/domain/push-subscription";
import type { SignedRequestProof } from "@/src/shared/security/request-signing";
import { conflict, rateLimited } from "@/src/shared/errors/app-error";

const deliveryTargetSchema = z.object({
  subscription_id: z.string().uuid(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
  public_token: z.string().uuid(),
  order_number: z.string().min(1).max(40),
  fulfillment_type: z.enum(["DINE_IN", "TAKEOUT"]),
  stall_name: z.string().min(1).max(80),
});

export class SupabasePushGateway implements PushGateway {
  constructor(private readonly client: SupabaseClient) {}

  async register(publicToken: string, subscription: OrderPushSubscriptionInput, security: SignedRequestProof): Promise<void> {
    const { error } = await this.client.rpc("register_order_push_subscription", {
      p_public_token: publicToken,
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.p256dh,
      p_auth: subscription.auth,
      p_rate_key_hash: security.rateKeyHash,
      p_request_timestamp: security.requestTimestamp,
      p_signature: security.signature,
    });
    if (!error) return;
    const message = error.message.toLowerCase();
    if (message.includes("rate limit")) throw rateLimited("알림 등록 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
    if (message.includes("too many")) throw conflict("이 주문에 등록된 알림 기기가 너무 많습니다.");
    if (message.includes("no longer")) throw conflict("이미 준비가 끝났거나 종료된 주문에는 알림을 등록할 수 없습니다.");
    throw conflict("알림을 등록하지 못했습니다. 주문 현황 화면에서 다시 시도해 주세요.");
  }

  async getDeliveryBatch(orderId: string): Promise<OrderPushDeliveryTarget[]> {
    const { data, error } = await this.client.rpc("get_order_push_delivery_batch", { p_order_id: orderId });
    if (error) throw conflict("푸시 알림 대상을 확인하지 못했습니다.");
    const parsed = z.array(deliveryTargetSchema).safeParse(data ?? []);
    if (!parsed.success) throw conflict("푸시 알림 대상을 확인하지 못했습니다.");
    return parsed.data.map((row) => ({
      subscriptionId: row.subscription_id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      publicToken: row.public_token,
      orderNumber: row.order_number,
      fulfillmentType: row.fulfillment_type,
      stallName: row.stall_name,
    }));
  }

  async finishDelivery(orderId: string): Promise<void> {
    const { error } = await this.client.rpc("finish_order_push_delivery", { p_order_id: orderId });
    if (error) throw conflict("푸시 알림 정보를 정리하지 못했습니다.");
  }
}
