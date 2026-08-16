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

test("고객 주문 현황은 2초 주기와 화면 복귀 시 즉시 동기화한다", async () => {
  const hook = await readFile(new URL("../src/features/orders/presentation/use-public-order-status.ts", import.meta.url), "utf8");
  const customer = await readFile(new URL("../src/components/CustomerOrder.tsx", import.meta.url), "utf8");
  assert.match(hook, /setInterval\(sync, 2000\)/);
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
  assert.match(session, /auth\.getUser\(accessToken\)/);
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
