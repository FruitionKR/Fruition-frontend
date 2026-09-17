import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE, getAccessCode, hashAccessCode } from "@/shared/lib/accessCode";

// 현재 브라우저의 접근 코드 상태. enabled=false면 게이트 자체가 꺼진 상태.
export async function GET(request: NextRequest) {
  const accessCode = getAccessCode();
  if (!accessCode) return NextResponse.json({ enabled: false, unlocked: true });

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const unlocked = Boolean(token) && token === (await hashAccessCode(accessCode));
  return NextResponse.json({ enabled: true, unlocked });
}

export async function POST(request: NextRequest) {
  const accessCode = getAccessCode();
  if (!accessCode) return NextResponse.json({ ok: true });

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code || code !== accessCode) {
    return NextResponse.json({ message: "코드가 올바르지 않습니다." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ACCESS_COOKIE,
    value: await hashAccessCode(accessCode),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE
  });
  return response;
}
