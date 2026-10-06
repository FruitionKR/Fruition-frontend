import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE, getAccessCode, hashAccessCode } from "@/shared/lib/accessCode";
import { getBlockedMs, getClientKey, recordFailure, resetFailures } from "./attemptLimiter";

const TOO_MANY_ATTEMPTS_MESSAGE = "시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.";

// 길이가 다른 문자열도 같은 시간에 비교하도록 SHA-256 다이제스트(항상 32바이트)끼리 비교한다.
function isSameCode(input: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(input), digest(expected));
}

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

  const clientKey = getClientKey(request.headers.get("x-forwarded-for"));
  const now = Date.now();
  const blockedMs = getBlockedMs(clientKey, now);
  if (blockedMs > 0) {
    return NextResponse.json(
      { message: TOO_MANY_ATTEMPTS_MESSAGE },
      { status: 429, headers: { "Retry-After": String(Math.ceil(blockedMs / 1000)) } }
    );
  }

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code || !isSameCode(code, accessCode)) {
    recordFailure(clientKey, now);
    return NextResponse.json({ message: "코드가 올바르지 않습니다." }, { status: 401 });
  }
  resetFailures(clientKey);

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
