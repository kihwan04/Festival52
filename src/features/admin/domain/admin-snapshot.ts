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

export interface DailySalesSummary extends SalesSummary {
  date: string;
}

export function emptySalesSummary(): SalesSummary {
  return { totalRevenue: 0, confirmedOrders: 0, dineInOrders: 0, takeoutOrders: 0, averageOrderAmount: 0 };
}

export function combineDailySales(rows: DailySalesSummary[]): SalesSummary {
  const combined = rows.reduce((result, row) => ({
    totalRevenue: result.totalRevenue + row.totalRevenue,
    confirmedOrders: result.confirmedOrders + row.confirmedOrders,
    dineInOrders: result.dineInOrders + row.dineInOrders,
    takeoutOrders: result.takeoutOrders + row.takeoutOrders,
    averageOrderAmount: 0,
  }), emptySalesSummary());
  combined.averageOrderAmount = combined.confirmedOrders ? Math.round(combined.totalRevenue / combined.confirmedOrders) : 0;
  return combined;
}

export function getSeoulDateKey(value: Date | string = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftDateKey(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export interface AdminSnapshot {
  orders: DemoOrder[];
  menu: MenuItem[];
  tables: FestivalTable[];
  categories: string[];
  settings: StoreSettings;
  sales: SalesSummary;
  dailySales: DailySalesSummary[];
  syncedAt: string;
}
