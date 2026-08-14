import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getUserSupabase } from "@/src/lib/supabase/server";

const adjustmentSchema = z.object({ quantityChange: z.number().int().min(-1000).max(1000).refine((value) => value !== 0), reason: z.string().trim().min(2).max(240) });

export async function POST(request: Request, { params }: { params: Promise<{ menuItemId: string }> }) {
  const accessToken = (await cookies()).get("festival_access_token")?.value;
  if (!accessToken) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const parsed = adjustmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "수량과 조정 사유를 확인해 주세요." }, { status: 400 });
  const { menuItemId } = await params;
  if (!z.string().uuid().safeParse(menuItemId).success) return NextResponse.json({ message: "잘못된 메뉴입니다." }, { status: 400 });
  const supabase = getUserSupabase(accessToken);
  if (!supabase) return NextResponse.json({ message: "관리자 서비스가 연결되지 않았습니다." }, { status: 503 });
  const { data, error } = await supabase.rpc("adjust_menu_stock", { p_menu_item_id: menuItemId, p_quantity_change: parsed.data.quantityChange, p_reason: parsed.data.reason });
  if (error) return NextResponse.json({ message: "재고가 음수가 되지 않는지 확인해 주세요." }, { status: 409 });
  return NextResponse.json({ stockQuantity: data });
}
