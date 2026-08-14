export type MenuStatus = "AVAILABLE" | "SOLD_OUT" | "HIDDEN" | "ARCHIVED";

export type MenuCategory = "안주" | "식사" | "간식" | "음료";

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
