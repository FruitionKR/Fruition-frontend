import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, getAccessCode, hashAccessCode, isSameAccessToken } from "./accessCode";

const READ_METHODS = ["GET", "HEAD"] as const;

// 접근 코드 없이도 허용하는 API. 로그인 → 워크스페이스 선택 → 설정 화면까지 도달하는 데 필요한 최소 경로.
// 항목마다 허용 메서드를 적는다. 쓰기 메서드는 그 흐름에 꼭 필요한 곳(로그인·가입·초대 수락·첫 워크스페이스 생성)에만 연다.
const OPEN_API_PATTERNS: ReadonlyArray<{ pattern: RegExp; methods: readonly string[] }> = [
  // 로그인·가입·재발급·로그아웃 등 로그인 전후 인증 흐름은 POST가 필요하다.
  { pattern: /^\/api\/auth\/(?!me(?:\/|$))/, methods: [...READ_METHODS, "POST"] },
  // 내 계정 정보는 조회만 연다. 계정 변경(PATCH/PUT/DELETE, MFA·소셜 연동 등)은 접근 코드 뒤에 둔다.
  { pattern: /^\/api\/auth\/me(?:\/|$)/, methods: READ_METHODS },
  // 초대 미리보기(GET)와 수락(POST)은 워크스페이스에 들어가는 데 필요하다.
  { pattern: /^\/api\/invitations\//, methods: [...READ_METHODS, "POST"] },
  // 목록 조회와, 워크스페이스가 하나도 없을 때의 기본 워크스페이스 생성(WorkspacesPage).
  { pattern: /^\/api\/workspaces$/, methods: [...READ_METHODS, "POST"] },
  // 워크스페이스 조회만. 이름 변경(PATCH)·삭제(DELETE)는 접근 코드 뒤에 둔다.
  { pattern: /^\/api\/workspaces\/[^/]+$/, methods: READ_METHODS }
];

function isOpenApi(pathname: string, method: string): boolean {
  const upper = method.toUpperCase();
  return OPEN_API_PATTERNS.some(({ pattern, methods }) => pattern.test(pathname) && methods.includes(upper));
}

/** /api 요청의 접근 코드 게이트. 루트 middleware.ts에서 호출한다. */
export async function handleAccessGate(request: NextRequest): Promise<NextResponse> {
  const accessCode = getAccessCode();
  // ACCESS_CODE 미설정이면 게이트 비활성.
  if (!accessCode) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (isOpenApi(pathname, request.method)) return NextResponse.next();

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (isSameAccessToken(token, await hashAccessCode(accessCode))) return NextResponse.next();

  return NextResponse.json(
    { error: { message: "설정에서 접근 코드를 입력해야 사용할 수 있습니다." } },
    { status: 403 }
  );
}
