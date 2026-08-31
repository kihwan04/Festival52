"use client";

import { useEffect, useState } from "react";
import { BellRing, Check, ExternalLink, Smartphone } from "lucide-react";
import { isPushSupported, serializeSubscription, subscribe } from "@mmmike/web-push/client";
import type { OrderStatus } from "@/src/features/orders/domain/order";

type PushState = "checking" | "ready" | "working" | "enabled" | "denied" | "unsupported" | "ios-install" | "error";

export function PushNotificationOptIn({
  publicToken,
  orderStatus,
  trackingHref,
}: {
  publicToken: string;
  orderStatus: OrderStatus;
  trackingHref?: string;
}) {
  const [state, setState] = useState<PushState>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const activeOrder = ["PENDING_PAYMENT", "PAID", "COOKING"].includes(orderStatus);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      await Promise.resolve();
      const ios = /iPad|iPhone|iPod/i.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (ios && !standalone) {
        if (!cancelled) setState("ios-install");
        return;
      }
      if (!window.isSecureContext || !isPushSupported()) {
        if (!cancelled) setState("unsupported");
        return;
      }
      try {
        const [, key] = await Promise.all([
          navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }),
          fetch("/api/push/public-key", { cache: "no-store" }).then(async (response) => {
            const payload = await response.json().catch(() => null) as { publicKey?: unknown; message?: unknown } | null;
            if (!response.ok || typeof payload?.publicKey !== "string") {
              throw new Error(typeof payload?.message === "string" ? payload.message : "알림 서비스를 준비하고 있습니다.");
            }
            return payload.publicKey;
          }),
        ]);
        if (cancelled) return;
        setPublicKey(key);
        setState(Notification.permission === "denied" ? "denied" : "ready");
      } catch {
        if (!cancelled) setState("error");
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, [setupAttempt]);

  const enablePush = async () => {
    if (!publicKey || state === "working") return;
    setState("working");
    setErrorMessage(null);
    try {
      const result = await subscribe(publicKey);
      if (result.status === "denied") {
        setState("denied");
        return;
      }
      if (result.status === "unsupported") {
        setState("unsupported");
        return;
      }
      const response = await fetch(`/api/orders/${encodeURIComponent(publicToken)}/push-subscription`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(serializeSubscription(result.subscription)),
      });
      const payload = await response.json().catch(() => null) as { message?: unknown } | null;
      if (!response.ok) {
        if (result.isNew) await result.subscription.unsubscribe().catch(() => false);
        throw new Error(typeof payload?.message === "string" ? payload.message : "알림을 등록하지 못했습니다.");
      }
      setState("enabled");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "알림을 등록하지 못했습니다.");
      setState("error");
    }
  };

  const handleButton = () => {
    if (!publicKey) {
      setErrorMessage(null);
      setState("checking");
      setSetupAttempt((current) => current + 1);
      return;
    }
    void enablePush();
  };

  if (!activeOrder && state !== "enabled") return null;

  if (state === "ios-install") {
    return <section className="push-opt-in ios-guide" aria-label="아이폰 주문 알림 설정 안내">
      <span className="push-icon"><Smartphone size={22} /></span>
      <div><strong>아이폰에서도 준비 완료 알림을 받을 수 있어요</strong><p>주문 현황 페이지를 연 뒤 Safari의 <b>공유 → 홈 화면에 추가</b>를 누르고, 생긴 아이콘으로 다시 열어 알림을 허용해 주세요.</p></div>
      {trackingHref && <a href={trackingHref}>주문 현황에서 설정 <ExternalLink size={14} /></a>}
    </section>;
  }

  return <section className={`push-opt-in ${state === "enabled" ? "enabled" : ""}`} aria-label="주문 준비 완료 푸시 알림">
    <span className="push-icon">{state === "enabled" ? <Check size={22} /> : <BellRing size={22} />}</span>
    <div>
      <strong>{state === "enabled" ? "준비 완료 알림이 켜졌어요" : "음식이 준비되면 바로 알려드릴게요"}</strong>
      <p>{pushStateMessage(state, errorMessage)}</p>
    </div>
    {(state === "ready" || state === "error") && <button type="button" onClick={handleButton}>{publicKey ? "알림 받기" : "다시 시도"}</button>}
  </section>;
}

function pushStateMessage(state: PushState, errorMessage: string | null): string {
  if (state === "checking") return "이 기기에서 알림을 사용할 수 있는지 확인하고 있어요.";
  if (state === "working") return "브라우저 알림 권한과 주문을 연결하고 있어요…";
  if (state === "enabled") return "화면을 닫아도 조리 완료 시 한 번만 알려드려요.";
  if (state === "denied") return "브라우저 설정에서 이 사이트의 알림을 허용한 뒤 다시 열어주세요.";
  if (state === "unsupported") return "이 브라우저에서는 푸시 알림을 지원하지 않아요. 주문 현황 화면을 확인해 주세요.";
  if (state === "error") return errorMessage ?? "알림 서비스를 불러오지 못했어요. 잠시 후 다시 눌러주세요.";
  return "버튼을 누른 뒤 브라우저 알림을 허용해 주세요.";
}
