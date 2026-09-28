import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import { Providers } from "@/app/providers";
import "@/app/styles/globals.css";

export const metadata: Metadata = {
  title: "Fruition Agent",
  description: "Research workspace prototype"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        {/* 전역 UI 서체 서브셋(fonts.css). 거의 모든 화면이 쓰는 라틴·상용 한글 두 조각만 먼저 받아
            첫 화면이 대체 서체로 그려졌다 바뀌는 깜빡임을 줄인다. 드문 한글 조각은 필요할 때 받는다. */}
        <link rel="preload" href="/fonts/pretendard/subset/PretendardVariable-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/pretendard/subset/PretendardVariable-ko-common.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
