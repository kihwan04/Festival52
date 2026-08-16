import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabase, getUserSupabase } from "@/src/lib/supabase/server";
import { ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE, adminSessionCookies } from "@/src/shared/auth/auth-cookies";
import { forbidden, serviceUnavailable, unauthenticated } from "@/src/shared/errors/app-error";

export interface AdminSession {
  client: SupabaseClient;
  userId: string;
  accessToken: string;
}

export async function requireAdminSession(): Promise<AdminSession> {
  const cookieStore = await cookies();
  let accessToken = cookieStore.get(ADMIN_ACCESS_COOKIE)?.value ?? null;
  let refreshToken = cookieStore.get(ADMIN_REFRESH_COOKIE)?.value ?? null;
  let refreshed = false;

  const refresh = async () => {
    if (!refreshToken) throw unauthenticated("로그인이 만료되었습니다. 다시 로그인해 주세요.");
    const publicClient = getPublicSupabase();
    if (!publicClient) throw serviceUnavailable("관리자 서비스가 연결되지 않았습니다.");
    const { data, error } = await publicClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) throw unauthenticated("로그인이 만료되었습니다. 다시 로그인해 주세요.");
    accessToken = data.session.access_token;
    refreshToken = data.session.refresh_token;
    refreshed = true;
    try {
      for (const cookie of adminSessionCookies(accessToken, refreshToken, data.session.expires_in)) {
        cookieStore.set(cookie.name, cookie.value, cookie.options);
      }
    } catch {
      // Server Components cannot write cookies. The first API refresh writes the rotated pair.
    }
  };

  if ((!accessToken || accessTokenExpiresSoon(accessToken)) && refreshToken) await refresh();
  if (!accessToken) throw unauthenticated();

  let client = getUserSupabase(accessToken);
  if (!client) throw serviceUnavailable("관리자 서비스가 연결되지 않았습니다.");
  let { data: isAdmin, error: roleError } = await client.rpc("is_festival_admin");
  if ((roleError || isAdmin !== true) && refreshToken && !refreshed) {
    await refresh();
    if (!accessToken) throw unauthenticated();
    client = getUserSupabase(accessToken);
    if (!client) throw serviceUnavailable("관리자 서비스가 연결되지 않았습니다.");
    ({ data: isAdmin, error: roleError } = await client.rpc("is_festival_admin"));
  }
  if (roleError) throw unauthenticated("로그인이 만료되었습니다. 다시 로그인해 주세요.");
  if (isAdmin !== true) throw forbidden("등록된 운영자 계정이 아닙니다.");
  const userId = accessTokenSubject(accessToken);
  if (!userId) throw unauthenticated("로그인이 만료되었습니다. 다시 로그인해 주세요.");
  return { client, userId, accessToken };
}

function accessTokenSubject(accessToken: string): string | null {
  try {
    const payload = decodeAccessToken(accessToken) as { sub?: unknown };
    return typeof payload.sub === "string" && /^[0-9a-f-]{36}$/i.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

function accessTokenExpiresSoon(accessToken: string): boolean {
  try {
    const decoded = decodeAccessToken(accessToken) as { exp?: unknown };
    return typeof decoded.exp !== "number" || decoded.exp <= Math.floor(Date.now() / 1000) + 120;
  } catch {
    return true;
  }
}

function decodeAccessToken(accessToken: string): unknown {
  const payload = accessToken.split(".")[1];
  if (!payload) throw new Error("invalid token");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  return JSON.parse(atob(normalized)) as unknown;
}
