import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: { default: "야장 52 | 축제 QR 주문", template: "%s | 야장 52" },
    description: "테이블과 포장 주문을 빠르고 정확하게 처리하는 축제 QR 주문 시스템",
    icons: { icon: "/og.png", shortcut: "/og.png" },
    openGraph: { title: "야장 52 · 축제 QR 주문", description: "QR을 찍고, 메뉴를 고르고, 주문 상태까지 한눈에.", type: "website", locale: "ko_KR", images: [{ url: `${origin}/og.png`, width: 1732, height: 909, alt: "야장 52 축제 QR 주문" }] },
    twitter: { card: "summary_large_image", title: "야장 52 · 축제 QR 주문", description: "줄 서지 말고, 맛있는 축제를 즐겨요.", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
