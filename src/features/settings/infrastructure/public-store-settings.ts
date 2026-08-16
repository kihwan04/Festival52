import { getPublicSupabase, isDemoMode } from "@/src/lib/supabase/server";
import { getPublicStoreSettings } from "@/src/features/settings/application/store-settings-service";
import { CLOSED_STORE_SETTINGS, DEMO_STORE_SETTINGS, type StoreSettings } from "@/src/features/settings/domain/store-settings";
import { SupabaseStoreSettingsGateway } from "@/src/features/settings/infrastructure/supabase-store-settings-gateway";

export async function loadPublicStoreSettings(teamSlug?: string): Promise<StoreSettings> {
  if (isDemoMode()) return DEMO_STORE_SETTINGS;
  const client = getPublicSupabase();
  if (!client) return CLOSED_STORE_SETTINGS;
  try {
    return await getPublicStoreSettings(new SupabaseStoreSettingsGateway(client), teamSlug);
  } catch {
    return CLOSED_STORE_SETTINGS;
  }
}
