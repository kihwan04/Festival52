import type { Metadata } from "next";
import { CustomerOrder } from "@/src/components/CustomerOrder";
import { loadPublicMenu, resolveTable } from "@/src/features/menu/infrastructure/public-menu";
import { isDemoMode } from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "테이블 주문" };

export default async function TableOrderPage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params;
  const [table, menuItems] = await Promise.all([resolveTable(qrToken), loadPublicMenu()]);
  if (!table || !menuItems) return <InvalidQr />;
  return <CustomerOrder initialFulfillment="DINE_IN" tableNumber={table.tableNumber} qrToken={qrToken} menuItems={menuItems} demoMode={isDemoMode()} />;
}

function InvalidQr() {
  return <main className="customer-shell invalid-qr"><div><span>!</span><h1>사용할 수 없는 QR이에요</h1><p>QR이 잘못되었거나 현재 비활성 상태입니다.<br />가까운 운영 부스에 문의해 주세요.</p></div></main>;
}
