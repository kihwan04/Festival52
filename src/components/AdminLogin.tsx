"use client";

import { useState } from "react";
import { ArrowLeft, LockKeyhole } from "lucide-react";

export function AdminLogin() {
  const [setupMode, setSetupMode] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoading(true); setError(null);
    const response = await fetch(setupMode ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, displayName }),
    });
    const result: unknown = await response.json();
    if (response.ok && typeof result === "object" && result !== null && "confirmationRequired" in result && result.confirmationRequired === true) {
      setError("확인 이메일을 보냈습니다. 이메일 확인 후 이 화면에서 로그인해 주세요.");
      setSetupMode(false); setLoading(false); return;
    }
    if (response.ok) window.location.reload();
    else { setError(typeof result === "object" && result !== null && "message" in result ? String(result.message) : "로그인하지 못했습니다."); setLoading(false); }
  };

  return <main className="admin-login-shell"><section className="admin-login-card">
    <a className="login-back" href="/"><ArrowLeft size={17} /> 고객 화면</a>
    <div className="login-lock"><LockKeyhole size={27} /></div><p className="login-kicker">{setupMode ? "FIRST ADMIN" : "STAFF ONLY"}</p><h1>{setupMode ? "첫 관리자 만들기" : "운영자 로그인"}</h1><p className="login-copy">{setupMode ? "첫 연결에서 한 번만 사용할 수 있습니다. 이후에는 등록된 운영자만 로그인할 수 있어요." : "주문·입금·재고 정보는 등록된 운영자만 확인할 수 있어요."}</p>
    <form onSubmit={submit}>{setupMode && <label>표시 이름<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="축제 관리자" autoComplete="name" /></label>}<label>이메일<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" autoComplete="username" /></label><label>비밀번호<input required type="password" minLength={setupMode ? 14 : 8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={setupMode ? "14자 이상 · 대소문자·숫자·특수문자" : "비밀번호 입력"} autoComplete={setupMode ? "new-password" : "current-password"} /></label>{error && <p className="login-error">{error}</p>}<button type="submit" disabled={loading}>{loading ? "확인 중…" : setupMode ? "관리자 계정 만들기" : "안전하게 로그인"}</button></form>
    <button className="login-mode-toggle" type="button" onClick={() => { setSetupMode((current) => !current); setError(null); }}>{setupMode ? "이미 계정이 있어요 · 로그인" : "처음 연결인가요? · 관리자 만들기"}</button>
    <small>관리자 계정은 Supabase Auth와 서버 권한으로 확인됩니다.</small>
  </section></main>;
}
