import type { Metadata } from "next";
import { CustomerOrder } from "@/src/components/CustomerOrder";
import { loadPublicMenu } from "@/src/features/menu/infrastructure/public-menu";
import { loadPublicStoreSettings } from "@/src/features/settings/infrastructure/public-store-settings";
import { isDemoMode } from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "포장 주문" };
export default async function BoothOrderPage() {
  const [menuItems, storeSettings] = await Promise.all([loadPublicMenu(), loadPublicStoreSettings()]);
  if (!menuItems) return <main className="customer-shell invalid-qr"><div><span>!</span><h1>주문 준비 중이에요</h1><p>잠시 후 다시 시도해 주세요.</p></div></main>;
  return <CustomerOrder initialFulfillment="TAKEOUT" menuItems={menuItems} storeSettings={storeSettings} demoMode={isDemoMode()} />;
}
