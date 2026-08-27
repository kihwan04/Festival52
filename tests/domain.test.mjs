import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertOrderTransition,
  calculateOrderTotal,
  confirmPayment,
  customerClaimsTransfer,
  priceOrderSelections,
  publicOrderProgressStep,
  publicOrderStatusMessage,
  validateFulfillment,
} from "../src/features/orders/domain/order.ts";
import { isStoreConfigured } from "../src/features/settings/domain/store-settings.ts";
import { combineDailySales, getSeoulDateKey, shiftDateKey } from "../src/features/admin/domain/admin-snapshot.ts";
import { createOrderSchema } from "../src/features/orders/presentation/schemas.ts";

const menu = [
  { id: "menu-1", name: "축제 국수", price: 6000, status: "AVAILABLE", stockQuantity: 3 },
  { id: "menu-2", name: "품절 감자", price: 4500, status: "SOLD_OUT", stockQuantity: 0 },
];

test("서버의 현재 가격으로 스냅샷과 총액을 계산한다", () => {
  const lines = priceOrderSelections([{ menuItemId: "menu-1", quantity: 2 }], menu);
  assert.deepEqual(lines[0], { menuItemId: "menu-1", quantity: 2, menuName: "축제 국수", unitPrice: 6000, subtotal: 12000 });
  assert.equal(calculateOrderTotal(lines), 12000);
});

test("품절 메뉴와 남은 재고를 넘는 주문을 거부한다", () => {
  assert.throws(() => priceOrderSelections([{ menuItemId: "menu-2", quantity: 1 }], menu), /주문할 수 없는/);
  assert.throws(() => priceOrderSelections([{ menuItemId: "menu-1", quantity: 4 }], menu), /재고/);
});

test("테이블 주문에는 테이블이 필요하고 포장 주문에는 필요하지 않다", () => {
  assert.throws(() => validateFulfillment("DINE_IN", null), /테이블/);
  assert.doesNotThrow(() => validateFulfillment("DINE_IN", "table-7"));
  assert.doesNotThrow(() => validateFulfillment("TAKEOUT", null));
});

test("고객 입금 표시는 결제를 확정하지 않는다", () => {
  assert.equal(customerClaimsTransfer("UNPAID"), "CUSTOMER_MARKED_TRANSFERRED");
});

test("관리자만 입금 확정과 주문 결제 상태를 동시에 변경한다", () => {
  assert.throws(() => confirmPayment("CUSTOMER_MARKED_TRANSFERRED", "PENDING_PAYMENT", false), /관리자/);
  assert.deepEqual(confirmPayment("CUSTOMER_MARKED_TRANSFERRED", "PENDING_PAYMENT", true), { paymentStatus: "CONFIRMED", orderStatus: "PAID" });
});

test("주문 상태를 건너뛸 수 없다", () => {
  assert.doesNotThrow(() => assertOrderTransition("PAID", "COOKING"));
  assert.throws(() => assertOrderTransition("PAID", "READY"), /허용되지 않은/);
  assert.throws(() => assertOrderTransition("SERVED", "CANCELLED"), /허용되지 않은/);
});

test("DB 마이그레이션이 중복 주문, 가격 스냅샷, 음수 재고를 방지한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202608140001_festival_qr.sql", import.meta.url), "utf8");
  assert.match(sql, /client_request_id uuid not null unique/i);
  assert.match(sql, /menu_name text not null/i);
  assert.match(sql, /subtotal integer not null check/i);
  assert.match(sql, /stock_quantity integer not null default 0 check \(stock_quantity >= 0\)/i);
  assert.match(sql, /for update/i);
});

test("결제 확정과 주문 PAID 변경이 동일 DB 함수에 있다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202608140001_festival_qr.sql", import.meta.url), "utf8");
  const adminFunction = sql.slice(sql.indexOf("function public.admin_process_order"));
  assert.match(adminFunction, /status = 'CONFIRMED'/i);
  assert.match(adminFunction, /status = 'PAID'/i);
  assert.match(adminFunction, /public\.is_festival_admin\(\)/i);
});

test("업데이트된 운영 설정은 카테고리 관리와 테이블별 QR 발급을 포함한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202608140002_admin_setup.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.menu_categories/i);
  assert.match(sql, /function public\.configure_festival_tables/i);
  assert.match(sql, /function public\.rotate_festival_table_qr/i);
  assert.match(sql, /qr_token = v_token/i);
});

test("완료 작업은 테이블 제공과 포장 수령을 구분하고 취소 전 확인한다", async () => {
  const dashboard = await readFile(new URL("../src/components/AdminDashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /DINE_IN[^\n]+제공 완료[^\n]+수령 완료/);
  assert.match(dashboard, /window\.confirm/);
});

test("Supabase 공개·관리자 권한을 분리하고 첫 관리자 생성을 한 번으로 제한한다", async () => {
  const hardening = await readFile(new URL("../supabase/migrations/202608140003_security_hardening.sql", import.meta.url), "utf8");
  const bootstrap = await readFile(new URL("../supabase/migrations/202608140004_admin_bootstrap.sql", import.meta.url), "utf8");
  assert.match(hardening, /revoke execute on all functions in schema public from public, anon, authenticated/i);
  assert.match(hardening, /grant execute on function public\.admin_process_order\(uuid, text\) to authenticated/i);
  assert.match(bootstrap, /lock table public\.profiles in exclusive mode/i);
  assert.match(bootstrap, /not exists\(select 1 from public\.profiles\)/i);
});

test("계좌 정보가 모두 있어야 매장 설정이 완료된다", () => {
  assert.equal(isStoreConfigured({ bankName: "은행", accountNumber: "123", accountHolder: "컴공" }), true);
  assert.equal(isStoreConfigured({ bankName: "은행", accountNumber: "", accountHolder: "컴공" }), false);
});

test("최종 마이그레이션은 닫힌 매장 주문을 차단하고 교착을 예방한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260814103059_final_architecture_and_store_settings.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.store_settings/i);
  assert.match(sql, /raise exception 'store closed'/i);
  assert.match(sql, /order by value->>'menu_item_id'/i);
  assert.match(sql, /revoke insert, update, delete on public\.menu_items from authenticated/i);
  assert.match(sql, /create_festival_menu_item/i);
  assert.match(sql, /update_store_settings/i);
});

test("API 라우트는 프레젠테이션 컨트롤러만 노출한다", async () => {
  const routes = [
    "../app/api/orders/route.ts",
    "../app/api/admin/menu/route.ts",
    "../app/api/admin/settings/route.ts",
    "../app/api/admin/snapshot/route.ts",
    "../app/api/auth/login/route.ts",
    "../app/api/auth/signup/route.ts",
  ];
  for (const route of routes) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.doesNotMatch(source, /@supabase\/supabase-js|\.from\(|\.rpc\(/i);
    assert.match(source, /controller/i);
  }
});

test("고객 주문 단계와 조리 안내 문구를 실제 상태에 맞게 계산한다", () => {
  const base = { fulfillment_type: "TAKEOUT", order_status: "PENDING_PAYMENT", payment_status: "UNPAID" };
  assert.equal(publicOrderProgressStep(base), 0);
  assert.equal(publicOrderProgressStep({ ...base, payment_status: "CUSTOMER_MARKED_TRANSFERRED" }), 1);
  assert.equal(publicOrderProgressStep({ ...base, order_status: "PAID", payment_status: "CONFIRMED" }), 2);
  assert.equal(publicOrderProgressStep({ ...base, order_status: "COOKING", payment_status: "CONFIRMED" }), 3);
  assert.equal(publicOrderProgressStep({ ...base, order_status: "READY", payment_status: "CONFIRMED" }), 4);
  assert.match(publicOrderStatusMessage({ ...base, order_status: "COOKING", payment_status: "CONFIRMED" }), /조리하고/);
  assert.match(publicOrderStatusMessage({ ...base, order_status: "READY", payment_status: "CONFIRMED" }), /준비가 끝났/);
});

test("고객 주문 현황은 4초 주기와 화면 복귀 시 즉시 동기화한다", async () => {
  const hook = await readFile(new URL("../src/features/orders/presentation/use-public-order-status.ts", import.meta.url), "utf8");
  const customer = await readFile(new URL("../src/components/CustomerOrder.tsx", import.meta.url), "utf8");
  assert.match(hook, /setInterval\(sync, 4000\)/);
  assert.match(hook, /refreshInFlight/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /addEventListener\("focus"/);
  assert.match(customer, /aria-live="polite"/);
  assert.match(customer, /조리 중/);
});

test("네트워크 재시도는 같은 요청 ID를 사용해 중복 주문을 막는다", async () => {
  const customer = await readFile(new URL("../src/components/CustomerOrder.tsx", import.meta.url), "utf8");
  assert.match(customer, /clientRequestId = useRef<string \| null>\(null\)/);
  assert.match(customer, /clientRequestId\.current \?\?= crypto\.randomUUID\(\)/);
  assert.match(customer, /clientRequestId: clientRequestId\.current/);
  assert.doesNotMatch(customer, /clientRequestId: crypto\.randomUUID\(\)/);
});

test("관리자 세션은 갱신 토큰을 보관하고 만료 전에 연장한다", async () => {
  const cookies = await readFile(new URL("../src/shared/auth/auth-cookies.ts", import.meta.url), "utf8");
  const session = await readFile(new URL("../src/shared/auth/admin-session.ts", import.meta.url), "utf8");
  assert.match(cookies, /festival_refresh_token/);
  assert.match(cookies, /httpOnly: true/);
  assert.match(session, /refreshSession\(\{ refresh_token: refreshToken \}\)/);
  assert.match(session, /rpc\("is_festival_admin"\)/);
  assert.doesNotMatch(session, /auth\.getUser\(accessToken\)/);
});

test("주요 화면 이동은 배포 환경에서도 동작하는 기본 링크를 사용한다", async () => {
  const files = [
    "../app/page.tsx",
    "../src/components/CustomerOrder.tsx",
    "../src/components/AdminLogin.tsx",
    "../src/components/AdminDashboard.tsx",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /next\/link|<Link/);
  }
});

test("매출 날짜는 서울 시간으로 계산하고 날짜 이동을 지원한다", () => {
  assert.equal(getSeoulDateKey("2026-08-15T14:59:59.000Z"), "2026-08-15");
  assert.equal(getSeoulDateKey("2026-08-15T15:00:00.000Z"), "2026-08-16");
  assert.equal(shiftDateKey("2026-08-01", -1), "2026-07-31");
  assert.equal(shiftDateKey("2026-12-31", 1), "2027-01-01");
});

test("일별 매출 합계로 전체 누적 매출을 정확히 계산한다", () => {
  assert.deepEqual(combineDailySales([
    { date: "2026-08-15", totalRevenue: 30000, confirmedOrders: 2, dineInOrders: 1, takeoutOrders: 1, averageOrderAmount: 15000 },
    { date: "2026-08-16", totalRevenue: 10000, confirmedOrders: 1, dineInOrders: 1, takeoutOrders: 0, averageOrderAmount: 10000 },
  ]), { totalRevenue: 40000, confirmedOrders: 3, dineInOrders: 2, takeoutOrders: 1, averageOrderAmount: 13333 });
});

test("관리자 일별 매출 집계는 서울 날짜와 확정 결제만 사용한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202608160001_admin_daily_sales.sql", import.meta.url), "utf8");
  assert.match(sql, /confirmed_at at time zone 'Asia\/Seoul'/i);
  assert.match(sql, /p\.status = 'CONFIRMED'/i);
  assert.match(sql, /security invoker/i);
});

test("관리자 매출은 날짜별 테이블 주문액과 입금 확정액을 분리해 표시한다", async () => {
  const [dashboard, gateway, migration] = await Promise.all([
    readFile(new URL("../src/components/AdminDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/admin/infrastructure/supabase-admin-dashboard-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817072333_add_daily_table_totals.sql", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /테이블별 금액/);
  assert.match(dashboard, /tableSale\.orderedAmount/);
  assert.match(dashboard, /tableSale\.confirmedAmount/);
  assert.match(gateway, /table_daily_sales/);
  assert.match(migration, /o\.team_id = v_team_id/);
  assert.match(migration, /p\.team_id = v_team_id/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /grant execute on function public\.get_admin_dashboard_snapshot\(\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.get_admin_dashboard_snapshot\(\) from public, anon, authenticated/i);
});

test("고객 주문 진입은 운영자가 발급한 테이블·포장 QR로 제공한다", async () => {
  const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const dashboard = await readFile(new URL("../src/components/AdminDashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(home, /href=.*\/booth|포장 주문 시작하기/);
  assert.match(home, /href="\/admin"/);
  assert.match(dashboard, /window\.location\.origin}\/s\//);
  assert.match(dashboard, /takeout-order-qr\.png/);
  assert.match(dashboard, /포장 주문 QR/);
});

test("운영팀 가입은 학과별 테넌트를 만들고 모든 운영 데이터를 DB에서 격리한다", async () => {
  const [migration, hardening, signup, signing] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260816050322_add_multi_team_signup.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260816051738_harden_multi_team_signup_proof.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AdminLogin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/security/request-signing.ts", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /create table public\.festival_teams/i);
  assert.match(migration, /create table public\.festival_team_members/i);
  assert.match(migration, /add column team_id uuid references public\.festival_teams/i);
  assert.match(migration, /current_festival_team_id\(\)/i);
  assert.match(migration, /team_id = \(select public\.current_festival_team_id\(\)\)/i);
  assert.match(migration, /handle_festival_operator_signup/i);
  assert.match(migration, /festival_department_name/i);
  assert.match(migration, /'operator-signup'[\s\S]*3, 3600/i);
  assert.match(migration, /on conflict \(team_id, table_number\)/i);
  assert.match(signup, /학과명/);
  assert.match(signup, /운영팀명/);
  assert.match(hardening, /signup-user-v1/);
  assert.match(hardening, /verify_festival_signature/);
  assert.match(signing, /signSignupProvision/);
});

test("팀별 포장 주소와 주문 서명에 공개 팀 식별자를 포함한다", async () => {
  const [dashboard, customer, signing, schema] = await Promise.all([
    readFile(new URL("../src/components/AdminDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/CustomerOrder.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/security/request-signing.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/orders/presentation/schemas.ts", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /\/s\/\$\{encodeURIComponent\(team\.publicSlug\)\}/);
  assert.match(customer, /JSON\.stringify\(\{ teamSlug,/);
  assert.match(signing, /order-v3/);
  assert.match(schema, /teamSlug: z\.string\(\)\.regex/);
});

test("테이블 QR 고객도 같은 운영팀의 포장 주문으로 전환할 수 있다", async () => {
  const [customer, tablePage, gateway] = await Promise.all([
    readFile(new URL("../src/components/CustomerOrder.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/t/[qrToken]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/orders/infrastructure/supabase-order-gateway.ts", import.meta.url), "utf8"),
  ]);
  assert.match(tablePage, /teamSlug=\{table\.teamSlug\}/);
  assert.match(customer, /onClick=\{\(\) => setFulfillment\("TAKEOUT"\)\}/);
  assert.match(customer, /qrToken: fulfillment === "DINE_IN" \? qrToken \?\? null : null/);
  assert.match(customer, /테이블 QR에서도 포장 주문으로 바꿀 수 있어요/);
  assert.match(gateway, /p_team_slug: command\.teamSlug/);
});

test("테이블 QR 설정 응답은 서버의 camelCase 형식을 그대로 사용한다", async () => {
  const dashboard = await readFile(new URL("../src/components/AdminDashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /payload = await adminRequest<FestivalTable\[\]>/);
  assert.match(dashboard, /setTables\(payload\)/);
  assert.doesNotMatch(dashboard, /row\.table_number|row\.qr_token|row\.is_active/);
  assert.match(dashboard, /\$\{count\}개 QR 생성/);
});

test("테이블 QR 토큰은 Supabase 확장 스키마의 난수 함수를 사용한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260816031134_fix_table_qr_generation.sql", import.meta.url), "utf8");
  assert.match(sql, /extensions\.gen_random_bytes\(24\)/i);
  assert.match(sql, /configure_festival_tables/i);
  assert.match(sql, /rotate_festival_table_qr/i);
  assert.match(sql, /public\.is_festival_admin\(\)/i);
});

test("주문 쓰기는 서버 HMAC 서명과 속도 제한을 통과해야 한다", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260816040918_harden_orders_auth_and_dashboard.sql", import.meta.url), "utf8");
  const gateway = await readFile(new URL("../src/features/orders/infrastructure/supabase-order-gateway.ts", import.meta.url), "utf8");
  const signing = await readFile(new URL("../src/shared/security/request-signing.ts", import.meta.url), "utf8");
  assert.match(migration, /verify_festival_signature/i);
  assert.match(migration, /extensions\.hmac/i);
  assert.match(migration, /consume_festival_rate_limit/i);
  assert.match(migration, /too many unpaid orders/i);
  assert.match(gateway, /p_rate_key_hash/);
  assert.match(gateway, /p_request_timestamp/);
  assert.match(gateway, /p_signature/);
  assert.match(signing, /FESTIVAL_REQUEST_SIGNING_SECRET/);
});

test("미입금 주문은 10분 후 자동 취소되고 재고가 복구된다", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260816040918_harden_orders_auth_and_dashboard.sql", import.meta.url), "utf8");
  assert.match(migration, /interval '10 minutes'/i);
  assert.match(migration, /expire_unpaid_festival_orders/i);
  assert.match(migration, /AUTO_CANCEL_UNPAID/i);
  assert.match(migration, /cron\.schedule/i);
  assert.match(migration, /미입금 10분 자동 취소 재고 복구/);
});

test("관리자 대시보드는 10초 주기의 단일 스냅샷 RPC를 사용한다", async () => {
  const dashboard = await readFile(new URL("../src/components/AdminDashboard.tsx", import.meta.url), "utf8");
  const gateway = await readFile(new URL("../src/features/admin/infrastructure/supabase-admin-dashboard-gateway.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20260816040918_harden_orders_auth_and_dashboard.sql", import.meta.url), "utf8");
  assert.match(dashboard, /setInterval\(sync, 10000\)/);
  assert.match(dashboard, /refreshInFlight/);
  assert.match(gateway, /rpc\("get_admin_dashboard_snapshot_v2"\)/);
  assert.doesNotMatch(gateway, /Promise\.all/);
  assert.match(migration, /get_admin_dashboard_snapshot/i);
  assert.match(migration, /security invoker/i);
});

test("관리자 비밀번호는 강도·유출 이력을 검사하고 로그인 시도를 제한한다", async () => {
  const passwordSecurity = await readFile(new URL("../src/shared/security/password-security.ts", import.meta.url), "utf8");
  const authGateway = await readFile(new URL("../src/features/auth/infrastructure/supabase-auth-gateway.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20260816040918_harden_orders_auth_and_dashboard.sql", import.meta.url), "utf8");
  assert.match(passwordSecurity, /password\.length < 14/);
  assert.match(passwordSecurity, /api\.pwnedpasswords\.com/);
  assert.match(authGateway, /authorize_festival_login_attempt/);
  assert.doesNotMatch(authGateway, /bootstrap_festival_admin[\s\S]*login\(/);
  assert.match(migration, /'admin-login'[\s\S]*10, 900/);
});

test("운영 응답은 CSRF·클릭재킹·콘텐츠 유형 공격을 방어한다", async () => {
  const middleware = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  const cookies = await readFile(new URL("../src/shared/auth/auth-cookies.ts", import.meta.url), "utf8");
  assert.match(middleware, /Content-Security-Policy/);
  assert.match(middleware, /X-Frame-Options/);
  assert.match(middleware, /X-Content-Type-Options/);
  assert.match(middleware, /origin !== request\.nextUrl\.origin/);
  assert.match(middleware, /Cache-Control/);
  assert.match(middleware, /X-Robots-Tag/);
  assert.match(cookies, /sameSite: "strict"/);
  assert.match(cookies, /priority: "high"/);
});

test("고객 QR 화면에서는 운영자 홈이나 로그인 화면으로 이동하는 링크를 노출하지 않는다", async () => {
  const customer = await readFile(new URL("../src/components/CustomerOrder.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(customer, /href="\/"/);
  assert.doesNotMatch(customer, /href=.*\/admin/);
  assert.match(customer, /customerMenuHref/);
  assert.match(customer, /aria-label="주문 메뉴로 돌아가기"/);
});

test("좁은 관리자 화면에서 테이블 QR 생성 폼을 세로로 배치한다", async () => {
  const [dashboard, styles] = await Promise.all([
    readFile(new URL("../src/components/AdminDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /`\$\{count\}개 QR 생성`/);
  assert.match(styles, /\.table-setup-card form button \{[^}]*white-space: nowrap/s);
  assert.match(styles, /@media \(max-width: 520px\) \{[\s\S]*?\.table-setup-card form \{ flex-direction: column; \}/);
});

test("최종 보강은 모든 운영 관계를 팀 복합키로 고정하고 로그아웃 세션을 즉시 거부한다", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260827044958_harden_tenant_and_signed_public_rpcs.sql", import.meta.url), "utf8");
  assert.match(migration, /foreign key \(team_id, table_id\)[\s\S]*festival_tables\(team_id, id\)/i);
  assert.match(migration, /foreign key \(team_id, order_id\)[\s\S]*orders\(team_id, id\)/i);
  assert.match(migration, /foreign key \(team_id, menu_item_id\)[\s\S]*menu_items\(team_id, id\)/i);
  assert.match(migration, /references public\.festival_team_members\(team_id, user_id\)/i);
  assert.match(migration, /from auth\.sessions session/i);
  assert.match(migration, /auth\.jwt\(\)->>'session_id'/i);
  assert.match(migration, /team\.is_active = true/i);
});

test("고객용 DB 호출은 서버 서명과 속도 제한 없이는 실행되지 않는다", async () => {
  const [migration, cleanup, signing, orderGateway] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260827044958_harden_tenant_and_signed_public_rpcs.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260827045021_remove_unsigned_public_rpcs.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/security/request-signing.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/orders/infrastructure/supabase-order-gateway.ts", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /public-order-v1/);
  assert.match(migration, /transfer-v1/);
  assert.match(migration, /consume_festival_rate_limit\('public-order'/i);
  assert.match(signing, /signPublicOrderRequest/);
  assert.match(signing, /signTransferClaim/);
  assert.match(orderGateway, /p_request_timestamp/);
  assert.match(orderGateway, /p_signature/);
  assert.match(cleanup, /drop function public\.get_public_order\(uuid\)/i);
  assert.match(cleanup, /drop function public\.mark_transfer_claimed\(uuid\)/i);
});

test("운영자 가입·데모·리디렉션은 운영 환경에서 실패 안전하게 잠긴다", async () => {
  const [server, auth, login, layout] = await Promise.all([
    readFile(new URL("../src/lib/supabase/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/auth/presentation/auth-controller.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AdminLogin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(server, /NODE_ENV !== "production"[\s\S]*FESTIVAL_DEMO_MODE/);
  assert.match(server, /FESTIVAL_ALLOW_SIGNUP === "true"/);
  assert.match(auth, /if \(!isOperatorSignupEnabled\(\)\) throw forbidden/);
  assert.match(auth, /signOut\(\{ scope: "local" \}\)/);
  assert.match(login, /allowSignup = false/);
  assert.doesNotMatch(layout, /x-forwarded-host|headers\(\)/);
  assert.match(layout, /publicSiteOrigin\(\)/);
});

test("API는 JSON 유형·64KB 제한·비캐시 응답을 강제한다", async () => {
  const source = await readFile(new URL("../src/shared/http/route-handler.ts", import.meta.url), "utf8");
  assert.match(source, /MAX_JSON_BODY_BYTES = 64 \* 1024/);
  assert.match(source, /mediaType !== "application\/json"/);
  assert.match(source, /request\.body\.getReader\(\)/);
  assert.match(source, /Cache-Control", "private, no-store/);
  assert.match(source, /Retry-After/);
});

test("고객 주문 UI도 메뉴별 10개·전체 20개 한도를 선제 적용한다", async () => {
  const source = await readFile(new URL("../src/components/CustomerOrder.tsx", import.meta.url), "utf8");
  assert.match(source, /currentTotal >= 20/);
  assert.match(source, /Math\.min\(10, item\.stockQuantity/);
  assert.match(source, /result\.total_amount/);
  assert.match(source, /같은 주문을 다시 눌러도 중복 접수되지 않습니다/);
});

test("동시 QR 주문은 주문별 UUID와 재고 행 잠금 순서로 서로 섞이지 않는다", async () => {
  const [baseMigration, teamMigration, indexMigration] = await Promise.all([
    readFile(new URL("../supabase/migrations/202608140001_festival_qr.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260816050322_add_multi_team_signup.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260827052906_index_tenant_foreign_keys.sql", import.meta.url), "utf8"),
  ]);
  assert.match(baseMigration, /client_request_id uuid not null unique/i);
  assert.match(teamMigration, /where client_request_id = p_client_request_id[\s\S]*team_id = v_team_id/i);
  assert.match(teamMigration, /jsonb_array_elements\(p_items\) order by value->>'menu_item_id'[\s\S]*for update/i);
  assert.match(teamMigration, /exception when unique_violation[\s\S]*'duplicate', true/i);
  assert.match(teamMigration, /nextval\('public\.festival_order_number_seq'\)/i);
  assert.match(indexMigration, /orders_team_table_idx[\s\S]*orders\(team_id, table_id\)/i);
  assert.match(indexMigration, /payments_team_order_idx[\s\S]*payments\(team_id, order_id\)/i);
  assert.match(indexMigration, /order_items_team_menu_idx[\s\S]*order_items\(team_id, menu_item_id\)/i);
});

test("포장 주문은 이름·휴대폰을 검증하고 완료 시 연락처를 자동 삭제한다", async () => {
  const valid = createOrderSchema.parse({
    teamSlug: "team-0123456789abcdef",
    qrToken: null,
    fulfillmentType: "TAKEOUT",
    clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
    customerName: " 김민준 ",
    customerPhone: "010-1234-5678",
    items: [{ menuItemId: "123e4567-e89b-42d3-a456-426614174001", quantity: 1 }],
  });
  assert.equal(valid.customerName, "김민준");
  assert.equal(valid.customerPhone, "01012345678");
  assert.equal(createOrderSchema.safeParse({ ...valid, customerName: null }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...valid, customerPhone: "010-12" }).success, false);

  const [migration, customer, dashboard, gateway] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260827051859_add_takeout_contact_details.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/components/CustomerOrder.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AdminDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/orders/infrastructure/supabase-order-gateway.ts", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /add column if not exists customer_name text/i);
  assert.match(migration, /orders_takeout_contact_check/i);
  assert.match(migration, /order-v3/i);
  assert.match(migration, /clear_finished_order_contact/i);
  assert.match(migration, /new\.status in \('SERVED', 'CANCELLED'\)/i);
  assert.match(migration, /get_admin_dashboard_snapshot_v2/i);
  assert.match(customer, /포장 수령자 정보/);
  assert.match(customer, /수령 완료·취소 시 자동 삭제/);
  assert.match(dashboard, /href=\{`tel:\$\{order\.customerPhone\}`\}/);
  assert.match(gateway, /p_customer_name: command\.customerName/);
  assert.match(gateway, /p_customer_phone: command\.customerPhone/);
});
