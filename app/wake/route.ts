import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, isAccessUnlocked } from "@/shared/lib/accessCode";
import { readWakePhase, requestWake } from "./requestWake";

// /api 밖이라 접근 코드 middleware·WAF 규칙을 거치지 않는다. 봇 방문으로 서버가 깨지 않도록 직접 쿠키를 확인한다.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!(await isAccessUnlocked(request.cookies.get(ACCESS_COOKIE)?.value))) {
    return new NextResponse(null, { status: 403, headers: NO_STORE });
  }
  await requestWake();
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const unlocked = await isAccessUnlocked(request.cookies.get(ACCESS_COOKIE)?.value);
  const phase = unlocked ? await readWakePhase() : "unknown";
  return NextResponse.json({ phase }, { headers: NO_STORE });
}
