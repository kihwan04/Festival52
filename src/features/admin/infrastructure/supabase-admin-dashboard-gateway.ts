import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AdminDashboardGateway } from "@/src/features/admin/application/admin-dashboard-service";
import { combineDailySales, type AdminSnapshot, type DailySalesSummary } from "@/src/features/admin/domain/admin-snapshot";
import type { MenuCategory, MenuItem } from "@/src/features/menu/domain/menu";
import type { DemoOrder, FestivalTable } from "@/src/shared/demo-data";
import { conflict } from "@/src/shared/errors/app-error";

const snapshotSchema = z.object({
  orders: z.array(z.object({
    id: z.string().uuid(),
    order_number: z.string(),
    fulfillment_type: z.enum(["DINE_IN", "TAKEOUT"]),
    table_number: z.number().int().positive().nullable(),
    total_amount: z.number().int().nonnegative(),
    status: z.enum(["PENDING_PAYMENT", "PAID", "COOKING", "READY", "SERVED", "CANCELLED"]),
    payment_status: z.enum(["UNPAID", "CUSTOMER_MARKED_TRANSFERRED", "CONFIRMED", "REJECTED"]),
    created_at: z.string(),
    items: z.array(z.object({ menu_name: z.string(), quantity: z.number().int().positive() })),
  })),
  menu: z.array(z.object({
    id: z.string().uuid(), name: z.string(), description: z.string(), price: z.number().int().nonnegative(), category: z.string(),
    status: z.enum(["AVAILABLE", "SOLD_OUT", "HIDDEN", "ARCHIVED"]), stock_quantity: z.number().int().nonnegative(),
    reserved_quantity: z.number().int().nonnegative(), sold_quantity: z.number().int().nonnegative(),
  })),
  tables: z.array(z.object({ id: z.string().uuid(), table_number: z.number().int().positive(), qr_token: z.string(), is_active: z.boolean() })),
  categories: z.array(z.string()),
  settings: z.object({
    stall_name: z.string(), bank_name: z.string(), account_number: z.string(), account_holder: z.string(), operating_hours: z.string(), is_open: z.boolean(),
  }),
  daily_sales: z.array(z.object({
    sales_date: z.string(), total_revenue: z.union([z.number(), z.string()]), confirmed_orders: z.union([z.number(), z.string()]),
    dine_in_orders: z.union([z.number(), z.string()]), takeout_orders: z.union([z.number(), z.string()]), average_order_amount: z.union([z.number(), z.string()]),
  })),
  synced_at: z.string(),
});

type DbSnapshot = z.infer<typeof snapshotSchema>;
type DbOrder = DbSnapshot["orders"][number];
type DbMenu = DbSnapshot["menu"][number];
type DbTable = DbSnapshot["tables"][number];
type DbDailySale = DbSnapshot["daily_sales"][number];

export class SupabaseAdminDashboardGateway implements AdminDashboardGateway {
  constructor(private readonly client: SupabaseClient) {}

  async load(): Promise<AdminSnapshot> {
    const { data, error } = await this.client.rpc("get_admin_dashboard_snapshot");
    if (error) throw conflict("운영 현황을 불러오지 못했습니다.");
    const parsed = snapshotSchema.safeParse(data);
    if (!parsed.success) throw conflict("운영 현황 응답을 확인하지 못했습니다.");
    const snapshot = parsed.data;
    const dailySales = snapshot.daily_sales.map(mapDailySale);
    return {
      orders: snapshot.orders.map(mapOrder),
      menu: snapshot.menu.map(mapMenu),
      tables: snapshot.tables.map(mapTable),
      categories: snapshot.categories,
      settings: {
        stallName: snapshot.settings.stall_name,
        bankName: snapshot.settings.bank_name,
        accountNumber: snapshot.settings.account_number,
        accountHolder: snapshot.settings.account_holder,
        operatingHours: snapshot.settings.operating_hours,
        isOpen: snapshot.settings.is_open,
        configured: Boolean(snapshot.settings.bank_name && snapshot.settings.account_number && snapshot.settings.account_holder),
      },
      sales: combineDailySales(dailySales),
      dailySales,
      syncedAt: snapshot.synced_at,
    };
  }
}

function relativeTime(createdAt: string): string { const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)); return minutes === 0 ? "방금 전" : `${minutes}분 전` }

function mapOrder(row: DbOrder): DemoOrder {
  return { id: row.id, orderNumber: row.order_number, fulfillmentType: row.fulfillment_type, tableNumber: row.table_number,
    items: row.items.map((item) => ({ name: item.menu_name, quantity: item.quantity })), totalAmount: row.total_amount,
    orderStatus: row.status, paymentStatus: row.payment_status, orderedAt: relativeTime(row.created_at) };
}

function mapMenu(row: DbMenu): MenuItem {
  const emojiByCategory: Record<string, string> = { "안주": "🥘", "식사": "🍜", "간식": "🥔", "음료": "🍹" };
  return { id: row.id, name: row.name, description: row.description, price: row.price, category: row.category as MenuCategory,
    status: row.stock_quantity === 0 ? "SOLD_OUT" : row.status, stockQuantity: row.stock_quantity,
    reservedQuantity: row.reserved_quantity, soldQuantity: row.sold_quantity, emoji: emojiByCategory[row.category] ?? "🍽️" };
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
