import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicSupabase } from "@/src/lib/supabase/server";

const loginSchema = z.object({ email: z.string().email().max(240), password: z.string().min(8).max(200) });

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "이메일과 비밀번호를 확인해 주세요." }, { status: 400 });
  const supabase = getPublicSupabase();
  if (!supabase) return NextResponse.json({ message: "관리자 로그인이 아직 연결되지 않았습니다." }, { status: 503 });
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.session) return NextResponse.json({ message: "로그인 정보가 올바르지 않습니다." }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("festival_access_token", data.session.access_token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: data.session.expires_in });
  return response;
}
