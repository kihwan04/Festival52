import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicSupabase, getUserSupabase } from "@/src/lib/supabase/server";

const setupSchema = z.object({
  email: z.string().email().max(240),
  password: z.string().min(10).max(200),
  displayName: z.string().trim().min(1).max(60),
});

export async function POST(request: Request) {
  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "이름, 이메일과 10자 이상의 비밀번호를 확인해 주세요." }, { status: 400 });
  const supabase = getPublicSupabase();
  if (!supabase) return NextResponse.json({ message: "관리자 서비스가 연결되지 않았습니다." }, { status: 503 });

  const { data: available, error: availabilityError } = await supabase.rpc("festival_admin_setup_available");
  if (availabilityError || available !== true) return NextResponse.json({ message: "첫 관리자 설정이 이미 완료되었습니다." }, { status: 409 });

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { display_name: parsed.data.displayName }, emailRedirectTo: `${new URL(request.url).origin}/admin` },
  });
  if (error || !data.user) return NextResponse.json({ message: "계정을 만들지 못했습니다. 이메일이 이미 사용 중인지 확인해 주세요." }, { status: 409 });

  if (!data.session) return NextResponse.json({ ok: true, confirmationRequired: true });
  const userSupabase = getUserSupabase(data.session.access_token);
  const { error: bootstrapError } = userSupabase ? await userSupabase.rpc("bootstrap_festival_admin", { p_display_name: parsed.data.displayName }) : { error: new Error("not configured") };
  if (bootstrapError) return NextResponse.json({ message: "계정은 생성됐지만 관리자 등록을 완료하지 못했습니다." }, { status: 409 });

  const response = NextResponse.json({ ok: true, confirmationRequired: false });
  response.cookies.set("festival_access_token", data.session.access_token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: data.session.expires_in });
  return response;
}
