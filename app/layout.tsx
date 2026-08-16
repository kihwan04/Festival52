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
    title: { default: "컴공 52 | QR 주문 운영", template: "%s | 컴공 52" },
    description: "테이블·포장 QR 발급부터 주문, 입금 확인, 조리와 날짜별 매출까지 관리하는 축제 운영 시스템",
    icons: { icon: "/og.png", shortcut: "/og.png" },
    openGraph: { title: "컴공 52 · QR 주문 운영", description: "주문은 QR로, 운영은 한곳에서.", type: "website", locale: "ko_KR", images: [{ url: `${origin}/og-operator.png`, width: 1732, height: 909, alt: "컴공 52 QR 주문 운영 시스템" }] },
    twitter: { card: "summary_large_image", title: "컴공 52 · QR 주문 운영", description: "주문은 QR로, 운영은 한곳에서.", images: [`${origin}/og-operator.png`] },
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
