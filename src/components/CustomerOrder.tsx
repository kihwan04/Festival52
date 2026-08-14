"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, Minus, Plus, ShoppingBag, Store, UtensilsCrossed, X } from "lucide-react";
import { DEMO_MENU } from "@/src/shared/demo-data";
import { formatWon, isOrderable, type MenuItem } from "@/src/features/menu/domain/menu";
import type { FulfillmentType } from "@/src/features/orders/domain/order";
import { DEMO_STORE_SETTINGS, type StoreSettings } from "@/src/features/settings/domain/store-settings";

interface CustomerOrderProps {
  initialFulfillment: FulfillmentType;
  tableNumber?: number;
  qrToken?: string;
  menuItems?: MenuItem[];
  storeSettings?: StoreSettings;
  demoMode?: boolean;
}

interface CreatedOrder { orderNumber: string; publicToken: string | null }

export function CustomerOrder({ initialFulfillment, tableNumber, qrToken, menuItems = DEMO_MENU, storeSettings = DEMO_STORE_SETTINGS, demoMode = false }: CustomerOrderProps) {
  const [fulfillment, setFulfillment] = useState<FulfillmentType>(initialFulfillment);
  const [category, setCategory] = useState("전체");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const [transferClaimed, setTransferClaimed] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const categories = ["전체", ...Array.from(new Set(menuItems.map((item) => item.category)))];
  const visibleMenu = menuItems.filter((item) => category === "전체" || item.category === category);
  const cartItems = menuItems.filter((item) => cart[item.id]).map((item) => ({ ...item, quantity: cart[item.id] }));
  const totalQuantity = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const totalAmount = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const canDineIn = Boolean(tableNumber && qrToken);
  const acceptingOrders = storeSettings.isOpen && storeSettings.configured;

  const updateQuantity = (id: string, delta: number) => {
    const item = menuItems.find((candidate) => candidate.id === id);
    if (!item) return;
    setCart((current) => {
      const next = Math.max(0, Math.min(item.stockQuantity, (current[id] ?? 0) + delta));
      const result = { ...current, [id]: next };
      if (next === 0) delete result[id];
      return result;
    });
  };

  const placeOrder = async () => {
    setSubmissionError(null);
    if (!acceptingOrders) {
      setSubmissionError("현재는 주문 접수 시간이 아닙니다.");
      return;
    }
    setSubmitting(true);
    try {
      if (demoMode) {
        const demoOrder = { orderNumber: fulfillment === "TAKEOUT" ? "P053" : "A052", publicToken: null };
        setCreatedOrder(demoOrder);
        setCartOpen(false);
        setOrderComplete(true);
        return;
      }
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qrToken: fulfillment === "DINE_IN" ? qrToken ?? null : null, fulfillmentType: fulfillment, clientRequestId: crypto.randomUUID(), items: cartItems.map((item) => ({ menuItemId: item.id, quantity: item.quantity })) }),
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(typeof result === "object" && result !== null && "message" in result ? String(result.message) : "주문을 접수하지 못했습니다. 메뉴와 재고를 다시 확인해 주세요.");
      if (typeof result !== "object" || result === null || !("order_number" in result) || !("public_token" in result)) throw new Error("주문 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
      setCreatedOrder({ orderNumber: String(result.order_number), publicToken: String(result.public_token) });
      setCartOpen(false);
      setOrderComplete(true);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "주문을 접수하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const claimTransfer = async () => {
    if (!createdOrder?.publicToken) { setTransferClaimed(true); return; }
    const response = await fetch("/api/orders/transfer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicToken: createdOrder.publicToken }) });
    if (response.ok) setTransferClaimed(true);
  };

  if (orderComplete) {
    return (
      <main className="customer-shell status-shell">
        <header className="customer-topbar">
          <Link className="round-button" href="/" aria-label="처음으로"><ArrowLeft size={20} /></Link>
          <span className="topbar-title">주문 현황</span><span className="topbar-spacer" />
        </header>
        <section className="order-success">
          <div className="success-icon"><Check size={34} /></div>
          <p className="success-kicker">주문이 접수되었어요</p>
          <h1>{createdOrder?.orderNumber ?? (fulfillment === "TAKEOUT" ? "P053" : "A052")}</h1>
          <div className="fulfillment-pill">{fulfillment === "TAKEOUT" ? <><ShoppingBag size={17} /> 포장 주문</> : <><UtensilsCrossed size={17} /> 테이블 {tableNumber ?? 7}</>}</div>
          <p className="success-copy">입금 후 아래 버튼을 꼭 눌러주세요.<br />운영자가 확인하면 바로 조리를 시작해요.</p>
        </section>
        <section className="transfer-card">
          <div className="transfer-head"><span>입금 계좌</span><strong>{formatWon(totalAmount)}</strong></div>
          <div className="bank-account"><span>{storeSettings.bankName}</span><strong>{storeSettings.accountNumber}</strong><small>예금주 · {storeSettings.accountHolder}</small></div>
          <p>입금자명 <strong>{createdOrder?.orderNumber ?? (fulfillment === "TAKEOUT" ? "P053" : "A052")}</strong>로 보내주세요.</p>
        </section>
        <div className="status-progress-card">
          <div className="progress-step done"><span><Check size={16} /></span><div><strong>주문 확인</strong><small>주문번호가 발급됐어요</small></div></div>
          <i /><div className={`progress-step ${transferClaimed ? "active" : ""}`}><span>2</span><div><strong>{transferClaimed ? "입금 확인 중" : "입금 대기"}</strong><small>{transferClaimed ? "운영자가 확인하고 있어요" : "계좌이체 후 알려주세요"}</small></div></div>
          <i /><div className="progress-step"><span>3</span><div><strong>주문 승인 · 조리</strong><small>승인 후 바로 준비할게요</small></div></div>
          <i /><div className="progress-step"><span>4</span><div><strong>조리 완료</strong><small>{fulfillment === "TAKEOUT" ? "부스에서 번호를 보여주세요" : "테이블로 가져다드려요"}</small></div></div>
        </div>
        {createdOrder?.publicToken && <Link className="public-order-link" href={`/order/${createdOrder.publicToken}`}>새로고침 가능한 주문 현황 열기 <ChevronRight size={16} /></Link>}
        <div className="sticky-order-action">
          <button className="checkout-button" type="button" disabled={transferClaimed} onClick={claimTransfer}>{transferClaimed ? <><Check size={20} /> 입금 확인을 요청했어요</> : "입금했어요"}</button>
          <small>이 버튼은 입금 완료가 아닌 확인 요청이에요.</small>
        </div>
      </main>
    );
  }

  return (
    <main className="customer-shell">
      <header className="customer-header">
        <div className="customer-head-row">
          <Link className="brand compact" href="/"><span className="brand-mark">52</span><span><strong>컴공</strong><small>COMPUTER ENGINEERING</small></span></Link>
          <span className={`open-chip ${acceptingOrders ? "" : "closed"}`}><i /> {acceptingOrders ? "주문 가능" : "주문 준비 중"}</span>
        </div>
        <div className="fulfillment-switch" role="group" aria-label="수령 방법">
          <button type="button" className={fulfillment === "DINE_IN" ? "active" : ""} disabled={!canDineIn} onClick={() => setFulfillment("DINE_IN")}><UtensilsCrossed size={17} /> {canDineIn ? `${tableNumber}번 테이블` : "테이블"}</button>
          <button type="button" className={fulfillment === "TAKEOUT" ? "active" : ""} onClick={() => setFulfillment("TAKEOUT")}><ShoppingBag size={17} /> 포장</button>
        </div>
      </header>

      <section className="menu-intro"><p>{fulfillment === "DINE_IN" ? `${tableNumber}번 테이블` : "포장 주문"}</p><h1>오늘 뭐 먹을까요?</h1><span>{acceptingOrders ? "축제의 밤을 더 맛있게 즐겨보세요." : `${storeSettings.operatingHours} 운영 · 현재 새 주문을 준비하고 있어요.`}</span></section>
      {!acceptingOrders && <div className="store-closed-banner"><Store size={19} /><div><strong>지금은 주문을 받고 있지 않아요</strong><small>메뉴는 미리 볼 수 있고, 영업을 시작하면 주문 버튼이 열립니다.</small></div></div>}
      <div className="category-tabs" role="tablist" aria-label="메뉴 분류">{categories.map((item) => <button type="button" role="tab" aria-selected={category === item} className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>

      <section className="menu-grid" aria-label="메뉴 목록">
        {visibleMenu.map((item) => {
          const quantity = cart[item.id] ?? 0;
          const orderable = isOrderable(item);
          return (
            <article className={`menu-card ${!orderable ? "sold-out" : ""}`} key={item.id}>
              <div className={`food-visual food-${item.id}`}><span>{item.emoji}</span>{item.badge && <b>{item.badge}</b>}{!orderable && <em>품절</em>}</div>
              <div className="menu-card-body">
                <div className="menu-title-row"><h2>{item.name}</h2><span className={item.stockQuantity <= 5 && orderable ? "stock-low" : "stock-label"}>{orderable ? `${item.stockQuantity}개 남음` : "오늘은 품절"}</span></div>
                <p>{item.description}</p>
                <div className="menu-card-bottom"><strong>{formatWon(item.price)}</strong>{quantity > 0 ? <div className="quantity-control"><button type="button" onClick={() => updateQuantity(item.id, -1)} aria-label={`${item.name} 수량 줄이기`}><Minus size={16} /></button><span>{quantity}</span><button type="button" onClick={() => updateQuantity(item.id, 1)} aria-label={`${item.name} 수량 늘리기`} disabled={quantity >= item.stockQuantity || !acceptingOrders}><Plus size={16} /></button></div> : <button className="add-button" type="button" onClick={() => updateQuantity(item.id, 1)} disabled={!orderable || !acceptingOrders} aria-label={`${item.name} 담기`}><Plus size={19} /></button>}</div>
              </div>
            </article>
          );
        })}
      </section>

      <div className="customer-note"><Store size={18} /><span>주문 즉시 재고가 확보돼요.<small>결제 전 취소 시 재고는 자동 복구됩니다.</small></span></div>
      {totalQuantity > 0 && <button type="button" className="floating-cart" onClick={() => setCartOpen(true)}><span className="cart-count">{totalQuantity}</span><strong>주문 바구니 보기</strong><span>{formatWon(totalAmount)} <ChevronRight size={18} /></span></button>}

      {cartOpen && <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false); }}><section className="cart-sheet" role="dialog" aria-modal="true" aria-label="주문 바구니">
        <div className="sheet-handle" /><div className="sheet-title"><div><small>{fulfillment === "DINE_IN" ? `${tableNumber}번 테이블` : "포장"}</small><h2>주문을 확인해 주세요</h2></div><button className="round-button" type="button" onClick={() => setCartOpen(false)} aria-label="닫기"><X size={19} /></button></div>
        <div className="cart-items">{cartItems.map((item) => <div className="cart-item" key={item.id}><span className="cart-emoji">{item.emoji}</span><div><strong>{item.name}</strong><small>{formatWon(item.price)}</small></div><div className="quantity-control"><button type="button" onClick={() => updateQuantity(item.id, -1)} aria-label="수량 줄이기"><Minus size={15} /></button><span>{item.quantity}</span><button type="button" onClick={() => updateQuantity(item.id, 1)} aria-label="수량 늘리기"><Plus size={15} /></button></div></div>)}</div>
        <div className="cart-summary"><span>총 {totalQuantity}개</span><strong>{formatWon(totalAmount)}</strong></div>
        {submissionError && <p className="submission-error">{submissionError}</p>}
        <button className="checkout-button" type="button" disabled={submitting || !acceptingOrders} onClick={placeOrder}>{submitting ? "재고 확인 중…" : acceptingOrders ? "계좌이체로 주문하기" : "현재 주문 준비 중"} {!submitting && acceptingOrders && <ChevronRight size={19} />}</button><p className="checkout-caption">주문 후 입금 계좌와 주문번호를 안내해 드려요.</p>
      </section></div>}
    </main>
  );
}
