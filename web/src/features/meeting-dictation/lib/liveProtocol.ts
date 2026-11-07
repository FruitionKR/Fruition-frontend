// 실시간 받아쓰기 WebSocket 계약(document docs/api/meetings.md `WS /api/meetings/{id}/live`)의 순수 규칙.
import { AI_USAGE_LIMIT_FAILURE_MESSAGE } from "@/shared/lib/aiErrorCodes";
import type { MeetingTranslate } from "./meetingTranslate";
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

// ai_usage_limit_exceeded: 사용자별 AI 사용 한도로 연결을 받자마자 닫는다(document MeetingLiveHandler).
const FATAL_ERROR_CODES = new Set(["insufficient_credit", "ai_usage_limit_exceeded", "transcript_limit", "meeting_not_open", "live_in_use"]);

/** 화면 문구가 있는 오류 code. 문구는 meeting 메시지 liveErrors에 둔다. AI 사용 한도는 앱 공통 안내를 쓴다. */
const LIVE_ERROR_CODES = [
  "invalid_audio",
  "meeting_not_open",
  "transcript_limit",
  "insufficient_credit",
  "segment_conflict",
  "transcript_incomplete",
  "transcript_save_failed",
  "backpressure",
  "transcription_failed",
  "live_in_use",
  "disconnected"
] as const;

type LiveErrorCode = (typeof LIVE_ERROR_CODES)[number];

function isLiveErrorCode(code: string): code is LiveErrorCode {
  return (LIVE_ERROR_CODES as readonly string[]).includes(code);
}

/** 오류 code → 안내 문구. 모르는 code는 글로 옮기기 서비스 연결 실패로 안내한다. */
export function describeLiveError(code: string, t: MeetingTranslate): string {
  if (code === "ai_usage_limit_exceeded") return AI_USAGE_LIMIT_FAILURE_MESSAGE;
  return t(`liveErrors.${isLiveErrorCode(code) ? code : "transcription_failed"}`);
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
