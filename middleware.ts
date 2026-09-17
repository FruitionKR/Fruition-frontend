import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, getAccessCode, hashAccessCode } from "@/shared/lib/accessCode";

// 접근 코드 없이도 허용하는 API. 로그인 → 워크스페이스 선택 → 설정 화면까지 도달하는 데 필요한 최소 경로.
const OPEN_API_PATTERNS = [
  /^\/api\/auth\//,
  /^\/api\/invitations\//,
  /^\/api\/workspaces$/,
  /^\/api\/workspaces\/[^/]+$/
];

export async function middleware(request: NextRequest) {
  const accessCode = getAccessCode();
  // ACCESS_CODE 미설정이면 게이트 비활성.
  if (!accessCode) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (OPEN_API_PATTERNS.some((pattern) => pattern.test(pathname))) return NextResponse.next();

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (token && token === (await hashAccessCode(accessCode))) return NextResponse.next();

  return NextResponse.json(
    { error: { message: "설정에서 접근 코드를 입력해야 사용할 수 있습니다." } },
    { status: 403 }
  );
}

export const config = {
  matcher: ["/api/:path*"]
};
