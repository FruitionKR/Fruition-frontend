import { NextResponse } from "next/server";

// ALB·kubelet 헬스체크용.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
