import { NextResponse } from "next/server";

// ALB·kubelet 헬스체크용. /api 밖이라 접근 코드 middleware를 거치지 않는다.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
