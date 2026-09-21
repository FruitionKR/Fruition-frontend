import { NextResponse } from "next/server";

// 이 작은 요청도 /api middleware의 접근 코드 검사를 통과해야 한다.
export const dynamic = "force-dynamic";

export function GET() {
  const backend = process.env.BACKEND_URL;
  const origin = backend ? new URL(backend).origin : null;
  return NextResponse.json({
    origin,
    directUpload: process.env.DOCUMENT_DIRECT_UPLOAD_ENABLED === "true"
  }, { headers: { "Cache-Control": "no-store" } });
}
