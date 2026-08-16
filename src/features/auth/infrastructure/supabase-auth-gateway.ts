import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthGateway, AuthSessionResult, LoginAttemptProof } from "@/src/features/auth/application/auth-service";
import { getUserSupabase } from "@/src/lib/supabase/server";
import { conflict, forbidden, rateLimited, serviceUnavailable, unauthenticated } from "@/src/shared/errors/app-error";

export class SupabaseAuthGateway implements AuthGateway {
  constructor(private readonly publicClient: SupabaseClient) {}

  async authorizeLoginAttempt(proof: LoginAttemptProof): Promise<void> {
    const { error } = await this.publicClient.rpc("authorize_festival_login_attempt", {
      p_rate_key_hash: proof.rateKeyHash,
      p_request_timestamp: proof.requestTimestamp,
      p_signature: proof.signature,
    });
    if (!error) return;
    if (error.message.toLowerCase().includes("rate limit")) throw rateLimited("로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요.");
    throw serviceUnavailable("로그인 보안 확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  async login(email: string, password: string): Promise<AuthSessionResult> {
    const { data, error } = await this.publicClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw unauthenticated("로그인 정보가 올바르지 않습니다.");
    const userClient = getUserSupabase(data.session.access_token);
    if (!userClient) throw serviceUnavailable("관리자 권한을 확인하지 못했습니다.");
    const { data: isAdmin } = await userClient.rpc("is_festival_admin");
    if (isAdmin !== true) throw forbidden("등록된 운영자 계정이 아닙니다.");
    return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresIn: data.session.expires_in, confirmationRequired: false };
  }

  async setup(email: string, password: string, displayName: string, redirectTo: string): Promise<AuthSessionResult> {
    const { data: available, error: availabilityError } = await this.publicClient.rpc("festival_admin_setup_available");
    if (availabilityError || available !== true) throw conflict("첫 관리자 설정이 이미 완료되었습니다.");
    const { data, error } = await this.publicClient.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName }, emailRedirectTo: redirectTo },
    });
    if (error || !data.user) throw conflict("계정을 만들지 못했습니다. 이메일이 이미 사용 중인지 확인해 주세요.");
    if (!data.session) return { accessToken: null, refreshToken: null, expiresIn: 0, confirmationRequired: true };
    const userClient = getUserSupabase(data.session.access_token);
    if (!userClient) throw serviceUnavailable("관리자 등록을 완료하지 못했습니다.");
    const { error: bootstrapError } = await userClient.rpc("bootstrap_festival_admin", { p_display_name: displayName });
    if (bootstrapError) throw conflict("계정은 생성됐지만 관리자 등록을 완료하지 못했습니다.");
    return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresIn: data.session.expires_in, confirmationRequired: false };
  }

  async changePassword(accessToken: string, currentPassword: string, newPassword: string): Promise<AuthSessionResult> {
    const currentClient = getUserSupabase(accessToken);
    if (!currentClient) throw serviceUnavailable("관리자 계정을 확인하지 못했습니다.");
    const { data: userData, error: userError } = await currentClient.auth.getUser(accessToken);
    const email = userData.user?.email;
    if (userError || !email) throw unauthenticated("로그인이 만료되었습니다. 다시 로그인해 주세요.");

    const { data: verified, error: verifyError } = await this.publicClient.auth.signInWithPassword({ email, password: currentPassword });
    if (verifyError || !verified.session) throw unauthenticated("현재 비밀번호가 올바르지 않습니다.");

    const verifiedClient = getUserSupabase(verified.session.access_token);
    if (!verifiedClient) throw serviceUnavailable("비밀번호를 변경하지 못했습니다.");
    const { error: updateError } = await verifiedClient.auth.updateUser({ password: newPassword });
    if (updateError) throw conflict("새 비밀번호를 저장하지 못했습니다. 다른 비밀번호를 사용해 주세요.");

    const { data: fresh, error: freshError } = await this.publicClient.auth.signInWithPassword({ email, password: newPassword });
    if (freshError || !fresh.session) throw serviceUnavailable("비밀번호는 변경됐지만 새 로그인 세션을 만들지 못했습니다. 다시 로그인해 주세요.");
    const freshClient = getUserSupabase(fresh.session.access_token);
    await freshClient?.auth.signOut({ scope: "others" }).catch(() => undefined);
    return {
      accessToken: fresh.session.access_token,
      refreshToken: fresh.session.refresh_token,
      expiresIn: fresh.session.expires_in,
      confirmationRequired: false,
    };
  }
}
