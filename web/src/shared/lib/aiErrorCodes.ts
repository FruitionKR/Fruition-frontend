/**
 * 서버가 한국어 문구 없이 코드만 보내는 AI 실패를 화면 문구로 바꾼다(#152 코멘트).
 * 그 밖의 AI 실패는 서버가 error_message에 한국어 문구를 담아 보내므로 그대로 보여 준다.
 * 함수마다 마지막 인자로 t(`useTranslations("shared")`)를 받으면 지금 언어 문구(shared.aiErrors.*)를, 없으면 한국어 문구를 쓴다.
 */
import type { SharedTranslate } from "@/shared/i18n/sharedTranslate";


/** 답변 듣기(TTS) 스트림 오류 `{"type":"error","code":...}`의 code(#149). */
export type TtsStreamErrorCode = "provider_unavailable" | "provider_rate_limited" | "deadline_exceeded" | "internal_error";

const TTS_STREAM_ERROR_MESSAGES: Record<TtsStreamErrorCode, string> = {
  provider_unavailable: "음성 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  provider_rate_limited: "요청이 많아 잠시 후 다시 시도해 주세요.",
  deadline_exceeded: "음성 생성이 지연돼 중단했습니다.",
  internal_error: "음성을 만들지 못했습니다."
};

const TTS_STREAM_ERROR_IDS = {
  provider_unavailable: "providerUnavailable",
  provider_rate_limited: "providerRateLimited",
  deadline_exceeded: "deadlineExceeded",
  internal_error: "internalError"
} as const satisfies Record<TtsStreamErrorCode, string>;

export function describeTtsStreamError(code: string | null | undefined, t?: SharedTranslate): string {
  const known = code && Object.hasOwn(TTS_STREAM_ERROR_IDS, code) ? code as TtsStreamErrorCode : "internal_error";
  return t ? t(`aiErrors.tts.${TTS_STREAM_ERROR_IDS[known]}`) : TTS_STREAM_ERROR_MESSAGES[known];
}

/**
 * AI 사용량 하루 한도 안내. apiErrors.ts의 AI_DAILY_LIMIT_MESSAGE와 같은 문구다(테스트가 hook 없이 import해 다른 모듈을 import하지 않는다).
 * 비동기 작업이 한도로 시작하지 못한 실패(회의록·문서 error_code, 실시간 받아쓰기 종료 사유)에 쓴다.
 */
export const AI_USAGE_LIMIT_FAILURE_MESSAGE = "오늘 사용할 수 있는 AI 사용량을 모두 썼어요. 내일 다시 이용해 주세요.";

/** 변환 뒤 자동 편입을 AI 사용 한도로 시작하지 못한 문서의 error_code(document Document.errorCode). */
const DOCUMENT_AI_USAGE_LIMIT_CODE = "AI_USAGE_LIMIT_EXCEEDED";

/**
 * error_code가 없던 이전 document 응답은 이 문구만 error_message에 남긴다
 * (document AiErrorMessages.AI_USAGE_LIMIT_EXCEEDED). 코드가 없을 때만 쓰는 대체 판정이다.
 */
const LEGACY_DOCUMENT_AI_USAGE_LIMIT_MESSAGES = new Set([
  DOCUMENT_AI_USAGE_LIMIT_CODE,
  "AI 사용 한도에 도달해 작업을 시작하지 않았습니다. 잠시 후 또는 내일 다시 시도해 주세요."
]);

/**
 * 문서 처리 실패 사유 표시. AI 사용량 한도 거절만 정해 둔 문구로 바꾸고 나머지는 error_message 그대로 둔다.
 * error_code를 먼저 보고, 코드가 없는 이전 응답만 문구로 판정한다.
 */
export function describeDocumentFailure<T extends string | null | undefined>(message: T, code?: string | null, t?: SharedTranslate): T | string {
  const limitMessage = t ? t("errors.aiDailyLimit") : AI_USAGE_LIMIT_FAILURE_MESSAGE;
  if (code) return code === DOCUMENT_AI_USAGE_LIMIT_CODE ? limitMessage : message;
  return message && LEGACY_DOCUMENT_AI_USAGE_LIMIT_MESSAGES.has(message.trim()) ? limitMessage : message;
}

/** 회의록 생성 실패 error_code와 요청이 겹칠 때의 409 code(#148). */
export type MeetingNotesErrorCode =
  | "MEETING_NOTES_INPUT_REJECTED"
  | "MEETING_NOTES_UNAVAILABLE"
  | "MEETING_NOTES_FAILED"
  | "MEETING_NOTES_INVALID"
  | "MEETING_NOTES_TIMEOUT"
  | "MEETING_NOTES_CANCELLED"
  | "MEETING_NOTES_BUSY"
  | "INSUFFICIENT_CREDIT"
  | "AI_USAGE_LIMIT_EXCEEDED";

const MEETING_NOTES_ERROR_MESSAGES: Record<MeetingNotesErrorCode, string> = {
  MEETING_NOTES_INPUT_REJECTED: "회의 내용을 처리할 수 없는 형식입니다. 녹음이나 대화 내용을 확인해 주세요.",
  MEETING_NOTES_UNAVAILABLE: "회의록 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  MEETING_NOTES_FAILED: "회의록을 만들지 못했습니다.",
  MEETING_NOTES_INVALID: "회의록 결과가 올바르지 않아 저장하지 못했습니다.",
  MEETING_NOTES_TIMEOUT: "회의록 생성이 지연돼 중단했습니다.",
  MEETING_NOTES_CANCELLED: "회의록 생성을 취소했습니다.",
  // 생성은 워크스페이스당 하나라 다른 회의의 회의록이 만들어지는 중이어도 409다(document meetings.md).
  MEETING_NOTES_BUSY: "이 워크스페이스에서 다른 회의록을 만들고 있습니다. 끝난 뒤 다시 시도해 주세요.",
  // 실패한 초안 버전의 error_code로 온다. 문구는 앱 공통 크레딧 부족 안내(INSUFFICIENT_CREDIT_MESSAGE)와 같다.
  INSUFFICIENT_CREDIT: "크레딧이 부족합니다.",
  // 사용자별 AI 사용 한도로 초안 생성을 시작하지 못한 실패 버전의 error_code(document MeetingNotesService).
  AI_USAGE_LIMIT_EXCEEDED: AI_USAGE_LIMIT_FAILURE_MESSAGE
};

const MEETING_NOTES_ERROR_KEYS = {
  MEETING_NOTES_INPUT_REJECTED: "aiErrors.meetingNotes.inputRejected",
  MEETING_NOTES_UNAVAILABLE: "aiErrors.meetingNotes.unavailable",
  MEETING_NOTES_FAILED: "aiErrors.meetingNotes.failed",
  MEETING_NOTES_INVALID: "aiErrors.meetingNotes.invalid",
  MEETING_NOTES_TIMEOUT: "aiErrors.meetingNotes.timeout",
  MEETING_NOTES_CANCELLED: "aiErrors.meetingNotes.cancelled",
  MEETING_NOTES_BUSY: "aiErrors.meetingNotes.busy",
  INSUFFICIENT_CREDIT: "errors.insufficientCredit",
  AI_USAGE_LIMIT_EXCEEDED: "errors.aiDailyLimit"
} as const satisfies Record<MeetingNotesErrorCode, string>;

export function describeMeetingNotesError(code: string | null | undefined, t?: SharedTranslate): string {
  const known = code && Object.hasOwn(MEETING_NOTES_ERROR_KEYS, code) ? code as MeetingNotesErrorCode : "MEETING_NOTES_FAILED";
  return t ? t(MEETING_NOTES_ERROR_KEYS[known]) : MEETING_NOTES_ERROR_MESSAGES[known];
}

/**
 * 녹음 파일 업로드·전사 취소·재생·회의 삭제의 HTTP 오류 code(#148, document meetings.md "녹음 원본과 회의 삭제").
 * 크레딧 부족(402 INSUFFICIENT_CREDIT)은 앱 공통 문구(getErrorMessage)를 쓰므로 여기 두지 않는다.
 */
export type MeetingRecordingErrorCode =
  | "MEETING_RECORDING_TOO_LARGE"
  | "MEETING_RECORDING_UNSUPPORTED"
  | "MEETING_RECORDING_EMPTY"
  | "MEETING_RECORDING_SIZE_MISMATCH"
  | "MEETING_UPLOAD_REJECTED"
  | "MEETING_RECORDING_NOT_ALLOWED"
  | "MEETING_LIVE_IN_USE"
  | "MEETING_NOT_TRANSCRIBING"
  | "MEETING_TRANSCRIBING"
  | "MEETING_RECORDING_CHANGED"
  | "MEETING_RECORDING_NOT_FOUND"
  | "MEETING_RECORDING_STORAGE_FAILED"
  | "MEETING_NOT_FOUND";

const MEETING_RECORDING_ERROR_MESSAGES: Record<MeetingRecordingErrorCode, string> = {
  MEETING_RECORDING_TOO_LARGE: "녹음 파일은 500MB 이하로 올려 주세요.",
  MEETING_RECORDING_UNSUPPORTED: "WAV, MP3, M4A, WebM 녹음 파일만 올릴 수 있습니다.",
  MEETING_RECORDING_EMPTY: "녹음 파일이 비어 있습니다.",
  MEETING_RECORDING_SIZE_MISMATCH: "올린 파일 크기가 맞지 않습니다. 다시 올려 주세요.",
  // ticket 만료·변조, 조각 크기·순서 오류. 처음부터 다시 올리면 새 ticket을 받는다.
  MEETING_UPLOAD_REJECTED: "업로드가 만료되었거나 올바르지 않습니다. 다시 올려 주세요.",
  MEETING_RECORDING_NOT_ALLOWED: "지금은 녹음 파일을 올릴 수 없습니다.",
  MEETING_LIVE_IN_USE: "녹음 연결이 아직 닫히지 않았습니다. 잠시 후 다시 시도해 주세요.",
  MEETING_NOT_TRANSCRIBING: "글로 옮기기가 이미 끝났습니다.",
  MEETING_TRANSCRIBING: "글로 옮기는 중에는 삭제할 수 없습니다. 글로 옮기기를 취소하거나 끝난 뒤 삭제해 주세요.",
  MEETING_RECORDING_CHANGED: "삭제하는 사이 녹음 파일이 바뀌었습니다. 다시 삭제해 주세요.",
  MEETING_RECORDING_NOT_FOUND: "녹음 파일이 없습니다.",
  MEETING_RECORDING_STORAGE_FAILED: "녹음 파일 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  MEETING_NOT_FOUND: "회의를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다."
};

const MEETING_RECORDING_ERROR_IDS = {
  MEETING_RECORDING_TOO_LARGE: "tooLarge",
  MEETING_RECORDING_UNSUPPORTED: "unsupported",
  MEETING_RECORDING_EMPTY: "empty",
  MEETING_RECORDING_SIZE_MISMATCH: "sizeMismatch",
  MEETING_UPLOAD_REJECTED: "uploadRejected",
  MEETING_RECORDING_NOT_ALLOWED: "notAllowed",
  MEETING_LIVE_IN_USE: "liveInUse",
  MEETING_NOT_TRANSCRIBING: "notTranscribing",
  MEETING_TRANSCRIBING: "transcribing",
  MEETING_RECORDING_CHANGED: "changed",
  MEETING_RECORDING_NOT_FOUND: "notFound",
  MEETING_RECORDING_STORAGE_FAILED: "storageFailed",
  MEETING_NOT_FOUND: "meetingNotFound"
} as const satisfies Record<MeetingRecordingErrorCode, string>;

/** 알려진 code면 화면 문구, 모르는 code면 null(호출부가 서버 문구나 기본 문구를 쓴다). */
export function describeMeetingRecordingError(code: string | null | undefined, t?: SharedTranslate): string | null {
  if (!code || !Object.hasOwn(MEETING_RECORDING_ERROR_IDS, code)) return null;
  const known = code as MeetingRecordingErrorCode;
  return t ? t(`aiErrors.meetingRecording.${MEETING_RECORDING_ERROR_IDS[known]}`) : MEETING_RECORDING_ERROR_MESSAGES[known];
}

/** 녹음 파일 전사 실패(회의 status=failed)의 error 문구. document가 한국어로 주므로 없을 때만 기본 문구를 쓴다. */
export function describeMeetingTranscriptionFailure(error: string | null | undefined, t?: SharedTranslate): string {
  return error?.trim() || (t ? t("aiErrors.transcriptionFailed") : "녹음 파일을 글로 옮기지 못했습니다. 다시 올려 주세요.");
}
