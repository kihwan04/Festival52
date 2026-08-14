import { z } from "zod";
import { configureTables, rotateTableQr } from "@/src/features/tables/application/table-service";
import { SupabaseTableGateway } from "@/src/features/tables/infrastructure/supabase-table-gateway";
import { requireAdminSession } from "@/src/shared/auth/admin-session";
import { invalidInput } from "@/src/shared/errors/app-error";
import { handleController, parseJson } from "@/src/shared/http/route-handler";

const configureSchema = z.object({ count: z.number().int().min(1).max(200) });
const uuidSchema = z.string().uuid();

export function configureTablesController(request: Request) {
  return handleController(async () => {
    const [command, session] = await Promise.all([parseJson(request, configureSchema, "테이블 수는 1~200개로 입력해 주세요."), requireAdminSession()]);
    return { body: await configureTables(new SupabaseTableGateway(session.client), command.count) };
  });
}

export function rotateTableQrController(_request: Request, context: { params: Promise<{ tableId: string }> }) {
  return handleController(async () => {
    const [params, session] = await Promise.all([context.params, requireAdminSession()]);
    const tableId = uuidSchema.safeParse(params.tableId);
    if (!tableId.success) throw invalidInput("잘못된 테이블입니다.");
    return { body: { qrToken: await rotateTableQr(new SupabaseTableGateway(session.client), tableId.data) } };
  });
}
