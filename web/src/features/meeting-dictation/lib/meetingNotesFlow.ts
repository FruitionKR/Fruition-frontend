import { describeMeetingNotesError } from "@/shared/lib/aiErrorCodes";
import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";

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
  | "applied";

/** 마이크가 열려 있는(멈출 수 있는) 단계 */
export function isCapturingPhase(phase: MeetingPhase): boolean {
  return phase === "starting" || phase === "recording" || phase === "reconnecting";
}

export const MEETING_TITLES: Record<Exclude<MeetingPhase, "idle">, string> = {
  starting: "받아쓰기 준비 중",
  recording: "받아쓰는 중",
  reconnecting: "다시 연결하는 중",
  finishing: "받아쓰기 마무리 중",
  stopped: "받아쓴 내용",
  generating: "회의록 작성 중",
  ready: "회의록",
  previewing: "문서 끝에 추가 미리보기",
  saving: "회의록 저장 중",
  applied: "회의록 저장됨"
};

/** 카드 아래 진행 표시(Figma 1540:22956) 문구. 진행 중이 아닌 단계는 null */
export function meetingProgressText(phase: MeetingPhase): string | null {
  switch (phase) {
    case "starting": return "마이크와 받아쓰기 연결을 준비하고 있어요…";
    case "recording": return "받아쓰고 있어요…";
    case "reconnecting": return "연결이 끊겨 다시 연결하고 있어요…";
    case "finishing": return "남은 문장을 저장하고 있어요…";
    case "generating": return "답변을 작성하고 있어요…";
    case "saving": return "문서에 저장하고 있어요…";
    default: return null;
  }
}

export const MEETING_MESSAGES = {
  unsupported: "이 브라우저는 회의 받아쓰기를 지원하지 않습니다.",
  emptyTranscript: "받아쓴 내용이 없어 회의록을 만들 수 없습니다.",
  incompleteTranscript: "일부 구간이 저장되지 않았습니다. 저장된 내용만으로 회의록을 만들 수 있습니다.",
  liveStillOpen: "받아쓰기 연결이 아직 닫히지 않았습니다. 잠시 후 다시 시도해 주세요.",
  notesCancelled: "회의록 만들기를 취소했습니다.",
  revisionChanged: "미리 본 뒤 문서가 바뀌었습니다. 다시 미리 보고 저장해 주세요.",
  outdated: "더 최근에 만든 회의록이 있습니다. 최신 회의록으로 다시 시도해 주세요.",
  alreadyApplied: "이 회의록은 이미 문서로 저장했습니다.",
  saved: "회의록을 문서로 저장했습니다."
} as const;

type NotesRequestError = {
  message: string;
  /** 누락·비정상 종료 구간이 있다. 저장된 내용만으로(allow_partial) 다시 요청할 수 있다. */
  incomplete: boolean;
  /** 받아쓰기 연결이 아직 안 닫혔다. 잠시 뒤 같은 요청을 다시 보내면 된다. */
  liveStillOpen: boolean;
};

/** 회의록 생성 요청(POST notes)의 HTTP 오류를 안내 문구로 바꾼다. */
export function describeNotesRequestError(error: unknown): NotesRequestError {
  const code = error instanceof ApiError ? error.code : undefined;
  const result = (message: string, flags: Partial<NotesRequestError> = {}) => ({ message, incomplete: false, liveStillOpen: false, ...flags });
  if (code === "MEETING_TRANSCRIPT_INCOMPLETE") return result(MEETING_MESSAGES.incompleteTranscript, { incomplete: true });
  if (code === "MEETING_TRANSCRIPT_EMPTY") return result(MEETING_MESSAGES.emptyTranscript);
  if (code === "MEETING_LIVE_IN_USE") return result(MEETING_MESSAGES.liveStillOpen, { liveStillOpen: true });
  if (code === "MEETING_NOTES_BUSY") return result(describeMeetingNotesError(code));
  return result(getErrorMessage(error, "회의록을 요청하지 못했습니다."));
}

/** 저장(apply)·미리보기(append-preview) 오류 문구 */
export function describeNotesSaveError(error: unknown, fallback: string): string {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === "DOCUMENT_REVISION_CHANGED") return MEETING_MESSAGES.revisionChanged;
  if (code === "MEETING_NOTES_OUTDATED") return MEETING_MESSAGES.outdated;
  if (code === "MEETING_NOTES_ALREADY_APPLIED") return MEETING_MESSAGES.alreadyApplied;
  return getErrorMessage(error, fallback);
}
