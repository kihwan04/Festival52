import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function supabaseUrl(): string | null { return process.env.SUPABASE_URL?.trim() || null }
function supabasePublishableKey(): string | null { return process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || null }

export function isDemoMode(): boolean { return process.env.FESTIVAL_DEMO_MODE === "true" }

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
