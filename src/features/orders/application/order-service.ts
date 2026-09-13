import type { AdminOrderAction, FulfillmentType, PublicOrder } from "@/src/features/orders/domain/order";

export interface CreateOrderCommand {
  teamSlug: string;
  qrToken: string | null;
  fulfillmentType: FulfillmentType;
  clientRequestId: string;
  customerName: string | null;
  customerPhone: string | null;
  items: Array<{ menuItemId: string; quantity: number; optionIds: string[] }>;
}

export interface CreatedOrder {
  order_id: string;
  order_number: string;
  public_token: string;
  total_amount: number;
  table_number: number | null;
  expires_at: string | null;
  duplicate: boolean;
}

export interface CreateOrderSecurity {
  rateKeyHash: string;
  requestTimestamp: number;
  signature: string;
}

export interface OrderGateway {
  create(command: CreateOrderCommand, security: CreateOrderSecurity): Promise<CreatedOrder>;
  markTransferClaimed(publicToken: string, security: CreateOrderSecurity): Promise<void>;
  findPublicOrder(publicToken: string, security: CreateOrderSecurity): Promise<PublicOrder | null>;
  process(orderId: string, action: AdminOrderAction): Promise<void>;
  createManualOrder(command: OwnerManualOrderCommand): Promise<void>;
}

export interface OwnerManualOrderCommand {
  clientRequestId: string;
  label: string;
  amount: number;
  fulfillmentType: FulfillmentType;
  tableNumber: number | null;
}

export const createOrder = (gateway: OrderGateway, command: CreateOrderCommand, security: CreateOrderSecurity) => gateway.create(command, security);
export const markTransferClaimed = (gateway: OrderGateway, publicToken: string, security: CreateOrderSecurity) => gateway.markTransferClaimed(publicToken, security);
export const getPublicOrder = (gateway: OrderGateway, publicToken: string, security: CreateOrderSecurity) => gateway.findPublicOrder(publicToken, security);
export const processAdminOrder = (gateway: OrderGateway, orderId: string, action: AdminOrderAction) => gateway.process(orderId, action);
export const createOwnerManualOrder = (gateway: OrderGateway, command: OwnerManualOrderCommand) => gateway.createManualOrder(command);
