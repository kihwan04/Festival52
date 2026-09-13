"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicOrder } from "@/src/features/orders/domain/order";

export function usePublicOrderStatus(publicToken: string | null) {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!publicToken || refreshInFlight.current) return null;
    refreshInFlight.current = true;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(publicToken)}`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(response.status === 404 ? "주문을 찾을 수 없습니다. 운영 부스에 주문번호를 알려주세요." : "최신 상태를 확인하지 못했습니다. 마지막 확인 정보를 표시합니다.");
      const next = await response.json() as PublicOrder;
      setOrder(next);
      setConnected(true);
      setLastUpdatedAt(new Date());
      setError(null);
      return next;
    } catch (cause) {
      setConnected(false);
      setError(!navigator.onLine ? "인터넷 연결이 끊겼습니다. 연결되면 자동으로 다시 확인합니다." : cause instanceof Error && cause.name === "Error" ? cause.message : "연결이 지연되고 있습니다. 잠시 후 다시 확인해 주세요.");
      return null;
    } finally {
      refreshInFlight.current = false;
    }
  }, [publicToken]);

  useEffect(() => {
    if (!publicToken) return;
    const sync = () => { if (document.visibilityState === "visible") void refresh(); };
    const initialTimer = window.setTimeout(sync, 0);
    const timer = window.setInterval(sync, 4000);
    const onVisibility = () => { if (document.visibilityState === "visible") sync(); };
    window.addEventListener("focus", sync);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [publicToken, refresh]);

  return { order, connected, lastUpdatedAt, error, refresh };
}
