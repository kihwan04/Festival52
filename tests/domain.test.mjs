import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertOrderTransition,
  calculateOrderTotal,
  confirmPayment,
  customerClaimsTransfer,
  priceOrderSelections,
  validateFulfillment,
} from "../src/features/orders/domain/order.ts";

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
