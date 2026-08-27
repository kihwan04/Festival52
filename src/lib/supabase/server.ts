import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function supabaseUrl(): string | null { return process.env.SUPABASE_URL?.trim() || null }
function supabasePublishableKey(): string | null { return process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || null }

const DEPLOYED_SITE_ORIGIN = "https://festival-52-qr-order.rlghks12291.chatgpt.site";

export function isDemoMode(): boolean {
  const renderTest = (globalThis as { __FESTIVAL_RENDER_TEST__?: boolean }).__FESTIVAL_RENDER_TEST__ === true;
  return (process.env.NODE_ENV !== "production" || renderTest) && process.env.FESTIVAL_DEMO_MODE === "true";
}

export function isOperatorSignupEnabled(): boolean {
  return process.env.FESTIVAL_ALLOW_SIGNUP === "true";
}

export function publicSiteOrigin(): string {
  const configured = process.env.FESTIVAL_PUBLIC_ORIGIN?.trim();
  if (!configured) return DEPLOYED_SITE_ORIGIN;
  try {
    const url = new URL(configured);
    const localDevelopment = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localDevelopment) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return DEPLOYED_SITE_ORIGIN;
    }
    return url.origin;
  } catch {
    return DEPLOYED_SITE_ORIGIN;
  }
}

export function getUserSupabase(accessToken: string): SupabaseClient | null {
  const url = supabaseUrl();
  const publishableKey = supabasePublishableKey();
  if (!url || !publishableKey) return null;
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function getPublicSupabase(): SupabaseClient | null {
  const url = supabaseUrl();
  const publishableKey = supabasePublishableKey();
  if (!url || !publishableKey) return null;
  return createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
