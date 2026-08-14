import { z } from "zod";
import { getPublicSupabase } from "@/src/lib/supabase/server";
import { createOrder, getPublicOrder, markTransferClaimed, processAdminOrder } from "@/src/features/orders/application/order-service";
import { SupabaseOrderGateway } from "@/src/features/orders/infrastructure/supabase-order-gateway";
import { adminOrderActionSchema, createOrderSchema, transferClaimSchema } from "@/src/features/orders/presentation/schemas";
import { notFound, serviceUnavailable } from "@/src/shared/errors/app-error";
import { requireAdminSession } from "@/src/shared/auth/admin-session";
import { handleController, parseJson } from "@/src/shared/http/route-handler";

const uuidSchema = z.string().uuid();

function publicGateway() {
  const client = getPublicSupabase();
  if (!client) throw serviceUnavailable("주문 서비스가 아직 연결되지 않았습니다.");
  return new SupabaseOrderGateway(client);
}

export function createOrderController(request: Request) {
  return handleController(async () => {
    const command = await parseJson(request, createOrderSchema, "주문 내용을 다시 확인해 주세요.");
    return { body: await createOrder(publicGateway(), command), status: 201 };
  });
}

export function markTransferController(request: Request) {
  return handleController(async () => {
    const command = await parseJson(request, transferClaimSchema, "잘못된 주문 정보입니다.");
    await markTransferClaimed(publicGateway(), command.publicToken);
    return { body: { ok: true } };
  });
}

export function getPublicOrderController(_request: Request, context: { params: Promise<{ publicToken: string }> }) {
  return handleController(async () => {
    const { publicToken } = await context.params;
    const token = uuidSchema.safeParse(publicToken);
    if (!token.success) throw notFound("잘못된 주문 주소입니다.");
    const order = await getPublicOrder(publicGateway(), token.data);
    if (!order) throw notFound("주문을 찾을 수 없습니다.");
    return { body: order };
  });
}

export function processAdminOrderController(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return handleController(async () => {
    const [command, params, session] = await Promise.all([
      parseJson(request, adminOrderActionSchema, "허용되지 않은 작업입니다."),
      context.params,
      requireAdminSession(),
    ]);
    const orderId = uuidSchema.safeParse(params.orderId);
    if (!orderId.success) throw notFound("잘못된 주문입니다.");
    await processAdminOrder(new SupabaseOrderGateway(session.client), orderId.data, command.action);
    return { body: { ok: true } };
  });
}
