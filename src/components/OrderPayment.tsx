"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { formatWon } from "@/src/features/menu/domain/menu";
import type { PublicOrder } from "@/src/features/orders/domain/order";

export function OrderPayment({ order, publicToken, onRefresh }: { order: PublicOrder; publicToken: string; onRefresh: () => Promise<unknown> }) {
  const [claimed, setClaimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const payment = order.payment_details;
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setNotice(`${label}를 복사했어요.`); }
    catch { setNotice("복사할 내용을 길게 눌러 직접 복사해 주세요."); }
  };
  const claim = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/orders/transfer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicToken }), signal: AbortSignal.timeout(15000) });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? "입금 확인 요청을 보내지 못했습니다.");
      setClaimed(true); await onRefresh();
    } catch (cause) { setError(cause instanceof Error && cause.name === "Error" ? cause.message : "연결을 확인하고 다시 눌러 주세요. 같은 요청은 중복 처리되지 않습니다."); }
    finally { lock.current = false; setBusy(false); }
  };
  if (order.order_status !== "PENDING_PAYMENT") return null;
  const requested = claimed || order.payment_status !== "UNPAID";
  return <>
    <section className="transfer-card">
      <div className="transfer-head"><span>보내실 금액</span><strong>{formatWon(order.total_amount)}</strong></div>
      {payment?.account_number ? <><div className="bank-account"><span>{payment.bank_name}</span><strong>{payment.account_number}</strong><small>예금주 · {payment.account_holder}</small></div><div className="payment-copy-actions"><button type="button" onClick={() => void copy(payment.account_number, "계좌번호")}><Copy size={16} /> 계좌번호 복사</button><button type="button" onClick={() => void copy(order.order_number, "입금자명")}><Copy size={16} /> 입금자명 복사</button></div></> : <p>계좌 정보를 불러오지 못했습니다. 운영 부스에 주문번호를 보여주고 계좌를 확인해 주세요.</p>}
      {notice && <div className="copy-notice" role="status">{notice}</div>}
      <p>입금자명 <strong>{order.order_number}</strong>로 계좌이체 후 ‘입금했어요’를 눌러 주세요.</p>
      {!requested && <p className="payment-deadline">{order.expires_at ? `${new Date(order.expires_at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })}까지 입금 표시해 주세요.` : "주문 후 10분 안에 입금 표시해 주세요."} 기한이 지나면 주문이 자동 취소됩니다.</p>}
    </section>
    <div className="sticky-order-action"><button className="checkout-button" type="button" disabled={requested || busy} onClick={() => void claim()}>{requested ? <><Check size={20} /> 입금 확인을 요청했어요</> : busy ? "확인 요청 보내는 중…" : "입금했어요"}</button>{error ? <small className="transfer-action-error" role="alert">{error}</small> : <small>실제 계좌이체 후 눌러 주세요. 운영자가 입금을 확인합니다.</small>}</div>
  </>;
}
