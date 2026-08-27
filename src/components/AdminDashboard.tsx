"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { AlertTriangle, Archive, BarChart3, Bell, CalendarDays, Check, ChefHat, ChevronLeft, ChevronRight, ClipboardList, Clock3, CookingPot, Copy, EyeOff, LayoutGrid, LockKeyhole, Minus, Package, Pencil, Plus, QrCode, RefreshCw, RotateCw, Search, Settings, ShoppingBag, Store, UtensilsCrossed, WalletCards, X } from "lucide-react";
import { DEMO_MENU, DEMO_ORDERS, DEMO_TABLES, type DemoOrder, type FestivalTable } from "@/src/shared/demo-data";
import { formatWon, type MenuItem, type MenuStatus } from "@/src/features/menu/domain/menu";
import type { OrderStatus } from "@/src/features/orders/domain/order";
import { emptySalesSummary, getSeoulDateKey, shiftDateKey, type AdminSnapshot, type DailySalesSummary, type DailyTableSalesSummary, type SalesSummary, type TeamIdentity } from "@/src/features/admin/domain/admin-snapshot";
import { DEMO_STORE_SETTINGS, type StoreSettings } from "@/src/features/settings/domain/store-settings";

type Filter = "ALL" | "DINE_IN" | "TAKEOUT" | "PAYMENT" | "COOKING" | "READY";
type View = "orders" | "inventory" | "tables" | "sales" | "settings";
type MenuDraft = Pick<MenuItem, "name" | "description" | "price" | "category" | "status" | "stockQuantity">;

class AdminRequestError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

async function adminRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new AdminRequestError("네트워크 연결을 확인해 주세요. 기존 화면은 유지됩니다.");
  }
  const payload = await response.json().catch(() => null) as T | { message?: string } | null;
  if (response.status === 401 || response.status === 403) {
    window.location.assign("/admin");
    throw new AdminRequestError("로그인이 만료되었습니다. 다시 로그인해 주세요.", response.status);
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message
      : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    throw new AdminRequestError(message, response.status);
  }
  return payload as T;
}

function adminErrorMessage(error: unknown, fallback: string): string {
  return error instanceof AdminRequestError || error instanceof Error ? error.message : fallback;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "주문 확인 중", PAID: "주문 승인", COOKING: "조리 중", READY: "조리 완료", SERVED: "완료", CANCELLED: "취소",
};
const MENU_STATUS_LABEL: Record<MenuStatus, string> = { AVAILABLE: "판매 중", SOLD_OUT: "품절", HIDDEN: "숨김", ARCHIVED: "보관" };

interface AdminDashboardProps {
  initialSnapshot?: AdminSnapshot;
  demoMode?: boolean;
}

const DEMO_SALES: SalesSummary = {
  totalRevenue: DEMO_ORDERS.filter((order) => order.paymentStatus === "CONFIRMED").reduce((sum, order) => sum + order.totalAmount, 0),
  confirmedOrders: DEMO_ORDERS.filter((order) => order.paymentStatus === "CONFIRMED").length,
  dineInOrders: DEMO_ORDERS.filter((order) => order.paymentStatus === "CONFIRMED" && order.fulfillmentType === "DINE_IN").length,
  takeoutOrders: DEMO_ORDERS.filter((order) => order.paymentStatus === "CONFIRMED" && order.fulfillmentType === "TAKEOUT").length,
  averageOrderAmount: 15333,
};

const DEMO_DAILY_SALES: DailySalesSummary[] = [{ date: getSeoulDateKey(), ...DEMO_SALES }];
const DEMO_TABLE_DAILY_SALES: DailyTableSalesSummary[] = [
  { date: getSeoulDateKey(), tableNumber: 3, orderedAmount: 14000, confirmedAmount: 14000, orderCount: 1, confirmedOrders: 1 },
  { date: getSeoulDateKey(), tableNumber: 7, orderedAmount: 20000, confirmedAmount: 0, orderCount: 1, confirmedOrders: 0 },
];

const DEMO_SNAPSHOT: AdminSnapshot = {
  team: { departmentName: "컴퓨터공학과", teamName: "컴공 52 운영팀", publicSlug: "team-0000000000000000" },
  orders: DEMO_ORDERS,
  menu: DEMO_MENU,
  tables: DEMO_TABLES,
  categories: ["안주", "식사", "간식", "음료"],
  settings: DEMO_STORE_SETTINGS,
  sales: DEMO_SALES,
  dailySales: DEMO_DAILY_SALES,
  tableDailySales: DEMO_TABLE_DAILY_SALES,
  syncedAt: new Date().toISOString(),
};

export function AdminDashboard({
  initialSnapshot = DEMO_SNAPSHOT,
  demoMode = true,
}: AdminDashboardProps) {
  const [view, setView] = useState<View>("orders");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [orders, setOrders] = useState<DemoOrder[]>(initialSnapshot.orders);
  const [menu, setMenu] = useState<MenuItem[]>(initialSnapshot.menu);
  const [tables, setTables] = useState<FestivalTable[]>(initialSnapshot.tables);
  const [categories, setCategories] = useState<string[]>(initialSnapshot.categories);
  const [settings, setSettings] = useState<StoreSettings>(initialSnapshot.settings);
  const [team, setTeam] = useState<TeamIdentity>(initialSnapshot.team);
  const [sales, setSales] = useState<SalesSummary>(initialSnapshot.sales);
  const [dailySales, setDailySales] = useState<DailySalesSummary[]>(initialSnapshot.dailySales ?? []);
  const [tableDailySales, setTableDailySales] = useState<DailyTableSalesSummary[]>(initialSnapshot.tableDailySales ?? []);
  const [syncedAt, setSyncedAt] = useState(initialSnapshot.syncedAt);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const refreshInFlight = useRef(false);

  const applySnapshot = useCallback((snapshot: AdminSnapshot) => {
    setTeam(snapshot.team);
    setOrders(snapshot.orders);
    setMenu(snapshot.menu);
    setTables(snapshot.tables);
    setCategories(snapshot.categories);
    setSettings(snapshot.settings);
    setSales(snapshot.sales);
    setDailySales(snapshot.dailySales ?? []);
    setTableDailySales(snapshot.tableDailySales ?? []);
    setSyncedAt(snapshot.syncedAt);
  }, []);

  const refreshSnapshot = useCallback(async (silent = false) => {
    if (demoMode) {
      setSyncedAt(new Date().toISOString());
      if (!silent) setNotice("데모 데이터가 새로고침되었습니다.");
      return;
    }
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setSyncing(true);
    try {
      applySnapshot(await adminRequest<AdminSnapshot>("/api/admin/snapshot"));
      if (!silent) setNotice("최신 운영 현황을 불러왔습니다.");
    } catch (error) {
      if (!silent) setNotice(adminErrorMessage(error, "운영 현황을 불러오지 못했습니다."));
    } finally {
      setSyncing(false);
      refreshInFlight.current = false;
    }
  }, [applySnapshot, demoMode]);

  useEffect(() => {
    if (demoMode) return;
    const sync = () => { if (document.visibilityState === "visible") void refreshSnapshot(true); };
    const timer = window.setInterval(sync, 10000);
    window.addEventListener("focus", sync);
    const onVisibility = () => { if (document.visibilityState === "visible") sync(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [demoMode, refreshSnapshot]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

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
      try {
        await adminRequest(`/api/admin/orders/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
        await refreshSnapshot(true);
      } catch (error) { showNotice(adminErrorMessage(error, "주문 상태를 바꾸지 못했습니다.")); return; }
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
      try {
        await adminRequest(`/api/admin/orders/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "CANCEL" }) });
        await refreshSnapshot(true);
      } catch (error) { showNotice(adminErrorMessage(error, "주문을 취소하지 못했습니다.")); return; }
    } else {
      setOrders((current) => current.map((order) => order.id === id ? { ...order, orderStatus: "CANCELLED" } : order));
    }
    showNotice("주문을 취소하고 재고를 복구했습니다.");
  };

  const adjustStock = async (id: string, quantityChange: number) => {
    if (!demoMode) {
      try {
        await adminRequest(`/api/admin/menu/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quantityChange, reason: quantityChange > 0 ? "추가 입고" : "운영 조정" }) });
        await refreshSnapshot(true);
      } catch (error) { showNotice(adminErrorMessage(error, "재고를 조정하지 못했습니다.")); return; }
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
      try {
        await adminRequest(id ? `/api/admin/menu/${id}` : "/api/admin/menu", {
          method: id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(id ? { name: draft.name, description: draft.description, price: draft.price, category: draft.category, status: draft.status } : draft),
        });
        await refreshSnapshot(true);
      } catch (error) { showNotice(adminErrorMessage(error, "메뉴를 저장하지 못했습니다.")); return false; }
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
      try {
        await adminRequest("/api/admin/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: normalized }) });
        await refreshSnapshot(true);
      } catch (error) { showNotice(adminErrorMessage(error, "카테고리를 추가하지 못했습니다.")); return false; }
    } else setCategories((current) => [...current, normalized]);
    showNotice("카테고리가 추가되었습니다.");
    return true;
  };

  const renameCategory = async (previousName: string, nextName: string): Promise<boolean> => {
    const normalized = nextName.trim();
    if (!normalized || normalized === previousName || categories.includes(normalized)) return false;
    if (!demoMode) {
      try {
        await adminRequest("/api/admin/categories", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ previousName, nextName: normalized }) });
        await refreshSnapshot(true);
      } catch (error) { showNotice(adminErrorMessage(error, "카테고리 이름을 바꾸지 못했습니다.")); return false; }
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
      try {
        await adminRequest("/api/admin/categories", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
        await refreshSnapshot(true);
      } catch (error) { showNotice(adminErrorMessage(error, "카테고리를 삭제하지 못했습니다.")); return false; }
    } else setCategories((current) => current.filter((item) => item !== name));
    showNotice("카테고리가 삭제되었습니다.");
    return true;
  };

  const configureTables = async (count: number): Promise<boolean> => {
    const currentCount = tables.filter((table) => table.isActive).length;
    if (count < currentCount && !window.confirm(`${currentCount - count}개 테이블을 비활성화할까요? 기존 주문 기록은 유지됩니다.`)) return false;
    if (!demoMode) {
      try {
        const payload = await adminRequest<FestivalTable[]>("/api/admin/tables", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count }) });
        if (!Array.isArray(payload)) throw new AdminRequestError("테이블 설정 결과를 확인하지 못했습니다.");
        setTables(payload);
      } catch (error) { showNotice(adminErrorMessage(error, "테이블을 설정하지 못했습니다.")); return false; }
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
    return true;
  };

  const rotateTableQr = async (table: FestivalTable) => {
    if (!window.confirm(`${table.tableNumber}번 테이블 QR을 재발급할까요? 기존 QR은 즉시 사용할 수 없게 됩니다.`)) return;
    if (!demoMode) {
      try {
        const payload = await adminRequest<{ qrToken: string }>(`/api/admin/tables/${table.id}`, { method: "POST" });
        if (!payload.qrToken) throw new AdminRequestError("QR 발급 결과를 확인하지 못했습니다.");
        setTables((current) => current.map((item) => item.id === table.id ? { ...item, qrToken: payload.qrToken } : item));
        await refreshSnapshot(true);
      } catch (error) { showNotice(adminErrorMessage(error, "QR을 재발급하지 못했습니다.")); return; }
    } else {
      const token = `demo-table-${table.tableNumber}-qr-${crypto.randomUUID()}`;
      setTables((current) => current.map((item) => item.id === table.id ? { ...item, qrToken: token } : item));
    }
    showNotice("새 QR이 발급되었습니다.");
  };

  const pendingPayments = orders.filter((order) => order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED").length;
  const cookingCount = orders.filter((order) => order.orderStatus === "COOKING" || order.orderStatus === "PAID").length;
  const readyCount = orders.filter((order) => order.orderStatus === "READY").length;
  const title: Record<View, string> = {
    orders: "실시간 주문 관리",
    inventory: "메뉴·재고 관리",
    tables: "테이블·QR 설정",
    sales: "매출 현황",
    settings: "매장 설정",
  };

  const saveSettings = async (draft: StoreSettings): Promise<boolean> => {
    if (demoMode) {
      setSettings({ ...draft, configured: Boolean(draft.bankName && draft.accountNumber && draft.accountHolder) });
      showNotice("데모 매장 설정이 저장되었습니다.");
      return true;
    }
    try {
      const payload = await adminRequest<StoreSettings>("/api/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      setSettings(payload);
      await refreshSnapshot(true);
    } catch (error) { showNotice(adminErrorMessage(error, "매장 설정을 저장하지 못했습니다.")); return false; }
    showNotice("매장 설정이 저장되었습니다.");
    return true;
  };

  const logout = async () => {
    try {
      await adminRequest("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/admin");
    }
  };

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <a className="brand admin-brand" href="/"><span className="brand-mark">52</span><span><strong>{team.departmentName}</strong><small>{team.teamName}</small></span></a>
        <nav aria-label="운영 메뉴">
          <button type="button" className={view === "orders" ? "active" : ""} onClick={() => setView("orders")}><ClipboardList size={20} /> 주문 관리 <b>{orders.filter((item) => item.orderStatus !== "SERVED" && item.orderStatus !== "CANCELLED").length}</b></button>
          <button type="button" className={view === "inventory" ? "active" : ""} onClick={() => setView("inventory")}><Package size={20} /> 메뉴·재고 <b className="warn-count">{menu.filter((item) => item.stockQuantity <= 5 && item.status !== "ARCHIVED").length}</b></button>
          <button type="button" className={view === "sales" ? "active" : ""} onClick={() => setView("sales")}><BarChart3 size={20} /> 매출 현황</button>
          <button type="button" className={view === "tables" ? "active" : ""} onClick={() => setView("tables")}><LayoutGrid size={20} /> 테이블·QR</button>
          <button type="button" className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><Settings size={20} /> 매장 설정</button>
        </nav>
        <div className="sidebar-bottom"><div className="admin-profile"><span>운</span><div><strong>운영 관리자</strong><small><i /> 근무 중</small></div><ChevronRight size={17} /></div></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><h1>{title[view]}</h1><p><span className="live-dot" /> {syncing ? "동기화 중" : `10초마다 동기화 · ${new Date(syncedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}</p></div>
          <div className="admin-tools">{view === "orders" && <div className="admin-search"><Search size={18} /><input aria-label="주문 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="주문번호, 메뉴 검색" /></div>}<button type="button" className="icon-button" aria-label="입금 확인 주문 보기" onClick={() => { setView("orders"); setFilter("PAYMENT"); showNotice(pendingPayments ? `입금 확인이 필요한 주문 ${pendingPayments}건입니다.` : "확인할 입금 알림이 없습니다."); }}><Bell size={20} />{pendingPayments > 0 && <i />}</button></div>
        </header>

        {view === "orders" ? <>
          <section className="stats-grid">
            <article><span className="stat-icon payment"><WalletCards size={22} /></span><div><small>입금 확인 필요</small><strong>{pendingPayments}<em>건</em></strong></div><button type="button" onClick={() => setFilter("PAYMENT")}>바로 보기 <ChevronRight size={15} /></button></article>
            <article><span className="stat-icon cooking"><CookingPot size={22} /></span><div><small>조리 대기·진행</small><strong>{cookingCount}<em>건</em></strong></div><span className="trend">평균 8분</span></article>
            <article><span className="stat-icon ready"><Check size={22} /></span><div><small>조리 완료</small><strong>{readyCount}<em>건</em></strong></div><button type="button" onClick={() => setFilter("READY")}>바로 보기 <ChevronRight size={15} /></button></article>
            <article><span className="stat-icon sales"><BarChart3 size={22} /></span><div><small>확정 매출</small><strong className="money">{formatWon(sales.totalRevenue)}</strong></div><button type="button" onClick={() => setView("sales")}>자세히 <ChevronRight size={15} /></button></article>
          </section>

          <div className="order-toolbar">
            <div className="admin-filters" role="tablist" aria-label="주문 필터">
              {([ ["ALL", "전체"], ["DINE_IN", "테이블"], ["TAKEOUT", "포장"], ["PAYMENT", "입금 확인"], ["COOKING", "조리 중"], ["READY", "조리 완료"] ] as Array<[Filter, string]>).map(([value, label]) => <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{label}{value === "PAYMENT" && pendingPayments > 0 && <b>{pendingPayments}</b>}</button>)}
            </div>
            <button className="refresh-button" type="button" disabled={syncing} onClick={() => void refreshSnapshot()}><RefreshCw size={16} /> 새로고침</button>
          </div>

          <section className="orders-grid" aria-label="주문 목록">
            {visibleOrders.length === 0 ? <div className="empty-state"><Check size={28} /><strong>해당 주문을 모두 처리했어요</strong><span>새 주문이 들어오면 자동으로 표시됩니다.</span></div> : visibleOrders.map((order) => <OrderCard order={order} onAdvance={advance} onCancel={cancel} key={order.id} />)}
          </section>
        </> : view === "inventory" ? <InventoryView menu={menu} categories={categories} onAdjust={adjustStock} onSaveMenu={saveMenu} onAddCategory={addCategory} onRenameCategory={renameCategory} onDeleteCategory={deleteCategory} /> : view === "tables" ? <TablesView team={team} tables={tables} onConfigure={configureTables} onRotate={rotateTableQr} /> : view === "sales" ? <SalesView totalSales={sales} dailySales={dailySales} tableDailySales={tableDailySales} tables={tables} /> : <SettingsView settings={settings} onSave={saveSettings} onLogout={logout} />}
      </section>
      {!online && <div className="admin-offline" role="alert"><AlertTriangle size={17} /> 네트워크 연결이 끊겼습니다. 기존 화면은 유지되며 연결 후 다시 동기화됩니다.</div>}
      {notice && <div className="admin-toast"><Check size={17} /> {notice}</div>}
    </main>
  );
}

function SalesView({ totalSales, dailySales, tableDailySales, tables }: { totalSales: SalesSummary; dailySales: DailySalesSummary[]; tableDailySales: DailyTableSalesSummary[]; tables: FestivalTable[] }) {
  const today = getSeoulDateKey();
  const [selectedDate, setSelectedDate] = useState(today);
  const sales = dailySales.find((item) => item.date === selectedDate) ?? emptySalesSummary();
  const selectedDateRows = tableDailySales.filter((item) => item.date === selectedDate);
  const selectedTableSales = Array.from(new Set([
    ...tables.filter((table) => table.isActive).map((table) => table.tableNumber),
    ...selectedDateRows.map((item) => item.tableNumber),
  ])).sort((a, b) => a - b).map((tableNumber) => selectedDateRows.find((item) => item.tableNumber === tableNumber) ?? {
    date: selectedDate, tableNumber, orderedAmount: 0, confirmedAmount: 0, orderCount: 0, confirmedOrders: 0,
  });
  const selectedDateLabel = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${selectedDate}T00:00:00+09:00`));

  return <section className="sales-view">
    <div className="sales-date-toolbar">
      <div className="sales-date-heading"><span><CalendarDays size={18} /></span><div><small>조회 날짜</small><strong>{selectedDateLabel}</strong></div></div>
      <div className="sales-date-controls">
        <button type="button" aria-label="이전 날짜" onClick={() => setSelectedDate((date) => shiftDateKey(date, -1))}><ChevronLeft size={18} /></button>
        <input type="date" aria-label="매출 조회 날짜" max={today} value={selectedDate} onChange={(event) => event.target.value && setSelectedDate(event.target.value)} />
        <button type="button" aria-label="다음 날짜" disabled={selectedDate >= today} onClick={() => setSelectedDate((date) => shiftDateKey(date, 1))}><ChevronRight size={18} /></button>
        <button type="button" className="today-button" disabled={selectedDate === today} onClick={() => setSelectedDate(today)}>오늘</button>
      </div>
    </div>
    <div className="sales-hero">
      <div><small>DAILY CONFIRMED REVENUE</small><h2>{formatWon(sales.totalRevenue)}</h2><p>{selectedDateLabel} · 관리자가 입금을 확인한 시각을 기준으로 집계합니다.</p></div>
      <BarChart3 size={42} />
    </div>
    <div className="sales-summary-grid">
      <article><small>결제 확정 주문</small><strong>{sales.confirmedOrders}<em>건</em></strong></article>
      <article><small>평균 주문 금액</small><strong>{formatWon(sales.averageOrderAmount)}</strong></article>
      <article><small>테이블 주문</small><strong>{sales.dineInOrders}<em>건</em></strong></article>
      <article><small>포장 주문</small><strong>{sales.takeoutOrders}<em>건</em></strong></article>
    </div>
    <section className="table-sales-panel">
      <div className="table-sales-heading"><div><small>TABLE SALES</small><h3>테이블별 금액</h3><p>{selectedDateLabel} 주문 금액과 실제 입금 확인 금액입니다.</p></div><LayoutGrid size={24} /></div>
      <div className="table-sales-grid">{selectedTableSales.map((tableSale) => <article className={tableSale.orderCount ? "has-orders" : ""} key={tableSale.tableNumber}>
        <div><span>테이블 {tableSale.tableNumber}</span><em>{tableSale.orderCount}건</em></div>
        <small>주문 금액</small><strong>{formatWon(tableSale.orderedAmount)}</strong>
        <p><span>입금 확인 {tableSale.confirmedOrders}건</span><b>{formatWon(tableSale.confirmedAmount)}</b></p>
      </article>)}</div>
      {selectedTableSales.length === 0 && <div className="table-sales-empty">활성화된 테이블이 없습니다.</div>}
    </section>
    <div className="sales-total-line"><span>전체 누적 확정 매출</span><strong>{formatWon(totalSales.totalRevenue)}</strong><em>{totalSales.confirmedOrders}건</em></div>
    <div className="sales-note"><WalletCards size={19} /><div><strong>현금·계좌이체 운영 기준</strong><p>고객의 “송금 완료” 표시만으로는 매출이 잡히지 않습니다. 실제 입금을 확인한 뒤 주문 관리에서 입금 확인을 눌러 주세요.</p></div></div>
  </section>;
}

function SettingsView({ settings, onSave, onLogout }: { settings: StoreSettings; onSave: (draft: StoreSettings) => Promise<boolean>; onLogout: () => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  };
  const readyToOpen = Boolean(draft.bankName.trim() && draft.accountNumber.trim() && draft.accountHolder.trim());
  return <section className="settings-view">
    <form className="settings-card" onSubmit={submit}>
      <div className="settings-heading"><div><small>STORE CONTROL</small><h2>축제 매장 운영 설정</h2><p>고객 주문 화면의 상호, 계좌, 영업 상태에 즉시 반영됩니다.</p></div><Store size={28} /></div>
      {!readyToOpen && <div className="settings-warning"><AlertTriangle size={18} /><span>실제 계좌 정보를 모두 입력해야 주문 접수를 시작할 수 있습니다.</span></div>}
      <div className="settings-form-grid">
        <label>부스 이름<input required maxLength={80} value={draft.stallName} onChange={(event) => setDraft({ ...draft, stallName: event.target.value })} /></label>
        <label>운영 시간<input required maxLength={80} value={draft.operatingHours} onChange={(event) => setDraft({ ...draft, operatingHours: event.target.value })} /></label>
        <label>은행<input maxLength={40} placeholder="예: 카카오뱅크" value={draft.bankName} onChange={(event) => setDraft({ ...draft, bankName: event.target.value })} /></label>
        <label>예금주<input maxLength={60} placeholder="실제 예금주" value={draft.accountHolder} onChange={(event) => setDraft({ ...draft, accountHolder: event.target.value })} /></label>
        <label className="wide">계좌번호<input maxLength={60} inputMode="numeric" placeholder="하이픈 포함 가능" value={draft.accountNumber} onChange={(event) => setDraft({ ...draft, accountNumber: event.target.value })} /></label>
      </div>
      <label className={`store-open-toggle ${draft.isOpen ? "open" : ""}`}><span><strong>{draft.isOpen ? "주문 접수 중" : "주문 접수 중지"}</strong><small>{draft.isOpen ? "고객이 새 주문을 제출할 수 있습니다." : "메뉴는 보이지만 새 주문은 차단됩니다."}</small></span><input type="checkbox" aria-label="주문 접수 여부" checked={draft.isOpen} disabled={!readyToOpen && !draft.isOpen} onChange={(event) => setDraft({ ...draft, isOpen: event.target.checked })} /><i /></label>
      <div className="settings-actions"><button type="button" className="logout-button" onClick={() => void onLogout()}>관리자 로그아웃</button><button type="submit" disabled={saving || (draft.isOpen && !readyToOpen)}><Check size={16} /> {saving ? "저장 중" : "설정 저장"}</button></div>
    </form>
    <PasswordSecurityCard />
  </section>;
}

function PasswordSecurityCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (newPassword !== confirmation) { setMessage("새 비밀번호 확인이 일치하지 않습니다."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) { setMessage(result?.message ?? "비밀번호를 변경하지 못했습니다."); return; }
      setCurrentPassword(""); setNewPassword(""); setConfirmation("");
      setMessage("새 비밀번호로 변경했고 다른 로그인 세션을 종료했습니다.");
    } finally {
      setSaving(false);
    }
  };
  return <form className="settings-card security-settings-card" onSubmit={submit}>
    <div className="settings-heading"><div><small>ADMIN SECURITY</small><h2>관리자 비밀번호 보안</h2><p>유출 이력과 강도를 검사하고, 변경 후 다른 로그인 세션을 종료합니다.</p></div><LockKeyhole size={28} /></div>
    <div className="settings-form-grid">
      <label className="wide">현재 비밀번호<input required type="password" minLength={8} maxLength={200} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
      <label>새 비밀번호<input required type="password" minLength={14} maxLength={200} autoComplete="new-password" placeholder="14자 이상 · 대소문자·숫자·특수문자" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
      <label>새 비밀번호 확인<input required type="password" minLength={14} maxLength={200} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
    </div>
    {message && <p className="security-settings-message" role="status">{message}</p>}
    <div className="settings-actions"><span /><button type="submit" disabled={saving}>{saving ? "보안 확인 중…" : "비밀번호 안전하게 변경"}</button></div>
  </form>;
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

function TablesView({ team, tables, onConfigure, onRotate }: { team: TeamIdentity; tables: FestivalTable[]; onConfigure: (count: number) => Promise<boolean>; onRotate: (table: FestivalTable) => void }) {
  const activeTables = tables.filter((table) => table.isActive).sort((a, b) => a.tableNumber - b.tableNumber);
  const [count, setCount] = useState(activeTables.length || 1);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await onConfigure(count);
    setSaving(false);
  };
  return <>
    <section className="table-setup-card">
      <div><span className="setup-icon"><QrCode size={24} /></span><div><h2>테이블 QR 생성</h2><p>테이블 수를 입력하고 생성 버튼을 누르면 1번부터 서로 다른 주문 QR이 발급됩니다. 현재 {activeTables.length}개가 사용 중입니다.</p></div></div>
      <form onSubmit={submit}><label>운영 테이블 수<input type="number" min="1" max="200" value={count} onChange={(event) => setCount(Math.min(200, Math.max(1, Number(event.target.value))))} /></label><button type="submit" disabled={saving}><Check size={17} /> {saving ? "생성 중…" : `${count}개 QR 생성`}</button></form>
    </section>
    <TakeoutQrCard team={team} />
    <div className="table-list-heading"><div><h2>발급된 테이블 QR</h2><p>각 QR은 해당 테이블 번호를 식별합니다. 출력 후 테이블에 부착해 주세요.</p></div><button type="button" onClick={() => window.print()}><QrCode size={16} /> 전체 QR 인쇄</button></div>
    <section className="table-qr-grid">{activeTables.map((table) => <TableQrCard table={table} onRotate={onRotate} key={table.id} />)}</section>
  </>;
}

function TakeoutQrCard({ team }: { team: TeamIdentity }) {
  const [qr, setQr] = useState({ orderUrl: "", dataUrl: "" });
  const [qrError, setQrError] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const url = `${window.location.origin}/s/${encodeURIComponent(team.publicSlug)}`;
    let active = true;
    void QRCode.toDataURL(url, { width: 420, margin: 1, color: { dark: "#17212b", light: "#ffffff" } })
      .then((dataUrl) => { if (active) setQr({ orderUrl: url, dataUrl }); })
      .catch(() => { if (active) setQrError(true); });
    return () => { active = false; };
  }, [team.publicSlug]);
  const copyLink = async () => {
    if (!qr.orderUrl) return;
    await navigator.clipboard.writeText(qr.orderUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return <section className="takeout-qr-panel">
    <div className="takeout-qr-copy">
      <span className="setup-icon takeout"><ShoppingBag size={24} /></span>
      <div><small>TAKEOUT ORDER</small><h2>포장 주문 QR</h2><p>포장 고객은 이 QR을 스캔하면 테이블 번호 없이 바로 메뉴를 주문할 수 있습니다. 한 번 출력해 계속 사용하세요.</p>
        <div className="takeout-qr-actions"><button type="button" onClick={() => void copyLink()}><Copy size={15} /> {copied ? "복사 완료" : "주문 링크 복사"}</button>{qr.dataUrl && <a href={qr.dataUrl} download="takeout-order-qr.png"><QrCode size={15} /> QR 이미지 저장</a>}</div>
      </div>
    </div>
    <div className="takeout-qr-image">{qrError ? <span className="qr-error"><AlertTriangle size={20} />QR 생성 실패</span> : qr.dataUrl ? <Image src={qr.dataUrl} width={420} height={420} unoptimized alt="포장 주문 QR" /> : <QrCode size={82} />}</div>
  </section>;
}

function TableQrCard({ table, onRotate }: { table: FestivalTable; onRotate: (table: FestivalTable) => void }) {
  const [qr, setQr] = useState({ orderUrl: "", dataUrl: "" });
  const [qrError, setQrError] = useState(false);
  useEffect(() => {
    const url = `${window.location.origin}/t/${encodeURIComponent(table.qrToken)}`;
    let active = true;
    void QRCode.toDataURL(url, { width: 360, margin: 1, color: { dark: "#17212b", light: "#ffffff" } })
      .then((dataUrl) => { if (active) setQr({ orderUrl: url, dataUrl }); })
      .catch(() => { if (active) setQrError(true); });
    return () => { active = false; };
  }, [table.qrToken]);
  return <article className="table-qr-card">
    <div className="qr-card-head"><div><small>TABLE</small><strong>{table.tableNumber}</strong></div><span><i /> 사용 중</span></div>
    <div className="qr-image">{qrError ? <span className="qr-error"><AlertTriangle size={18} />QR 생성 실패</span> : qr.dataUrl ? <Image src={qr.dataUrl} width={360} height={360} unoptimized alt={`${table.tableNumber}번 테이블 주문 QR`} /> : <QrCode size={78} />}</div>
    <p>{table.tableNumber}번 테이블 주문</p><small className="qr-token">{table.qrToken}</small>
    <div className="qr-actions"><button type="button" onClick={() => navigator.clipboard.writeText(qr.orderUrl)}><Copy size={14} /> 링크 복사</button>{qr.dataUrl && <a href={qr.dataUrl} download={`table-${table.tableNumber}-qr.png`}><QrCode size={14} /> 저장</a>}<button type="button" onClick={() => onRotate(table)} aria-label={`${table.tableNumber}번 QR 재발급`}><RotateCw size={14} /></button></div>
  </article>;
}
