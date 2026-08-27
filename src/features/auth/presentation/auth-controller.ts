import { z } from "zod";
import { getPublicSupabase, isOperatorSignupEnabled, publicSiteOrigin } from "@/src/lib/supabase/server";
import { authorizeLoginAttempt, authorizeSignupAttempt, changeAdminPassword, loginAdmin, signupOperator } from "@/src/features/auth/application/auth-service";
import { SupabaseAuthGateway } from "@/src/features/auth/infrastructure/supabase-auth-gateway";
import { adminSessionCookies, clearedAdminSessionCookies } from "@/src/shared/auth/auth-cookies";
import { forbidden, serviceUnavailable } from "@/src/shared/errors/app-error";
import { handleController, parseJson } from "@/src/shared/http/route-handler";
import { assertSecureAdminPassword } from "@/src/shared/security/password-security";
import { signLoginAttempt, signSignupAttempt, signSignupProvision } from "@/src/shared/security/request-signing";
import { requireAdminSession } from "@/src/shared/auth/admin-session";

const loginSchema = z.object({ email: z.string().email().max(240), password: z.string().min(8).max(200) });
const signupSchema = z.object({
  departmentName: z.string().trim().min(2).max(80).refine((value) => !value.includes("|")),
  teamName: z.string().trim().min(2).max(80).refine((value) => !value.includes("|")),
  displayName: z.string().trim().min(2).max(60).refine((value) => !value.includes("|")),
  email: z.string().trim().email().max(240),
  password: z.string().min(14).max(200),
  passwordConfirm: z.string().min(14).max(200),
}).refine((value) => value.password === value.passwordConfirm, {
  path: ["passwordConfirm"],
  message: "비밀번호가 서로 다릅니다.",
});
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

export function signupController(request: Request) {
  return handleController(async () => {
    if (!isOperatorSignupEnabled()) throw forbidden("운영자 가입이 잠겨 있습니다. 기존 운영자 계정으로 로그인해 주세요.");
    const command = await parseJson(request, signupSchema, "학과명, 운영팀명과 계정 정보를 확인해 주세요.");
    const gateway = authGateway();
    await authorizeSignupAttempt(gateway, await signSignupAttempt(request));
    await assertSecureAdminPassword(command.password, command.email);
    const signupCommand = {
      departmentName: command.departmentName,
      teamName: command.teamName,
      displayName: command.displayName,
      email: command.email.toLowerCase(),
      password: command.password,
    };
    const result = await signupOperator(
      gateway,
      signupCommand,
      new URL("/admin", publicSiteOrigin()).toString(),
      await signSignupProvision(signupCommand),
    );
    if (result.confirmationRequired) {
      return { body: { ok: true, confirmationRequired: true } };
    }
    if (!result.accessToken || !result.refreshToken) throw serviceUnavailable("로그인 세션을 만들지 못했습니다.");
    return {
      body: { ok: true, confirmationRequired: false },
      cookies: adminSessionCookies(result.accessToken, result.refreshToken, result.expiresIn),
    };
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
  return handleController(async () => {
    try {
      const session = await requireAdminSession();
      await session.client.auth.signOut({ scope: "local" });
    } catch {
      // Clearing both HttpOnly cookies is still required when the remote
      // session has already expired or Auth is temporarily unavailable.
    }
    return { body: { ok: true }, cookies: clearedAdminSessionCookies() };
  });
}
