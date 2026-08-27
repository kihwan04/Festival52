import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { OrderTracker } from "@/src/components/OrderTracker";
import { getPublicOrder } from "@/src/features/orders/application/order-service";
import { SupabaseOrderGateway } from "@/src/features/orders/infrastructure/supabase-order-gateway";
import { getPublicSupabase } from "@/src/lib/supabase/server";
import { publicSiteOrigin } from "@/src/lib/supabase/server";
import { signPublicOrderRequest } from "@/src/shared/security/request-signing";

export const metadata: Metadata = { title: "주문 현황", robots: { index: false, follow: false, noarchive: true } };
export const dynamic = "force-dynamic";

export default async function PublicOrderPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  if (!z.string().uuid().safeParse(publicToken).success) notFound();
  const supabase = getPublicSupabase();
  if (!supabase) notFound();
  const requestHeaders = await headers();
  const proofRequest = new Request(publicSiteOrigin(), { headers: requestHeaders });
  const proof = await signPublicOrderRequest(proofRequest, publicToken);
  const order = await getPublicOrder(new SupabaseOrderGateway(supabase), publicToken, proof).catch(() => null);
  if (!order) notFound();
  return <OrderTracker publicToken={publicToken} initialOrder={order} />;
}
