import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { notifyReadyOrder, registerOrderPushSubscription } from "@/src/features/push/application/push-service";
import type { PushDeliverySummary } from "@/src/features/push/domain/push-subscription";
import { SupabasePushGateway } from "@/src/features/push/infrastructure/supabase-push-gateway";
import { getVapidPublicKey, WebPushSender } from "@/src/features/push/infrastructure/web-push-sender";
import { pushSubscriptionSchema } from "@/src/features/push/presentation/schemas";
import { getPublicSupabase } from "@/src/lib/supabase/server";
import { notFound, serviceUnavailable } from "@/src/shared/errors/app-error";
import { handleController, parseJson } from "@/src/shared/http/route-handler";
import { signPushSubscription } from "@/src/shared/security/request-signing";

const uuidSchema = z.string().uuid();

export function getPushPublicKeyController() {
  return handleController(async () => ({ body: { publicKey: getVapidPublicKey() } }));
}

export function registerPushSubscriptionController(
  request: Request,
  context: { params: Promise<{ publicToken: string }> },
) {
  return handleController(async () => {
    const [body, params] = await Promise.all([
      parseJson(request, pushSubscriptionSchema, "알림 등록 정보를 다시 확인해 주세요."),
      context.params,
    ]);
    const publicToken = uuidSchema.safeParse(params.publicToken);
    if (!publicToken.success) throw notFound("잘못된 주문입니다.");
    const client = getPublicSupabase();
    if (!client) throw serviceUnavailable("알림 서비스를 연결하고 있습니다. 잠시 후 다시 시도해 주세요.");
    const subscription = { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth };
    await registerOrderPushSubscription(
      new SupabasePushGateway(client),
      publicToken.data,
      subscription,
      await signPushSubscription(request, publicToken.data, subscription),
    );
    return { body: { ok: true } };
  });
}

export async function notifyReadyPushBestEffort(client: SupabaseClient, orderId: string): Promise<PushDeliverySummary> {
  try {
    return await notifyReadyOrder(new SupabasePushGateway(client), new WebPushSender(), orderId);
  } catch {
    return { attempted: 0, delivered: 0, failed: 0, unavailable: true };
  }
}
