import type { Metadata } from "next";
import { TableBattle } from "@/src/components/TableBattle";
import { resolveTable } from "@/src/features/menu/infrastructure/public-menu";
import { isDemoMode } from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "TABLE BATTLE" };

export default async function TableBattlePage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params;
  const table = await resolveTable(qrToken);
  if (!table) return <main className="customer-shell invalid-qr"><div><span>!</span><h1>사용할 수 없는 QR이에요</h1><p>QR이 잘못되었거나 현재 비활성 상태입니다.<br />가까운 운영 부스에 문의해 주세요.</p></div></main>;
  return <TableBattle qrToken={qrToken} tableNumber={table.tableNumber} demoMode={isDemoMode()} />;
}
