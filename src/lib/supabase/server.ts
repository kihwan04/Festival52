import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function supabaseUrl(): string | null { return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null }
function supabaseAnonKey(): string | null { return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null }

export function isDemoMode(): boolean { return process.env.FESTIVAL_DEMO_MODE === "true" }

export function getUserSupabase(accessToken: string): SupabaseClient | null {
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function getPublicSupabase(): SupabaseClient | null {
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
