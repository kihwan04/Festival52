import assert from "node:assert/strict";
import test from "node:test";

process.env.FESTIVAL_DEMO_MODE = "true";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("메인 화면은 운영자 로그인 전용으로 렌더링한다", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /컴공 52/);
  assert.match(html, /주문은 QR로/);
  assert.match(html, /운영자 로그인/);
  assert.doesNotMatch(html, /포장 주문 시작하기|테이블 체험하기|포장 주문 체험하기/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Building your site/i);
});

test("포장 주문 메뉴를 서버 렌더링한다", async () => {
  const response = await render("/booth");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /오늘 뭐 먹을까요/);
  assert.match(html, /화끈 제육볶음/);
  assert.match(html, /포장/);
});

test("테이블 QR 메뉴에서 포장 주문 전환을 안내한다", async () => {
  const response = await render("/t/table-7-demo");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /7번 테이블/);
  assert.match(html, /포장 주문/);
  assert.match(html, /테이블 QR에서도 포장 주문으로 바꿀 수 있어요/);
});

test("관리자 설정에서 메뉴와 테이블 QR 관리를 제공한다", async () => {
  const response = await render("/admin");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /메뉴·재고/);
  assert.match(html, /테이블·QR/);
  assert.match(html, /주문 관리/);
  assert.match(html, /매출 현황/);
  assert.match(html, /매장 설정/);
  assert.doesNotMatch(html, /매출 현황<\/button>[^<]*disabled/i);
});

test("운영 모드의 관리자 화면은 로그인과 학과별 운영팀 가입을 제공한다", async () => {
  process.env.FESTIVAL_DEMO_MODE = "false";
  try {
    const response = await render("/admin");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /운영자 로그인/);
    assert.match(html, /회원가입/);
    assert.doesNotMatch(html, /FIRST ADMIN/);
  } finally {
    process.env.FESTIVAL_DEMO_MODE = "true";
  }
});
