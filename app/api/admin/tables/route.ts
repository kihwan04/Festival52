import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserSupabase } from "@/src/lib/supabase/server";

export async function POST(request: Request) {
  const accessToken = (await cookies()).get("festival_access_token")?.value;
  if (!accessToken) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const parsed = z.object({ count: z.number().int().min(1).max(200) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "테이블 수는 1~200개로 입력해 주세요." }, { status: 400 });
  const supabase = getUserSupabase(accessToken);
  if (!supabase) return NextResponse.json({ message: "관리자 서비스가 연결되지 않았습니다." }, { status: 503 });
  const { data, error } = await supabase.rpc("configure_festival_tables", { p_count: parsed.data.count });
  if (error) return NextResponse.json({ message: "테이블을 설정하지 못했습니다." }, { status: 409 });
  return NextResponse.json(data);
}
