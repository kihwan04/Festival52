import { NextResponse } from "next/server";
import { transferClaimSchema } from "@/src/features/orders/presentation/schemas";
import { getPublicSupabase } from "@/src/lib/supabase/server";

export async function POST(request: Request) {
  const parsed = transferClaimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "잘못된 주문 정보입니다." }, { status: 400 });
  const supabase = getPublicSupabase();
  if (!supabase) return NextResponse.json({ message: "주문 서비스가 연결되지 않았습니다." }, { status: 503 });
  const { error } = await supabase.rpc("mark_transfer_claimed", { p_public_token: parsed.data.publicToken });
  if (error) return NextResponse.json({ message: "입금 확인 요청을 처리하지 못했습니다." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
