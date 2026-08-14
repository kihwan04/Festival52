import { getAdminDashboard } from "@/src/features/admin/application/admin-dashboard-service";
import { SupabaseAdminDashboardGateway } from "@/src/features/admin/infrastructure/supabase-admin-dashboard-gateway";
import { requireAdminSession } from "@/src/shared/auth/admin-session";
import { handleController } from "@/src/shared/http/route-handler";

export function getAdminDashboardController() {
  return handleController(async () => {
    const session = await requireAdminSession();
    return { body: await getAdminDashboard(new SupabaseAdminDashboardGateway(session.client)) };
  });
}
