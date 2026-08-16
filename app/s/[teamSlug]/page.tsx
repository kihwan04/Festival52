import type { Metadata } from "next";
import { CustomerOrder } from "@/src/components/CustomerOrder";
import { loadPublicMenu } from "@/src/features/menu/infrastructure/public-menu";
import { loadPublicStoreSettings } from "@/src/features/settings/infrastructure/public-store-settings";
import { isDemoMode } from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "포장 주문" };

export default async function TeamTakeoutPage({ params }: { params: Promise<{ teamSlug: string }> }) {
  const { teamSlug } = await params;
  if (!/^team-[a-f0-9]{16}$/.test(teamSlug)) return <InvalidTeam />;
  const [menuItems, storeSettings] = await Promise.all([
    loadPublicMenu(teamSlug),
    loadPublicStoreSettings(teamSlug),
  ]);
  if (!menuItems) return <InvalidTeam />;
  return <CustomerOrder initialFulfillment="TAKEOUT" teamSlug={teamSlug} menuItems={menuItems} storeSettings={storeSettings} demoMode={isDemoMode()} />;
}

function InvalidTeam() {
  return <main className="customer-shell invalid-qr"><div><span>!</span><h1>사용할 수 없는 주문 주소예요</h1><p>운영팀에서 새 포장 QR을 받아 주세요.</p></div></main>;
}
