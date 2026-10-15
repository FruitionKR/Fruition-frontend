/**
 * 서버가 한국어 문구 없이 코드만 보내는 AI 실패를 화면 문구로 바꾼다(#152 코멘트).
 * 그 밖의 AI 실패는 서버가 error_message에 한국어 문구를 담아 보내므로 그대로 보여 준다.
 */

/** 답변 듣기(TTS) 스트림 오류 `{"type":"error","code":...}`의 code(#149). */
export type TtsStreamErrorCode = "provider_unavailable" | "provider_rate_limited" | "deadline_exceeded" | "internal_error";

const TTS_STREAM_ERROR_MESSAGES: Record<TtsStreamErrorCode, string> = {
  provider_unavailable: "음성 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  provider_rate_limited: "요청이 많아 잠시 후 다시 시도해 주세요.",
  deadline_exceeded: "음성 생성이 지연돼 중단했습니다.",
  internal_error: "음성을 만들지 못했습니다."
};

export function describeTtsStreamError(code: string | null | undefined): string {
  return (code && TTS_STREAM_ERROR_MESSAGES[code as TtsStreamErrorCode]) || TTS_STREAM_ERROR_MESSAGES.internal_error;
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
  | "INSUFFICIENT_CREDIT";

const MEETING_NOTES_ERROR_MESSAGES: Record<MeetingNotesErrorCode, string> = {
  MEETING_NOTES_INPUT_REJECTED: "회의 내용을 처리할 수 없는 형식입니다. 녹음이나 전사 내용을 확인해 주세요.",
  MEETING_NOTES_UNAVAILABLE: "회의록 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  MEETING_NOTES_FAILED: "회의록을 만들지 못했습니다.",
  MEETING_NOTES_INVALID: "회의록 결과가 올바르지 않아 저장하지 못했습니다.",
  MEETING_NOTES_TIMEOUT: "회의록 생성이 지연돼 중단했습니다.",
  MEETING_NOTES_CANCELLED: "회의록 생성을 취소했습니다.",
  // 생성은 워크스페이스당 하나라 다른 회의의 회의록이 만들어지는 중이어도 409다(document meetings.md).
  MEETING_NOTES_BUSY: "이 워크스페이스에서 다른 회의록을 만들고 있습니다. 끝난 뒤 다시 시도해 주세요.",
  // 실패한 초안 버전의 error_code로 온다. 문구는 앱 공통 크레딧 부족 안내(INSUFFICIENT_CREDIT_MESSAGE)와 같다.
  INSUFFICIENT_CREDIT: "크레딧이 부족합니다."
};

export function describeMeetingNotesError(code: string | null | undefined): string {
  return (code && MEETING_NOTES_ERROR_MESSAGES[code as MeetingNotesErrorCode]) || MEETING_NOTES_ERROR_MESSAGES.MEETING_NOTES_FAILED;
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
  MEETING_RECORDING_TOO_LARGE: "녹음 파일은 500 MiB 이하로 올려 주세요.",
  MEETING_RECORDING_UNSUPPORTED: "WAV, MP3, M4A, WebM 녹음 파일만 올릴 수 있습니다.",
  MEETING_RECORDING_EMPTY: "녹음 파일이 비어 있습니다.",
  MEETING_RECORDING_SIZE_MISMATCH: "올린 파일 크기가 맞지 않습니다. 다시 올려 주세요.",
  // ticket 만료·변조, 조각 크기·순서 오류. 처음부터 다시 올리면 새 ticket을 받는다.
  MEETING_UPLOAD_REJECTED: "업로드가 만료되었거나 올바르지 않습니다. 다시 올려 주세요.",
  MEETING_RECORDING_NOT_ALLOWED: "지금은 녹음 파일을 올릴 수 없습니다.",
  MEETING_LIVE_IN_USE: "받아쓰기 연결이 아직 닫히지 않았습니다. 잠시 후 다시 시도해 주세요.",
  MEETING_NOT_TRANSCRIBING: "전사가 이미 끝났습니다.",
  MEETING_TRANSCRIBING: "전사 중에는 삭제할 수 없습니다. 전사를 취소하거나 끝난 뒤 삭제해 주세요.",
  MEETING_RECORDING_CHANGED: "삭제하는 사이 녹음 파일이 바뀌었습니다. 다시 삭제해 주세요.",
  MEETING_RECORDING_NOT_FOUND: "녹음 파일이 없습니다.",
  MEETING_RECORDING_STORAGE_FAILED: "녹음 파일 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  MEETING_NOT_FOUND: "회의를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다."
};

/** 알려진 code면 화면 문구, 모르는 code면 null(호출부가 서버 문구나 기본 문구를 쓴다). */
export function describeMeetingRecordingError(code: string | null | undefined): string | null {
  return (code && MEETING_RECORDING_ERROR_MESSAGES[code as MeetingRecordingErrorCode]) || null;
}

/** 녹음 파일 전사 실패(회의 status=failed)의 error 문구. document가 한국어로 주므로 없을 때만 기본 문구를 쓴다. */
export function describeMeetingTranscriptionFailure(error: string | null | undefined): string {
  return error?.trim() || "녹음 파일을 전사하지 못했습니다. 다시 올려 주세요.";
}
