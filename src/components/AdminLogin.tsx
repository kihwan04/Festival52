"use client";

import { useState } from "react";
import { ArrowLeft, LockKeyhole } from "lucide-react";

export function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoading(true); setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const result: unknown = await response.json();
    if (response.ok) window.location.reload();
    else { setError(typeof result === "object" && result !== null && "message" in result ? String(result.message) : "로그인하지 못했습니다."); setLoading(false); }
  };

  return <main className="admin-login-shell"><section className="admin-login-card">
    <a className="login-back" href="/"><ArrowLeft size={17} /> 고객 화면</a>
    <div className="login-lock"><LockKeyhole size={27} /></div><p className="login-kicker">STAFF ONLY</p><h1>운영자 로그인</h1><p className="login-copy">주문·입금·재고 정보는 등록된 운영자만 확인할 수 있어요.</p>
    <form onSubmit={submit}><label>이메일<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" autoComplete="username" /></label><label>비밀번호<input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호 입력" autoComplete="current-password" /></label>{error && <p className="login-error">{error}</p>}<button type="submit" disabled={loading}>{loading ? "확인 중…" : "안전하게 로그인"}</button></form>
    <small>관리자 계정은 Supabase Auth와 서버 권한으로 확인됩니다.</small>
  </section></main>;
}
