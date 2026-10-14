import {
  apiFetch,
  getWorkspaceId,
  idempotencyKey,
  parseJsonOrThrow,
  workspacePath
} from "@/shared/api/client";
import type {
  MeetingAppendPreviewResponse,
  MeetingLiveTicketResponse,
  MeetingNotesApplyRequest,
  MeetingNotesResponse,
  MeetingResponse
} from "../model/meeting";

// 회의 받아쓰기 REST API(document docs/api/meetings.md). 회의는 만든 사람만 볼 수 있고 남의 회의는 404다.

export const MEETING_ERROR_MESSAGES = {
  createFailed: "회의를 시작하지 못했습니다.",
  ticketFailed: "받아쓰기 연결을 준비하지 못했습니다.",
  notesFailed: "회의록을 요청하지 못했습니다.",
  notesLoadFailed: "회의록을 불러오지 못했습니다.",
  notesCancelFailed: "회의록 만들기를 취소하지 못했습니다.",
  previewFailed: "문서 끝에 추가할 내용을 미리 보지 못했습니다.",
  applyFailed: "회의록을 문서로 저장하지 못했습니다."
} as const;

function meetingPath(meetingId: string, ...segments: (string | number)[]) {
  return workspacePath(getWorkspaceId(), "meetings", meetingId, ...segments);
}

/** 실시간 받아쓰기 회의를 만든다. document_id를 주면 회의록을 그 문서 끝에 추가할 대상으로 기억한다. */
export async function createMeeting(input: { documentId?: string | null; displayName?: string }): Promise<MeetingResponse> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "meetings"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({
      source: "live",
      ...(input.displayName ? { display_name: input.displayName } : {}),
      ...(input.documentId ? { document_id: input.documentId } : {})
    })
  });
  return parseJsonOrThrow<MeetingResponse>(response, MEETING_ERROR_MESSAGES.createFailed);
}

/** WebSocket 접속용 60초짜리 일회용 ticket. 재연결할 때마다 새로 받는다. */
export async function issueMeetingLiveTicket(meetingId: string): Promise<string> {
  const response = await apiFetch(meetingPath(meetingId, "live-tickets"), { method: "POST" });
  const body = await parseJsonOrThrow<MeetingLiveTicketResponse>(response, MEETING_ERROR_MESSAGES.ticketFailed);
  return body.ticket;
}

/**
 * 확정 전사로 회의록 초안 생성을 요청한다. 비동기라 보통 202(generating)이고, 끝난 뒤에는 fetchMeetingNotes로 기다린다.
 * key는 같은 요청의 네트워크 재시도에만 다시 쓰고, 다시 만들기는 새 키로 보낸다.
 */
export async function requestMeetingNotes(meetingId: string, options: { allowPartial?: boolean; key?: string } = {}): Promise<MeetingNotesResponse> {
  const query = options.allowPartial ? "?allow_partial=true" : "";
  const response = await apiFetch(`${meetingPath(meetingId, "notes")}${query}`, {
    method: "POST",
    headers: { "Idempotency-Key": options.key ?? idempotencyKey() }
  });
  return parseJsonOrThrow<MeetingNotesResponse>(response, MEETING_ERROR_MESSAGES.notesFailed);
}

export async function fetchMeetingNotes(meetingId: string): Promise<MeetingNotesResponse> {
  const response = await apiFetch(meetingPath(meetingId, "notes"), { cache: "no-store" });
  return parseJsonOrThrow<MeetingNotesResponse>(response, MEETING_ERROR_MESSAGES.notesLoadFailed);
}

export async function cancelMeetingNotes(meetingId: string): Promise<MeetingNotesResponse> {
  const response = await apiFetch(meetingPath(meetingId, "notes", "cancel"), { method: "POST" });
  return parseJsonOrThrow<MeetingNotesResponse>(response, MEETING_ERROR_MESSAGES.notesCancelFailed);
}

/** 회의를 시작한 문서(또는 documentId) 끝에 회의록을 붙인 전체 본문과 base_revision. 아무것도 바꾸지 않는다. */
export async function previewMeetingNotesAppend(meetingId: string, version: number, documentId?: string): Promise<MeetingAppendPreviewResponse> {
  const response = await apiFetch(meetingPath(meetingId, "notes", version, "append-preview"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(documentId ? { document_id: documentId } : {})
  });
  return parseJsonOrThrow<MeetingAppendPreviewResponse>(response, MEETING_ERROR_MESSAGES.previewFailed);
}

/** 회의록을 새 문서로 만들거나(create) 기존 문서 끝에 추가한다(append). 같은 key 재시도는 같은 결과를 돌려준다. */
export async function applyMeetingNotes(
  meetingId: string,
  version: number,
  request: MeetingNotesApplyRequest,
  key = idempotencyKey()
): Promise<MeetingNotesResponse> {
  const response = await apiFetch(meetingPath(meetingId, "notes", version, "apply"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(request)
  });
  return parseJsonOrThrow<MeetingNotesResponse>(response, MEETING_ERROR_MESSAGES.applyFailed);
}
