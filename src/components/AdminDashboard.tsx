"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { AlertTriangle, Archive, BarChart3, Bell, Check, ChefHat, ChevronRight, ClipboardList, Clock3, CookingPot, Copy, EyeOff, LayoutGrid, Minus, Package, Pencil, Plus, QrCode, RefreshCw, RotateCw, Search, Settings, ShoppingBag, Store, UtensilsCrossed, WalletCards, X } from "lucide-react";
import { DEMO_MENU, DEMO_ORDERS, DEMO_TABLES, type DemoOrder, type FestivalTable } from "@/src/shared/demo-data";
import { formatWon, type MenuItem, type MenuStatus } from "@/src/features/menu/domain/menu";
import type { OrderStatus } from "@/src/features/orders/domain/order";

type Filter = "ALL" | "DINE_IN" | "TAKEOUT" | "PAYMENT" | "COOKING" | "READY";
type View = "orders" | "inventory" | "tables";
type MenuDraft = Pick<MenuItem, "name" | "description" | "price" | "category" | "status" | "stockQuantity">;

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "주문 확인 중", PAID: "주문 승인", COOKING: "조리 중", READY: "조리 완료", SERVED: "완료", CANCELLED: "취소",
};
const MENU_STATUS_LABEL: Record<MenuStatus, string> = { AVAILABLE: "판매 중", SOLD_OUT: "품절", HIDDEN: "숨김", ARCHIVED: "보관" };

interface AdminDashboardProps {
  initialOrders?: DemoOrder[];
  initialMenu?: MenuItem[];
  initialTables?: FestivalTable[];
  initialCategories?: string[];
  demoMode?: boolean;
}

export function AdminDashboard({
  initialOrders = DEMO_ORDERS,
  initialMenu = DEMO_MENU,
  initialTables = DEMO_TABLES,
  initialCategories = ["안주", "식사", "간식", "음료"],
  demoMode = true,
}: AdminDashboardProps) {
  const router = useRouter();
  const [view, setView] = useState<View>("orders");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [orders, setOrders] = useState<DemoOrder[]>(initialOrders);
  const [menu, setMenu] = useState<MenuItem[]>(initialMenu);
  const [tables, setTables] = useState<FestivalTable[]>(initialTables);
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOrders(initialOrders);
      setMenu(initialMenu);
      setTables(initialTables);
      setCategories(initialCategories);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialCategories, initialMenu, initialOrders, initialTables]);

  useEffect(() => {
    if (demoMode) return;
    const sync = () => router.refresh();
    const timer = window.setInterval(sync, 5000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [demoMode, router]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2400);
  };

  const visibleOrders = useMemo(() => orders.filter((order) => {
    if (search && !`${order.orderNumber} ${order.tableNumber ?? ""} ${order.items.map((item) => item.name).join(" ")}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "DINE_IN" || filter === "TAKEOUT") return order.fulfillmentType === filter;
    if (filter === "PAYMENT") return order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED";
    if (filter === "COOKING") return order.orderStatus === "COOKING" || order.orderStatus === "PAID";
    if (filter === "READY") return order.orderStatus === "READY";
    return order.orderStatus !== "SERVED" && order.orderStatus !== "CANCELLED";
  }), [filter, orders, search]);

  const advance = async (id: string) => {
    const target = orders.find((order) => order.id === id);
    if (!target || (target.orderStatus === "PENDING_PAYMENT" && target.paymentStatus !== "CUSTOMER_MARKED_TRANSFERRED")) return;
    const action = target.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED" ? "CONFIRM_PAYMENT" : target.orderStatus === "PAID" ? "START_COOKING" : target.orderStatus === "COOKING" ? "MARK_READY" : "MARK_SERVED";
    if (!demoMode) {
      const response = await fetch(`/api/admin/orders/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) { showNotice("주문 상태를 바꾸지 못했습니다."); return; }
      router.refresh();
    } else {
      setOrders((current) => current.map((order) => {
        if (order.id !== id) return order;
        if (order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED") return { ...order, paymentStatus: "CONFIRMED", orderStatus: "PAID" };
        const next: Partial<Record<OrderStatus, OrderStatus>> = { PAID: "COOKING", COOKING: "READY", READY: "SERVED" };
        return next[order.orderStatus] ? { ...order, orderStatus: next[order.orderStatus] as OrderStatus } : order;
      }));
    }
    showNotice("주문 상태가 반영되었습니다.");
  };

  const cancel = async (id: string) => {
    const target = orders.find((order) => order.id === id);
    if (!target || !window.confirm(`#${target.orderNumber} 주문을 취소할까요? 확보한 재고는 즉시 복구됩니다.`)) return;
    if (!demoMode) {
      const response = await fetch(`/api/admin/orders/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "CANCEL" }) });
      if (!response.ok) { showNotice("주문을 취소하지 못했습니다."); return; }
      router.refresh();
    } else {
      setOrders((current) => current.map((order) => order.id === id ? { ...order, orderStatus: "CANCELLED" } : order));
    }
    showNotice("주문을 취소하고 재고를 복구했습니다.");
  };

  const adjustStock = async (id: string, quantityChange: number) => {
    if (!demoMode) {
      const response = await fetch(`/api/admin/menu/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quantityChange, reason: quantityChange > 0 ? "추가 입고" : "운영 조정" }) });
      if (!response.ok) { showNotice("재고를 조정하지 못했습니다."); return; }
      router.refresh();
    } else {
      setMenu((current) => current.map((item) => item.id === id ? {
        ...item,
        stockQuantity: Math.max(0, item.stockQuantity + quantityChange),
        status: item.stockQuantity + quantityChange <= 0 ? "SOLD_OUT" : item.status === "SOLD_OUT" ? "AVAILABLE" : item.status,
      } : item));
    }
    showNotice(`${quantityChange > 0 ? "추가 입고" : "운영 조정"}가 재고 기록에 저장되었습니다.`);
  };

  const saveMenu = async (id: string | null, draft: MenuDraft): Promise<boolean> => {
    if (!demoMode) {
      const response = await fetch(id ? `/api/admin/menu/${id}` : "/api/admin/menu", {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(id ? { name: draft.name, description: draft.description, price: draft.price, category: draft.category, status: draft.status } : draft),
      });
      if (!response.ok) { showNotice((await response.json().catch(() => null) as { message?: string } | null)?.message ?? "메뉴를 저장하지 못했습니다."); return false; }
      router.refresh();
    } else if (id) {
      setMenu((current) => current.map((item) => item.id === id ? { ...item, ...draft } : item));
    } else {
      setMenu((current) => [...current, { id: crypto.randomUUID(), ...draft, reservedQuantity: 0, soldQuantity: 0, emoji: "🍽️" }]);
    }
    showNotice(id ? "메뉴 정보가 수정되었습니다." : "새 메뉴가 추가되었습니다.");
    return true;
  };

  const addCategory = async (name: string): Promise<boolean> => {
    const normalized = name.trim();
    if (!normalized || categories.includes(normalized)) return false;
    if (!demoMode) {
      const response = await fetch("/api/admin/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: normalized }) });
      if (!response.ok) { showNotice("카테고리를 추가하지 못했습니다."); return false; }
      router.refresh();
    } else setCategories((current) => [...current, normalized]);
    showNotice("카테고리가 추가되었습니다.");
    return true;
  };

  const renameCategory = async (previousName: string, nextName: string): Promise<boolean> => {
    const normalized = nextName.trim();
    if (!normalized || normalized === previousName || categories.includes(normalized)) return false;
    if (!demoMode) {
      const response = await fetch("/api/admin/categories", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ previousName, nextName: normalized }) });
      if (!response.ok) { showNotice("카테고리 이름을 바꾸지 못했습니다."); return false; }
      router.refresh();
    } else {
      setCategories((current) => current.map((item) => item === previousName ? normalized : item));
      setMenu((current) => current.map((item) => item.category === previousName ? { ...item, category: normalized } : item));
    }
    showNotice("카테고리 이름이 변경되었습니다.");
    return true;
  };

  const deleteCategory = async (name: string): Promise<boolean> => {
    if (menu.some((item) => item.category === name && item.status !== "ARCHIVED")) { showNotice("사용 중인 카테고리는 삭제할 수 없습니다."); return false; }
    if (!window.confirm(`'${name}' 카테고리를 삭제할까요?`)) return false;
    if (!demoMode) {
      const response = await fetch("/api/admin/categories", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      if (!response.ok) { showNotice("카테고리를 삭제하지 못했습니다."); return false; }
      router.refresh();
    } else setCategories((current) => current.filter((item) => item !== name));
    showNotice("카테고리가 삭제되었습니다.");
    return true;
  };

  const configureTables = async (count: number) => {
    const currentCount = tables.filter((table) => table.isActive).length;
    if (count < currentCount && !window.confirm(`${currentCount - count}개 테이블을 비활성화할까요? 기존 주문 기록은 유지됩니다.`)) return;
    if (!demoMode) {
      const response = await fetch("/api/admin/tables", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count }) });
      if (!response.ok) { showNotice("테이블을 설정하지 못했습니다."); return; }
      const rows = await response.json() as Array<{ id: string; table_number: number; qr_token: string; is_active: boolean }>;
      setTables(rows.map((row) => ({ id: row.id, tableNumber: row.table_number, qrToken: row.qr_token, isActive: row.is_active })));
      router.refresh();
    } else {
      setTables((current) => Array.from({ length: Math.max(count, current.length) }, (_, index) => {
        const tableNumber = index + 1;
        const existing = current.find((item) => item.tableNumber === tableNumber);
        return existing ? { ...existing, isActive: tableNumber <= count } : {
          id: `00000000-0000-4000-8000-${String(tableNumber).padStart(12, "0")}`,
          tableNumber,
          qrToken: `demo-table-${tableNumber}-qr-token`,
          isActive: tableNumber <= count,
        };
      }));
    }
    showNotice(`${count}개 테이블의 QR이 준비되었습니다.`);
  };

  const rotateTableQr = async (table: FestivalTable) => {
    if (!window.confirm(`${table.tableNumber}번 테이블 QR을 재발급할까요? 기존 QR은 즉시 사용할 수 없게 됩니다.`)) return;
    if (!demoMode) {
      const response = await fetch(`/api/admin/tables/${table.id}`, { method: "POST" });
      if (!response.ok) { showNotice("QR을 재발급하지 못했습니다."); return; }
      const payload = await response.json() as { qrToken: string };
      setTables((current) => current.map((item) => item.id === table.id ? { ...item, qrToken: payload.qrToken } : item));
      router.refresh();
    } else {
      const token = `demo-table-${table.tableNumber}-qr-${crypto.randomUUID()}`;
      setTables((current) => current.map((item) => item.id === table.id ? { ...item, qrToken: token } : item));
    }
    showNotice("새 QR이 발급되었습니다.");
  };

  const pendingPayments = orders.filter((order) => order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED").length;
  const cookingCount = orders.filter((order) => order.orderStatus === "COOKING" || order.orderStatus === "PAID").length;
  const readyCount = orders.filter((order) => order.orderStatus === "READY").length;
  const title = view === "orders" ? "실시간 주문 관리" : view === "inventory" ? "메뉴·재고 관리" : "테이블·QR 설정";

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand admin-brand" href="/"><span className="brand-mark">52</span><span><strong>컴공</strong><small>ADMIN CONSOLE</small></span></Link>
        <nav aria-label="운영 메뉴">
          <button type="button" className={view === "orders" ? "active" : ""} onClick={() => setView("orders")}><ClipboardList size={20} /> 주문 관리 <b>{orders.filter((item) => item.orderStatus !== "SERVED" && item.orderStatus !== "CANCELLED").length}</b></button>
          <button type="button" className={view === "inventory" ? "active" : ""} onClick={() => setView("inventory")}><Package size={20} /> 메뉴·재고 <b className="warn-count">{menu.filter((item) => item.stockQuantity <= 5 && item.status !== "ARCHIVED").length}</b></button>
          <button type="button" disabled><BarChart3 size={20} /> 매출 현황</button>
          <button type="button" className={view === "tables" ? "active" : ""} onClick={() => setView("tables")}><LayoutGrid size={20} /> 테이블·QR</button>
        </nav>
        <div className="sidebar-bottom"><button type="button"><Settings size={19} /> 매장 설정</button><div className="admin-profile"><span>운</span><div><strong>운영 관리자</strong><small><i /> 근무 중</small></div><ChevronRight size={17} /></div></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><h1>{title}</h1><p><span className="live-dot" /> 자동 동기화 · 창 복귀 시 즉시 갱신</p></div>
          <div className="admin-tools">{view === "orders" && <div className="admin-search"><Search size={18} /><input aria-label="주문 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="주문번호, 메뉴 검색" /></div>}<button type="button" className="icon-button" aria-label="새 알림"><Bell size={20} /><i /></button></div>
        </header>

        {view === "orders" ? <>
          <section className="stats-grid">
            <article><span className="stat-icon payment"><WalletCards size={22} /></span><div><small>입금 확인 필요</small><strong>{pendingPayments}<em>건</em></strong></div><button type="button" onClick={() => setFilter("PAYMENT")}>바로 보기 <ChevronRight size={15} /></button></article>
            <article><span className="stat-icon cooking"><CookingPot size={22} /></span><div><small>조리 대기·진행</small><strong>{cookingCount}<em>건</em></strong></div><span className="trend">평균 8분</span></article>
            <article><span className="stat-icon ready"><Check size={22} /></span><div><small>조리 완료</small><strong>{readyCount}<em>건</em></strong></div><button type="button" onClick={() => setFilter("READY")}>바로 보기 <ChevronRight size={15} /></button></article>
            <article><span className="stat-icon sales"><BarChart3 size={22} /></span><div><small>오늘 매출</small><strong className="money">₩ 1,284,000</strong></div><span className="trend up">테이블·포장 통합</span></article>
          </section>

          <div className="order-toolbar">
            <div className="admin-filters" role="tablist" aria-label="주문 필터">
              {([ ["ALL", "전체"], ["DINE_IN", "테이블"], ["TAKEOUT", "포장"], ["PAYMENT", "입금 확인"], ["COOKING", "조리 중"], ["READY", "조리 완료"] ] as Array<[Filter, string]>).map(([value, label]) => <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{label}{value === "PAYMENT" && pendingPayments > 0 && <b>{pendingPayments}</b>}</button>)}
            </div>
            <button className="refresh-button" type="button" onClick={() => router.refresh()}><RefreshCw size={16} /> 새로고침</button>
          </div>

          <section className="orders-grid" aria-label="주문 목록">
            {visibleOrders.length === 0 ? <div className="empty-state"><Check size={28} /><strong>해당 주문을 모두 처리했어요</strong><span>새 주문이 들어오면 자동으로 표시됩니다.</span></div> : visibleOrders.map((order) => <OrderCard order={order} onAdvance={advance} onCancel={cancel} key={order.id} />)}
          </section>
        </> : view === "inventory" ? <InventoryView menu={menu} categories={categories} onAdjust={adjustStock} onSaveMenu={saveMenu} onAddCategory={addCategory} onRenameCategory={renameCategory} onDeleteCategory={deleteCategory} /> : <TablesView tables={tables} onConfigure={configureTables} onRotate={rotateTableQr} />}
      </section>
      {notice && <div className="admin-toast"><Check size={17} /> {notice}</div>}
    </main>
  );
}

function OrderCard({ order, onAdvance, onCancel }: { order: DemoOrder; onAdvance: (id: string) => void; onCancel: (id: string) => void }) {
  const isPayment = order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED";
  const waitingForTransfer = order.orderStatus === "PENDING_PAYMENT" && !isPayment;
  const actionLabel = waitingForTransfer ? "입금 대기" : isPayment ? "입금 확인" : order.orderStatus === "PAID" ? "조리 시작" : order.orderStatus === "COOKING" ? "조리 완료" : order.fulfillmentType === "DINE_IN" ? "제공 완료" : "수령 완료";
  const actionIcon = isPayment ? <WalletCards size={17} /> : order.orderStatus === "READY" ? <Check size={17} /> : <ChefHat size={17} />;
  const statusLabel = isPayment ? "입금 확인 중" : STATUS_LABEL[order.orderStatus];
  return <article className={`order-card status-${order.orderStatus.toLowerCase()}`}>
    <div className="order-card-head"><div><span className="order-number">#{order.orderNumber}</span><span className={`order-status status-${order.orderStatus.toLowerCase()}`}>{statusLabel}</span></div><span className="order-time"><Clock3 size={15} /> {order.orderedAt}</span></div>
    <div className={`order-destination ${order.fulfillmentType === "TAKEOUT" ? "takeout" : ""}`}>{order.fulfillmentType === "DINE_IN" ? <><UtensilsCrossed size={19} /><strong>테이블 {order.tableNumber}</strong><span>매장 이용</span></> : <><ShoppingBag size={19} /><strong>포장 주문</strong><span>번호로 호출</span></>}</div>
    <div className="order-items">{order.items.map((item) => <div key={item.name}><span>{item.name}</span><strong>× {item.quantity}</strong></div>)}</div>
    <div className="order-total"><span>총 결제금액</span><strong>{formatWon(order.totalAmount)}</strong></div>
    <div className="order-actions"><button className="cancel-order" type="button" onClick={() => onCancel(order.id)} aria-label={`${order.orderNumber} 주문 취소`}><X size={17} /></button><button className="primary-order-action" type="button" disabled={waitingForTransfer} onClick={() => onAdvance(order.id)}>{actionIcon}{actionLabel}</button></div>
  </article>;
}

interface InventoryViewProps {
  menu: MenuItem[];
  categories: string[];
  onAdjust: (id: string, change: number) => void;
  onSaveMenu: (id: string | null, draft: MenuDraft) => Promise<boolean>;
  onAddCategory: (name: string) => Promise<boolean>;
  onRenameCategory: (previousName: string, nextName: string) => Promise<boolean>;
  onDeleteCategory: (name: string) => Promise<boolean>;
}

function InventoryView({ menu, categories, onAdjust, onSaveMenu, onAddCategory, onRenameCategory, onDeleteCategory }: InventoryViewProps) {
  const [editor, setEditor] = useState<MenuItem | "NEW" | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const totalSold = menu.reduce((sum, item) => sum + item.soldQuantity, 0);
  const activeMenu = menu.filter((item) => item.status !== "ARCHIVED");

  const addCategory = async (event: FormEvent) => {
    event.preventDefault();
    if (await onAddCategory(categoryName)) setCategoryName("");
  };
  const renameCategory = async (name: string) => {
    const next = window.prompt("새 카테고리 이름을 입력해 주세요.", name);
    if (next) await onRenameCategory(name, next);
  };

  return <>
    <section className="inventory-summary"><article><Package size={22} /><div><small>판매 가능 재고</small><strong>{activeMenu.reduce((sum, item) => sum + item.stockQuantity, 0)}개</strong></div></article><article><Store size={22} /><div><small>판매 완료</small><strong>{totalSold}개</strong></div></article><article className="warning"><AlertTriangle size={22} /><div><small>재고 주의</small><strong>{activeMenu.filter((item) => item.stockQuantity <= 5).length}개 메뉴</strong></div></article></section>
    <section className="category-panel">
      <div><strong>메뉴 카테고리</strong><small>이름을 눌러 수정하고, 사용하지 않는 분류만 삭제할 수 있어요.</small></div>
      <div className="category-manager">{categories.map((name) => <span className="category-chip" key={name}><button type="button" onClick={() => renameCategory(name)}><Pencil size={12} /> {name}</button><button type="button" aria-label={`${name} 삭제`} onClick={() => onDeleteCategory(name)}><X size={12} /></button></span>)}<form onSubmit={addCategory}><input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} maxLength={30} placeholder="새 카테고리" aria-label="새 카테고리 이름" /><button type="submit"><Plus size={14} /> 추가</button></form></div>
    </section>
    <section className="inventory-panel">
      <div className="panel-heading"><div><h2>현재 메뉴 재고</h2><p>재고 조정은 사유와 함께 감사 기록에 저장됩니다.</p></div><button type="button" onClick={() => setEditor("NEW")}><Plus size={17} /> 새 메뉴</button></div>
      <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>메뉴</th><th>판매 가능</th><th>주문 대기</th><th>판매 완료</th><th>상태</th><th>조정·관리</th></tr></thead><tbody>{activeMenu.map((item) => <tr key={item.id}><td><span className="table-emoji">{item.emoji}</span><div><strong>{item.name}</strong><small>{item.category} · {formatWon(item.price)}</small></div></td><td><strong className={item.stockQuantity <= 5 ? "low-number" : ""}>{item.stockQuantity}</strong>개</td><td>{item.reservedQuantity}개</td><td>{item.soldQuantity}개</td><td><span className={`inventory-status ${item.status.toLowerCase()}`}>{MENU_STATUS_LABEL[item.status]}</span></td><td><div className="stock-actions"><button type="button" onClick={() => onAdjust(item.id, -1)} disabled={item.stockQuantity === 0} aria-label={`${item.name} 재고 1 감소`}><Minus size={15} /></button><button type="button" onClick={() => onAdjust(item.id, 10)} aria-label={`${item.name} 재고 10 추가`}><Plus size={15} /> 10</button><button type="button" onClick={() => setEditor(item)} aria-label={`${item.name} 수정`}><Pencil size={14} /> 수정</button><button type="button" onClick={() => onSaveMenu(item.id, { ...item, status: item.status === "SOLD_OUT" ? "AVAILABLE" : "SOLD_OUT" })} aria-label={`${item.name} 품절 상태 전환`}><EyeOff size={14} /></button></div></td></tr>)}</tbody></table></div>
    </section>
    <div className="inventory-footnote"><Clock3 size={16} /> 메뉴 보관은 수정 창에서 선택할 수 있고 주문 내역은 삭제되지 않습니다.</div>
    {editor && <MenuEditor item={editor === "NEW" ? null : editor} categories={categories} onClose={() => setEditor(null)} onSave={async (draft) => { if (await onSaveMenu(editor === "NEW" ? null : editor.id, draft)) setEditor(null); }} />}
  </>;
}

function MenuEditor({ item, categories, onClose, onSave }: { item: MenuItem | null; categories: string[]; onClose: () => void; onSave: (draft: MenuDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<MenuDraft>(item ? { name: item.name, description: item.description, price: item.price, category: item.category, status: item.status, stockQuantity: item.stockQuantity } : { name: "", description: "", price: 0, category: categories[0] ?? "", status: "AVAILABLE", stockQuantity: 0 });
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  };
  return <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="admin-modal" role="dialog" aria-modal="true" aria-label={item ? "메뉴 수정" : "새 메뉴 추가"} onSubmit={submit}>
    <div className="admin-modal-head"><div><small>{item ? "MENU EDIT" : "NEW MENU"}</small><h2>{item ? item.name : "새 메뉴 추가"}</h2></div><button type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button></div>
    <label>메뉴 이름<input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label>설명<textarea maxLength={500} rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
    <div className="admin-form-row"><label>가격<input required type="number" min="0" step="100" value={draft.price} onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })} /></label><label>카테고리<select required value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label></div>
    <div className="admin-form-row"><label>판매 상태<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as MenuStatus })}><option value="AVAILABLE">판매 중</option><option value="SOLD_OUT">품절</option><option value="HIDDEN">숨김</option>{item && <option value="ARCHIVED">보관</option>}</select></label><label>초기 재고<input type="number" min="0" max="100000" disabled={Boolean(item)} value={draft.stockQuantity} onChange={(event) => setDraft({ ...draft, stockQuantity: Number(event.target.value) })} /><small>{item ? "기존 재고는 표의 빠른 조정으로 변경하세요." : "등록 시 확보된 수량"}</small></label></div>
    <div className="admin-modal-actions"><button type="button" onClick={onClose}>취소</button><button type="submit" disabled={saving || categories.length === 0}>{item?.status === "ARCHIVED" ? <Archive size={16} /> : <Check size={16} />}{saving ? "저장 중…" : "저장"}</button></div>
  </form></div>;
}

function TablesView({ tables, onConfigure, onRotate }: { tables: FestivalTable[]; onConfigure: (count: number) => void; onRotate: (table: FestivalTable) => void }) {
  const activeTables = tables.filter((table) => table.isActive).sort((a, b) => a.tableNumber - b.tableNumber);
  const [count, setCount] = useState(activeTables.length || 1);
  return <>
    <section className="table-setup-card">
      <div><span className="setup-icon"><QrCode size={24} /></span><div><h2>테이블 QR 자동 생성</h2><p>테이블 수를 저장하면 1번부터 각각 다른 주문 주소와 QR이 발급됩니다.</p></div></div>
      <form onSubmit={(event) => { event.preventDefault(); onConfigure(count); }}><label>운영 테이블 수<input type="number" min="1" max="200" value={count} onChange={(event) => setCount(Math.min(200, Math.max(1, Number(event.target.value))))} /></label><button type="submit"><Check size={17} /> 테이블 설정 저장</button></form>
    </section>
    <div className="table-list-heading"><div><h2>발급된 테이블 QR</h2><p>각 QR은 해당 테이블 번호를 식별합니다. 출력 후 테이블에 부착해 주세요.</p></div><button type="button" onClick={() => window.print()}><QrCode size={16} /> 전체 QR 인쇄</button></div>
    <section className="table-qr-grid">{activeTables.map((table) => <TableQrCard table={table} onRotate={onRotate} key={table.id} />)}</section>
  </>;
}

function TableQrCard({ table, onRotate }: { table: FestivalTable; onRotate: (table: FestivalTable) => void }) {
  const [qr, setQr] = useState({ orderUrl: "", dataUrl: "" });
  useEffect(() => {
    const url = `${window.location.origin}/t/${encodeURIComponent(table.qrToken)}`;
    let active = true;
    void QRCode.toDataURL(url, { width: 360, margin: 1, color: { dark: "#17212b", light: "#ffffff" } }).then((dataUrl) => {
      if (active) setQr({ orderUrl: url, dataUrl });
    });
    return () => { active = false; };
  }, [table.qrToken]);
  return <article className="table-qr-card">
    <div className="qr-card-head"><div><small>TABLE</small><strong>{table.tableNumber}</strong></div><span><i /> 사용 중</span></div>
    <div className="qr-image">{qr.dataUrl ? <Image src={qr.dataUrl} width={360} height={360} unoptimized alt={`${table.tableNumber}번 테이블 주문 QR`} /> : <QrCode size={78} />}</div>
    <p>{table.tableNumber}번 테이블 주문</p><small className="qr-token">{table.qrToken}</small>
    <div className="qr-actions"><button type="button" onClick={() => navigator.clipboard.writeText(qr.orderUrl)}><Copy size={14} /> 링크 복사</button>{qr.dataUrl && <a href={qr.dataUrl} download={`table-${table.tableNumber}-qr.png`}><QrCode size={14} /> 저장</a>}<button type="button" onClick={() => onRotate(table)} aria-label={`${table.tableNumber}번 QR 재발급`}><RotateCw size={14} /></button></div>
  </article>;
}
