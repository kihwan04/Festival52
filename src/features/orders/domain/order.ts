export type FulfillmentType = "DINE_IN" | "TAKEOUT";
export type OrderStatus = "PENDING_PAYMENT" | "PAID" | "COOKING" | "READY" | "SERVED" | "CANCELLED";
export type PaymentStatus = "UNPAID" | "CUSTOMER_MARKED_TRANSFERRED" | "CONFIRMED" | "REJECTED";
export type AdminOrderAction = "CONFIRM_PAYMENT" | "START_COOKING" | "MARK_READY" | "MARK_SERVED" | "CANCEL";

export interface PublicOrder {
  order_number: string;
  fulfillment_type: FulfillmentType;
  table_number: number | null;
  total_amount: number;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  items: Array<{ name: string; quantity: number; subtotal: number }>;
}

export interface OrderLineInput { menuItemId: string; quantity: number }
export interface PricedOrderLine extends OrderLineInput { menuName: string; unitPrice: number; subtotal: number }
export interface MenuPricingRecord { id: string; name: string; price: number; status: "AVAILABLE" | "SOLD_OUT" | "HIDDEN" | "ARCHIVED"; stockQuantity: number }

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING_PAYMENT: "PAID",
  PAID: "COOKING",
  COOKING: "READY",
  READY: "SERVED",
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return to === "CANCELLED" ? from !== "SERVED" && from !== "CANCELLED" : NEXT_STATUS[from] === to;
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) throw new Error(`허용되지 않은 주문 상태 변경입니다: ${from} → ${to}`);
}

export function nextOrderStatus(status: OrderStatus): OrderStatus | null { return NEXT_STATUS[status] ?? null }

export function validateFulfillment(type: FulfillmentType, tableId: string | null): void {
  if (type === "DINE_IN" && !tableId) throw new Error("테이블 주문에는 활성 테이블이 필요합니다.");
}

export function calculateOrderTotal(lines: ReadonlyArray<PricedOrderLine>): number {
  return lines.reduce((sum, line) => {
    if (!Number.isInteger(line.unitPrice) || !Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error("유효하지 않은 주문 항목입니다.");
    if (line.subtotal !== line.unitPrice * line.quantity) throw new Error("주문 항목의 소계가 올바르지 않습니다.");
    return sum + line.subtotal;
  }, 0);
}

export function priceOrderSelections(selections: ReadonlyArray<OrderLineInput>, menu: ReadonlyArray<MenuPricingRecord>): PricedOrderLine[] {
  if (selections.length === 0) throw new Error("주문 항목이 필요합니다.");
  return selections.map((selection) => {
    const current = menu.find((item) => item.id === selection.menuItemId);
    if (!current || current.status !== "AVAILABLE") throw new Error("주문할 수 없는 메뉴입니다.");
    if (!Number.isInteger(selection.quantity) || selection.quantity <= 0 || current.stockQuantity < selection.quantity) throw new Error("재고 또는 수량을 확인해 주세요.");
    return { ...selection, menuName: current.name, unitPrice: current.price, subtotal: current.price * selection.quantity };
  });
}

export function customerClaimsTransfer(status: PaymentStatus): PaymentStatus {
  if (status !== "UNPAID") throw new Error("이미 입금 요청이 처리된 결제입니다.");
  return "CUSTOMER_MARKED_TRANSFERRED";
}

export function confirmPayment(paymentStatus: PaymentStatus, orderStatus: OrderStatus, isAdmin: boolean): { paymentStatus: PaymentStatus; orderStatus: OrderStatus } {
  if (!isAdmin) throw new Error("관리자만 입금을 확인할 수 있습니다.");
  if (paymentStatus !== "CUSTOMER_MARKED_TRANSFERRED" || orderStatus !== "PENDING_PAYMENT") throw new Error("입금 확인이 가능한 상태가 아닙니다.");
  return { paymentStatus: "CONFIRMED", orderStatus: "PAID" };
}
