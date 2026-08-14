export interface StoreSettings {
  stallName: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  operatingHours: string;
  isOpen: boolean;
  configured: boolean;
}

export const DEMO_STORE_SETTINGS: StoreSettings = {
  stallName: "컴공 52",
  bankName: "카카오뱅크",
  accountNumber: "3333-12-3456789",
  accountHolder: "축제운영위원회",
  operatingHours: "17:00 — 23:30",
  isOpen: true,
  configured: true,
};

export const CLOSED_STORE_SETTINGS: StoreSettings = {
  stallName: "컴공 52",
  bankName: "",
  accountNumber: "",
  accountHolder: "",
  operatingHours: "17:00 — 23:30",
  isOpen: false,
  configured: false,
};

export function isStoreConfigured(settings: Pick<StoreSettings, "bankName" | "accountNumber" | "accountHolder">): boolean {
  return Boolean(settings.bankName.trim() && settings.accountNumber.trim() && settings.accountHolder.trim());
}
