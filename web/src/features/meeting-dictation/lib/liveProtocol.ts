// 실시간 받아쓰기 WebSocket 계약(document docs/api/meetings.md `WS /api/meetings/{id}/live`)의 순수 규칙.
// 브라우저 API를 다루는 쪽은 model/liveSession.ts다.

export type LiveServerEvent =
  | { type: "ready"; sample_rate: number; stream_order: number }
  | { type: "committed"; segment_id: string; previous_segment_id: string | null; position: number }
  | { type: "delta"; segment_id: string; text: string }
  | { type: "completed"; segment_id: string; text: string }
  | { type: "finished"; segment_count: number }
  | { type: "error"; code: string; message: string };

/** 오디오 frame 하나의 최대 크기(1초, PCM16 mono 24kHz). */
export const LIVE_MAX_FRAME_BYTES = 48_000;
export const LIVE_SAMPLE_RATE = 24_000;
/** 같은 회의에 이미 연결이 있으면 접속 직후 이 close code로 닫는다. */
export const LIVE_CLOSE_IN_USE = 4409;
/** 연결당 최대 60분(AI 제한). 그 전에 finish하고 새 ticket으로 이어 간다. */
export const LIVE_ROLLOVER_MS = 55 * 60_000;

const FATAL_ERROR_CODES = new Set(["insufficient_credit", "transcript_limit", "meeting_not_open", "live_in_use"]);

const LIVE_ERROR_MESSAGES: Record<string, string> = {
  invalid_audio: "받아쓰기 연결이 오디오를 받지 못했습니다.",
  meeting_not_open: "더 이상 받아쓸 수 없는 회의입니다.",
  transcript_limit: "회의 전사 한도(10만 자)에 도달해 받아쓰기를 멈췄습니다. 지금까지 받아쓴 내용으로 회의록을 만들 수 있습니다.",
  insufficient_credit: "크레딧이 부족합니다. 받아쓰기를 멈췄고 지금까지 받아쓴 내용은 저장돼 있습니다.",
  segment_conflict: "받아쓴 문장을 저장하는 중 충돌이 생겼습니다.",
  transcript_incomplete: "일부 문장을 저장하지 못했습니다.",
  transcript_save_failed: "받아쓴 문장을 저장하지 못했습니다.",
  backpressure: "네트워크가 느려 받아쓰기 연결이 끊겼습니다.",
  transcription_failed: "받아쓰기 서비스에 연결하지 못했습니다.",
  live_in_use: "이 회의는 이미 다른 곳에서 받아쓰고 있습니다.",
  disconnected: "받아쓰기 연결이 끊겼습니다. 지금까지 받아쓴 내용은 저장돼 있습니다."
};

export function describeLiveError(code: string): string {
  return LIVE_ERROR_MESSAGES[code] ?? LIVE_ERROR_MESSAGES.transcription_failed;
}

/** 새 ticket으로 다시 연결해도 같은 결과인 오류. 크레딧·한도·회의 상태·다른 곳 사용 중. */
export function isFatalLiveError(code: string): boolean {
  return FATAL_ERROR_CODES.has(code);
}

/** 서버 text frame을 이벤트로 바꾼다. 모르는 type이나 깨진 JSON은 null(무시)이다. */
export function parseLiveServerEvent(data: unknown): LiveServerEvent | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  const text = (key: string) => (typeof event[key] === "string" ? (event[key] as string) : null);
  const num = (key: string) => (typeof event[key] === "number" ? (event[key] as number) : null);
  switch (event.type) {
    case "ready":
      return { type: "ready", sample_rate: num("sample_rate") ?? LIVE_SAMPLE_RATE, stream_order: num("stream_order") ?? 0 };
    case "committed": {
      const segmentId = text("segment_id");
      const position = num("position");
      if (!segmentId || position === null) return null;
      return { type: "committed", segment_id: segmentId, previous_segment_id: text("previous_segment_id"), position };
    }
    case "delta":
    case "completed": {
      const segmentId = text("segment_id");
      if (!segmentId) return null;
      return { type: event.type, segment_id: segmentId, text: text("text") ?? "" };
    }
    case "finished":
      return { type: "finished", segment_count: num("segment_count") ?? 0 };
    case "error":
      return { type: "error", code: text("code") ?? "transcription_failed", message: text("message") ?? "" };
    default:
      return null;
  }
}

/**
 * WebSocket 주소. 문서 API를 다른 오리진(BACKEND_URL)으로 직접 부르는 배포면 그 오리진에,
 * 아니면 화면과 같은 오리진에 붙는다(ALB 경로 분기·로컬 rewrite). http→ws, https→wss로 바꾼다.
 */
export function buildLiveSocketUrl(apiOrigin: string | null, pageOrigin: string, meetingId: string, ticket: string): string {
  const base = new URL(apiOrigin ?? pageOrigin);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `/api/meetings/${encodeURIComponent(meetingId)}/live`;
  base.search = `?ticket=${encodeURIComponent(ticket)}`;
  return base.toString();
}
