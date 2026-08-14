import Link from "next/link";
import { ArrowRight, ChefHat, QrCode, ShieldCheck, UtensilsCrossed } from "lucide-react";
import { isDemoMode } from "@/src/lib/supabase/server";

export default function Home() {
  const demoMode = isDemoMode();
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="주요 메뉴">
        <Link className="brand" href="/">
          <span className="brand-mark">52</span>
          <span><strong>컴공</strong><small>COMPUTER ENGINEERING</small></span>
        </Link>
        <Link className="nav-admin" href="/admin">운영자 화면 <ArrowRight size={16} /></Link>
      </nav>

      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> 지금 주문 가능해요</div>
          <h1>줄 서지 말고,<br /><em>맛있는 축제</em>를 즐겨요.</h1>
          <p>QR로 메뉴를 고르고 계좌이체 후 알려주세요.<br />입금 확인부터 조리 완료까지 실시간으로 안내해 드려요.</p>
          <div className="hero-actions">
            <Link className="primary-link" href={demoMode ? "/t/table-7-demo" : "/booth"}>
              <QrCode size={20} /> {demoMode ? "7번 테이블 체험하기" : "포장 주문 시작하기"} <ArrowRight size={18} />
            </Link>
            <Link className="secondary-link" href={demoMode ? "/booth" : "/admin"}>
              <UtensilsCrossed size={19} /> {demoMode ? "포장 주문 체험하기" : "운영자 로그인"}
            </Link>
          </div>
          <div className="trust-row">
            <span><ShieldCheck size={17} /> 안전한 주문</span>
            <span><ChefHat size={17} /> 실시간 조리 현황</span>
          </div>
        </div>

        <div className="hero-ticket" aria-label="주문 과정 안내">
          <div className="ticket-top"><span>COMGONG 52</span><span>ORDER GUIDE</span></div>
          <div className="ticket-number"># A052</div>
          <div className="ticket-route">
            <div><span>01</span><strong>메뉴 선택</strong><small>먹고 싶은 메뉴 담기</small></div><i />
            <div><span>02</span><strong>계좌이체</strong><small>입금 후 버튼 누르기</small></div><i />
            <div><span>03</span><strong>맛있게 냠!</strong><small>준비 완료 알림 확인</small></div>
          </div>
          <div className="ticket-cut" />
          <div className="ticket-bottom"><div><small>오늘의 추천</small><strong>화끈 제육볶음</strong></div><span>BEST</span></div>
        </div>
      </section>

      <footer className="landing-footer"><span>52 FESTIVAL · 오늘도 맛있는 밤</span><span>운영시간 17:00 — 23:30</span></footer>
    </main>
  );
}
