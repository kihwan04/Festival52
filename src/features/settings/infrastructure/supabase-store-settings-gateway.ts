import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { StoreSettingsGateway, StoreSettingsUpdate } from "@/src/features/settings/application/store-settings-service";
import type { StoreSettings } from "@/src/features/settings/domain/store-settings";
import { conflict } from "@/src/shared/errors/app-error";

const settingsSchema = z.object({
  stall_name: z.string(), bank_name: z.string(), account_number: z.string(), account_holder: z.string(),
  operating_hours: z.string(), is_open: z.boolean(), configured: z.boolean(),
});

export class SupabaseStoreSettingsGateway implements StoreSettingsGateway {
  constructor(private readonly client: SupabaseClient) {}

  async getPublic(teamSlug?: string): Promise<StoreSettings> {
    const { data, error } = teamSlug
      ? await this.client.rpc("get_public_store_settings", { p_team_slug: teamSlug })
      : await this.client.rpc("get_public_store_settings");
    if (error) throw conflict("매장 설정을 불러오지 못했습니다.");
    return mapSettings(data);
  }

  async getAdmin(): Promise<StoreSettings> {
    const { data, error } = await this.client.from("store_settings")
      .select("stall_name,bank_name,account_number,account_holder,operating_hours,is_open").limit(1).maybeSingle();
    if (error || !data) throw conflict("매장 설정을 불러오지 못했습니다.");
    return mapSettings({ ...data, configured: Boolean(data.bank_name && data.account_number && data.account_holder) });
  }

  async update(settings: StoreSettingsUpdate): Promise<StoreSettings> {
    const { data, error } = await this.client.rpc("update_store_settings", {
      p_stall_name: settings.stallName,
      p_bank_name: settings.bankName,
      p_account_number: settings.accountNumber,
      p_account_holder: settings.accountHolder,
      p_operating_hours: settings.operatingHours,
      p_is_open: settings.isOpen,
    });
    if (error) throw conflict("매장 설정을 저장하지 못했습니다.");
    return mapSettings(data);
  }
}

function mapSettings(value: unknown): StoreSettings {
  const parsed = settingsSchema.safeParse(value);
  if (!parsed.success) throw conflict("매장 설정 결과를 확인하지 못했습니다.");
  return {
    stallName: parsed.data.stall_name,
    bankName: parsed.data.bank_name,
    accountNumber: parsed.data.account_number,
    accountHolder: parsed.data.account_holder,
    operatingHours: parsed.data.operating_hours,
    isOpen: parsed.data.is_open,
    configured: parsed.data.configured,
  };
}
