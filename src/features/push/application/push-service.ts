import type { SignedRequestProof } from "@/src/shared/security/request-signing";
import type { OrderPushDeliveryTarget, OrderPushSubscriptionInput, PushDeliverySummary } from "@/src/features/push/domain/push-subscription";

export interface PushGateway {
  register(publicToken: string, subscription: OrderPushSubscriptionInput, security: SignedRequestProof): Promise<void>;
  getDeliveryBatch(orderId: string): Promise<OrderPushDeliveryTarget[]>;
  finishDelivery(orderId: string): Promise<void>;
}

export interface PushSender {
  sendReady(targets: OrderPushDeliveryTarget[]): Promise<PushDeliverySummary>;
}

export const registerOrderPushSubscription = (
  gateway: PushGateway,
  publicToken: string,
  subscription: OrderPushSubscriptionInput,
  security: SignedRequestProof,
) => gateway.register(publicToken, subscription, security);

export async function notifyReadyOrder(gateway: PushGateway, sender: PushSender, orderId: string): Promise<PushDeliverySummary> {
  const targets = await gateway.getDeliveryBatch(orderId);
  if (targets.length === 0) return { attempted: 0, delivered: 0, failed: 0 };

  let summary: PushDeliverySummary;
  try {
    summary = await sender.sendReady(targets);
  } catch {
    summary = { attempted: targets.length, delivered: 0, failed: targets.length };
  }

  try {
    await gateway.finishDelivery(orderId);
  } catch {
    // Delivery must never roll back an already completed order transition.
  }
  return summary;
}
