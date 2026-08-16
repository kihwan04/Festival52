import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthGateway, AuthSessionResult } from "@/src/features/auth/application/auth-service";
import { getUserSupabase } from "@/src/lib/supabase/server";
import { conflict, forbidden, serviceUnavailable, unauthenticated } from "@/src/shared/errors/app-error";

export class SupabaseAuthGateway implements AuthGateway {
  constructor(private readonly publicClient: SupabaseClient) {}

  async login(email: string, password: string): Promise<AuthSessionResult> {
    const { data, error } = await this.publicClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw unauthenticated("로그인 정보가 올바르지 않습니다.");
    const userClient = getUserSupabase(data.session.access_token);
    if (!userClient) throw serviceUnavailable("관리자 권한을 확인하지 못했습니다.");
    let { data: isAdmin } = await userClient.rpc("is_festival_admin");
    if (isAdmin !== true) {
      const displayName = typeof data.user.user_metadata?.display_name === "string" ? data.user.user_metadata.display_name : "축제 관리자";
      const { error: bootstrapError } = await userClient.rpc("bootstrap_festival_admin", { p_display_name: displayName });
      if (!bootstrapError) ({ data: isAdmin } = await userClient.rpc("is_festival_admin"));
    }
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
}
