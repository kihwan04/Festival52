"use client";

import { useState } from "react";
import { ArrowLeft, Building2, LockKeyhole } from "lucide-react";

type AuthMode = "login" | "signup";

export function AdminLogin({ allowSignup = false }: { allowSignup?: boolean }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [departmentName, setDepartmentName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const switchMode = (next: AuthMode) => {
    if (next === "signup" && !allowSignup) return;
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
    setPasswordConfirm("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signup" && password !== passwordConfirm) throw new Error("비밀번호가 서로 다릅니다.");
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "login"
          ? { email, password }
          : { departmentName, teamName, displayName, email, password, passwordConfirm }),
      });
      const result = await response.json().catch(() => null) as { message?: string; confirmationRequired?: boolean } | null;
      if (!response.ok) throw new Error(result?.message ?? (mode === "login" ? "로그인하지 못했습니다." : "가입하지 못했습니다."));
      if (mode === "signup" && result?.confirmationRequired) {
        setNotice("확인 메일을 보냈습니다. 이메일 인증을 마친 뒤 로그인해 주세요.");
        setMode("login");
        setPassword("");
        setPasswordConfirm("");
        return;
      }
      window.location.reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "요청을 처리하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const signup = mode === "signup";
  return <main className="admin-login-shell"><section className={`admin-login-card ${signup ? "signup" : ""}`}>
    <a className="login-back" href="/"><ArrowLeft size={17} /> 처음 화면</a>
    <div className="login-lock">{signup ? <Building2 size={27} /> : <LockKeyhole size={27} />}</div>
    <p className="login-kicker">{signup ? "NEW OPERATIONS TEAM" : "STAFF ONLY"}</p>
    <h1>{signup ? "운영팀 회원가입" : "운영자 로그인"}</h1>
    <p className="login-copy">{signup
      ? "학과별로 독립된 메뉴·QR·주문·매출 공간을 만들어 드려요."
      : "자신의 운영팀 주문·입금·재고 정보만 안전하게 확인할 수 있어요."}</p>
    {allowSignup && <div className="login-tabs" role="tablist" aria-label="계정 메뉴">
      <button type="button" role="tab" aria-selected={!signup} className={!signup ? "active" : ""} onClick={() => switchMode("login")}>로그인</button>
      <button type="button" role="tab" aria-selected={signup} className={signup ? "active" : ""} onClick={() => switchMode("signup")}>회원가입</button>
    </div>}
    <form onSubmit={submit}>
      {signup && <div className="signup-fields">
        <label>학과명<input required minLength={2} maxLength={80} value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} placeholder="예: 컴퓨터공학과" autoComplete="organization" /></label>
        <label>운영팀명<input required minLength={2} maxLength={80} value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="예: 2026 대동제 운영팀" /></label>
        <label>담당자명<input required minLength={2} maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="예: 홍길동" autoComplete="name" /></label>
      </div>}
      <label>이메일<input required type="email" maxLength={240} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operator@example.com" autoComplete="username" /></label>
      <label>비밀번호<input required type="password" minLength={signup ? 14 : 8} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={signup ? "14자 이상 안전한 비밀번호" : "비밀번호 입력"} autoComplete={signup ? "new-password" : "current-password"} /></label>
      {signup && <>
        <label>비밀번호 확인<input required type="password" minLength={14} maxLength={200} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} placeholder="비밀번호 다시 입력" autoComplete="new-password" /></label>
        <p className="password-guide">영문 대·소문자, 숫자, 특수문자를 포함한 14자 이상으로 입력해 주세요.</p>
      </>}
      {notice && <p className="login-notice" role="status">{notice}</p>}
      {error && <p className="login-error" role="alert">{error}</p>}
      <button type="submit" disabled={loading}>{loading ? "확인 중…" : signup ? "내 운영팀 만들기" : "안전하게 로그인"}</button>
    </form>
    <small>{signup ? "가입한 팀의 데이터는 다른 운영팀과 데이터베이스에서 분리됩니다." : "신규 가입은 잠겨 있습니다. 등록된 운영자 계정으로 로그인해 주세요."}</small>
  </section></main>;
}
