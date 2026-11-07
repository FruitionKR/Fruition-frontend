import type { MeetingListItem, MeetingNotesResponse, MeetingResponse } from "@/entities/meeting";
import { describeMeetingNotesError, describeMeetingTranscriptionFailure } from "@/shared/lib/aiErrorCodes";
import { hasFinalSegments, transcriptFromSegments } from "./liveTranscript";
import type { MeetingPhase } from "./meetingNotesFlow";
import type { MeetingTranslate } from "./meetingTranslate";

// 회의 목록에서 고른 회의를 다시 열 때(진행 중인 회의 이어 보기) 서버 상태를 회의 화면 단계로 옮긴다.

export type ResumedMeetingView = {
  phase: Exclude<MeetingPhase, "idle">;
  notice: { text: string; tone: "error" | "info" } | null;
};

/**
 * 최신 회의록 초안을 조회해야 하는지. 초안이 없는 회의를 조회하면 404라 브라우저 콘솔에 오류가 남으므로 있을 만할 때만 조회한다.
 * - 전사가 끝난(open) 회의만 회의록을 가질 수 있다.
 * - 목록의 has_notes(ready·applied 초안)가 true면 조회한다.
 * - has_notes가 false여도 받아쓴 문장이 있으면 생성 중(generating)·실패(failed) 초안이 있을 수 있어 조회한다
 *   (has_notes는 이 둘을 세지 않는다). 받아쓴 문장이 없으면 초안을 만들 수 없으므로(422) 조회하지 않는다.
 */
export function shouldLoadNotesOnResume(
  meeting: Pick<MeetingResponse, "status" | "segments">,
  listItem: Pick<MeetingListItem, "has_notes">
): boolean {
  if (meeting.status !== "open") return false;
  if (listItem.has_notes) return true;
  return hasFinalSegments(transcriptFromSegments(meeting.segments));
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
  notes: Pick<MeetingNotesResponse, "status" | "error_code"> | null,
  t: MeetingTranslate
): ResumedMeetingView {
  switch (meeting.status) {
    case "transcribing":
      return { phase: "transcribing", notice: null };
    case "failed":
      return { phase: "stopped", notice: { text: describeMeetingTranscriptionFailure(meeting.error), tone: "error" } };
    case "awaiting_upload":
      return { phase: "stopped", notice: { text: t("messages.awaitingUpload"), tone: "info" } };
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
  if (meeting.live_connected) return { phase: "stopped", notice: { text: t("messages.liveConnected"), tone: "info" } };
  if (!hasFinalSegments(transcriptFromSegments(meeting.segments))) {
    const text = meeting.source === "upload" ? t("messages.emptyRecordingTranscript") : t("messages.emptyTranscript");
    return { phase: "stopped", notice: { text, tone: "info" } };
  }
  return { phase: "stopped", notice: null };
}

/** 목록 상태 표시. label은 meeting 메시지 badges 아래 키다. */
export type MeetingListBadge = {
  label: "transcribing" | "awaitingUpload" | "failed" | "hasNotes" | "transcribed" | "recorded";
  tone: "progress" | "error" | "neutral";
};

/** 회의 목록 한 줄의 상태 표시. 진행 중(전사)·실패를 먼저 알리고, 끝난 회의는 회의록 여부를 보여 준다. */
export function meetingListBadge(item: Pick<MeetingListItem, "status" | "has_notes" | "source">): MeetingListBadge {
  switch (item.status) {
    case "transcribing": return { label: "transcribing", tone: "progress" };
    case "awaiting_upload": return { label: "awaitingUpload", tone: "neutral" };
    case "failed": return { label: "failed", tone: "error" };
    default: return item.has_notes
      ? { label: "hasNotes", tone: "neutral" }
      : { label: item.source === "upload" ? "transcribed" : "recorded", tone: "neutral" };
  }
}
