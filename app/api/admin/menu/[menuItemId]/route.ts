import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getUserSupabase } from "@/src/lib/supabase/server";

const adjustmentSchema = z.object({ quantityChange: z.number().int().min(-1000).max(1000).refine((value) => value !== 0), reason: z.string().trim().min(2).max(240) });
const editSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  price: z.number().int().min(0).max(10_000_000).optional(),
  category: z.string().trim().min(1).max(30).optional(),
  status: z.enum(["AVAILABLE", "SOLD_OUT", "HIDDEN", "ARCHIVED"]).optional(),
}).refine((value) => Object.keys(value).length > 0);

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

export async function PATCH(request: Request, { params }: { params: Promise<{ menuItemId: string }> }) {
  const accessToken = (await cookies()).get("festival_access_token")?.value;
  if (!accessToken) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const parsed = editSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "수정할 메뉴 정보를 확인해 주세요." }, { status: 400 });
  const { menuItemId } = await params;
  if (!z.string().uuid().safeParse(menuItemId).success) return NextResponse.json({ message: "잘못된 메뉴입니다." }, { status: 400 });
  const supabase = getUserSupabase(accessToken);
  if (!supabase) return NextResponse.json({ message: "관리자 서비스가 연결되지 않았습니다." }, { status: 503 });
  if (parsed.data.category) {
    const { data: category } = await supabase.from("menu_categories").select("name").eq("name", parsed.data.category).maybeSingle();
    if (!category) return NextResponse.json({ message: "등록되지 않은 카테고리입니다." }, { status: 400 });
  }
  const updates = {
    ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
    ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
    ...(parsed.data.price === undefined ? {} : { price: parsed.data.price }),
    ...(parsed.data.category === undefined ? {} : { category: parsed.data.category }),
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("menu_items").update(updates).eq("id", menuItemId).select("id,name,description,price,category,status,stock_quantity").single();
  if (error) return NextResponse.json({ message: "메뉴를 수정하지 못했습니다." }, { status: 409 });
  return NextResponse.json(data);
}
