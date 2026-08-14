"use client";

import { useEffect, useState } from "react";
import { Check, ChefHat, Clock3, PackageCheck, ShoppingBag, UtensilsCrossed, WalletCards } from "lucide-react";
import { formatWon } from "@/src/features/menu/domain/menu";
import type { PublicOrder } from "@/src/features/orders/domain/order";

export type { PublicOrder } from "@/src/features/orders/domain/order";

export function OrderTracker({ publicToken, initialOrder }: { publicToken: string; initialOrder: PublicOrder }) {
  const [order, setOrder] = useState(initialOrder);
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/orders/${encodeURIComponent(publicToken)}`, { cache: "no-store" });
      if (response.ok) setOrder(await response.json() as PublicOrder);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [publicToken]);

  const step = order.order_status === "CANCELLED" ? -1 : order.order_status === "PENDING_PAYMENT"
    ? order.payment_status === "CUSTOMER_MARKED_TRANSFERRED" ? 1 : 0
    : order.order_status === "PAID" ? 2
      : order.order_status === "COOKING" ? 3
        : order.order_status === "READY" ? 4 : 5;
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
    <section className="tracker-hero"><span className="tracker-live"><i /> 주문 상태 자동 갱신</span><h1>#{order.order_number}</h1><div className="fulfillment-pill">{order.fulfillment_type === "TAKEOUT" ? <><ShoppingBag size={17} /> 포장 주문</> : <><UtensilsCrossed size={17} /> 테이블 {order.table_number}</>}</div><p>{order.order_status === "CANCELLED" ? "취소된 주문입니다. 운영 부스에 문의해 주세요." : order.order_status === "READY" ? order.fulfillment_type === "TAKEOUT" ? "포장 준비가 완료됐어요! 부스에서 주문번호를 보여주세요." : "조리가 완료됐어요. 곧 테이블로 가져다드릴게요." : order.order_status === "SERVED" ? `${finalLabel} 처리된 주문입니다.` : "화면을 닫아도 주문번호로 다시 확인할 수 있어요."}</p></section>
    <section className="tracker-progress">
      {stages.map((item, index) => <div className={index < step ? "done" : index === step ? "active" : ""} key={item.title}><span>{index < step ? <Check size={17} /> : item.icon}</span><strong>{item.title}</strong><small>{index === step ? "현재 단계" : index < step ? "완료" : "대기"}</small></div>)}
    </section>
    <section className="tracker-order-card"><div className="tracker-card-head"><strong>주문 내역</strong><span><Clock3 size={14} /> 자동 새로고침</span></div>{order.items.map((item) => <div className="tracker-item" key={item.name}><span>{item.name} <small>× {item.quantity}</small></span><strong>{formatWon(item.subtotal)}</strong></div>)}<div className="tracker-total"><span>총 결제금액</span><strong>{formatWon(order.total_amount)}</strong></div></section>
  </main>;
}
