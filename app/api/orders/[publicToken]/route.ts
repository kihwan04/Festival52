import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicSupabase } from "@/src/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  if (!z.string().uuid().safeParse(publicToken).success) return NextResponse.json({ message: "잘못된 주문 주소입니다." }, { status: 400 });
  const supabase = getPublicSupabase();
  if (!supabase) return NextResponse.json({ message: "주문 서비스가 연결되지 않았습니다." }, { status: 503 });
  const { data, error } = await supabase.rpc("get_public_order", { p_public_token: publicToken });
  if (error || !data) return NextResponse.json({ message: "주문을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(data);
}
