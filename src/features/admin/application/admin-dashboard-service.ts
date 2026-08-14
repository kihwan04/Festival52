import type { AdminSnapshot } from "@/src/features/admin/domain/admin-snapshot";

export interface AdminDashboardGateway {
  load(): Promise<AdminSnapshot>;
}

export const getAdminDashboard = (gateway: AdminDashboardGateway) => gateway.load();
