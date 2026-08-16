import { ArrowRight, BarChart3, LogIn, QrCode, ShieldCheck } from "lucide-react";
import { loadPublicStoreSettings } from "@/src/features/settings/infrastructure/public-store-settings";

export const dynamic = "force-dynamic";

export default async function Home() {
  const settings = await loadPublicStoreSettings();
  const acceptingOrders = settings.isOpen && settings.configured;
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="주요 메뉴">
        <a className="brand" href="/">
          <span className="brand-mark">52</span>
          <span><strong>컴공</strong><small>COMPUTER ENGINEERING</small></span>
        </a>
        <a className="nav-admin" href="/admin">운영자 로그인 <ArrowRight size={16} /></a>
      </nav>

      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> {acceptingOrders ? "주문 시스템 운영 중" : "운영 준비 상태"}</div>
          <h1>주문은 QR로,<br /><em>운영은 한곳</em>에서.</h1>
          <p>로그인 후 테이블·포장 QR을 발급하고<br />주문, 입금 확인, 조리와 매출까지 관리하세요.</p>
          <div className="hero-actions operator-only-action">
            <a className="primary-link" href="/admin">
              <LogIn size={20} /> 운영자 로그인 <ArrowRight size={18} />
            </a>
          </div>
          <div className="trust-row">
            <span><ShieldCheck size={17} /> 관리자 전용</span>
            <span><QrCode size={17} /> QR 발급·관리</span>
            <span><BarChart3 size={17} /> 실시간 매출</span>
          </div>
        </div>

        <div className="hero-ticket" aria-label="운영 과정 안내">
          <div className="ticket-top"><span>COMGONG 52</span><span>OPERATION GUIDE</span></div>
          <div className="ticket-number">ADMIN 52</div>
          <div className="ticket-route">
            <div><span>01</span><strong>QR 발급</strong><small>테이블·포장 주문 준비</small></div><i />
            <div><span>02</span><strong>주문 운영</strong><small>입금 확인과 조리 관리</small></div><i />
            <div><span>03</span><strong>매출 확인</strong><small>날짜별 확정 매출 조회</small></div>
          </div>
          <div className="ticket-cut" />
          <div className="ticket-bottom"><div><small>현재 상태</small><strong>{acceptingOrders ? "실시간 주문 접수 중" : "운영 준비 중"}</strong></div><span>{acceptingOrders ? "OPEN" : "READY"}</span></div>
        </div>
      </section>

      <footer className="landing-footer"><span>{settings.stallName} · 오늘도 맛있는 밤</span><span>운영시간 {settings.operatingHours}</span></footer>
    </main>
  );
}
