import { sendPushBatch, topicFromString, type PushSubscriptionData, type VapidConfig } from "@mmmike/web-push/send";
import type { PushSender } from "@/src/features/push/application/push-service";
import { normalizeAllowedPushEndpoint, type OrderPushDeliveryTarget, type PushDeliverySummary } from "@/src/features/push/domain/push-subscription";
import { serviceUnavailable } from "@/src/shared/errors/app-error";

export class WebPushSender implements PushSender {
  async sendReady(targets: OrderPushDeliveryTarget[]): Promise<PushDeliverySummary> {
    if (targets.length === 0) return { attempted: 0, delivered: 0, failed: 0 };
    const vapid = vapidConfig();
    const first = targets[0];
    const validTargets = targets.filter((target) => normalizeAllowedPushEndpoint(target.endpoint) === target.endpoint);
    const subscriptions: PushSubscriptionData[] = validTargets.map((target) => ({
      endpoint: target.endpoint,
      expirationTime: null,
      keys: { p256dh: target.p256dh, auth: target.auth },
    }));
    const payload = {
      title: `${first.stallName.slice(0, 60)} · 주문 준비 완료`,
      body: first.fulfillmentType === "TAKEOUT"
        ? `#${first.orderNumber} 포장이 준비됐어요. 부스에서 주문번호를 보여주세요.`
        : `#${first.orderNumber} 조리가 완료됐어요. 곧 테이블로 가져다드릴게요.`,
      url: `/order/${first.publicToken}`,
      tag: `festival-order-${first.publicToken}`,
    };
    const result = await sendPushBatch(subscriptions, payload, vapid, {
      ttl: 60 * 60,
      urgency: "high",
      topic: await topicFromString(`order-ready:${first.publicToken}`),
      concurrency: 3,
      timeoutMs: 8_000,
    });
    return {
      attempted: targets.length,
      delivered: result.delivered,
      failed: targets.length - validTargets.length + result.gone.length + result.failed.length,
    };
  }
}

export function getVapidPublicKey(): string {
  return vapidConfig().publicKey;
}

function vapidConfig(): VapidConfig {
  const publicKey = process.env.FESTIVAL_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.FESTIVAL_VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.FESTIVAL_VAPID_SUBJECT?.trim() ?? "";
  let validSubject = false;
  try {
    const parsed = new URL(subject);
    validSubject = (parsed.protocol === "https:" || parsed.protocol === "mailto:") && subject.length <= 256;
  } catch {
    validSubject = false;
  }
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey)
      || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)
      || !validSubject) {
    throw serviceUnavailable("푸시 알림 서비스를 설정하고 있습니다. 잠시 후 다시 시도해 주세요.");
  }
  return { publicKey, privateKey, subject };
}
