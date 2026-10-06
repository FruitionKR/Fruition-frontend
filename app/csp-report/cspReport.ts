/**
 * 브라우저 CSP 위반 보고를 로그 한 줄짜리 요약으로 줄인다(이슈 #77).
 * 공개 엔드포인트라 보고 본문은 신뢰하지 않는다. 문서 URL·소스 위치·샘플 코드는 버리고
 * 어떤 지시어가 어느 오리진을 막았는지만 남긴다.
 */

export type CspViolationSummary = { directive: string; blocked: string };

export const MAX_REPORT_BYTES = 16 * 1024;
const MAX_SUMMARIES_PER_REQUEST = 10;
const DIRECTIVE = /^[a-z-]{1,40}$/;
// blocked-uri 자리에 오는 CSP 키워드. 무인증 엔드포인트라 이 밖의 글자는 로그에 그대로 남기지 않는다.
const BLOCKED_KEYWORDS = new Set([
  "inline", "eval", "wasm-eval", "trusted-types-policy", "trusted-types-sink",
  "self", "data", "blob", "mediastream", "filesystem", "about"
]);
// 호스트가 비정상적으로 길면(최대 수 KB) 상한 안에서도 로그가 커지므로 오리진을 잘라 남긴다.
const MAX_ORIGIN_LENGTH = 200;

function normalizeDirective(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const directive = value.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return DIRECTIVE.test(directive) ? directive : "unknown";
}

function normalizeBlocked(value: unknown): string {
  if (typeof value !== "string" || !value) return "unknown";
  const trimmed = value.trim().toLowerCase();
  if (BLOCKED_KEYWORDS.has(trimmed)) return trimmed;
  try {
    const url = new URL(value);
    if (url.protocol === "data:" || url.protocol === "blob:") return url.protocol.slice(0, -1);
    // 경로·쿼리에 문서 내용이 실릴 수 있으므로 오리진만 남긴다
    if (["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return url.origin.slice(0, MAX_ORIGIN_LENGTH);
    return "other";
  } catch {
    return "other";
  }
}

function summarize(report: unknown): CspViolationSummary | null {
  if (!report || typeof report !== "object") return null;
  const fields = report as Record<string, unknown>;
  return {
    directive: normalizeDirective(fields["effective-directive"] ?? fields.effectiveDirective ?? fields["violated-directive"]),
    blocked: normalizeBlocked(fields["blocked-uri"] ?? fields.blockedURL)
  };
}

/**
 * report-uri 형식(`application/csp-report`, `{ "csp-report": {...} }`)과
 * Reporting API 형식(`application/reports+json`, `[{ type: "csp-violation", body: {...} }]`)을 모두 읽는다.
 */
export function summarizeCspReports(body: string): CspViolationSummary[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const reports = Array.isArray(parsed)
    ? parsed
      .filter((entry) => entry && typeof entry === "object" && (entry as { type?: unknown }).type === "csp-violation")
      .map((entry) => (entry as { body?: unknown }).body)
    : [(parsed as { "csp-report"?: unknown } | null)?.["csp-report"]];
  return reports
    .slice(0, MAX_SUMMARIES_PER_REQUEST)
    .map(summarize)
    .filter((summary): summary is CspViolationSummary => summary !== null);
}

/** 본문을 최대 maxBytes까지만 읽는다. 넘으면 null. Content-Length 없이 길게 보내는 요청도 끊는다. */
export async function readCappedText(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * 분당 로그 줄 수 상한. 서버(프로세스)마다 따로 센다. 보고가 몰려도 로그가 넘치지 않게 한다.
 * 누구나 상한을 채울 수 있으므로 버린 건수를 세어, 새 창의 첫 호출에서 직전 창의 버린 건수(dropped)를 한 번 돌려준다.
 */
export function createLogLimiter(maxPerWindow: number, windowMs: number) {
  let windowStart = 0;
  let count = 0;
  let dropped = 0;
  return (now: number): { allowed: boolean; dropped: number } => {
    let previousDropped = 0;
    if (now - windowStart >= windowMs) {
      previousDropped = dropped;
      windowStart = now;
      count = 0;
      dropped = 0;
    }
    if (count >= maxPerWindow) {
      dropped += 1;
      return { allowed: false, dropped: previousDropped };
    }
    count += 1;
    return { allowed: true, dropped: previousDropped };
  };
}
