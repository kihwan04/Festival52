"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicOrder } from "@/src/features/orders/domain/order";

export function usePublicOrderStatus(publicToken: string | null) {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!publicToken) return null;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(publicToken)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("order status unavailable");
      const next = await response.json() as PublicOrder;
      setOrder(next);
      setConnected(true);
      setLastUpdatedAt(new Date());
      return next;
    } catch {
      setConnected(false);
      return null;
    }
  }, [publicToken]);

  useEffect(() => {
    if (!publicToken) return;
    const sync = () => void refresh();
    const initialTimer = window.setTimeout(sync, 0);
    const timer = window.setInterval(sync, 2000);
    const onVisibility = () => { if (document.visibilityState === "visible") sync(); };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [publicToken, refresh]);

  return { order, connected, lastUpdatedAt, refresh };
}
