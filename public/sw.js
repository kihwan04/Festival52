/* Festival order Web Push service worker. It intentionally caches nothing. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = safeText(payload.title, "주문 준비 완료", 80);
  const body = safeText(payload.body, "주문 현황을 확인해 주세요.", 180);
  const tag = safeText(payload.tag, "festival-order-ready", 64);
  const url = safeOrderPath(payload.url);
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    data: { url },
    renotify: true,
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeOrderPath(event.notification.data && event.notification.data.url);
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const open = windows.find((client) => {
      try { return new URL(client.url).pathname === path; } catch { return false; }
    });
    return open ? open.focus() : self.clients.openWindow(path);
  }));
});

function safeText(value, fallback, maxLength) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function safeOrderPath(value) {
  if (typeof value !== "string") return "/";
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin && /^\/order\/[0-9a-f-]{36}$/i.test(url.pathname) ? url.pathname : "/";
  } catch {
    return "/";
  }
}
