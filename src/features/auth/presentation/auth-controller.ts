import { z } from "zod";
import { getPublicSupabase } from "@/src/lib/supabase/server";
import { loginAdmin, setupFirstAdmin } from "@/src/features/auth/application/auth-service";
import { SupabaseAuthGateway } from "@/src/features/auth/infrastructure/supabase-auth-gateway";
import { serviceUnavailable } from "@/src/shared/errors/app-error";
import { handleController, parseJson } from "@/src/shared/http/route-handler";

const loginSchema = z.object({ email: z.string().email().max(240), password: z.string().min(8).max(200) });
const setupSchema = z.object({
  email: z.string().email().max(240), password: z.string().min(10).max(200), displayName: z.string().trim().min(1).max(60),
});

const authCookie = (accessToken: string, maxAge: number) => ({
  name: "festival_access_token",
  value: accessToken,
  options: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge },
});

function authGateway() {
  const client = getPublicSupabase();
  if (!client) throw serviceUnavailable("관리자 로그인이 아직 연결되지 않았습니다.");
  return new SupabaseAuthGateway(client);
}

export function loginController(request: Request) {
  return handleController(async () => {
    const command = await parseJson(request, loginSchema, "이메일과 비밀번호를 확인해 주세요.");
    const result = await loginAdmin(authGateway(), command.email, command.password);
    if (!result.accessToken) throw serviceUnavailable("로그인 세션을 만들지 못했습니다.");
    return { body: { ok: true }, cookies: [authCookie(result.accessToken, result.expiresIn)] };
  });
}

export function setupController(request: Request) {
  return handleController(async () => {
    const command = await parseJson(request, setupSchema, "이름, 이메일과 10자 이상의 비밀번호를 확인해 주세요.");
    const result = await setupFirstAdmin(authGateway(), command.email, command.password, command.displayName, `${new URL(request.url).origin}/admin`);
    return {
      body: { ok: true, confirmationRequired: result.confirmationRequired },
      cookies: result.accessToken ? [authCookie(result.accessToken, result.expiresIn)] : [],
    };
  });
}

export function logoutController() {
  return handleController(async () => ({
    body: { ok: true },
    cookies: [{ name: "festival_access_token", value: "", options: { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 0 } }],
  }));
}
