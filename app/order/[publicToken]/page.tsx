import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { OrderTracker, type PublicOrder } from "@/src/components/OrderTracker";
import { getPublicSupabase } from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "주문 현황" };
export const dynamic = "force-dynamic";

export default async function PublicOrderPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  if (!z.string().uuid().safeParse(publicToken).success) notFound();
  const supabase = getPublicSupabase();
  if (!supabase) notFound();
  const { data, error } = await supabase.rpc("get_public_order", { p_public_token: publicToken });
  if (error || !data) notFound();
  return <OrderTracker publicToken={publicToken} initialOrder={data as PublicOrder} />;
}
