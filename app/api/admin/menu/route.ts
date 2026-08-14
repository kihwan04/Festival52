import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserSupabase } from "@/src/lib/supabase/server";

const menuSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  price: z.number().int().min(0).max(10_000_000),
  category: z.string().trim().min(1).max(30),
  status: z.enum(["AVAILABLE", "SOLD_OUT", "HIDDEN"]).default("AVAILABLE"),
  stockQuantity: z.number().int().min(0).max(100_000),
});

export async function POST(request: Request) {
  const accessToken = (await cookies()).get("festival_access_token")?.value;
  if (!accessToken) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const parsed = menuSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "메뉴 이름, 가격, 카테고리와 재고를 확인해 주세요." }, { status: 400 });
  const supabase = getUserSupabase(accessToken);
  if (!supabase) return NextResponse.json({ message: "관리자 서비스가 연결되지 않았습니다." }, { status: 503 });

  const { data: category } = await supabase.from("menu_categories").select("name").eq("name", parsed.data.category).maybeSingle();
  if (!category) return NextResponse.json({ message: "먼저 사용할 카테고리를 만들어 주세요." }, { status: 400 });
  const { data, error } = await supabase.from("menu_items").insert({
    name: parsed.data.name,
    description: parsed.data.description,
    price: parsed.data.price,
    category: parsed.data.category,
    status: parsed.data.stockQuantity === 0 ? "SOLD_OUT" : parsed.data.status,
    stock_quantity: parsed.data.stockQuantity,
  }).select("id,name,description,price,category,status,stock_quantity").single();
  if (error) return NextResponse.json({ message: "메뉴를 추가하지 못했습니다." }, { status: 409 });
  return NextResponse.json(data, { status: 201 });
}
