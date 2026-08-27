import { NextResponse, type NextRequest } from "next/server";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite === "cross-site") {
      return NextResponse.json({ code: "FORBIDDEN", message: "허용되지 않은 요청입니다." }, { status: 403 });
    }
    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.json({ code: "FORBIDDEN", message: "허용되지 않은 요청입니다." }, { status: 403 });
    }
  }

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Origin-Agent-Cluster", "?1");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  const sensitivePath = request.nextUrl.pathname === "/admin"
    || request.nextUrl.pathname.startsWith("/api/")
    || request.nextUrl.pathname.startsWith("/order/")
    || request.nextUrl.pathname.startsWith("/t/")
    || request.nextUrl.pathname.startsWith("/s/")
    || request.nextUrl.pathname === "/booth";
  if (sensitivePath) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  if (request.nextUrl.protocol === "https:") response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return response;
}

export const config = { matcher: "/:path*" };
