import { z } from "zod";
import { updateStoreSettings } from "@/src/features/settings/application/store-settings-service";
import { SupabaseStoreSettingsGateway } from "@/src/features/settings/infrastructure/supabase-store-settings-gateway";
import { requireAdminSession } from "@/src/shared/auth/admin-session";
import { handleController, parseJson } from "@/src/shared/http/route-handler";

const settingsUpdateSchema = z.object({
  stallName: z.string().trim().min(1).max(80),
  bankName: z.string().trim().max(40),
  accountNumber: z.string().trim().max(60),
  accountHolder: z.string().trim().max(60),
  operatingHours: z.string().trim().min(1).max(80),
  isOpen: z.boolean(),
});

export function updateStoreSettingsController(request: Request) {
  return handleController(async () => {
    const [command, session] = await Promise.all([parseJson(request, settingsUpdateSchema, "매장 설정 값을 확인해 주세요."), requireAdminSession()]);
    return { body: await updateStoreSettings(new SupabaseStoreSettingsGateway(session.client), command) };
  });
}
