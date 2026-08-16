import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { MenuAdminGateway, MenuUpdate } from "@/src/features/menu/application/menu-admin-service";
import type { MenuDraft, MenuItem } from "@/src/features/menu/domain/menu";
import { conflict, notFound } from "@/src/shared/errors/app-error";

const menuRowSchema = z.object({
  id: z.string().uuid(), name: z.string(), description: z.string(), price: z.number().int().nonnegative(),
  category: z.string(), status: z.enum(["AVAILABLE", "SOLD_OUT", "HIDDEN", "ARCHIVED"]), stock_quantity: z.number().int().nonnegative(),
});

export class SupabaseMenuAdminGateway implements MenuAdminGateway {
  constructor(private readonly client: SupabaseClient) {}

  async categoryExists(name: string): Promise<boolean> {
    const { data, error } = await this.client.from("menu_categories").select("name").eq("name", name).maybeSingle();
    if (error) throw conflict("카테고리를 확인하지 못했습니다.");
    return Boolean(data);
  }

  async createMenu(draft: MenuDraft): Promise<MenuItem> {
    const { data, error } = await this.client.rpc("create_festival_menu_item", {
      p_name: draft.name,
      p_description: draft.description,
      p_price: draft.price,
      p_category: draft.category,
      p_status: draft.status,
      p_stock_quantity: draft.stockQuantity,
    });
    if (error) throw conflict("메뉴를 추가하지 못했습니다.");
    return mapMenu(data);
  }

  async updateMenu(id: string, update: MenuUpdate): Promise<MenuItem> {
    const { data: current, error: currentError } = await this.client.from("menu_items")
      .select("id,name,description,price,category,status,stock_quantity").eq("id", id).maybeSingle();
    if (currentError || !current) throw notFound("메뉴를 찾을 수 없습니다.");
    const parsed = menuRowSchema.safeParse(current);
    if (!parsed.success) throw conflict("메뉴 정보를 확인하지 못했습니다.");
    const next = { ...parsed.data, ...update };
    const { data, error } = await this.client.rpc("update_festival_menu_item", {
      p_menu_item_id: id,
      p_name: next.name,
      p_description: next.description,
      p_price: next.price,
      p_category: next.category,
      p_status: next.status,
    });
    if (error) throw conflict("메뉴를 수정하지 못했습니다.");
    return mapMenu(data);
  }

  async adjustStock(id: string, quantityChange: number, reason: string): Promise<number> {
    const { data, error } = await this.client.rpc("adjust_menu_stock", { p_menu_item_id: id, p_quantity_change: quantityChange, p_reason: reason });
    if (error || typeof data !== "number") throw conflict("재고가 음수가 되지 않는지 확인해 주세요.");
    return data;
  }

  async addCategory(name: string): Promise<void> {
    const { error } = await this.client.rpc("create_menu_category", { p_name: name });
    if (error) throw conflict("같은 이름의 카테고리가 있는지 확인해 주세요.");
  }

  async renameCategory(previousName: string, nextName: string): Promise<void> {
    const { error } = await this.client.rpc("rename_menu_category", { p_previous_name: previousName, p_next_name: nextName });
    if (error) throw conflict("카테고리 이름을 바꾸지 못했습니다.");
  }

  async deleteCategory(name: string): Promise<void> {
    const { error } = await this.client.rpc("delete_menu_category", { p_name: name });
    if (error) throw conflict("사용 중인 카테고리는 삭제할 수 없습니다.");
  }
}

function mapMenu(value: unknown): MenuItem {
  const parsed = menuRowSchema.safeParse(value);
  if (!parsed.success) throw conflict("메뉴 결과를 확인하지 못했습니다.");
  const row = parsed.data;
  return {
    id: row.id, name: row.name, description: row.description, price: row.price, category: row.category,
    status: row.stock_quantity === 0 ? "SOLD_OUT" : row.status, stockQuantity: row.stock_quantity,
    reservedQuantity: 0, soldQuantity: 0, emoji: "🍽️",
  };
}
