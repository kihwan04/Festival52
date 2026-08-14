import type { Metadata } from "next";
import { AdminDashboard } from "@/src/components/AdminDashboard";
import { AdminLogin } from "@/src/components/AdminLogin";
import { cookies } from "next/headers";
import { getUserSupabase, isDemoMode } from "@/src/lib/supabase/server";
import type { DemoOrder } from "@/src/shared/demo-data";
import type { MenuItem, MenuCategory, MenuStatus } from "@/src/features/menu/domain/menu";
import type { FulfillmentType, OrderStatus, PaymentStatus } from "@/src/features/orders/domain/order";

export const metadata: Metadata = { title: "운영 대시보드" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (isDemoMode()) return <AdminDashboard demoMode />;
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("festival_access_token")?.value;
  if (!accessToken) return <AdminLogin />;
  const supabase = getUserSupabase(accessToken);
  if (!supabase) return <AdminLogin />;
  const { data: userData } = await supabase.auth.getUser(accessToken);
  if (!userData.user) return <AdminLogin />;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (!profile || !["ADMIN", "STAFF"].includes(String(profile.role))) return <AdminLogin />;
  const [ordersResult, menuResult, itemStatsResult] = await Promise.all([
    supabase.from("orders").select("id,order_number,fulfillment_type,total_amount,status,created_at,festival_tables(table_number),order_items(menu_name,quantity),payments(status)").order("created_at", { ascending: false }).limit(100),
    supabase.from("menu_items").select("id,name,description,price,category,status,stock_quantity").neq("status", "ARCHIVED").order("sort_order"),
    supabase.from("order_items").select("menu_item_id,quantity,orders(status)"),
  ]);
  const stats = buildInventoryStats((itemStatsResult.data ?? []) as unknown as DbOrderItemStat[]);
  const initialOrders = ((ordersResult.data ?? []) as unknown as DbOrder[]).map(mapOrder);
  const initialMenu = ((menuResult.data ?? []) as unknown as DbMenu[]).map((item) => mapMenu(item, stats.get(item.id)));
  return <AdminDashboard initialOrders={initialOrders} initialMenu={initialMenu} demoMode={false} />;
}

interface DbOrder {
  id: string; order_number: string; fulfillment_type: FulfillmentType; total_amount: number; status: OrderStatus; created_at: string;
  festival_tables: { table_number: number } | Array<{ table_number: number }> | null;
  order_items: Array<{ menu_name: string; quantity: number }>;
  payments: { status: PaymentStatus } | Array<{ status: PaymentStatus }>;
}
interface DbMenu { id: string; name: string; description: string; price: number; category: string; status: MenuStatus; stock_quantity: number }
interface DbOrderItemStat { menu_item_id: string; quantity: number; orders: { status: OrderStatus } | Array<{ status: OrderStatus }> }

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
