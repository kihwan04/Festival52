import type { MenuItem } from "@/src/features/menu/domain/menu";
import type { StoreSettings } from "@/src/features/settings/domain/store-settings";
import type { DemoOrder, FestivalTable } from "@/src/shared/demo-data";

export interface SalesSummary {
  totalRevenue: number;
  confirmedOrders: number;
  dineInOrders: number;
  takeoutOrders: number;
  averageOrderAmount: number;
}

export interface AdminSnapshot {
  orders: DemoOrder[];
  menu: MenuItem[];
  tables: FestivalTable[];
  categories: string[];
  settings: StoreSettings;
  sales: SalesSummary;
  syncedAt: string;
}
