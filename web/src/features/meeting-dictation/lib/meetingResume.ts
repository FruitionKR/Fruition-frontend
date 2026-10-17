import type { MeetingListItem, MeetingNotesResponse, MeetingResponse } from "@/entities/meeting";
import { describeMeetingNotesError, describeMeetingTranscriptionFailure } from "@/shared/lib/aiErrorCodes";
import { hasFinalSegments, transcriptFromSegments } from "./liveTranscript";
import { MEETING_MESSAGES, type MeetingPhase } from "./meetingNotesFlow";

// 회의 목록에서 고른 회의를 다시 열 때(진행 중인 회의 이어 보기) 서버 상태를 회의 화면 단계로 옮긴다.

export type ResumedMeetingView = {
  phase: Exclude<MeetingPhase, "idle">;
  notice: { text: string; tone: "error" | "info" } | null;
};

export const MEETING_RESUME_MESSAGES = {
  awaitingUpload: "녹음 파일을 아직 올리지 않은 회의예요. 녹음 파일을 다시 올려 주세요.",
  liveConnected: "다른 화면에서 이 회의를 받아쓰고 있어요. 받아쓰기를 멈춘 뒤 회의록을 만들 수 있어요."
} as const;

/** 최신 회의록 초안을 조회해야 하는지. 전사가 끝난(open) 회의만 회의록을 가질 수 있다. */
export function shouldLoadNotesOnResume(meeting: Pick<MeetingResponse, "status">): boolean {
  return meeting.status === "open";
}

/**
 * 회의(GET .../meetings/{id})와 최신 회의록 초안(없으면 null)으로 다시 열 화면을 정한다.
 * - transcribing: 전사 진행 표시(조회로 대기)
 * - failed·awaiting_upload: 멈춘 화면 + 안내(녹음 파일 다시 올리기)
 * - open: 회의록이 생성 중이면 대기, 만들어졌으면 회의록, 저장됐으면 저장됨, 없거나 실패면 받아쓴 내용
 * 녹음 재생은 단계와 상관없이 회의의 has_recording으로 보여 준다.
 */
export function resumedMeetingView(
  meeting: Pick<MeetingResponse, "status" | "source" | "error" | "segments" | "live_connected">,
  notes: Pick<MeetingNotesResponse, "status" | "error_code"> | null
): ResumedMeetingView {
  switch (meeting.status) {
    case "transcribing":
      return { phase: "transcribing", notice: null };
    case "failed":
      return { phase: "stopped", notice: { text: describeMeetingTranscriptionFailure(meeting.error), tone: "error" } };
    case "awaiting_upload":
      return { phase: "stopped", notice: { text: MEETING_RESUME_MESSAGES.awaitingUpload, tone: "info" } };
    default:
      break;
  }
  if (notes?.status === "generating") return { phase: "generating", notice: null };
  if (notes?.status === "ready") return { phase: "ready", notice: null };
  if (notes?.status === "applied") return { phase: "applied", notice: null };
  if (notes?.status === "failed") {
    const isCancelled = notes.error_code === "MEETING_NOTES_CANCELLED";
    return { phase: "stopped", notice: { text: describeMeetingNotesError(notes.error_code), tone: isCancelled ? "info" : "error" } };
  }
  if (meeting.live_connected) return { phase: "stopped", notice: { text: MEETING_RESUME_MESSAGES.liveConnected, tone: "info" } };
  if (!hasFinalSegments(transcriptFromSegments(meeting.segments))) {
    const text = meeting.source === "upload" ? MEETING_MESSAGES.emptyRecordingTranscript : MEETING_MESSAGES.emptyTranscript;
    return { phase: "stopped", notice: { text, tone: "info" } };
  }
  return { phase: "stopped", notice: null };
}

export type MeetingListBadge = { label: string; tone: "progress" | "error" | "neutral" };

/** 회의 목록 한 줄의 상태 표시. 진행 중(전사)·실패를 먼저 알리고, 끝난 회의는 회의록 여부를 보여 준다. */
export function meetingListBadge(item: Pick<MeetingListItem, "status" | "has_notes" | "source">): MeetingListBadge {
  switch (item.status) {
    case "transcribing": return { label: "전사 중", tone: "progress" };
    case "awaiting_upload": return { label: "올리기 전", tone: "neutral" };
    case "failed": return { label: "전사 실패", tone: "error" };
    default: return item.has_notes
      ? { label: "회의록 있음", tone: "neutral" }
      : { label: item.source === "upload" ? "전사 완료" : "받아쓰기", tone: "neutral" };
  }
}
