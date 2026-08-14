import { NextResponse } from "next/server";
import { createOrderSchema } from "@/src/features/orders/presentation/schemas";
import { getPublicSupabase } from "@/src/lib/supabase/server";

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  const parsed = createOrderSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ code: "INVALID_ORDER", message: "주문 내용을 다시 확인해 주세요." }, { status: 400 });

  const supabase = getPublicSupabase();
  if (!supabase) return NextResponse.json({ code: "SERVICE_NOT_CONFIGURED", message: "주문 서비스가 아직 연결되지 않았습니다." }, { status: 503 });

  const { data, error } = await supabase.rpc("create_festival_order", {
    p_qr_token: parsed.data.qrToken,
    p_fulfillment_type: parsed.data.fulfillmentType,
    p_client_request_id: parsed.data.clientRequestId,
    p_items: parsed.data.items.map((item) => ({ menu_item_id: item.menuItemId, quantity: item.quantity })),
  });
  if (error) return NextResponse.json({ code: "ORDER_REJECTED", message: error.message.includes("stock") ? "남은 재고가 부족합니다. 메뉴를 다시 확인해 주세요." : "주문을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 409 });
  return NextResponse.json(data, { status: 201 });
}
