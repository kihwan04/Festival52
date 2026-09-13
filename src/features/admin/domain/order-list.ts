import type { DemoOrder } from "../../../shared/demo-data.ts";

export type OrderFilter = "ALL" | "UNPAID" | "PAYMENT" | "COOKING" | "READY" | "HISTORY";
export type OrderChannel = "ALL" | "DINE_IN" | "TAKEOUT";

export function isActiveOrder(order: Pick<DemoOrder, "orderStatus">): boolean {
  return order.orderStatus !== "SERVED" && order.orderStatus !== "CANCELLED";
}

export function filterOrders(orders: DemoOrder[], filter: OrderFilter, channel: OrderChannel, search: string): DemoOrder[] {
  const query = search.trim().toLocaleLowerCase("ko-KR").replace(/[\s#-]/g, "");
  return orders.filter((order) => {
    if (channel !== "ALL" && order.fulfillmentType !== channel) return false;
    const searchable = [order.orderNumber, order.tableNumber ? `테이블${order.tableNumber}` : "포장", order.customerName, order.customerPhone, ...order.items.map((item) => item.name)].join(" ").toLocaleLowerCase("ko-KR").replace(/[\s#-]/g, "");
    if (query && !searchable.includes(query)) return false;
    if (filter === "HISTORY") return !isActiveOrder(order);
    if (!isActiveOrder(order)) return false;
    if (filter === "UNPAID") return order.orderStatus === "PENDING_PAYMENT" && order.paymentStatus === "UNPAID";
    if (filter === "PAYMENT") return order.orderStatus === "PENDING_PAYMENT" && order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED";
    if (filter === "COOKING") return order.orderStatus === "PAID" || order.orderStatus === "COOKING";
    if (filter === "READY") return order.orderStatus === "READY";
    return true;
  });
}
