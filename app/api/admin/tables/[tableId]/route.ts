import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserSupabase } from "@/src/lib/supabase/server";

export async function POST(_request: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const accessToken = (await cookies()).get("festival_access_token")?.value;
  if (!accessToken) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const { tableId } = await params;
  if (!z.string().uuid().safeParse(tableId).success) return NextResponse.json({ message: "잘못된 테이블입니다." }, { status: 400 });
  const supabase = getUserSupabase(accessToken);
  if (!supabase) return NextResponse.json({ message: "관리자 서비스가 연결되지 않았습니다." }, { status: 503 });
  const { data, error } = await supabase.rpc("rotate_festival_table_qr", { p_table_id: tableId });
  if (error) return NextResponse.json({ message: "QR을 재발급하지 못했습니다." }, { status: 409 });
  return NextResponse.json({ qrToken: data });
}
