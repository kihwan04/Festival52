export type MenuStatus = "AVAILABLE" | "SOLD_OUT" | "HIDDEN" | "ARCHIVED";

// Categories are managed by festival staff, so production data is intentionally
// not limited to the four demo categories.
export type MenuCategory = string;

export interface MenuOption {
  id: string;
  name: string;
  priceDelta: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: MenuCategory;
  status: MenuStatus;
  stockQuantity: number;
  reservedQuantity: number;
  soldQuantity: number;
  badge?: string;
  emoji: string;
  options: MenuOption[];
}

export interface MenuDraft {
  name: string;
  description: string;
  price: number;
  category: string;
  status: MenuStatus;
  stockQuantity: number;
  options: MenuOption[];
}

export function isOrderable(item: MenuItem, quantity = 1): boolean {
  return item.status === "AVAILABLE" && quantity > 0 && item.stockQuantity >= quantity;
}

export function formatWon(amount: number): string {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("금액은 0 이상의 정수여야 합니다.");
  }
  return `${amount.toLocaleString("ko-KR")}원`;
}
