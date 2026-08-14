import { z } from "zod";
import { addMenuCategory, adjustMenuStock, createMenuItem, deleteMenuCategory, renameMenuCategory, updateMenuItem } from "@/src/features/menu/application/menu-admin-service";
import { SupabaseMenuAdminGateway } from "@/src/features/menu/infrastructure/supabase-menu-admin-gateway";
import { categoryCreateSchema, categoryRenameSchema, menuAdjustmentSchema, menuCreateSchema, menuEditSchema } from "@/src/features/menu/presentation/admin-menu-schemas";
import { requireAdminSession } from "@/src/shared/auth/admin-session";
import { invalidInput } from "@/src/shared/errors/app-error";
import { handleController, parseJson } from "@/src/shared/http/route-handler";

const idSchema = z.string().uuid();

export function createMenuController(request: Request) {
  return handleController(async () => {
    const [draft, session] = await Promise.all([parseJson(request, menuCreateSchema, "메뉴 정보를 확인해 주세요."), requireAdminSession()]);
    return { body: await createMenuItem(new SupabaseMenuAdminGateway(session.client), draft), status: 201 };
  });
}

export function adjustMenuController(request: Request, context: { params: Promise<{ menuItemId: string }> }) {
  return handleController(async () => {
    const [command, params, session] = await Promise.all([parseJson(request, menuAdjustmentSchema, "수량과 조정 사유를 확인해 주세요."), context.params, requireAdminSession()]);
    const id = idSchema.safeParse(params.menuItemId);
    if (!id.success) throw invalidInput("잘못된 메뉴입니다.");
    const stockQuantity = await adjustMenuStock(new SupabaseMenuAdminGateway(session.client), id.data, command.quantityChange, command.reason);
    return { body: { stockQuantity } };
  });
}

export function updateMenuController(request: Request, context: { params: Promise<{ menuItemId: string }> }) {
  return handleController(async () => {
    const [update, params, session] = await Promise.all([parseJson(request, menuEditSchema, "수정할 메뉴 정보를 확인해 주세요."), context.params, requireAdminSession()]);
    const id = idSchema.safeParse(params.menuItemId);
    if (!id.success) throw invalidInput("잘못된 메뉴입니다.");
    return { body: await updateMenuItem(new SupabaseMenuAdminGateway(session.client), id.data, update) };
  });
}

export function createCategoryController(request: Request) {
  return handleController(async () => {
    const [command, session] = await Promise.all([parseJson(request, categoryCreateSchema, "카테고리 이름을 확인해 주세요."), requireAdminSession()]);
    await addMenuCategory(new SupabaseMenuAdminGateway(session.client), command.name);
    return { body: { ok: true }, status: 201 };
  });
}

export function renameCategoryController(request: Request) {
  return handleController(async () => {
    const [command, session] = await Promise.all([parseJson(request, categoryRenameSchema, "카테고리 이름을 확인해 주세요."), requireAdminSession()]);
    await renameMenuCategory(new SupabaseMenuAdminGateway(session.client), command.previousName, command.nextName);
    return { body: { ok: true } };
  });
}

export function deleteCategoryController(request: Request) {
  return handleController(async () => {
    const [command, session] = await Promise.all([parseJson(request, categoryCreateSchema, "삭제할 카테고리를 확인해 주세요."), requireAdminSession()]);
    await deleteMenuCategory(new SupabaseMenuAdminGateway(session.client), command.name);
    return { body: { ok: true } };
  });
}
