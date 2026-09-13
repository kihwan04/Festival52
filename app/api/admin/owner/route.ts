import { requireAdminSession } from "@/src/shared/auth/admin-session";
import { conflict } from "@/src/shared/errors/app-error";
import { handleController } from "@/src/shared/http/route-handler";

export const GET = () => handleController(async () => {
  const session = await requireAdminSession();
  const { data, error } = await session.client.rpc("is_festival_owner");
  if (error) throw conflict("오너 권한을 확인하지 못했습니다.");
  return { body: { isOwner: data === true } };
});
