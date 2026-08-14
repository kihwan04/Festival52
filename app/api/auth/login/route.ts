import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicSupabase, getUserSupabase } from "@/src/lib/supabase/server";

const loginSchema = z.object({ email: z.string().email().max(240), password: z.string().min(8).max(200) });

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "이메일과 비밀번호를 확인해 주세요." }, { status: 400 });
  const supabase = getPublicSupabase();
  if (!supabase) return NextResponse.json({ message: "관리자 로그인이 아직 연결되지 않았습니다." }, { status: 503 });
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.session) return NextResponse.json({ message: "로그인 정보가 올바르지 않습니다." }, { status: 401 });
  const userSupabase = getUserSupabase(data.session.access_token);
  if (!userSupabase) return NextResponse.json({ message: "관리자 권한을 확인하지 못했습니다." }, { status: 503 });
  let { data: isAdmin } = await userSupabase.rpc("is_festival_admin");
  if (isAdmin !== true) {
    const displayName = typeof data.user.user_metadata?.display_name === "string" ? data.user.user_metadata.display_name : "축제 관리자";
    const { error: bootstrapError } = await userSupabase.rpc("bootstrap_festival_admin", { p_display_name: displayName });
    if (!bootstrapError) ({ data: isAdmin } = await userSupabase.rpc("is_festival_admin"));
  }
  if (isAdmin !== true) return NextResponse.json({ message: "등록된 운영자 계정이 아닙니다." }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("festival_access_token", data.session.access_token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: data.session.expires_in });
  return response;
}
