import { NextResponse } from "next/server";
import { adminOrderActionSchema } from "@/src/features/orders/presentation/schemas";
import { getUserSupabase } from "@/src/lib/supabase/server";
import { cookies } from "next/headers";

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const accessToken = (await cookies()).get("festival_access_token")?.value;
  if (!accessToken) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const parsed = adminOrderActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "허용되지 않은 작업입니다." }, { status: 400 });
  const supabase = getUserSupabase(accessToken);
  if (!supabase) return NextResponse.json({ message: "관리자 서비스가 연결되지 않았습니다." }, { status: 503 });
  const { orderId } = await params;
  const { error } = await supabase.rpc("admin_process_order", { p_order_id: orderId, p_action: parsed.data.action });
  if (error) return NextResponse.json({ message: "관리자 권한 또는 주문 상태를 확인해 주세요." }, { status: 403 });
  return NextResponse.json({ ok: true });
}
