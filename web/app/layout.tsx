import type { Metadata } from "next";
import { headers } from "next/headers";
import { Providers } from "@/app/providers";
import "@/app/styles/globals.css";
import { readCspNonce } from "@/shared/lib/security/contentSecurityPolicy";
import { FAVICON_LINKS } from "@/shared/lib/favicon";
import { THEME_INIT_SCRIPT } from "@/shared/lib/themePreference";
import { FaviconSync } from "@/shared/ui/FaviconSync";
import { publicAnalyticsToken } from "@/shared/lib/analytics/config";

// CSP nonce가 요청마다 달라 미리 만든 HTML로는 스크립트가 막힌다. 모든 화면을 요청 때 렌더링한다(이슈 #77).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Fruition",
  description: "Research workspace prototype"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  // middleware가 요청 헤더의 CSP에 넣은 nonce. 인라인 테마 스크립트도 이 nonce로만 실행된다.
  const nonce = readCspNonce((await headers()).get("content-security-policy"));
  return (
    // 테마 스크립트가 hydration 전에 data-theme을 붙이므로 그 속성 차이는 경고하지 않는다.
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 고른 테마(라이트·다크)를 첫 화면 전에 적용한다. 고정 문자열이라 사용자 입력이 섞이지 않는다. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* 탭 아이콘. 탭 띠는 앱 테마가 아니라 OS·브라우저 색 구성을 따르므로 media로 검정·흰 아이콘을 고르고,
            색 구성이 바뀌면 FaviconSync가 바로 바꾼다(shared/lib/favicon.ts). */}
        {FAVICON_LINKS.map((link) => (
          <link key={link.href} rel="icon" href={link.href} type={link.type} sizes={link.sizes} media={link.media} data-favicon={link.format} />
        ))}
        {/* 전역 UI 서체 서브셋(fonts.css). 거의 모든 화면이 쓰는 라틴·상용 한글 두 조각만 먼저 받아
            첫 화면이 대체 서체로 그려졌다 바뀌는 깜빡임을 줄인다. 드문 한글 조각은 필요할 때 받는다. */}
        <link rel="preload" href="/fonts/pretendard/subset/PretendardVariable-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/pretendard/subset/PretendardVariable-ko-common.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <FaviconSync />
        <Providers analytics={{
          token: publicAnalyticsToken(process.env.ANALYTICS_ENABLED, process.env.POSTHOG_PROJECT_TOKEN),
          environment: process.env.ANALYTICS_ENVIRONMENT === "production" ? "production" : process.env.ANALYTICS_ENVIRONMENT === "staging" ? "staging" : "local",
          appVersion: process.env.APP_VERSION ?? "local",
          nonce,
        }}>{children}</Providers>
      </body>
    </html>
  );
}
