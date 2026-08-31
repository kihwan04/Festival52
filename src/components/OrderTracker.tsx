"use client";

import { Check, ChefHat, Clock3, PackageCheck, ShoppingBag, UtensilsCrossed, WalletCards } from "lucide-react";
import { formatWon } from "@/src/features/menu/domain/menu";
import { publicOrderProgressStep, publicOrderStatusMessage, type PublicOrder } from "@/src/features/orders/domain/order";
import { usePublicOrderStatus } from "@/src/features/orders/presentation/use-public-order-status";
import { PushNotificationOptIn } from "@/src/components/PushNotificationOptIn";

export type { PublicOrder } from "@/src/features/orders/domain/order";

export function OrderTracker({ publicToken, initialOrder }: { publicToken: string; initialOrder: PublicOrder }) {
  const { order: syncedOrder, connected, lastUpdatedAt } = usePublicOrderStatus(publicToken);
  const order = syncedOrder ?? initialOrder;
  const step = publicOrderProgressStep(order);
  const finalLabel = order.fulfillment_type === "DINE_IN" ? "제공 완료" : "수령 완료";
  const stages = [
    { title: "주문 확인", icon: <Check size={18} /> },
    { title: "입금 확인", icon: <WalletCards size={18} /> },
    { title: "주문 승인", icon: <Check size={18} /> },
    { title: "조리 중", icon: <ChefHat size={18} /> },
    { title: "조리 완료", icon: <ShoppingBag size={18} /> },
    { title: finalLabel, icon: <PackageCheck size={18} /> },
  ];
  return <main className="customer-shell status-shell tracker-shell">
    <section className="tracker-hero" aria-live="polite"><span className={`tracker-live ${connected ? "" : "connecting"}`}><i /> {connected ? "4초마다 자동 갱신" : "상태 연결 중"}{lastUpdatedAt && ` · ${lastUpdatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}</span><h1>#{order.order_number}</h1><div className="fulfillment-pill">{order.fulfillment_type === "TAKEOUT" ? <><ShoppingBag size={17} /> 포장 주문</> : <><UtensilsCrossed size={17} /> 테이블 {order.table_number}</>}</div><p>{publicOrderStatusMessage(order)}</p></section>
    <section className="tracker-progress">
      {stages.map((item, index) => <div className={index < step ? "done" : index === step ? "active" : ""} key={item.title}><span>{index < step ? <Check size={17} /> : item.icon}</span><strong>{item.title}</strong><small>{index === step ? "현재 단계" : index < step ? "완료" : "대기"}</small></div>)}
    </section>
    <PushNotificationOptIn publicToken={publicToken} orderStatus={order.order_status} />
    <section className="tracker-order-card"><div className="tracker-card-head"><strong>주문 내역</strong><span><Clock3 size={14} /> 자동 새로고침</span></div>{order.items.map((item) => <div className="tracker-item" key={item.name}><span>{item.name} <small>× {item.quantity}</small></span><strong>{formatWon(item.subtotal)}</strong></div>)}<div className="tracker-total"><span>총 결제금액</span><strong>{formatWon(order.total_amount)}</strong></div></section>
  </main>;
}
