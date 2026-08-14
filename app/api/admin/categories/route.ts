import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserSupabase } from "@/src/lib/supabase/server";

const nameSchema = z.string().trim().min(1).max(30);

async function adminClient() {
  const accessToken = (await cookies()).get("festival_access_token")?.value;
  return accessToken ? getUserSupabase(accessToken) : null;
}

export async function POST(request: Request) {
  const parsed = z.object({ name: nameSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "카테고리 이름을 확인해 주세요." }, { status: 400 });
  const supabase = await adminClient();
  if (!supabase) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await supabase.from("menu_categories").insert({ name: parsed.data.name }).select("name").single();
  if (error) return NextResponse.json({ message: "같은 이름의 카테고리가 있는지 확인해 주세요." }, { status: 409 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = z.object({ previousName: nameSchema, nextName: nameSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "카테고리 이름을 확인해 주세요." }, { status: 400 });
  const supabase = await adminClient();
  if (!supabase) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const { error } = await supabase.rpc("rename_menu_category", { p_previous_name: parsed.data.previousName, p_next_name: parsed.data.nextName });
  if (error) return NextResponse.json({ message: "카테고리 이름을 바꾸지 못했습니다." }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const parsed = z.object({ name: nameSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "삭제할 카테고리를 확인해 주세요." }, { status: 400 });
  const supabase = await adminClient();
  if (!supabase) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const { error } = await supabase.rpc("delete_menu_category", { p_name: parsed.data.name });
  if (error) return NextResponse.json({ message: "사용 중인 카테고리는 삭제할 수 없습니다." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
