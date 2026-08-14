import type { MenuDraft, MenuItem, MenuStatus } from "@/src/features/menu/domain/menu";
import { conflict } from "@/src/shared/errors/app-error";

export interface MenuUpdate {
  name?: string;
  description?: string;
  price?: number;
  category?: string;
  status?: MenuStatus;
}

export interface MenuAdminGateway {
  categoryExists(name: string): Promise<boolean>;
  createMenu(draft: MenuDraft): Promise<MenuItem>;
  updateMenu(id: string, update: MenuUpdate): Promise<MenuItem>;
  adjustStock(id: string, quantityChange: number, reason: string): Promise<number>;
  addCategory(name: string): Promise<void>;
  renameCategory(previousName: string, nextName: string): Promise<void>;
  deleteCategory(name: string): Promise<void>;
}

export async function createMenuItem(gateway: MenuAdminGateway, draft: MenuDraft): Promise<MenuItem> {
  if (!await gateway.categoryExists(draft.category)) throw conflict("먼저 사용할 카테고리를 만들어 주세요.");
  return gateway.createMenu(draft);
}

export async function updateMenuItem(gateway: MenuAdminGateway, id: string, update: MenuUpdate): Promise<MenuItem> {
  if (update.category && !await gateway.categoryExists(update.category)) throw conflict("등록되지 않은 카테고리입니다.");
  return gateway.updateMenu(id, update);
}

export const adjustMenuStock = (gateway: MenuAdminGateway, id: string, quantityChange: number, reason: string) => gateway.adjustStock(id, quantityChange, reason);
export const addMenuCategory = (gateway: MenuAdminGateway, name: string) => gateway.addCategory(name);
export const renameMenuCategory = (gateway: MenuAdminGateway, previousName: string, nextName: string) => gateway.renameCategory(previousName, nextName);
export const deleteMenuCategory = (gateway: MenuAdminGateway, name: string) => gateway.deleteCategory(name);
