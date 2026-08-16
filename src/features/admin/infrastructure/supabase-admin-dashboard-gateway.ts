import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminDashboardGateway } from "@/src/features/admin/application/admin-dashboard-service";
import { combineDailySales, type AdminSnapshot, type DailySalesSummary } from "@/src/features/admin/domain/admin-snapshot";
import type { MenuCategory, MenuItem, MenuStatus } from "@/src/features/menu/domain/menu";
import type { FulfillmentType, OrderStatus, PaymentStatus } from "@/src/features/orders/domain/order";
import { SupabaseStoreSettingsGateway } from "@/src/features/settings/infrastructure/supabase-store-settings-gateway";
import type { DemoOrder, FestivalTable } from "@/src/shared/demo-data";
import { conflict } from "@/src/shared/errors/app-error";

interface DbOrder {
  id: string; order_number: string; fulfillment_type: FulfillmentType; total_amount: number; status: OrderStatus; created_at: string;
  festival_tables: { table_number: number } | Array<{ table_number: number }> | null;
  order_items: Array<{ menu_name: string; quantity: number }>;
  payments: { status: PaymentStatus } | Array<{ status: PaymentStatus }>;
}
interface DbMenu { id: string; name: string; description: string; price: number; category: string; status: MenuStatus; stock_quantity: number }
interface DbTable { id: string; table_number: number; qr_token: string; is_active: boolean }
interface DbOrderItemStat { menu_item_id: string; quantity: number; orders: { status: OrderStatus } | Array<{ status: OrderStatus }> }
interface DbDailySale {
  sales_date: string;
  total_revenue: number | string;
  confirmed_orders: number | string;
  dine_in_orders: number | string;
  takeout_orders: number | string;
  average_order_amount: number | string;
}

export class SupabaseAdminDashboardGateway implements AdminDashboardGateway {
  constructor(private readonly client: SupabaseClient) {}

  async load(): Promise<AdminSnapshot> {
    const [ordersResult, menuResult, itemStatsResult, tableResult, categoryResult, salesResult, settings] = await Promise.all([
      this.client.from("orders").select("id,order_number,fulfillment_type,total_amount,status,created_at,festival_tables(table_number),order_items(menu_name,quantity),payments(status)").order("created_at", { ascending: false }).limit(200),
      this.client.from("menu_items").select("id,name,description,price,category,status,stock_quantity").order("sort_order"),
      this.client.from("order_items").select("menu_item_id,quantity,orders(status)"),
      this.client.from("festival_tables").select("id,table_number,qr_token,is_active").order("table_number"),
      this.client.from("menu_categories").select("name").order("sort_order").order("name"),
      this.client.rpc("get_admin_sales_by_day"),
      new SupabaseStoreSettingsGateway(this.client).getAdmin(),
    ]);
    const error = ordersResult.error ?? menuResult.error ?? itemStatsResult.error ?? tableResult.error ?? categoryResult.error ?? salesResult.error;
    if (error) throw conflict("운영 현황을 불러오지 못했습니다.");
    const inventoryStats = buildInventoryStats((itemStatsResult.data ?? []) as unknown as DbOrderItemStat[]);
    const dailySales = ((salesResult.data ?? []) as unknown as DbDailySale[]).map(mapDailySale);
    return {
      orders: ((ordersResult.data ?? []) as unknown as DbOrder[]).map(mapOrder),
      menu: ((menuResult.data ?? []) as unknown as DbMenu[]).map((item) => mapMenu(item, inventoryStats.get(item.id))),
      tables: ((tableResult.data ?? []) as DbTable[]).map(mapTable),
      categories: ((categoryResult.data ?? []) as Array<{ name: string }>).map((item) => item.name),
      settings,
      sales: combineDailySales(dailySales),
      dailySales,
      syncedAt: new Date().toISOString(),
    };
  }
}

function firstRelation<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value }
function relativeTime(createdAt: string): string { const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)); return minutes === 0 ? "방금 전" : `${minutes}분 전` }

function mapOrder(row: DbOrder): DemoOrder {
  const table = firstRelation(row.festival_tables);
  const payment = firstRelation(row.payments);
  return { id: row.id, orderNumber: row.order_number, fulfillmentType: row.fulfillment_type, tableNumber: table?.table_number ?? null,
    items: row.order_items.map((item) => ({ name: item.menu_name, quantity: item.quantity })), totalAmount: row.total_amount,
    orderStatus: row.status, paymentStatus: payment?.status ?? "UNPAID", orderedAt: relativeTime(row.created_at) };
}

function buildInventoryStats(rows: DbOrderItemStat[]): Map<string, { reserved: number; sold: number }> {
  const result = new Map<string, { reserved: number; sold: number }>();
  for (const row of rows) {
    const status = firstRelation(row.orders)?.status;
    if (!status || status === "CANCELLED") continue;
    const current = result.get(row.menu_item_id) ?? { reserved: 0, sold: 0 };
    if (status === "PENDING_PAYMENT") current.reserved += row.quantity;
    else current.sold += row.quantity;
    result.set(row.menu_item_id, current);
  }
  return result;
}

function mapMenu(row: DbMenu, stats?: { reserved: number; sold: number }): MenuItem {
  const emojiByCategory: Record<string, string> = { "안주": "🥘", "식사": "🍜", "간식": "🥔", "음료": "🍹" };
  return { id: row.id, name: row.name, description: row.description, price: row.price, category: row.category as MenuCategory,
    status: row.stock_quantity === 0 ? "SOLD_OUT" : row.status, stockQuantity: row.stock_quantity,
    reservedQuantity: stats?.reserved ?? 0, soldQuantity: stats?.sold ?? 0, emoji: emojiByCategory[row.category] ?? "🍽️" };
}

function mapTable(row: DbTable): FestivalTable { return { id: row.id, tableNumber: row.table_number, qrToken: row.qr_token, isActive: row.is_active } }

function mapDailySale(row: DbDailySale): DailySalesSummary {
  return {
    date: row.sales_date,
    totalRevenue: Number(row.total_revenue),
    confirmedOrders: Number(row.confirmed_orders),
    dineInOrders: Number(row.dine_in_orders),
    takeoutOrders: Number(row.takeout_orders),
    averageOrderAmount: Number(row.average_order_amount),
  };
}
