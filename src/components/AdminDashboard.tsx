"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { AlertTriangle, Archive, BarChart3, Bell, CalendarDays, Check, ChefHat, ChevronLeft, ChevronRight, ClipboardList, Clock3, CookingPot, Copy, Crown, EyeOff, LayoutGrid, LockKeyhole, Minus, Package, Pencil, Phone, Plus, QrCode, RefreshCw, RotateCw, Search, Settings, ShoppingBag, Store, Swords, UtensilsCrossed, WalletCards, X } from "lucide-react";
import { DEMO_MENU, DEMO_ORDERS, DEMO_TABLES, type DemoOrder, type FestivalTable } from "@/src/shared/demo-data";
import { formatWon, type MenuItem, type MenuOption, type MenuStatus } from "@/src/features/menu/domain/menu";
import type { OrderStatus } from "@/src/features/orders/domain/order";
import { emptySalesSummary, getSeoulDateKey, shiftDateKey, type AdminSnapshot, type DailySalesSummary, type DailyTableSalesSummary, type SalesSummary, type TeamIdentity } from "@/src/features/admin/domain/admin-snapshot";
import { DEMO_STORE_SETTINGS, type StoreSettings } from "@/src/features/settings/domain/store-settings";
import type { AdminTableBattleState } from "@/src/features/table-battle/presentation/admin-table-battle-controller";
import { filterOrders, isActiveOrder, type OrderFilter, type OrderChannel } from "@/src/features/admin/domain/order-list";
import { useDialog } from "@/src/shared/use-dialog";

type Filter = OrderFilter;
type View = "orders" | "inventory" | "tables" | "sales" | "settings" | "battle";
type MenuDraft = Pick<MenuItem, "name" | "description" | "price" | "category" | "status" | "stockQuantity" | "options">;
type AdminOrderResponse = { ok: true; push?: { attempted: number; delivered: number; failed: number; unavailable?: boolean } };
type OwnerManualOrderDraft = { label: string; amount: number; fulfillmentType: "DINE_IN" | "TAKEOUT"; tableNumber: number | null; clientRequestId: string };

class AdminRequestError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

async function adminRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000), ...init });
  } catch {
    throw new AdminRequestError("네트워크 연결을 확인해 주세요. 기존 화면은 유지됩니다.");
  }
  const payload = await response.json().catch(() => null) as T | { message?: string } | null;
  if (response.status === 401) {
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
  PENDING_PAYMENT: "입금 대기", PAID: "조리 대기", COOKING: "조리 중", READY: "전달 대기", SERVED: "완료", CANCELLED: "취소",
};
const MENU_STATUS_LABEL: Record<MenuStatus, string> = { AVAILABLE: "판매 중", SOLD_OUT: "품절", HIDDEN: "숨김", ARCHIVED: "보관" };

interface AdminDashboardProps {
  initialSnapshot?: AdminSnapshot;
  demoMode?: boolean;
  initialIsOwner?: boolean;
}

const DEMO_SALES: SalesSummary = {
  totalRevenue: DEMO_ORDERS.filter((order) => order.paymentStatus === "CONFIRMED").reduce((sum, order) => sum + order.totalAmount, 0),
  confirmedOrders: DEMO_ORDERS.filter((order) => order.paymentStatus === "CONFIRMED").length,
  dineInOrders: DEMO_ORDERS.filter((order) => order.paymentStatus === "CONFIRMED" && order.fulfillmentType === "DINE_IN").length,
  takeoutOrders: DEMO_ORDERS.filter((order) => order.paymentStatus === "CONFIRMED" && order.fulfillmentType === "TAKEOUT").length,
  averageOrderAmount: 15333,
};

const DEMO_DAILY_SALES: DailySalesSummary[] = [{ date: getSeoulDateKey(), ...DEMO_SALES }];
const DEMO_TABLE_BATTLE: AdminTableBattleState = {
  event: { id: "00000000-0000-4000-8000-000000000018", title: "18:00 TABLE BATTLE", status: "BOMB_GAME", rewardName: "버갈튀 1개 무료", winnerTableId: null, minimumOrderAmount: 10000, roundCount: 3, lastRoundType: "BOMB_GAME" },
  participants: [
    { id: "00000000-0000-4000-8000-000000000007", tableNumber: 7, teamName: "불타는 감자단", status: "APPROVED", wordScore: 11, eligibleAmount: 20000 },
    { id: "00000000-0000-4000-8000-000000000003", tableNumber: 3, teamName: "치즈러버", status: "APPROVED", wordScore: 9, eligibleAmount: 14000 },
    { id: "00000000-0000-4000-8000-000000000005", tableNumber: 5, teamName: "개발자살려", status: "ELIMINATED", wordScore: 4, eligibleAmount: 10000 },
  ],
};
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
  initialIsOwner = demoMode,
}: AdminDashboardProps) {
  const [view, setView] = useState<View>("orders");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [channel, setChannel] = useState<OrderChannel>("ALL");
  const [manualOpen, setManualOpen] = useState(false);
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
  const [isOwner, setIsOwner] = useState(initialIsOwner);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [busyOrders, setBusyOrders] = useState<Set<string>>(new Set());
  const orderLocks = useRef(new Set<string>());
  const [battleState, setBattleState] = useState<AdminTableBattleState>(DEMO_TABLE_BATTLE);
  const [battleLoading, setBattleLoading] = useState(false);
  const refreshInFlight = useRef(false);
  const battleInFlight = useRef(false);

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
      setSyncError(null);
      if (!silent) setNotice("최신 운영 현황을 불러왔습니다.");
    } catch (error) {
      setSyncError(adminErrorMessage(error, "최신 주문을 확인하지 못했습니다."));
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

  useEffect(() => {
    if (demoMode) return;
    let active = true;
    void adminRequest<{ isOwner: boolean }>("/api/admin/owner")
      .then((result) => { if (active) setIsOwner(result.isOwner); })
      .catch(() => { if (active) setIsOwner(false); });
    return () => { active = false; };
  }, [demoMode]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2400);
  }, []);

  const refreshBattle = useCallback(async () => {
    if (demoMode) return;
    if (battleInFlight.current) return;
    battleInFlight.current = true;
    setBattleLoading(true);
    try {
      setBattleState(await adminRequest<AdminTableBattleState>("/api/admin/table-battle"));
    } catch (error) {
      showNotice(adminErrorMessage(error, "TABLE BATTLE 운영 현황을 불러오지 못했습니다."));
    } finally {
      setBattleLoading(false);
      battleInFlight.current = false;
    }
  }, [demoMode, showNotice]);

  useEffect(() => {
    if (view !== "battle") return;
    const id = window.setTimeout(() => void refreshBattle(), 0);
    return () => window.clearTimeout(id);
  }, [refreshBattle, view]);

  const visibleOrders = useMemo(() => filterOrders(orders, filter, channel, search), [filter, channel, orders, search]);

  const runOrderAction = async (id: string, action: (id: string) => Promise<void>) => {
    if (orderLocks.current.has(id) || !online) return;
    orderLocks.current.add(id);
    setBusyOrders(new Set(orderLocks.current));
    try { await action(id); }
    finally { orderLocks.current.delete(id); setBusyOrders(new Set(orderLocks.current)); }
  };

  const advance = async (id: string) => {
    const target = orders.find((order) => order.id === id);
    if (!target || !isActiveOrder(target) || (target.orderStatus === "PENDING_PAYMENT" && target.paymentStatus !== "CUSTOMER_MARKED_TRANSFERRED")) return;
    const action = target.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED" ? "CONFIRM_PAYMENT" : target.orderStatus === "PAID" ? "START_COOKING" : target.orderStatus === "COOKING" ? "MARK_READY" : "MARK_SERVED";
    let transitionNotice = "주문 상태가 반영되었습니다.";
    if (!demoMode) {
      try {
        const result = await adminRequest<AdminOrderResponse>(`/api/admin/orders/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
        if (action === "MARK_READY" && result.push) {
          if (result.push.unavailable) transitionNotice = "조리 완료 처리됨 · 푸시 확인에 실패해 포장 주문은 전화 확인이 필요해요.";
          else if (result.push.delivered > 0 && result.push.failed > 0) transitionNotice = `조리 완료 · 푸시 ${result.push.delivered}대 전송, ${result.push.failed}대 실패`;
          else if (result.push.delivered > 0) transitionNotice = `조리 완료 · 푸시 알림 ${result.push.delivered}대 전송`;
          else if (result.push.attempted > 0) transitionNotice = "조리 완료 처리됨 · 푸시 전송에 실패해 포장 주문은 전화 확인이 필요해요.";
          else transitionNotice = "조리 완료 처리됨 · 알림 미신청 고객은 주문 현황 화면으로 확인해요.";
        }
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
    showNotice(transitionNotice);
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

  const createManualOrder = async (draft: OwnerManualOrderDraft): Promise<boolean> => {
    if (!isOwner) return false;
    if (!demoMode) {
      try {
        await adminRequest("/api/admin/orders/manual", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
        await refreshSnapshot(true);
      } catch (error) { showNotice(adminErrorMessage(error, "직접 입력 주문을 저장하지 못했습니다.")); return false; }
    } else {
      setOrders((current) => [{ id: crypto.randomUUID(), orderNumber: `M${String(current.length + 1).padStart(3, "0")}`, fulfillmentType: draft.fulfillmentType, tableNumber: draft.tableNumber, customerName: null, customerPhone: null, items: [{ name: draft.label, quantity: 1 }], totalAmount: draft.amount, orderStatus: "SERVED", paymentStatus: "CONFIRMED", orderedAt: "방금 전" }, ...current]);
    }
    setFilter("HISTORY"); setChannel("ALL"); setSearch("");
    showNotice("판매 내역을 저장했습니다. 완료·취소 내역에서 확인하세요.");
    return true;
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
          body: JSON.stringify(id ? { name: draft.name, description: draft.description, price: draft.price, category: draft.category, status: draft.status, options: draft.options } : draft),
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

  const runBattleOperation = async (command: Record<string, unknown>, successMessage: string, demoUpdate?: () => void) => {
    if (battleInFlight.current) return;
    battleInFlight.current = true;
    setBattleLoading(true);
    try {
      if (demoMode) {
        demoUpdate?.();
      } else {
        setBattleState(await adminRequest<AdminTableBattleState>("/api/admin/table-battle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) }));
      }
      showNotice(successMessage);
    } catch (error) { showNotice(adminErrorMessage(error, "게임 운영 요청을 처리하지 못했습니다."));
    } finally {
      setBattleLoading(false);
      battleInFlight.current = false;
    }
  };

  const selectBattleWinner = async (participantId: string) => {
    const participant = battleState.participants.find((item) => item.id === participantId);
    const event = battleState.event;
    if (!event || !participant || !window.confirm(`TABLE ${participant.tableNumber} · ${participant.teamName}을(를) 1등으로 확정할까요? 게임은 즉시 종료됩니다.`)) return;
    await runBattleOperation({ action: "SELECT_WINNER", eventId: event.id, participantId }, `TABLE ${participant.tableNumber}을(를) 1등으로 확정했습니다.`, () => {
      setBattleState((current) => ({ ...current, event: current.event ? { ...current.event, status: "FINISHED", winnerTableId: participantId } : null, participants: current.participants.map((item) => ({ ...item, status: item.id === participantId ? "WINNER" : item.status === "APPROVED" ? "ELIMINATED" : item.status })) }));
    });
  };

  const pendingPayments = orders.filter((order) => isActiveOrder(order) && order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED").length;
  const cookingCount = orders.filter((order) => order.orderStatus === "COOKING" || order.orderStatus === "PAID").length;
  const readyCount = orders.filter((order) => order.orderStatus === "READY").length;
  const title: Record<View, string> = {
    orders: "실시간 주문 관리",
    inventory: "메뉴·재고 관리",
    tables: "테이블·QR 설정",
    sales: "매출 현황",
    settings: "매장 설정",
    battle: "TABLE BATTLE 운영",
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
          <button type="button" className={view === "battle" ? "active" : ""} onClick={() => setView("battle")}><Swords size={20} /> 게임 운영</button>
          <button type="button" className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><Settings size={20} /> 매장 설정</button>
        </nav>
        <div className="sidebar-bottom"><a className="customer-preview-link" href={`/s/${team.publicSlug}`} target="_blank" rel="noreferrer"><Store size={17} /> 고객 메뉴 열기 <ChevronRight size={16} /></a><div className="admin-profile"><span>{isOwner ? "주" : "운"}</span><div><strong>{isOwner ? "주인 계정" : "운영자 계정"}</strong><small>{isOwner ? "판매 입력·내역 관리 가능" : "주문·매장 운영"}</small></div></div></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><h1>{title[view]}</h1><p className={syncError || !online ? "sync-warning" : ""}><span className="live-dot" /> {demoMode ? "체험 모드 · 실제 주문은 저장되지 않습니다" : !online ? "인터넷 연결 끊김" : syncError ? "최신 정보 확인 실패 · 재연결 중" : syncing ? "최신 주문 확인 중" : `10초마다 갱신 · 마지막 확인 ${new Date(syncedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}</p></div>
          <div className="admin-tools">{view === "orders" && <div className="admin-search"><Search size={18} /><input aria-label="주문 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="주문번호, 메뉴 검색" /></div>}<button type="button" className="icon-button" aria-label="입금 확인 주문 보기" onClick={() => { setView("orders"); setFilter("PAYMENT"); showNotice(pendingPayments ? `입금 확인이 필요한 주문 ${pendingPayments}건입니다.` : "확인할 입금 알림이 없습니다."); }}><Bell size={20} />{pendingPayments > 0 && <i />}</button></div>
        </header>

        <div className="operations-bar"><span className={`store-status ${settings.isOpen && settings.configured ? "open" : ""}`}><i />{settings.isOpen && settings.configured ? "주문 접수 중" : "주문 접수 중지"}</span><span className="account-role">{isOwner ? "주인 계정" : "운영자 계정"}</span><button type="button" onClick={() => setView("settings")}>접수·계좌 설정 <ChevronRight size={15} /></button><a href={`/s/${team.publicSlug}`} target="_blank" rel="noreferrer">고객 화면 <ChevronRight size={15} /></a></div>
        {syncError && <div className="connection-warning" role="alert"><span>{syncError} 마지막으로 확인한 정보를 표시합니다.</span><button type="button" disabled={syncing || !online} onClick={() => void refreshSnapshot()}>다시 연결</button></div>}
        {view === "orders" ? <>
          {(!settings.configured || !settings.isOpen || !menu.some((item) => item.status === "AVAILABLE" && item.stockQuantity > 0) || !tables.some((table) => table.isActive)) && <details className="readiness-check" open={!settings.configured}><summary>영업 준비 확인 <span>계좌 → 메뉴 → QR → 주문 접수</span></summary><div>{([{ label: "입금 계좌", ready: settings.configured, view: "settings" }, { label: "판매할 메뉴·재고", ready: menu.some((item) => item.status === "AVAILABLE" && item.stockQuantity > 0), view: "inventory" }, { label: "테이블 QR (매장 이용 시)", ready: tables.some((table) => table.isActive), view: "tables" }, { label: "주문 접수 켜기", ready: settings.isOpen && settings.configured, view: "settings" }] as Array<{ label: string; ready: boolean; view: View }>).map((item) => <button key={item.label} type="button" onClick={() => setView(item.view)}><span>{item.ready ? <Check size={17} /> : <AlertTriangle size={17} />}{item.label}</span><strong>{item.ready ? "준비됨" : "설정하기"}</strong></button>)}</div></details>}
          <section className="stats-grid">
            <article><span className="stat-icon payment"><WalletCards size={22} /></span><div><small>입금 확인 필요</small><strong>{pendingPayments}<em>건</em></strong></div><button type="button" onClick={() => setFilter("PAYMENT")}>바로 보기 <ChevronRight size={15} /></button></article>
            <article><span className="stat-icon cooking"><CookingPot size={22} /></span><div><small>조리 대기·진행</small><strong>{cookingCount}<em>건</em></strong></div><button type="button" onClick={() => setFilter("COOKING")}>바로 보기 <ChevronRight size={15} /></button></article>
            <article><span className="stat-icon ready"><Check size={22} /></span><div><small>조리 완료</small><strong>{readyCount}<em>건</em></strong></div><button type="button" onClick={() => setFilter("READY")}>바로 보기 <ChevronRight size={15} /></button></article>
            <article><span className="stat-icon sales"><BarChart3 size={22} /></span><div><small>확정 매출</small><strong className="money">{formatWon(sales.totalRevenue)}</strong></div><button type="button" onClick={() => setView("sales")}>자세히 <ChevronRight size={15} /></button></article>
          </section>

          <p className="order-workflow">실제 입금 확인 <ChevronRight size={14} /> 조리 시작 <ChevronRight size={14} /> 조리 완료 <ChevronRight size={14} /> 제공·수령 완료</p>
          <div className="order-toolbar">
            <div className="admin-filters" role="tablist" aria-label="주문 필터">
              {([ ["ALL", "진행 중"], ["UNPAID", "입금 대기"], ["PAYMENT", "입금 확인"], ["COOKING", "조리"], ["READY", "전달 대기"], ["HISTORY", "완료·취소"] ] as Array<[Filter, string]>).map(([value, label]) => <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{label}<b>{filterOrders(orders, value, "ALL", "").length}</b></button>)}
            </div>
            <button className="refresh-button" type="button" disabled={syncing} onClick={() => void refreshSnapshot()}><RefreshCw size={16} /> 새로고침</button>
          </div>

          <div className="order-list-controls"><div className="channel-filter" aria-label="주문 유형">{([ ["ALL", "전체 유형"], ["DINE_IN", "테이블"], ["TAKEOUT", "포장"] ] as Array<[OrderChannel, string]>).map(([value, label]) => <button type="button" key={value} aria-pressed={channel === value} onClick={() => setChannel(value)}>{label}</button>)}</div><span>{visibleOrders.length}건 표시</span>{isOwner && <button className="manual-entry-toggle" type="button" aria-expanded={manualOpen} onClick={() => setManualOpen((value) => !value)}><Plus size={16} /> 현장 판매 입력</button>}</div>
          {filter === "HISTORY" && <p className="history-note">최근 완료·취소 내역입니다. 전체 기간의 매출은 ‘매출 현황’에서 확인하세요.</p>}
          {isOwner && manualOpen && <OwnerManualOrderEntry tables={tables} onCreate={createManualOrder} />}
          <section className="orders-grid" aria-label="주문 목록">
            {visibleOrders.length === 0 ? <div className="empty-state"><Check size={28} /><strong>{search ? "검색 결과가 없습니다" : filter === "HISTORY" ? "완료·취소된 주문이 없습니다" : "해당하는 진행 주문이 없습니다"}</strong><span>{search ? "주문번호·테이블·이름을 확인하거나 검색 조건을 바꿔 주세요." : "새 주문이 들어오면 자동으로 표시됩니다."}</span>{(search || channel !== "ALL") && <button type="button" onClick={() => { setSearch(""); setChannel("ALL"); }}>검색 조건 지우기</button>}</div> : visibleOrders.map((order) => <OrderCard order={order} busy={busyOrders.has(order.id) || !online} onAdvance={(id) => void runOrderAction(id, advance)} onCancel={(id) => void runOrderAction(id, cancel)} key={order.id} />)}
          </section>
        </> : view === "inventory" ? <InventoryView menu={menu} categories={categories} onAdjust={adjustStock} onSaveMenu={saveMenu} onAddCategory={addCategory} onRenameCategory={renameCategory} onDeleteCategory={deleteCategory} /> : view === "tables" ? <TablesView team={team} tables={tables} onConfigure={configureTables} onRotate={rotateTableQr} /> : view === "sales" ? <SalesView totalSales={sales} dailySales={dailySales} tableDailySales={tableDailySales} tables={tables} /> : view === "battle" ? <TableBattleOperations state={battleState} loading={battleLoading} onRefresh={() => void refreshBattle()} onSelectWinner={(participantId) => void selectBattleWinner(participantId)} onOperate={(command, successMessage, demoUpdate) => void runBattleOperation(command, successMessage, demoUpdate)} /> : <SettingsView settings={settings} onSave={saveSettings} onLogout={logout} />}
      </section>
      {!online && <div className="admin-offline" role="alert"><AlertTriangle size={17} /> 네트워크 연결이 끊겼습니다. 기존 화면은 유지되며 연결 후 다시 동기화됩니다.</div>}
      {notice && <div className="admin-toast"><Check size={17} /> {notice}</div>}
    </main>
  );
}

function TableBattleOperations({ state, loading, onRefresh, onSelectWinner, onOperate }: { state: AdminTableBattleState; loading: boolean; onRefresh: () => void; onSelectWinner: (participantId: string) => void; onOperate: (command: Record<string, unknown>, successMessage: string, demoUpdate?: () => void) => void }) {
  const event = state.event;
  const [prompt, setPrompt] = useState("");
  const [hint, setHint] = useState("");
  const [answers, setAnswers] = useState("");
  if (!event) return <section className="battle-admin-empty"><Swords size={30} /><h2>지금 바로 게임을 열 수 있어요</h2><p>참가 접수가 즉시 열리고, 1만원 이상 결제한 테이블만 관리자 승인 대상으로 표시됩니다.</p><button type="button" className="battle-admin-primary" disabled={loading} onClick={() => onOperate({ action: "CREATE_EVENT", title: "TABLE BATTLE" }, "TABLE BATTLE 참가 접수를 열었습니다.")}>참가 접수 열기</button></section>;
  const alive = state.participants.filter((participant) => participant.status === "APPROVED");
  const completed = event.status === "FINISHED";
  const canStartQuiz = !completed && ["REGISTRATION_OPEN", "REGISTRATION_LOCKED", "READY"].includes(event.status) && event.roundCount === 0 && alive.length >= 2;
  const canStartFloor = !completed && event.status === "READY" && event.lastRoundType === "WORD_QUIZ" && alive.length >= 2;
  const canStartBomb = !completed && event.status === "READY" && event.lastRoundType === "FLOOR_GAME" && alive.length >= 2;
  const startQuiz = () => {
    const registeredAnswers = answers.split(",").map((value) => value.trim()).filter(Boolean);
    if (!prompt.trim() || registeredAnswers.length === 0) return;
    onOperate({ action: "START_ROUND", eventId: event.id, roundType: "WORD_QUIZ", prompt, hint, answers: registeredAnswers }, "초성퀴즈를 바로 시작했습니다.", () => undefined);
  };
  return <section className="battle-admin-view">
    <header className="battle-admin-head"><div><span>LIVE GAME CONTROL</span><h2>{event.title}</h2><p>진행 상태 · <strong>{event.status.replaceAll("_", " ")}</strong> · 생존 {alive.length}팀</p></div><button className="refresh-button" type="button" disabled={loading} onClick={onRefresh}><RefreshCw size={16} /> 새로고침</button></header>
    <div className="battle-admin-rule"><Swords size={19} /><span><strong>안전한 종료 규칙 적용 중</strong><small>동시 선택·폭탄 만료·미선택 상황에서도 최종 1팀만 우승합니다. 게임 중 주문 접수는 계속됩니다.</small></span></div>
    <div className="battle-admin-actions">
      {event.status === "SCHEDULED" && <button type="button" className="battle-admin-primary" disabled={loading} onClick={() => onOperate({ action: "SET_REGISTRATION", eventId: event.id, status: "REGISTRATION_OPEN" }, "참가 접수를 열었습니다.", () => undefined)}>참가 접수 열기</button>}
      {event.status === "REGISTRATION_OPEN" && <button type="button" className="battle-admin-secondary" disabled={loading} onClick={() => onOperate({ action: "SET_REGISTRATION", eventId: event.id, status: "REGISTRATION_LOCKED" }, "새 참가 접수를 마감했습니다.", () => undefined)}>새 참가 접수 마감</button>}
      {event.status === "REGISTRATION_LOCKED" && <button type="button" className="battle-admin-secondary" disabled={loading} onClick={() => onOperate({ action: "SET_REGISTRATION", eventId: event.id, status: "READY" }, "승인된 테이블을 게임 대기방으로 보냈습니다.", () => undefined)}>승인팀 대기방 열기</button>}
      {canStartQuiz && <div className="battle-admin-quiz"><strong>ROUND 1 · 초성퀴즈</strong><input value={prompt} disabled={loading} onChange={(input) => setPrompt(input.target.value)} maxLength={80} placeholder="문제 초성 예: ㅂ ㄱ ㅌ" /><input value={hint} disabled={loading} onChange={(input) => setHint(input.target.value)} maxLength={120} placeholder="힌트 (선택)" /><input value={answers} disabled={loading} onChange={(input) => setAnswers(input.target.value)} maxLength={300} placeholder="정답, 복수 정답은 쉼표로 구분" /><button type="button" className="battle-admin-primary" disabled={loading || !prompt.trim() || !answers.trim()} onClick={startQuiz}>초성퀴즈 바로 시작</button></div>}
      {canStartFloor && <button type="button" className="battle-admin-primary" disabled={loading} onClick={() => onOperate({ action: "START_ROUND", eventId: event.id, roundType: "FLOOR_GAME" }, "행운의 지뢰밭을 시작했습니다.", () => undefined)}>ROUND 2 · 지뢰밭 바로 시작</button>}
      {canStartBomb && <button type="button" className="battle-admin-primary" disabled={loading} onClick={() => onOperate({ action: "START_ROUND", eventId: event.id, roundType: "BOMB_GAME" }, "폭탄 돌리기를 시작했습니다.", () => undefined)}>FINAL · 폭탄 돌리기 시작</button>}
    </div>
    <div className="battle-admin-list">{state.participants.map((participant) => {
      const eligible = participant.eligibleAmount >= event.minimumOrderAmount;
      return <article key={participant.id} className={participant.status.toLowerCase()}><div><span>TABLE {participant.tableNumber}</span><strong>{participant.teamName}</strong><small>결제 완료 {formatWon(participant.eligibleAmount)} / 참가 기준 {formatWon(event.minimumOrderAmount)} · 초성퀴즈 {participant.wordScore}점</small></div>{participant.status === "PENDING" ? <div className="battle-admin-review"><button type="button" disabled={loading || !eligible} title={eligible ? "" : "1만원 이상 결제 완료 주문이 필요합니다."} onClick={() => onOperate({ action: "REVIEW", eventId: event.id, participantId: participant.id, decision: "APPROVE" }, `TABLE ${participant.tableNumber} 참가를 승인했습니다.`, () => undefined)}><Check size={16} /> 승인</button><button type="button" className="reject" disabled={loading} onClick={() => onOperate({ action: "REVIEW", eventId: event.id, participantId: participant.id, decision: "REJECT" }, `TABLE ${participant.tableNumber} 참가를 거절했습니다.`, () => undefined)}><X size={16} /> 거절</button></div> : participant.status === "WINNER" ? <b><Crown size={16} /> 1등 확정</b> : !completed && ["APPROVED", "ELIMINATED"].includes(participant.status) && <button type="button" disabled={loading} onClick={() => onSelectWinner(participant.id)}><Crown size={16} /> 1등으로 확정</button>}</article>;
    })}</div>
    {event.rewardName && <p className="battle-admin-reward">우승 상품 · {event.rewardName}</p>}
  </section>;
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

function OwnerManualOrderEntry({ tables, onCreate }: { tables: FestivalTable[]; onCreate: (draft: OwnerManualOrderDraft) => Promise<boolean> }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<"DINE_IN" | "TAKEOUT">("TAKEOUT");
  const [tableNumber, setTableNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const submissionLock = useRef(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const activeTables = tables.filter((table) => table.isActive);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submissionLock.current) return;
    const parsedAmount = Number(amount);
    const parsedTable = fulfillmentType === "DINE_IN" ? Number(tableNumber) : null;
    if (!label.trim() || !Number.isInteger(parsedAmount) || parsedAmount < 100 || parsedAmount > 10000000 || (fulfillmentType === "DINE_IN" && !parsedTable)) { setResultMessage("내역, 100~10,000,000원 사이의 금액, 테이블을 확인해 주세요."); return; }
    const fingerprint = JSON.stringify([label.trim(), parsedAmount, fulfillmentType, parsedTable]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    submissionLock.current = true;
    setSaving(true);
    setResultMessage(null);
    try {
      const saved = await onCreate({ label: label.trim(), amount: parsedAmount, fulfillmentType, tableNumber: parsedTable, clientRequestId: request.current.id });
      if (saved) { setLabel(""); setAmount(""); setTableNumber(""); request.current = null; setResultMessage("판매 내역을 저장했습니다. 아래 완료 내역을 확인하세요."); }
      else setResultMessage("저장 여부를 확인하지 못했습니다. 같은 내용으로 다시 누르면 중복 저장되지 않습니다.");
    } finally { setSaving(false); submissionLock.current = false; }
  };
  return <form className="owner-manual-order" onSubmit={submit}>
    <div><span>주인 전용</span><strong>현장 판매 직접 입력</strong><small>이미 받은 금액을 매출·제공 완료로 기록합니다. 조리 주문을 만들거나 메뉴 재고를 차감하지 않습니다.</small></div>
    <label>판매 내역<input disabled={saving} required maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="예: 현장 세트 판매" /></label>
    <label>받은 금액 (원)<input disabled={saving} required maxLength={8} value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="예: 15000" /></label>
    <label>주문 유형<select disabled={saving} value={fulfillmentType} onChange={(event) => { setFulfillmentType(event.target.value as "DINE_IN" | "TAKEOUT"); setTableNumber(""); }}><option value="TAKEOUT">포장</option><option value="DINE_IN">테이블</option></select></label>
    {fulfillmentType === "DINE_IN" && <select required value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} aria-label="테이블 번호"><option value="">테이블 선택</option>{activeTables.map((table) => <option key={table.id} value={table.tableNumber}>테이블 {table.tableNumber}</option>)}</select>}
    <button type="submit" disabled={saving || !label.trim() || !amount}>{saving ? "저장 중…" : `${amount ? formatWon(Number(amount)) : "판매"} 기록하기`}</button>
    {resultMessage && <p className="manual-result" role="status">{resultMessage}</p>}
  </form>;
}

function OrderCard({ order, busy, onAdvance, onCancel }: { order: DemoOrder; busy: boolean; onAdvance: (id: string) => void; onCancel: (id: string) => void }) {
  const active = isActiveOrder(order);
  const isPayment = active && order.paymentStatus === "CUSTOMER_MARKED_TRANSFERRED";
  const waitingForTransfer = order.orderStatus === "PENDING_PAYMENT" && !isPayment;
  const actionLabel = waitingForTransfer ? "입금 대기" : isPayment ? "입금 확인" : order.orderStatus === "PAID" ? "조리 시작" : order.orderStatus === "COOKING" ? "조리 완료" : order.fulfillmentType === "DINE_IN" ? "제공 완료" : "수령 완료";
  const actionIcon = isPayment ? <WalletCards size={17} /> : order.orderStatus === "READY" ? <Check size={17} /> : <ChefHat size={17} />;
  const statusLabel = isPayment ? "입금 확인 중" : STATUS_LABEL[order.orderStatus];
  return <article className={`order-card status-${order.orderStatus.toLowerCase()}`}>
    <div className="order-card-head"><div><span className="order-number">#{order.orderNumber}</span><span className={`order-status status-${order.orderStatus.toLowerCase()}`}>{statusLabel}</span></div><span className="order-time"><Clock3 size={15} /> {order.orderedAt}</span></div>
    <div className={`order-destination ${order.fulfillmentType === "TAKEOUT" ? "takeout" : ""}`}>{order.fulfillmentType === "DINE_IN" ? <><UtensilsCrossed size={19} /><strong>테이블 {order.tableNumber}</strong><span>매장 이용</span></> : <><ShoppingBag size={19} /><div className="takeout-contact-copy"><strong>{order.customerName ?? "포장 주문"}</strong><span>{order.customerPhone ? formatCustomerPhone(order.customerPhone) : "주문번호로 호출"}</span></div>{order.customerPhone && <a className="takeout-call" href={`tel:${order.customerPhone}`} aria-label={`${order.customerName ?? order.orderNumber} 고객에게 전화`}><Phone size={13} /> 전화</a>}</>}</div>
    <div className="order-items">{order.items.map((item, index) => <div key={`${item.name}-${index}`}><span>{item.name}{item.selectedOptions && item.selectedOptions.length > 0 && <small>{item.selectedOptions.map((option) => `+ ${option.name}`).join(" · ")}</small>}</span><strong>× {item.quantity}</strong></div>)}</div>
    <div className="order-total"><span>총 결제금액</span><strong>{formatWon(order.totalAmount)}</strong></div>
    {isPayment && <p className="payment-check-hint">입금자명 {order.orderNumber} · 실제 입금액을 확인해 주세요.</p>}
    <div className="order-actions">{active ? <><button className="cancel-order" type="button" disabled={busy} onClick={() => onCancel(order.id)} aria-label={`${order.orderNumber} 주문 취소`}>취소</button><button className="primary-order-action" type="button" disabled={busy || waitingForTransfer} onClick={() => onAdvance(order.id)}>{actionIcon}{busy ? "처리 중…" : actionLabel}</button></> : <span className="order-final-label">{order.orderStatus === "CANCELLED" ? "취소된 주문" : "제공·수령 완료"}</span>}</div>
  </article>;
}

function formatCustomerPhone(phone: string): string {
  if (phone.length === 11) return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
  return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
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
      <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>메뉴</th><th>판매 가능</th><th>주문 대기</th><th>판매 완료</th><th>상태</th><th>조정·관리</th></tr></thead><tbody>{activeMenu.map((item) => <tr key={item.id}><td><span className="table-emoji">{item.emoji}</span><div><strong>{item.name}</strong><small>{item.category} · {formatWon(item.price)}{item.options.length > 0 ? ` · 옵션 ${item.options.length}개` : ""}</small></div></td><td><strong className={item.stockQuantity <= 5 ? "low-number" : ""}>{item.stockQuantity}</strong>개</td><td>{item.reservedQuantity}개</td><td>{item.soldQuantity}개</td><td><span className={`inventory-status ${item.status.toLowerCase()}`}>{MENU_STATUS_LABEL[item.status]}</span></td><td><div className="stock-actions"><button type="button" onClick={() => onAdjust(item.id, -1)} disabled={item.stockQuantity === 0} aria-label={`${item.name} 재고 1 감소`}><Minus size={15} /></button><button type="button" onClick={() => onAdjust(item.id, 10)} aria-label={`${item.name} 재고 10 추가`}><Plus size={15} /> 10</button><button type="button" onClick={() => setEditor(item)} aria-label={`${item.name} 수정`}><Pencil size={14} /> 수정</button><button type="button" onClick={() => onSaveMenu(item.id, { ...item, status: item.status === "SOLD_OUT" ? "AVAILABLE" : "SOLD_OUT" })} aria-label={`${item.name} 품절 상태 전환`}><EyeOff size={14} /></button></div></td></tr>)}</tbody></table></div>
    </section>
    <div className="inventory-footnote"><Clock3 size={16} /> 메뉴 보관은 수정 창에서 선택할 수 있고 주문 내역은 삭제되지 않습니다.</div>
    {editor && <MenuEditor item={editor === "NEW" ? null : editor} categories={categories} onClose={() => setEditor(null)} onSave={async (draft) => { if (await onSaveMenu(editor === "NEW" ? null : editor.id, draft)) setEditor(null); }} />}
  </>;
}

function MenuEditor({ item, categories, onClose, onSave }: { item: MenuItem | null; categories: string[]; onClose: () => void; onSave: (draft: MenuDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<MenuDraft>(item ? { name: item.name, description: item.description, price: item.price, category: item.category, status: item.status, stockQuantity: item.stockQuantity, options: item.options } : { name: "", description: "", price: 0, category: categories[0] ?? "", status: "AVAILABLE", stockQuantity: 0, options: [] });
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  useDialog(dialogRef, true, () => { if (!saving) onClose(); });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  };
  return <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onClose(); }}><form ref={dialogRef} tabIndex={-1} className="admin-modal" role="dialog" aria-modal="true" aria-label={item ? "메뉴 수정" : "새 메뉴 추가"} onSubmit={submit}>
    <div className="admin-modal-head"><div><small>{item ? "MENU EDIT" : "NEW MENU"}</small><h2>{item ? item.name : "새 메뉴 추가"}</h2></div><button type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button></div>
    <label>메뉴 이름<input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label>설명<textarea maxLength={500} rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
    <div className="admin-form-row"><label>가격<input required type="number" min="0" step="100" value={draft.price} onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })} /></label><label>카테고리<select required value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label></div>
    <div className="admin-form-row"><label>판매 상태<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as MenuStatus })}><option value="AVAILABLE">판매 중</option><option value="SOLD_OUT">품절</option><option value="HIDDEN">숨김</option>{item && <option value="ARCHIVED">보관</option>}</select></label><label>초기 재고<input type="number" min="0" max="100000" disabled={Boolean(item)} value={draft.stockQuantity} onChange={(event) => setDraft({ ...draft, stockQuantity: Number(event.target.value) })} /><small>{item ? "기존 재고는 표의 빠른 조정으로 변경하세요." : "등록 시 확보된 수량"}</small></label></div>
    <MenuOptionEditor options={draft.options} onChange={(options) => setDraft({ ...draft, options })} />
    <div className="admin-modal-actions"><button type="button" onClick={onClose}>취소</button><button type="submit" disabled={saving || categories.length === 0}>{item?.status === "ARCHIVED" ? <Archive size={16} /> : <Check size={16} />}{saving ? "저장 중…" : "저장"}</button></div>
  </form></div>;
}

function MenuOptionEditor({ options, onChange }: { options: MenuOption[]; onChange: (options: MenuOption[]) => void }) {
  const addOption = () => {
    if (options.length >= 12) return;
    onChange([...options, { id: crypto.randomUUID(), name: "", priceDelta: 0 }]);
  };
  const updateOption = (id: string, update: Partial<MenuOption>) => onChange(options.map((option) => option.id === id ? { ...option, ...update } : option));
  return <fieldset className="menu-option-editor">
    <legend><span><strong>추가 옵션</strong><small>손님이 원하는 항목을 여러 개 선택할 수 있어요.</small></span><button type="button" onClick={addOption} disabled={options.length >= 12}><Plus size={14} /> 옵션 추가</button></legend>
    {options.length === 0 ? <p>토핑, 사이즈업처럼 추가 금액이 있는 항목을 등록해 보세요.</p> : <div className="menu-option-list">{options.map((option, index) => <div className="menu-option-row" key={option.id}>
      <label>옵션 이름<input required maxLength={40} placeholder="예: 초코 토핑" value={option.name} onChange={(event) => updateOption(option.id, { name: event.target.value })} /></label>
      <label>추가 금액<input required type="number" min="0" max="1000000" step="100" value={option.priceDelta} onChange={(event) => updateOption(option.id, { priceDelta: Number(event.target.value) })} /></label>
      <button type="button" aria-label={`${index + 1}번째 옵션 삭제`} onClick={() => onChange(options.filter((candidate) => candidate.id !== option.id))}><X size={16} /></button>
    </div>)}</div>}
  </fieldset>;
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
