"use client";

import { useRef, useState } from "react";
import { ArrowLeft, Check, ChefHat, ChevronRight, Copy, PackageCheck, Minus, Plus, ShoppingBag, Store, Swords, UtensilsCrossed, WalletCards, X } from "lucide-react";
import { DEMO_MENU } from "@/src/shared/demo-data";
import { formatWon, isOrderable, type MenuItem } from "@/src/features/menu/domain/menu";
import { publicOrderProgressStep, publicOrderStatusMessage, type FulfillmentType, type PublicOrder } from "@/src/features/orders/domain/order";
import { usePublicOrderStatus } from "@/src/features/orders/presentation/use-public-order-status";
import { PushNotificationOptIn } from "@/src/components/PushNotificationOptIn";
import { DEMO_STORE_SETTINGS, type StoreSettings } from "@/src/features/settings/domain/store-settings";

interface CustomerOrderProps {
  initialFulfillment: FulfillmentType;
  teamSlug: string;
  tableNumber?: number;
  qrToken?: string;
  menuItems?: MenuItem[];
  storeSettings?: StoreSettings;
  demoMode?: boolean;
}

interface CreatedOrder { orderNumber: string; publicToken: string | null; initialOrder: PublicOrder }
interface CartLine { key: string; menuItemId: string; optionIds: string[]; quantity: number }
type CartDisplayItem = MenuItem & { key: string; optionIds: string[]; selectedOptions: MenuItem["options"]; unitPrice: number; quantity: number };

export function CustomerOrder({ initialFulfillment, teamSlug, tableNumber, qrToken, menuItems = DEMO_MENU, storeSettings = DEMO_STORE_SETTINGS, demoMode = false }: CustomerOrderProps) {
  const [fulfillment, setFulfillment] = useState<FulfillmentType>(initialFulfillment);
  const [category, setCategory] = useState("전체");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [optionPicker, setOptionPicker] = useState<MenuItem | null>(null);
  const [pendingOptionIds, setPendingOptionIds] = useState<string[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const [transferClaimed, setTransferClaimed] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const clientRequestId = useRef<string | null>(null);
  const { order: syncedOrder, connected, lastUpdatedAt, refresh: refreshOrder } = usePublicOrderStatus(createdOrder?.publicToken ?? null);

  const categories = ["전체", ...Array.from(new Set(menuItems.map((item) => item.category)))];
  const visibleMenu = menuItems.filter((item) => category === "전체" || item.category === category);
  const cartItems: CartDisplayItem[] = cart.flatMap((line) => {
    const item = menuItems.find((candidate) => candidate.id === line.menuItemId);
    if (!item) return [];
    const selectedOptions = item.options.filter((option) => line.optionIds.includes(option.id));
    return [{ ...item, ...line, selectedOptions, unitPrice: item.price + selectedOptions.reduce((sum, option) => sum + option.priceDelta, 0) }];
  });
  const totalQuantity = cart.reduce((sum, line) => sum + line.quantity, 0);
  const totalAmount = cartItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const canDineIn = Boolean(tableNumber && qrToken);
  const customerMenuHref = canDineIn ? `/t/${encodeURIComponent(qrToken ?? "")}` : `/s/${encodeURIComponent(teamSlug)}`;
  const acceptingOrders = storeSettings.isOpen && storeSettings.configured;

  const menuCartQuantity = (menuItemId: string) => cart.filter((line) => line.menuItemId === menuItemId).reduce((sum, line) => sum + line.quantity, 0);

  const updateQuantity = (key: string, delta: number) => {
    setCart((current) => {
      const line = current.find((candidate) => candidate.key === key);
      if (!line) return current;
      const item = menuItems.find((candidate) => candidate.id === line.menuItemId);
      if (!item) return current;
      const currentTotal = current.reduce((sum, candidate) => sum + candidate.quantity, 0);
      const currentMenuTotal = current.filter((candidate) => candidate.menuItemId === item.id).reduce((sum, candidate) => sum + candidate.quantity, 0);
      if (delta > 0 && currentTotal >= 20) return current;
      if (delta > 0 && currentMenuTotal >= Math.min(10, item.stockQuantity)) return current;
      const next = line.quantity + delta;
      return next <= 0 ? current.filter((candidate) => candidate.key !== key) : current.map((candidate) => candidate.key === key ? { ...candidate, quantity: next } : candidate);
    });
  };

  const addToCart = (item: MenuItem, optionIds: string[] = []) => {
    const normalizedIds = [...optionIds].sort();
    const key = `${item.id}:${normalizedIds.join(",")}`;
    setCart((current) => {
      const currentTotal = current.reduce((sum, line) => sum + line.quantity, 0);
      const currentMenuTotal = current.filter((line) => line.menuItemId === item.id).reduce((sum, line) => sum + line.quantity, 0);
      if (currentTotal >= 20 || currentMenuTotal >= Math.min(10, item.stockQuantity)) return current;
      const existing = current.find((line) => line.key === key);
      return existing
        ? current.map((line) => line.key === key ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { key, menuItemId: item.id, optionIds: normalizedIds, quantity: 1 }];
    });
  };

  const openOptionPicker = (item: MenuItem) => {
    setPendingOptionIds([]);
    setOptionPicker(item);
  };

  const placeOrder = async () => {
    setSubmissionError(null);
    if (!acceptingOrders) {
      setSubmissionError("현재는 주문 접수 시간이 아닙니다.");
      return;
    }
    const normalizedPhone = customerPhone.replace(/[^0-9]/g, "");
    if (fulfillment === "TAKEOUT" && (!customerName.trim() || !/^01[016789][0-9]{7,8}$/.test(normalizedPhone))) {
      setSubmissionError("포장 주문을 받을 분의 이름과 휴대폰 번호를 확인해 주세요.");
      return;
    }
    setSubmitting(true);
    try {
      if (demoMode) {
        const orderNumber = fulfillment === "TAKEOUT" ? "P053" : "A052";
        const demoOrder = { orderNumber, publicToken: null, initialOrder: buildInitialOrder(orderNumber, fulfillment, tableNumber ?? null, totalAmount, cartItems) };
        setCreatedOrder(demoOrder);
        setCartOpen(false);
        setOrderComplete(true);
        return;
      }
      clientRequestId.current ??= crypto.randomUUID();
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamSlug, qrToken: fulfillment === "DINE_IN" ? qrToken ?? null : null, fulfillmentType: fulfillment, clientRequestId: clientRequestId.current, customerName: fulfillment === "TAKEOUT" ? customerName.trim() : null, customerPhone: fulfillment === "TAKEOUT" ? normalizedPhone : null, items: cartItems.map((item) => ({ menuItemId: item.id, quantity: item.quantity, optionIds: item.optionIds })) }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result === "object" && result !== null && "message" in result ? String(result.message) : "주문을 접수하지 못했습니다. 메뉴와 재고를 다시 확인해 주세요.");
      if (typeof result !== "object" || result === null || !("order_number" in result) || !("public_token" in result) || !("total_amount" in result)) throw new Error("주문 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
      const orderNumber = String(result.order_number);
      const confirmedTotal = Number(result.total_amount);
      if (!Number.isSafeInteger(confirmedTotal) || confirmedTotal < 0) throw new Error("결제 금액을 확인하지 못했습니다. 운영 부스에 문의해 주세요.");
      setCreatedOrder({ orderNumber, publicToken: String(result.public_token), initialOrder: buildInitialOrder(orderNumber, fulfillment, tableNumber ?? null, confirmedTotal, cartItems) });
      setCartOpen(false);
      setOrderComplete(true);
    } catch (error) {
      setSubmissionError(!navigator.onLine ? "네트워크 연결이 끊겼습니다. 연결 후 같은 주문을 다시 눌러도 중복 접수되지 않습니다." : error instanceof Error ? error.message : "주문을 접수하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const claimTransfer = async () => {
    if (!createdOrder?.publicToken) { setTransferClaimed(true); return; }
    setTransferError(null);
    setTransferSubmitting(true);
    try {
      const response = await fetch("/api/orders/transfer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicToken: createdOrder.publicToken }) });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? "입금 확인 요청을 보내지 못했습니다. 잠시 후 다시 눌러 주세요.");
      setTransferClaimed(true);
      await refreshOrder();
    } catch (error) {
      setTransferError(!navigator.onLine ? "네트워크 연결을 확인한 뒤 다시 눌러 주세요." : error instanceof Error ? error.message : "입금 확인 요청을 보내지 못했습니다.");
    } finally {
      setTransferSubmitting(false);
    }
  };

  const copyPaymentValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyNotice(`${label}를 복사했어요.`);
      window.setTimeout(() => setCopyNotice(null), 1800);
    } catch {
      setCopyNotice("길게 눌러 직접 복사해 주세요.");
    }
  };

  if (orderComplete) {
    const currentOrder = syncedOrder ?? createdOrder?.initialOrder ?? null;
    const displayOrder = currentOrder && transferClaimed && currentOrder.payment_status === "UNPAID"
      ? { ...currentOrder, payment_status: "CUSTOMER_MARKED_TRANSFERRED" as const }
      : currentOrder;
    const paymentClaimed = displayOrder?.payment_status !== "UNPAID";
    const awaitingPayment = displayOrder?.order_status === "PENDING_PAYMENT";
    return (
      <main className="customer-shell status-shell">
        <header className="customer-topbar">
          <a className="round-button" href={customerMenuHref} aria-label="주문 메뉴로 돌아가기"><ArrowLeft size={20} /></a>
          <span className="topbar-title">주문 현황</span><span className="topbar-spacer" />
        </header>
        <section className="order-success" aria-live="polite">
          <div className="success-icon"><Check size={34} /></div>
          <p className="success-kicker">실시간 주문 현황</p>
          <h1>{createdOrder?.orderNumber ?? (fulfillment === "TAKEOUT" ? "P053" : "A052")}</h1>
          <div className="fulfillment-pill">{fulfillment === "TAKEOUT" ? <><ShoppingBag size={17} /> {customerName.trim()} · 포장 주문</> : <><UtensilsCrossed size={17} /> 테이블 {tableNumber ?? 7}</>}</div>
          <span className={`customer-live-chip ${connected || demoMode ? "connected" : ""}`}><i /> {connected || demoMode ? "4초마다 자동 갱신" : "상태 연결 중"}{lastUpdatedAt && ` · ${lastUpdatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}</span>
          <p className="success-copy">{displayOrder ? publicOrderStatusMessage(displayOrder) : "주문 상태를 불러오고 있어요."}</p>
        </section>
        {awaitingPayment && <section className="transfer-card">
          <div className="transfer-head"><span>입금 계좌</span><strong>{formatWon(displayOrder?.total_amount ?? createdOrder?.initialOrder.total_amount ?? totalAmount)}</strong></div>
          <div className="bank-account"><span>{storeSettings.bankName}</span><strong>{storeSettings.accountNumber}</strong><small>예금주 · {storeSettings.accountHolder}</small></div>
          <div className="payment-copy-actions">
            <button type="button" onClick={() => void copyPaymentValue(storeSettings.accountNumber, "계좌번호")}><Copy size={14} /> 계좌번호 복사</button>
            <button type="button" onClick={() => void copyPaymentValue(createdOrder?.orderNumber ?? "", "입금자명")}><Copy size={14} /> 입금자명 복사</button>
          </div>
          {copyNotice && <div className="copy-notice" role="status">{copyNotice}</div>}
          <p>입금자명 <strong>{createdOrder?.orderNumber ?? (fulfillment === "TAKEOUT" ? "P053" : "A052")}</strong>로 보내주세요. 미입금 상태가 10분간 계속되면 주문과 확보 재고가 자동으로 취소됩니다.</p>
        </section>}
        {displayOrder && <LiveOrderProgress order={displayOrder} />}
        {createdOrder?.publicToken && displayOrder && <PushNotificationOptIn publicToken={createdOrder.publicToken} orderStatus={displayOrder.order_status} trackingHref={`/order/${createdOrder.publicToken}`} />}
        {createdOrder?.publicToken && <a className="public-order-link" href={`/order/${createdOrder.publicToken}`}>새로고침 가능한 주문 현황 열기 <ChevronRight size={16} /></a>}
        {awaitingPayment && <div className="sticky-order-action">
          <button className="checkout-button" type="button" disabled={paymentClaimed || transferSubmitting} onClick={claimTransfer}>{paymentClaimed ? <><Check size={20} /> 입금 확인을 요청했어요</> : transferSubmitting ? "확인 요청 보내는 중…" : "입금했어요"}</button>
          {transferError ? <small className="transfer-action-error" role="alert">{transferError}</small> : <small>이 버튼은 입금 완료가 아닌 확인 요청이에요.</small>}
        </div>}
      </main>
    );
  }

  return (
    <main className="customer-shell">
      <header className="customer-header">
        <div className="customer-head-row">
          <div className="brand compact" aria-label={`${storeSettings.stallName} 주문 화면`}><span className="brand-mark">52</span><span><strong>{storeSettings.stallName}</strong><small>FESTIVAL ORDER</small></span></div>
          <span className={`open-chip ${acceptingOrders ? "" : "closed"}`}><i /> {acceptingOrders ? "주문 가능" : "주문 준비 중"}</span>
        </div>
        <div className="fulfillment-switch" role="group" aria-label="수령 방법">
          <button type="button" className={fulfillment === "DINE_IN" ? "active" : ""} disabled={!canDineIn} onClick={() => setFulfillment("DINE_IN")}><UtensilsCrossed size={17} /> {canDineIn ? `${tableNumber}번 테이블` : "테이블"}</button>
          <button type="button" className={fulfillment === "TAKEOUT" ? "active" : ""} onClick={() => setFulfillment("TAKEOUT")}><ShoppingBag size={17} /> 포장 주문</button>
        </div>
        {canDineIn && <p className="fulfillment-switch-guide"><ShoppingBag size={14} /> 테이블 QR에서도 포장 주문으로 바꿀 수 있어요.</p>}
      </header>

      <section className="menu-intro"><p>{fulfillment === "DINE_IN" ? `${tableNumber}번 테이블` : "포장 주문"}</p><h1>오늘 뭐 먹을까요?</h1><span>{acceptingOrders ? "축제의 밤을 더 맛있게 즐겨보세요." : `${storeSettings.operatingHours} 운영 · 현재 새 주문을 준비하고 있어요.`}</span></section>
      {!acceptingOrders && <div className="store-closed-banner"><Store size={19} /><div><strong>지금은 주문을 받고 있지 않아요</strong><small>메뉴는 미리 볼 수 있고, 영업을 시작하면 주문 버튼이 열립니다.</small></div></div>}
      {fulfillment === "DINE_IN" && canDineIn && <a className="table-battle-entry" href={`/t/${encodeURIComponent(qrToken ?? "")}/battle`}><span><Swords size={20} /></span><div><small>TABLE {tableNumber} EXCLUSIVE</small><strong>TABLE BATTLE</strong><em>테이블 대항전 참여하기 <ChevronRight size={15} /></em></div></a>}
      <div className="category-tabs" role="tablist" aria-label="메뉴 분류">{categories.map((item) => <button type="button" role="tab" aria-selected={category === item} className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>

      <section className="menu-grid" aria-label="메뉴 목록">
        {visibleMenu.map((item) => {
          const quantity = menuCartQuantity(item.id);
          const orderable = isOrderable(item);
          const quantityLimitReached = quantity >= Math.min(10, item.stockQuantity) || totalQuantity >= 20;
          return (
            <article className={`menu-card ${!orderable ? "sold-out" : ""}`} key={item.id}>
              <div className={`food-visual food-${item.id}`}><span>{item.emoji}</span>{item.badge && <b>{item.badge}</b>}{!orderable && <em>품절</em>}</div>
              <div className="menu-card-body">
                <div className="menu-title-row"><h2>{item.name}</h2><span className={item.stockQuantity <= 5 && orderable ? "stock-low" : "stock-label"}>{orderable ? `${item.stockQuantity}개 남음` : "오늘은 품절"}</span></div>
                <p>{item.description}</p>
                {item.options.length > 0 && <span className="menu-option-hint">옵션 {item.options.length}개 · 선택 가능</span>}
                <div className="menu-card-bottom"><strong>{formatWon(item.price)}{item.options.length > 0 && <small>부터</small>}</strong>{item.options.length > 0 ? <button className="option-button" type="button" onClick={() => openOptionPicker(item)} disabled={!orderable || !acceptingOrders || quantityLimitReached}>{quantity > 0 ? `${quantity}개 담김 · 더 담기` : "옵션 선택"}</button> : quantity > 0 ? <div className="quantity-control"><button type="button" onClick={() => updateQuantity(`${item.id}:`, -1)} aria-label={`${item.name} 수량 줄이기`}><Minus size={16} /></button><span>{quantity}</span><button type="button" onClick={() => addToCart(item)} aria-label={`${item.name} 수량 늘리기`} disabled={quantityLimitReached || !acceptingOrders}><Plus size={16} /></button></div> : <button className="add-button" type="button" onClick={() => addToCart(item)} disabled={!orderable || !acceptingOrders || totalQuantity >= 20} aria-label={`${item.name} 담기`}><Plus size={19} /></button>}</div>
              </div>
            </article>
          );
        })}
      </section>

      <div className="customer-note"><Store size={18} /><span>주문 즉시 재고가 확보돼요.<small>10분 안에 입금 표시가 없으면 주문이 자동 취소되고 재고가 복구됩니다.</small></span></div>
      {totalQuantity > 0 && <button type="button" className="floating-cart" onClick={() => setCartOpen(true)}><span className="cart-count">{totalQuantity}</span><strong>주문 바구니 보기</strong><span>{formatWon(totalAmount)} <ChevronRight size={18} /></span></button>}

      {cartOpen && <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false); }}><section className="cart-sheet" role="dialog" aria-modal="true" aria-label="주문 바구니">
        <div className="sheet-handle" /><div className="sheet-title"><div><small>{fulfillment === "DINE_IN" ? `${tableNumber}번 테이블` : "포장"}</small><h2>주문을 확인해 주세요</h2></div><button className="round-button" type="button" onClick={() => setCartOpen(false)} aria-label="닫기"><X size={19} /></button></div>
        <div className="cart-items">{cartItems.map((item) => <div className="cart-item" key={item.key}><span className="cart-emoji">{item.emoji}</span><div><strong>{item.name}</strong>{item.selectedOptions.length > 0 && <em>{item.selectedOptions.map((option) => `${option.name} +${formatWon(option.priceDelta)}`).join(" · ")}</em>}<small>{formatWon(item.unitPrice)}</small></div><div className="quantity-control"><button type="button" onClick={() => updateQuantity(item.key, -1)} aria-label={`${item.name} 수량 줄이기`}><Minus size={15} /></button><span>{item.quantity}</span><button type="button" onClick={() => updateQuantity(item.key, 1)} disabled={menuCartQuantity(item.id) >= Math.min(10, item.stockQuantity) || totalQuantity >= 20 || !acceptingOrders} aria-label={`${item.name} 수량 늘리기`}><Plus size={15} /></button></div></div>)}</div>
        {fulfillment === "TAKEOUT" && <div className="takeout-contact-form">
          <div><strong>포장 수령자 정보</strong><small>음식이 준비되면 이름으로 불러드리고, 못 보신 경우에만 전화드려요.</small></div>
          <label>이름<input type="text" value={customerName} maxLength={40} autoComplete="name" placeholder="예: 김민준" onChange={(event) => { setCustomerName(event.target.value); setSubmissionError(null); }} /></label>
          <label>휴대폰 번호<input type="tel" inputMode="tel" value={customerPhone} maxLength={13} autoComplete="tel" placeholder="010-1234-5678" onChange={(event) => { setCustomerPhone(formatPhoneInput(event.target.value)); setSubmissionError(null); }} /></label>
          <p>연락처는 운영자에게만 보이며 수령 완료·취소 시 자동 삭제됩니다.</p>
        </div>}
        <div className="cart-summary"><span>총 {totalQuantity}개</span><strong>{formatWon(totalAmount)}</strong></div>
        {submissionError && <p className="submission-error">{submissionError}</p>}
        <button className="checkout-button" type="button" disabled={submitting || !acceptingOrders} onClick={placeOrder}>{submitting ? "재고 확인 중…" : acceptingOrders ? "계좌이체로 주문하기" : "현재 주문 준비 중"} {!submitting && acceptingOrders && <ChevronRight size={19} />}</button><p className="checkout-caption">주문 후 입금 계좌와 주문번호를 안내해 드려요.</p>
      </section></div>}
      {optionPicker && <div className="sheet-backdrop option-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOptionPicker(null); }}><section className="cart-sheet option-picker" role="dialog" aria-modal="true" aria-label={`${optionPicker.name} 옵션 선택`}>
        <div className="sheet-handle" /><div className="sheet-title"><div><small>추가 옵션</small><h2>{optionPicker.name}</h2></div><button className="round-button" type="button" onClick={() => setOptionPicker(null)} aria-label="닫기"><X size={19} /></button></div>
        <p className="option-picker-guide">원하는 옵션을 모두 선택해 주세요. 선택하지 않고 담아도 됩니다.</p>
        <div className="customer-option-list">{optionPicker.options.map((option) => <label key={option.id} className={pendingOptionIds.includes(option.id) ? "selected" : ""}><input type="checkbox" checked={pendingOptionIds.includes(option.id)} onChange={(event) => setPendingOptionIds((current) => event.target.checked ? [...current, option.id] : current.filter((id) => id !== option.id))} /><span><strong>{option.name}</strong><small>+ {formatWon(option.priceDelta)}</small></span><i><Check size={15} /></i></label>)}</div>
        <div className="option-picker-total"><span>1개 금액</span><strong>{formatWon(optionPicker.price + optionPicker.options.filter((option) => pendingOptionIds.includes(option.id)).reduce((sum, option) => sum + option.priceDelta, 0))}</strong></div>
        <button className="checkout-button" type="button" onClick={() => { addToCart(optionPicker, pendingOptionIds); setOptionPicker(null); }}>{pendingOptionIds.length > 0 ? `옵션 ${pendingOptionIds.length}개와 함께 담기` : "기본 메뉴로 담기"}</button>
      </section></div>}
    </main>
  );
}

function formatPhoneInput(value: string): string {
  const digits = value.replace(/[^0-9]/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function buildInitialOrder(orderNumber: string, fulfillmentType: FulfillmentType, currentTableNumber: number | null, totalAmount: number, items: CartDisplayItem[]): PublicOrder {
  return {
    order_number: orderNumber,
    fulfillment_type: fulfillmentType,
    table_number: fulfillmentType === "DINE_IN" ? currentTableNumber : null,
    total_amount: totalAmount,
    order_status: "PENDING_PAYMENT",
    payment_status: "UNPAID",
    items: items.map((item) => ({ name: item.name, quantity: item.quantity, subtotal: item.unitPrice * item.quantity, selectedOptions: item.selectedOptions.map((option) => ({ name: option.name, priceDelta: option.priceDelta })) })),
  };
}

function LiveOrderProgress({ order }: { order: PublicOrder }) {
  const step = publicOrderProgressStep(order);
  const finalLabel = order.fulfillment_type === "DINE_IN" ? "제공 완료" : "수령 완료";
  const stages = [
    { title: "주문 접수", icon: <Check size={17} /> },
    { title: "입금 확인", icon: <WalletCards size={17} /> },
    { title: "주문 승인", icon: <Check size={17} /> },
    { title: "조리 중", icon: <ChefHat size={17} /> },
    { title: "조리 완료", icon: <ShoppingBag size={17} /> },
    { title: finalLabel, icon: <PackageCheck size={17} /> },
  ];
  return <section className={`tracker-progress live-order-progress ${step < 0 ? "cancelled" : ""}`} aria-label="실시간 주문 진행 단계">
    {stages.map((stage, index) => <div className={index < step ? "done" : index === step ? "active" : ""} key={stage.title}><span>{index < step ? <Check size={17} /> : stage.icon}</span><strong>{stage.title}</strong><small>{step < 0 ? "중단" : index === step ? "현재 단계" : index < step ? "완료" : "대기"}</small></div>)}
  </section>;
}
