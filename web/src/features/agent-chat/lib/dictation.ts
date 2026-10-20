// 채팅 입력창 음성 받아쓰기(#147)의 순수 규칙. 브라우저 API를 다루는 쪽은 model/useDictation.ts다.

/** 발화 길이 상한. 서버 계약상 클라이언트가 60초로 제한한다. */
export const DICTATION_MAX_MS = 60_000;
/** 서버가 받는 오디오 본문 상한(24 MiB). */
export const DICTATION_MAX_BYTES = 24 * 1024 * 1024;

// 서버가 받는 형식 순서대로. Chrome·Firefox는 webm/opus, Safari는 mp4를 고른다.
const RECORDING_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg", "audio/wav"];

export const DICTATION_MESSAGES = {
  unsupported: "이 브라우저는 음성 입력을 지원하지 않습니다.",
  permissionDenied: "마이크 사용 권한이 거부되었습니다. 브라우저 설정에서 마이크를 허용해 주세요.",
  noMicrophone: "사용할 수 있는 마이크를 찾지 못했습니다.",
  microphoneFailed: "마이크를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  tooLarge: "녹음이 너무 길어요. 60초 안으로 짧게 말해 주세요.",
  empty: "말소리를 알아듣지 못했어요. 다시 한 번 말해 주세요.",
  recording: "듣고 있어요. 다 말했으면 버튼을 한 번 더 눌러 주세요 (최대 60초)",
  transcribing: "말한 내용을 글로 바꾸고 있어요…"
} as const;

/** MediaRecorder가 지원하는 첫 형식. 하나도 없으면 null. */
export function pickRecordingMimeType(isTypeSupported: (type: string) => boolean): string | null {
  return RECORDING_MIME_TYPES.find((type) => isTypeSupported(type)) ?? null;
}

/** getUserMedia 실패를 사용자 안내로 바꾼다. 권한 거부와 마이크 없음을 구분한다. */
export function describeMicrophoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return DICTATION_MESSAGES.permissionDenied;
  if (name === "NotFoundError" || name === "OverconstrainedError") return DICTATION_MESSAGES.noMicrophone;
  return DICTATION_MESSAGES.microphoneFailed;
}

/** 받아쓴 텍스트를 입력창 내용 뒤에 붙인다. 기존 내용이 있으면 공백으로 띄운다. */
export function appendDictation(current: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return current;
  if (!current.trim()) return trimmed;
  return /\s$/.test(current) ? `${current}${trimmed}` : `${current} ${trimmed}`;
}
