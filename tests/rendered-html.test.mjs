import assert from "node:assert/strict";
import test from "node:test";

process.env.FESTIVAL_DEMO_MODE = "true";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("축제 주문 시작 화면을 서버 렌더링한다", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /컴공 52/);
  assert.match(html, /줄 서지 말고/);
  assert.match(html, /포장 주문/);
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

test("관리자 설정에서 메뉴와 테이블 QR 관리를 제공한다", async () => {
  const response = await render("/admin");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /메뉴·재고/);
  assert.match(html, /테이블·QR/);
  assert.match(html, /주문 관리/);
});
