import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, hasVerifiedAccessCode } from "@/shared/lib/accessCode";
import { readWakePhase, requestWake } from "./requestWake";

// /api 밖이라 접근 코드 middleware·WAF 규칙을 거치지 않는다. 봇 방문으로 서버가 깨지 않도록 직접 쿠키를 확인한다.
// ACCESS_CODE가 비어 있으면(게이트 꺼짐) 확인할 코드가 없으므로 기동 요청·상태 조회를 모두 막는다.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!(await hasVerifiedAccessCode(request.cookies.get(ACCESS_COOKIE)?.value))) {
    return new NextResponse(null, { status: 403, headers: NO_STORE });
  }
  await requestWake();
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const verified = await hasVerifiedAccessCode(request.cookies.get(ACCESS_COOKIE)?.value);
  const phase = verified ? await readWakePhase() : "unknown";
  return NextResponse.json({ phase }, { headers: NO_STORE });
}
