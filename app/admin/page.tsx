import type { Metadata } from "next";
import { AdminDashboard } from "@/src/components/AdminDashboard";
import { AdminLogin } from "@/src/components/AdminLogin";
import { getAdminDashboard } from "@/src/features/admin/application/admin-dashboard-service";
import { SupabaseAdminDashboardGateway } from "@/src/features/admin/infrastructure/supabase-admin-dashboard-gateway";
import { requireAdminSession } from "@/src/shared/auth/admin-session";
import { isDemoMode, isOperatorSignupEnabled } from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "운영 대시보드", robots: { index: false, follow: false, noarchive: true } };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (isDemoMode()) return <AdminDashboard demoMode />;
  const snapshot = await (async () => {
    const session = await requireAdminSession();
    return getAdminDashboard(new SupabaseAdminDashboardGateway(session.client));
  })().catch(() => null);
  if (!snapshot) return <AdminLogin allowSignup={isOperatorSignupEnabled()} />;
  return <AdminDashboard initialSnapshot={snapshot} demoMode={false} />;
}
