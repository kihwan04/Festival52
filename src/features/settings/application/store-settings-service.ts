import type { StoreSettings } from "@/src/features/settings/domain/store-settings";
import { isStoreConfigured } from "@/src/features/settings/domain/store-settings";
import { invalidInput } from "@/src/shared/errors/app-error";

export type StoreSettingsUpdate = Omit<StoreSettings, "configured">;

export interface StoreSettingsGateway {
  getPublic(): Promise<StoreSettings>;
  getAdmin(): Promise<StoreSettings>;
  update(settings: StoreSettingsUpdate): Promise<StoreSettings>;
}

export const getPublicStoreSettings = (gateway: StoreSettingsGateway) => gateway.getPublic();
export const getAdminStoreSettings = (gateway: StoreSettingsGateway) => gateway.getAdmin();

export function updateStoreSettings(gateway: StoreSettingsGateway, settings: StoreSettingsUpdate): Promise<StoreSettings> {
  if (settings.isOpen && !isStoreConfigured(settings)) throw invalidInput("영업을 시작하려면 은행, 계좌번호와 예금주를 모두 입력해 주세요.");
  return gateway.update(settings);
}
