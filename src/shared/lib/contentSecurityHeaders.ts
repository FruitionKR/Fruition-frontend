import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "./contentSecurityPolicy";

/**
 * 화면 요청에 nonce CSP를 붙인다. 루트 middleware.ts에서 호출한다.
 * Next는 요청의 Content-Security-Policy 헤더에서 nonce를 읽어 자기 스크립트에 붙이므로 요청·응답 양쪽에 넣는다.
 * nonce가 요청마다 달라야 해서 화면은 모두 동적 렌더링한다(app/layout.tsx).
 */
export function applyContentSecurityPolicy(request: NextRequest): NextResponse {
  // dev는 HMR이 eval·websocket을 쓰므로 붙이지 않는다.
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  const nonce = btoa(crypto.randomUUID());
  const policy = buildContentSecurityPolicy({
    nonce,
    backendUrl: process.env.BACKEND_URL,
    s3Origin: process.env.CSP_S3_ORIGIN
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}
