import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserSupabase } from "@/src/lib/supabase/server";
import { forbidden, serviceUnavailable, unauthenticated } from "@/src/shared/errors/app-error";

export interface AdminSession {
  client: SupabaseClient;
  userId: string;
  accessToken: string;
}

export async function requireAdminSession(): Promise<AdminSession> {
  const accessToken = (await cookies()).get("festival_access_token")?.value;
  if (!accessToken) throw unauthenticated();
  const client = getUserSupabase(accessToken);
  if (!client) throw serviceUnavailable("관리자 서비스가 연결되지 않았습니다.");
  const { data: userData, error: userError } = await client.auth.getUser(accessToken);
  if (userError || !userData.user) throw unauthenticated("로그인이 만료되었습니다. 다시 로그인해 주세요.");
  const { data: isAdmin, error: roleError } = await client.rpc("is_festival_admin");
  if (roleError || isAdmin !== true) throw forbidden("등록된 운영자 계정이 아닙니다.");
  return { client, userId: userData.user.id, accessToken };
}
