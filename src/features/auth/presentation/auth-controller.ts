import { z } from "zod";
import { getPublicSupabase } from "@/src/lib/supabase/server";
import { authorizeLoginAttempt, changeAdminPassword, loginAdmin } from "@/src/features/auth/application/auth-service";
import { SupabaseAuthGateway } from "@/src/features/auth/infrastructure/supabase-auth-gateway";
import { adminSessionCookies, clearedAdminSessionCookies } from "@/src/shared/auth/auth-cookies";
import { serviceUnavailable } from "@/src/shared/errors/app-error";
import { handleController, parseJson } from "@/src/shared/http/route-handler";
import { assertSecureAdminPassword } from "@/src/shared/security/password-security";
import { signLoginAttempt } from "@/src/shared/security/request-signing";
import { requireAdminSession } from "@/src/shared/auth/admin-session";

const loginSchema = z.object({ email: z.string().email().max(240), password: z.string().min(8).max(200) });
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(14).max(200),
}).refine((value) => value.currentPassword !== value.newPassword, { path: ["newPassword"], message: "새 비밀번호를 입력해 주세요." });

function authGateway() {
  const client = getPublicSupabase();
  if (!client) throw serviceUnavailable("관리자 로그인이 아직 연결되지 않았습니다.");
  return new SupabaseAuthGateway(client);
}

export function loginController(request: Request) {
  return handleController(async () => {
    const command = await parseJson(request, loginSchema, "이메일과 비밀번호를 확인해 주세요.");
    const gateway = authGateway();
    await authorizeLoginAttempt(gateway, await signLoginAttempt(request));
    const result = await loginAdmin(gateway, command.email, command.password);
    if (!result.accessToken || !result.refreshToken) throw serviceUnavailable("로그인 세션을 만들지 못했습니다.");
    return { body: { ok: true }, cookies: adminSessionCookies(result.accessToken, result.refreshToken, result.expiresIn) };
  });
}

export function changePasswordController(request: Request) {
  return handleController(async () => {
    const [command, session] = await Promise.all([
      parseJson(request, passwordChangeSchema, "현재 비밀번호와 14자 이상의 새 비밀번호를 확인해 주세요."),
      requireAdminSession(),
    ]);
    const { data: userData, error: userError } = await session.client.auth.getUser(session.accessToken);
    const email = userData.user?.email;
    if (userError || !email) throw serviceUnavailable("관리자 계정을 확인하지 못했습니다.");
    await assertSecureAdminPassword(command.newPassword, email);
    const result = await changeAdminPassword(authGateway(), session.accessToken, command.currentPassword, command.newPassword);
    if (!result.accessToken || !result.refreshToken) throw serviceUnavailable("새 로그인 세션을 만들지 못했습니다.");
    return { body: { ok: true }, cookies: adminSessionCookies(result.accessToken, result.refreshToken, result.expiresIn) };
  });
}

export function logoutController() {
  return handleController(async () => ({
    body: { ok: true },
    cookies: clearedAdminSessionCookies(),
  }));
}
