const orderPathPattern = /^\/order\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function GET(request: Request) {
  const requestedStart = new URL(request.url).searchParams.get("start") ?? "/";
  const startUrl = orderPathPattern.test(requestedStart) ? requestedStart : "/";
  return Response.json({
    id: "/",
    name: "컴공 52 주문 알림",
    short_name: "컴공 52",
    description: "축제 QR 주문 현황과 준비 완료 알림",
    lang: "ko-KR",
    start_url: startUrl,
    scope: "/",
    display: "standalone",
    background_color: "#fffdfa",
    theme_color: "#f25a32",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  }, {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": startUrl === "/" ? "public, max-age=300" : "private, no-store, max-age=0",
    },
  });
}
