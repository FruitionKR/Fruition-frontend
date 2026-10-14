import { NextResponse } from "next/server";

// 이 작은 요청도 /api middleware의 접근 코드 검사를 통과해야 한다.
export const dynamic = "force-dynamic";

export function GET() {
  const backend = process.env.BACKEND_URL;
  const origin = backend ? new URL(backend).origin : null;
  // BACKEND_URL이 있거나 ALB가 같은 출처에서 API를 나누면 직접 업로드가 기본이며,
  // DOCUMENT_DIRECT_UPLOAD_ENABLED=false로만 명시적으로 끈다. 같은 출처면 origin은 null이라 상대 경로로 보낸다.
  const routed = origin !== null || process.env.SAME_ORIGIN_API === "true";
  const directUpload = routed && process.env.DOCUMENT_DIRECT_UPLOAD_ENABLED !== "false";
  return NextResponse.json({ origin, directUpload }, { headers: { "Cache-Control": "no-store" } });
}
