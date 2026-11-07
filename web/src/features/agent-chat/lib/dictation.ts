// 채팅 입력창 음성 받아쓰기(#147)의 순수 규칙. 브라우저 API를 다루는 쪽은 model/useDictation.ts다.
import { SPEECH_MAX_BYTES } from "@/shared/config/uploadLimits";

/** 발화 길이 상한. 서버 계약상 클라이언트가 60초로 제한한다. */
export const DICTATION_MAX_MS = 60_000;
/** 서버가 받는 오디오 본문 상한(24 MiB). */
export const DICTATION_MAX_BYTES = SPEECH_MAX_BYTES;

// 서버가 받는 형식 순서대로. Chrome·Firefox는 webm/opus, Safari는 mp4를 고른다.
const RECORDING_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg", "audio/wav"];

/** 받아쓰기 안내 문구의 agentChat.dictation 아래 메시지 키 */
export type DictationMessageKey =
  | "unsupported"
  | "permissionDenied"
  | "noMicrophone"
  | "microphoneFailed"
  | "tooLarge"
  | "empty"
  | "recording"
  | "transcribing";

/** MediaRecorder가 지원하는 첫 형식. 하나도 없으면 null. */
export function pickRecordingMimeType(isTypeSupported: (type: string) => boolean): string | null {
  return RECORDING_MIME_TYPES.find((type) => isTypeSupported(type)) ?? null;
}

/** getUserMedia 실패를 사용자 안내 키로 바꾼다. 권한 거부와 마이크 없음을 구분한다. */
export function describeMicrophoneError(error: unknown): DictationMessageKey {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "permissionDenied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "noMicrophone";
  return "microphoneFailed";
}

/** 받아쓴 텍스트를 입력창 내용 뒤에 붙인다. 기존 내용이 있으면 공백으로 띄운다. */
export function appendDictation(current: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return current;
  if (!current.trim()) return trimmed;
  return /\s$/.test(current) ? `${current}${trimmed}` : `${current} ${trimmed}`;
}
