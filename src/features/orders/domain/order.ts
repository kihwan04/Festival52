export type FulfillmentType = "DINE_IN" | "TAKEOUT";
export type OrderStatus = "PENDING_PAYMENT" | "PAID" | "COOKING" | "READY" | "SERVED" | "CANCELLED";
export type PaymentStatus = "UNPAID" | "CUSTOMER_MARKED_TRANSFERRED" | "CONFIRMED" | "REJECTED";
export type AdminOrderAction = "CONFIRM_PAYMENT" | "START_COOKING" | "MARK_READY" | "MARK_SERVED" | "CANCEL";

export interface PublicOrder {
  payment_details?: { bank_name: string; account_number: string; account_holder: string } | null;
  menu_path?: string;
  order_number: string;
  fulfillment_type: FulfillmentType;
  table_number: number | null;
  total_amount: number;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  expires_at?: string | null;
  items: Array<{ name: string; quantity: number; subtotal: number; selectedOptions: Array<{ name: string; priceDelta: number }> }>;
}

export function publicOrderProgressStep(order: Pick<PublicOrder, "order_status" | "payment_status">): number {
  if (order.order_status === "CANCELLED") return -1;
  if (order.order_status === "PENDING_PAYMENT") return order.payment_status === "CUSTOMER_MARKED_TRANSFERRED" ? 1 : 0;
  if (order.order_status === "PAID") return 2;
  if (order.order_status === "COOKING") return 3;
  if (order.order_status === "READY") return 4;
  return 5;
}

export function publicOrderStatusMessage(order: Pick<PublicOrder, "order_status" | "payment_status" | "fulfillment_type">): string {
  if (order.order_status === "CANCELLED") return "취소된 주문입니다. 운영 부스에 문의해 주세요.";
  if (order.order_status === "SERVED") return order.fulfillment_type === "DINE_IN" ? "테이블 제공이 완료됐습니다. 맛있게 드세요!" : "수령 완료된 주문입니다. 감사합니다!";
  if (order.order_status === "READY") return order.fulfillment_type === "DINE_IN" ? "조리가 완료됐어요. 곧 테이블로 가져다드릴게요." : "포장 준비가 끝났어요! 부스에서 주문번호를 보여주세요.";
  if (order.order_status === "COOKING") return "지금 맛있게 조리하고 있어요. 완료되면 이 화면에 바로 표시됩니다.";
  if (order.order_status === "PAID") return "입금 확인이 완료됐어요. 곧 조리를 시작합니다.";
  if (order.payment_status === "CUSTOMER_MARKED_TRANSFERRED") return "입금 확인을 요청했어요. 운영자가 확인하면 바로 알려드릴게요.";
  return "계좌이체 후 ‘입금했어요’를 눌러주세요.";
}

export interface OrderLineInput { menuItemId: string; quantity: number; optionIds?: string[] }
export interface PricedOrderLine extends OrderLineInput { menuName: string; unitPrice: number; subtotal: number; selectedOptions?: Array<{ name: string; priceDelta: number }> }
export interface MenuPricingRecord { id: string; name: string; price: number; status: "AVAILABLE" | "SOLD_OUT" | "HIDDEN" | "ARCHIVED"; stockQuantity: number; options?: Array<{ id: string; name: string; priceDelta: number }> }

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
    const optionIds = selection.optionIds ?? [];
    if (new Set(optionIds).size !== optionIds.length) throw new Error("같은 옵션이 중복되어 있습니다.");
    const selectedOptions = optionIds.map((id) => current.options?.find((option) => option.id === id));
    if (selectedOptions.some((option) => !option)) throw new Error("선택할 수 없는 옵션입니다.");
    const chosen = selectedOptions.filter((option): option is NonNullable<typeof option> => Boolean(option));
    const unitPrice = current.price + chosen.reduce((sum, option) => sum + option.priceDelta, 0);
    return { ...selection, menuName: current.name, unitPrice, subtotal: unitPrice * selection.quantity, selectedOptions: chosen };
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
