import type { NextRequest } from "next/server";
import { handleAccessGate } from "@/shared/lib/accessGate";
import { applyContentSecurityPolicy } from "@/shared/lib/contentSecurityHeaders";

// Next.js는 라우팅 app/과 같은 위치(프로젝트 루트)의 middleware.ts만 인식한다.
// 그래서 이 파일은 루트에 두고, 게이트 로직은 src/shared/lib/accessGate.ts에 둔다.
export function middleware(request: NextRequest) {
  if (/^\/api(\/|$)/.test(request.nextUrl.pathname)) return handleAccessGate(request);
  return applyContentSecurityPolicy(request);
}

// Next가 빌드 시 정적으로 읽는 값이라 다른 모듈에서 가져오지 않고 이 파일에 직접 선언한다.
// 두 번째 항목은 CSP를 붙일 화면 요청이다. 정적 청크·폰트·pdf.js 자산에는 붙이지 않는다.
export const config = {
  matcher: ["/api/:path*", "/((?!api/|_next/|fonts/|pdfjs/).*)"]
};
