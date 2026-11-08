import { describeMeetingNotesError, describeMeetingRecordingError } from "@/shared/lib/aiErrorCodes";
import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";
import type { SharedTranslate } from "@/shared/i18n/sharedTranslate";
import type { MeetingTranslate } from "./meetingTranslate";

// 회의 화면의 단계와 단계별 문구. 화면(MeetingNotesView)과 상태 훅(useMeetingSession)이 같이 쓴다.

export type MeetingPhase =
  | "idle"
  | "starting"
  | "recording"
  | "reconnecting"
  | "finishing"
  | "stopped"
  | "generating"
  | "ready"
  | "previewing"
  | "saving"
  | "applied"
  // 녹음 파일 전사: 올리는 중 → 전사 중(조회로 대기) → 끝나면 stopped와 같은 흐름(회의록 만들기)
  | "uploading"
  | "transcribing"
  | "deleting"
  // 회의 목록에서 고른 회의를 불러오는 중(진행 중인 회의 이어 보기)
  | "opening";

/** 마이크가 열려 있는(멈출 수 있는) 단계 */
export function isCapturingPhase(phase: MeetingPhase): boolean {
  return phase === "starting" || phase === "recording" || phase === "reconnecting";
}

/** 회의 화면 제목. 문구는 meeting 메시지 titles에 둔다. */
export function meetingTitle(phase: Exclude<MeetingPhase, "idle">, t: MeetingTranslate): string {
  return t(`titles.${phase}`);
}

/**
 * 회의 화면을 닫을 수 없는 단계. 받아쓰기·업로드·저장·삭제가 끝나거나 취소한 뒤 닫는다.
 * 전사·회의록 생성은 서버에서 이어지고 회의 목록에서 다시 열 수 있어 닫아도 된다.
 * 업로드는 이 탭이 조각을 보내는 중이라 닫으면 이어 갈 수 없어 "올리기 취소"로만 끝낸다.
 */
export function isMeetingBusyPhase(phase: MeetingPhase): boolean {
  return phase === "starting" || phase === "recording" || phase === "reconnecting" || phase === "finishing"
    || phase === "saving" || phase === "uploading" || phase === "deleting";
}

/** 회의 화면 제목 줄에 "닫기"를 두는 단계 */
export function canCloseMeetingInPhase(phase: MeetingPhase): boolean {
  return phase !== "idle" && !isMeetingBusyPhase(phase);
}

/**
 * 탭을 닫거나 새로고침하기 전에 확인을 받는 단계. 녹음 파일 조각을 S3에 올리는 중에는 떠나면 업로드를 이어 갈 수 없다.
 * 전사는 서버에서 이어지고 회의 목록에서 다시 열 수 있어 확인하지 않는다.
 */
export function shouldConfirmLeavingPhase(phase: MeetingPhase): boolean {
  return phase === "uploading";
}

/**
 * 회의록을 확인 없이 새 문서로 저장할지. 이 화면에서 생성이 끝나는 것을 지켜본 회의록만 버전마다 한 번 저장한다.
 * 다시 만들기와 생성 중인 회의를 다시 연 경우도 포함한다. 자동 승인을 켠 사용자가 허용한 범위로 본다.
 * 이미 만들어진 회의록을 다시 연 경우와 저장에 실패해 돌아온 경우는 사람이 고른다.
 */
export function shouldAutoSaveMeetingNotes(input: {
  isEnabled: boolean;
  phase: MeetingPhase;
  wasGenerating: boolean;
  hasNotes: boolean;
  isAlreadyTried: boolean;
}): boolean {
  return input.isEnabled && input.phase === "ready" && input.wasGenerating && input.hasNotes && !input.isAlreadyTried;
}

/** 회의를 지울 수 있는 단계. 전사·회의록 생성 중에는 먼저 취소한다(서버도 전사 중이면 409 MEETING_TRANSCRIBING). */
export function canDeleteMeetingInPhase(phase: MeetingPhase): boolean {
  return phase === "stopped" || phase === "ready" || phase === "applied";
}

/** 카드 아래 진행 표시(Figma 1540:22956) 문구. 진행 중이 아닌 단계는 null */
export function meetingProgressText(phase: MeetingPhase, t: MeetingTranslate, uploadPercent: number | null = null): string | null {
  switch (phase) {
    case "uploading": return uploadPercent === null ? t("progress.uploading") : t("progress.uploadingPercent", { percent: uploadPercent });
    case "transcribing":
    case "deleting":
    case "opening":
    case "starting":
    case "recording":
    case "reconnecting":
    case "finishing":
    case "generating":
    case "saving":
      return t(`progress.${phase}`);
    default: return null;
  }
}

/** 녹음 파일 업로드·전사 취소·재생·삭제 오류 문구. 알려진 code는 화면 문구, 402·권한 등은 앱 공통 문구(ts)를 쓴다. */
export function describeRecordingError(error: unknown, fallback: string, ts?: SharedTranslate): string {
  const code = error instanceof ApiError ? error.code : undefined;
  return describeMeetingRecordingError(code, ts) ?? getErrorMessage(error, fallback, ts);
}

type NotesRequestError = {
  message: string;
  /** 누락·비정상 종료 구간이 있다. 저장된 내용만으로(allow_partial) 다시 요청할 수 있다. */
  incomplete: boolean;
  /** 받아쓰기 연결이 아직 안 닫혔다. 잠시 뒤 같은 요청을 다시 보내면 된다. */
  liveStillOpen: boolean;
};

/** 회의록 생성 요청(POST notes)의 HTTP 오류를 안내 문구로 바꾼다. */
export function describeNotesRequestError(error: unknown, t: MeetingTranslate, ts?: SharedTranslate): NotesRequestError {
  const code = error instanceof ApiError ? error.code : undefined;
  const result = (message: string, flags: Partial<NotesRequestError> = {}) => ({ message, incomplete: false, liveStillOpen: false, ...flags });
  if (code === "MEETING_TRANSCRIPT_INCOMPLETE") return result(t("messages.incompleteTranscript"), { incomplete: true });
  if (code === "MEETING_TRANSCRIPT_EMPTY") return result(t("messages.emptyTranscript"));
  if (code === "MEETING_LIVE_IN_USE") return result(t("messages.liveStillOpen"), { liveStillOpen: true });
  if (code === "MEETING_NOTES_BUSY") return result(describeMeetingNotesError(code, ts));
  return result(getErrorMessage(error, t("errors.notesFailed"), ts));
}

/** 저장(apply)·미리보기(append-preview) 오류 문구 */
export function describeNotesSaveError(error: unknown, fallback: string, t: MeetingTranslate, ts?: SharedTranslate): string {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === "DOCUMENT_REVISION_CHANGED") return t("messages.revisionChanged");
  if (code === "MEETING_NOTES_OUTDATED") return t("messages.outdated");
  if (code === "MEETING_NOTES_ALREADY_APPLIED") return t("messages.alreadyApplied");
  if (code === "DUPLICATE_NAME") return t("messages.duplicateName");
  return getErrorMessage(error, fallback, ts);
}

/** 마이크를 열지 못한 사유 문구(getUserMedia 오류 이름으로 고른다). */
export function describeMeetingMicrophoneError(error: unknown, t: MeetingTranslate): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return t("messages.microphoneDenied");
  if (name === "NotFoundError" || name === "OverconstrainedError") return t("messages.noMicrophone");
  return t("messages.microphoneFailed");
}
