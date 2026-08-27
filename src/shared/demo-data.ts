import type { MenuItem } from "@/src/features/menu/domain/menu";
import type { FulfillmentType, OrderStatus, PaymentStatus } from "@/src/features/orders/domain/order";

export const DEMO_MENU: MenuItem[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "화끈 제육볶음", description: "불향 가득 매콤한 제육과 아삭한 양파", price: 12000, category: "안주", status: "AVAILABLE", stockQuantity: 13, reservedQuantity: 2, soldQuantity: 35, badge: "BEST", emoji: "🥘" },
  { id: "22222222-2222-4222-8222-222222222222", name: "바삭 닭강정", description: "달콤매콤 소스와 땅콩을 올린 한입 닭강정", price: 10000, category: "안주", status: "AVAILABLE", stockQuantity: 8, reservedQuantity: 3, soldQuantity: 41, badge: "인기", emoji: "🍗" },
  { id: "33333333-3333-4333-8333-333333333333", name: "치즈 떡볶이", description: "쫄깃한 밀떡 위에 고소한 치즈 듬뿍", price: 8000, category: "식사", status: "AVAILABLE", stockQuantity: 5, reservedQuantity: 1, soldQuantity: 28, emoji: "🍲" },
  { id: "44444444-4444-4444-8444-444444444444", name: "잔치 국수", description: "진한 멸치 육수와 푸짐한 고명", price: 6000, category: "식사", status: "AVAILABLE", stockQuantity: 17, reservedQuantity: 0, soldQuantity: 19, emoji: "🍜" },
  { id: "55555555-5555-4555-8555-555555555555", name: "회오리 감자", description: "바삭하게 튀겨낸 축제 대표 간식", price: 4500, category: "간식", status: "SOLD_OUT", stockQuantity: 0, reservedQuantity: 0, soldQuantity: 52, emoji: "🥔" },
  { id: "66666666-6666-4666-8666-666666666666", name: "청포도 에이드", description: "상큼한 청포도와 톡 쏘는 탄산", price: 4000, category: "음료", status: "AVAILABLE", stockQuantity: 21, reservedQuantity: 2, soldQuantity: 31, emoji: "🍹" },
];

export interface DemoOrder {
  id: string; orderNumber: string; fulfillmentType: FulfillmentType; tableNumber: number | null;
  customerName: string | null; customerPhone: string | null;
  items: Array<{ name: string; quantity: number }>; totalAmount: number; orderStatus: OrderStatus;
  paymentStatus: PaymentStatus; orderedAt: string;
}

export const DEMO_ORDERS: DemoOrder[] = [
  { id: "o-52", orderNumber: "A052", fulfillmentType: "DINE_IN", tableNumber: 7, customerName: null, customerPhone: null, items: [{ name: "화끈 제육볶음", quantity: 1 }, { name: "청포도 에이드", quantity: 2 }], totalAmount: 20000, orderStatus: "PENDING_PAYMENT", paymentStatus: "CUSTOMER_MARKED_TRANSFERRED", orderedAt: "방금 전" },
  { id: "o-53", orderNumber: "P053", fulfillmentType: "TAKEOUT", tableNumber: null, customerName: "김민준", customerPhone: "01012345678", items: [{ name: "바삭 닭강정", quantity: 2 }], totalAmount: 20000, orderStatus: "PAID", paymentStatus: "CONFIRMED", orderedAt: "3분 전" },
  { id: "o-49", orderNumber: "A049", fulfillmentType: "DINE_IN", tableNumber: 3, customerName: null, customerPhone: null, items: [{ name: "치즈 떡볶이", quantity: 1 }, { name: "잔치 국수", quantity: 1 }], totalAmount: 14000, orderStatus: "COOKING", paymentStatus: "CONFIRMED", orderedAt: "8분 전" },
  { id: "o-47", orderNumber: "P047", fulfillmentType: "TAKEOUT", tableNumber: null, customerName: "이서연", customerPhone: "01098765432", items: [{ name: "화끈 제육볶음", quantity: 1 }], totalAmount: 12000, orderStatus: "READY", paymentStatus: "CONFIRMED", orderedAt: "12분 전" },
];

export interface FestivalTable {
  id: string;
  tableNumber: number;
  qrToken: string;
  isActive: boolean;
}

export const DEMO_TABLES: FestivalTable[] = Array.from({ length: 12 }, (_, index) => {
  const tableNumber = index + 1;
  return {
    id: `00000000-0000-4000-8000-${String(tableNumber).padStart(12, "0")}`,
    tableNumber,
    qrToken: tableNumber === 7 ? "table-7-demo" : `demo-table-${tableNumber}-qr-token`,
    isActive: true,
  };
});
