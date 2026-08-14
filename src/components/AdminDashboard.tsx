"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, BarChart3, Bell, Check, ChefHat, ChevronRight, ClipboardList, Clock3, CookingPot, LayoutGrid, Minus, Package, Plus, RefreshCw, Search, Settings, ShoppingBag, Store, UtensilsCrossed, WalletCards, X } from "lucide-react";
import { DEMO_MENU, DEMO_ORDERS, type DemoOrder } from "@/src/shared/demo-data";
import { formatWon, type MenuItem } from "@/src/features/menu/domain/menu";
import type { OrderStatus } from "@/src/features/orders/domain/order";

type Filter = "ALL" | "DINE_IN" | "TAKEOUT" | "PAYMENT" | "COOKING" | "READY";
type View = "orders" | "inventory";

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "입금 확인 필요", PAID: "결제 완료", COOKING: "조리 중", READY: "준비 완료", SERVED: "전달 완료", CANCELLED: "취소",
};

interface AdminDashboardProps { initialOrders?: DemoOrder[]; initialMenu?: MenuItem[]; demoMode?: boolean }

export function AdminDashboard({ initialOrders = DEMO_ORDERS, initialMenu = DEMO_MENU, demoMode = true }: AdminDashboardProps) {
  const router = useRouter();
  const [view, setView] = useState<View>("orders");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [orders, setOrders] = useState<DemoOrder[]>(initialOrders);
  const [menu, setMenu] = useState<MenuItem[]>(initialMenu);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setOrders(initialOrders); setMenu(initialMenu); }, 0);
    return () => window.clearTimeout(timer);
  }, [initialMenu, initialOrders]);
  useEffect(() => {
    if (demoMode) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [demoMode, router]);

  const visibleOrders = useMemo(() => orders.filter((order) => {
    if (search && !`${order.orderNumber} ${order.tableNumber ?? ""} ${order.items.map((item) => item.name).join(" ")}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "DINE_IN" || filter === "TAKEOUT") return order.fulfillmentType === filter;
    if (filter === "PAYMENT") return order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED";
    if (filter === "COOKING") return order.orderStatus === "COOKING" || order.orderStatus === "PAID";
    if (filter === "READY") return order.orderStatus === "READY";
    return order.orderStatus !== "SERVED" && order.orderStatus !== "CANCELLED";
  }), [filter, orders, search]);

  const advance = (id: string) => {
    const target = orders.find((order) => order.id === id);
    if (!target) return;
    const action = target.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED" ? "CONFIRM_PAYMENT" : target.orderStatus === "PAID" ? "START_COOKING" : target.orderStatus === "COOKING" ? "MARK_READY" : "MARK_SERVED";
    if (!demoMode) void fetch(`/api/admin/orders/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }).then(() => router.refresh());
    setOrders((current) => current.map((order) => {
      if (order.id !== id) return order;
      if (order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED") return { ...order, paymentStatus: "CONFIRMED", orderStatus: "PAID" };
      const next: Partial<Record<OrderStatus, OrderStatus>> = { PAID: "COOKING", COOKING: "READY", READY: "SERVED" };
      return next[order.orderStatus] ? { ...order, orderStatus: next[order.orderStatus] as OrderStatus } : order;
    }));
    setNotice("주문 상태가 반영되었습니다.");
    window.setTimeout(() => setNotice(null), 2200);
  };

  const cancel = (id: string) => {
    if (!demoMode) void fetch(`/api/admin/orders/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "CANCEL" }) }).then(() => router.refresh());
    setOrders((current) => current.map((order) => order.id === id ? { ...order, orderStatus: "CANCELLED" } : order));
    setNotice("주문을 취소하고 재고를 복구했습니다.");
    window.setTimeout(() => setNotice(null), 2200);
  };

  const adjustStock = (id: string, quantityChange: number) => {
    if (!demoMode) void fetch(`/api/admin/menu/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quantityChange, reason: quantityChange > 0 ? "추가 입고" : "운영 조정" }) }).then(() => router.refresh());
    setMenu((current) => current.map((item) => item.id === id ? {
      ...item,
      stockQuantity: Math.max(0, item.stockQuantity + quantityChange),
      status: item.stockQuantity + quantityChange <= 0 ? "SOLD_OUT" : item.status === "SOLD_OUT" ? "AVAILABLE" : item.status,
    } : item));
    setNotice(`${quantityChange > 0 ? "추가 입고" : "운영 조정"}가 재고 기록에 저장되었습니다.`);
    window.setTimeout(() => setNotice(null), 2200);
  };

  const pendingPayments = orders.filter((order) => order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED").length;
  const cookingCount = orders.filter((order) => order.orderStatus === "COOKING" || order.orderStatus === "PAID").length;
  const readyCount = orders.filter((order) => order.orderStatus === "READY").length;

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand admin-brand" href="/"><span className="brand-mark">52</span><span><strong>컴공</strong><small>ADMIN CONSOLE</small></span></Link>
        <nav aria-label="운영 메뉴">
          <button type="button" className={view === "orders" ? "active" : ""} onClick={() => setView("orders")}><ClipboardList size={20} /> 주문 관리 <b>{orders.filter((item) => item.orderStatus !== "SERVED" && item.orderStatus !== "CANCELLED").length}</b></button>
          <button type="button" className={view === "inventory" ? "active" : ""} onClick={() => setView("inventory")}><Package size={20} /> 메뉴·재고 <b className="warn-count">{menu.filter((item) => item.stockQuantity <= 5).length}</b></button>
          <button type="button" disabled><BarChart3 size={20} /> 매출 현황</button>
          <button type="button" disabled><LayoutGrid size={20} /> 테이블·QR</button>
        </nav>
        <div className="sidebar-bottom"><button type="button"><Settings size={19} /> 매장 설정</button><div className="admin-profile"><span>운</span><div><strong>운영 관리자</strong><small><i /> 근무 중</small></div><ChevronRight size={17} /></div></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><h1>{view === "orders" ? "실시간 주문 관리" : "메뉴·재고 관리"}</h1><p><span className="live-dot" /> 실시간 연결됨 · 방금 동기화</p></div>
          <div className="admin-tools"><div className="admin-search"><Search size={18} /><input aria-label="주문 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="주문번호, 메뉴 검색" /></div><button type="button" className="icon-button" aria-label="새 알림"><Bell size={20} /><i /></button></div>
        </header>

        {view === "orders" ? <>
          <section className="stats-grid">
            <article><span className="stat-icon payment"><WalletCards size={22} /></span><div><small>입금 확인 필요</small><strong>{pendingPayments}<em>건</em></strong></div><button type="button" onClick={() => setFilter("PAYMENT")}>바로 보기 <ChevronRight size={15} /></button></article>
            <article><span className="stat-icon cooking"><CookingPot size={22} /></span><div><small>조리 대기·진행</small><strong>{cookingCount}<em>건</em></strong></div><span className="trend">평균 8분</span></article>
            <article><span className="stat-icon ready"><Check size={22} /></span><div><small>준비 완료</small><strong>{readyCount}<em>건</em></strong></div><button type="button" onClick={() => setFilter("READY")}>바로 보기 <ChevronRight size={15} /></button></article>
            <article><span className="stat-icon sales"><BarChart3 size={22} /></span><div><small>오늘 매출</small><strong className="money">₩ 1,284,000</strong></div><span className="trend up">어제보다 18% ↑</span></article>
          </section>

          <div className="order-toolbar">
            <div className="admin-filters" role="tablist" aria-label="주문 필터">
              {([ ["ALL", "전체"], ["DINE_IN", "테이블"], ["TAKEOUT", "포장"], ["PAYMENT", "입금 확인"], ["COOKING", "조리 중"], ["READY", "준비 완료"] ] as Array<[Filter, string]>).map(([value, label]) => <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{label}{value === "PAYMENT" && pendingPayments > 0 && <b>{pendingPayments}</b>}</button>)}
            </div>
            <button className="refresh-button" type="button"><RefreshCw size={16} /> 새로고침</button>
          </div>

          <section className="orders-grid" aria-label="주문 목록">
            {visibleOrders.length === 0 ? <div className="empty-state"><Check size={28} /><strong>해당 주문을 모두 처리했어요</strong><span>새 주문이 들어오면 자동으로 표시됩니다.</span></div> : visibleOrders.map((order) => <OrderCard order={order} onAdvance={advance} onCancel={cancel} key={order.id} />)}
          </section>
        </> : <InventoryView menu={menu} onAdjust={adjustStock} />}
      </section>
      {notice && <div className="admin-toast"><Check size={17} /> {notice}</div>}
    </main>
  );
}

function OrderCard({ order, onAdvance, onCancel }: { order: DemoOrder; onAdvance: (id: string) => void; onCancel: (id: string) => void }) {
  const isPayment = order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED";
  const actionLabel = isPayment ? "입금 확인" : order.orderStatus === "PAID" ? "조리 시작" : order.orderStatus === "COOKING" ? "준비 완료" : "전달 완료";
  const actionIcon = isPayment ? <WalletCards size={17} /> : order.orderStatus === "READY" ? <Check size={17} /> : <ChefHat size={17} />;
  return <article className={`order-card status-${order.orderStatus.toLowerCase()}`}>
    <div className="order-card-head"><div><span className="order-number">#{order.orderNumber}</span><span className={`order-status status-${order.orderStatus.toLowerCase()}`}>{STATUS_LABEL[order.orderStatus]}</span></div><span className="order-time"><Clock3 size={15} /> {order.orderedAt}</span></div>
    <div className={`order-destination ${order.fulfillmentType === "TAKEOUT" ? "takeout" : ""}`}>{order.fulfillmentType === "DINE_IN" ? <><UtensilsCrossed size={19} /><strong>테이블 {order.tableNumber}</strong><span>매장 이용</span></> : <><ShoppingBag size={19} /><strong>포장 주문</strong><span>번호로 호출</span></>}</div>
    <div className="order-items">{order.items.map((item) => <div key={item.name}><span>{item.name}</span><strong>× {item.quantity}</strong></div>)}</div>
    <div className="order-total"><span>총 결제금액</span><strong>{formatWon(order.totalAmount)}</strong></div>
    <div className="order-actions"><button className="cancel-order" type="button" onClick={() => onCancel(order.id)} aria-label={`${order.orderNumber} 주문 취소`}><X size={17} /></button><button className="primary-order-action" type="button" onClick={() => onAdvance(order.id)}>{actionIcon}{actionLabel}</button></div>
  </article>;
}

function InventoryView({ menu, onAdjust }: { menu: MenuItem[]; onAdjust: (id: string, change: number) => void }) {
  const totalSold = menu.reduce((sum, item) => sum + item.soldQuantity, 0);
  return <>
    <section className="inventory-summary"><article><Package size={22} /><div><small>판매 가능 재고</small><strong>{menu.reduce((sum, item) => sum + item.stockQuantity, 0)}개</strong></div></article><article><Store size={22} /><div><small>판매 완료</small><strong>{totalSold}개</strong></div></article><article className="warning"><AlertTriangle size={22} /><div><small>재고 주의</small><strong>{menu.filter((item) => item.stockQuantity <= 5).length}개 메뉴</strong></div></article></section>
    <section className="inventory-panel">
      <div className="panel-heading"><div><h2>현재 메뉴 재고</h2><p>모든 조정은 사유와 함께 감사 기록에 저장됩니다.</p></div><button type="button"><Plus size={17} /> 새 메뉴</button></div>
      <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>메뉴</th><th>판매 가능</th><th>주문 대기</th><th>판매 완료</th><th>상태</th><th>빠른 조정</th></tr></thead><tbody>{menu.map((item) => <tr key={item.id}><td><span className="table-emoji">{item.emoji}</span><div><strong>{item.name}</strong><small>{formatWon(item.price)}</small></div></td><td><strong className={item.stockQuantity <= 5 ? "low-number" : ""}>{item.stockQuantity}</strong>개</td><td>{item.reservedQuantity}개</td><td>{item.soldQuantity}개</td><td><span className={`inventory-status ${item.status.toLowerCase()}`}>{item.status === "AVAILABLE" ? "판매 중" : "품절"}</span></td><td><div className="stock-actions"><button type="button" onClick={() => onAdjust(item.id, -1)} disabled={item.stockQuantity === 0} aria-label={`${item.name} 재고 1 감소`}><Minus size={15} /></button><button type="button" onClick={() => onAdjust(item.id, 10)} aria-label={`${item.name} 재고 10 추가`}><Plus size={15} /> 10</button></div></td></tr>)}</tbody></table></div>
    </section>
    <div className="inventory-footnote"><Clock3 size={16} /> 최근 조정 · 2분 전 청포도 에이드 +20 (추가 입고)</div>
  </>;
}
