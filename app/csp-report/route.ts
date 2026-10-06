import { NextResponse, type NextRequest } from "next/server";
import { createLogLimiter, MAX_REPORT_BYTES, readCappedText, summarizeCspReports } from "./cspReport";

// 브라우저가 Content-Security-Policy-Report-Only 위반을 보내는 곳(이슈 #77).
// 보고는 접근 코드 쿠키 없이도 오므로 /api 밖에 두어 접근 코드 게이트를 거치지 않는다.
// 누구나 보낼 수 있으므로 크기·로그 수를 제한하고, 결과와 관계없이 204만 돌려준다.
export const dynamic = "force-dynamic";

const LOG_LINES_PER_MINUTE = 60;
const allowLog = createLogLimiter(LOG_LINES_PER_MINUTE, 60_000);

function noContent() {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REPORT_BYTES) return noContent();
  const body = await readCappedText(request.body, MAX_REPORT_BYTES).catch(() => null);
  if (!body) return noContent();
  for (const { directive, blocked } of summarizeCspReports(body)) {
    if (!allowLog(Date.now())) break;
    console.warn(`[csp-report] ${directive} ${blocked}`);
  }
  return noContent();
}
