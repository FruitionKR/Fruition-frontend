import {
  apiFetch,
  getWorkspaceId,
  idempotencyKey,
  parseJsonOrThrow,
  throwIfNotOk,
  workspacePath
} from "@/shared/api/client";
import { uploadDirectMultipart, type DirectMultipartOptions } from "@/entities/document/api/multipartUpload";
import type {
  MeetingAppendPreviewResponse,
  MeetingLiveTicketResponse,
  MeetingNotesApplyRequest,
  MeetingNotesResponse,
  MeetingRecordingUrlResponse,
  MeetingResponse,
  MeetingSource
} from "../model/meeting";

// 회의 받아쓰기 REST API(document docs/api/meetings.md). 회의는 만든 사람만 볼 수 있고 남의 회의는 404다.

export const MEETING_ERROR_MESSAGES = {
  createFailed: "회의를 시작하지 못했습니다.",
  ticketFailed: "받아쓰기 연결을 준비하지 못했습니다.",
  notesFailed: "회의록을 요청하지 못했습니다.",
  notesLoadFailed: "회의록을 불러오지 못했습니다.",
  notesCancelFailed: "회의록 만들기를 취소하지 못했습니다.",
  previewFailed: "문서 끝에 추가할 내용을 미리 보지 못했습니다.",
  applyFailed: "회의록을 문서로 저장하지 못했습니다.",
  loadFailed: "회의 상태를 불러오지 못했습니다.",
  uploadFailed: "녹음 파일을 올리지 못했습니다.",
  transcriptionCancelFailed: "전사를 취소하지 못했습니다.",
  recordingUrlFailed: "녹음을 불러오지 못했습니다.",
  deleteFailed: "회의를 삭제하지 못했습니다."
} as const;

function meetingPath(meetingId: string, ...segments: (string | number)[]) {
  return workspacePath(getWorkspaceId(), "meetings", meetingId, ...segments);
}

/**
 * 회의를 만든다. live는 실시간 받아쓰기(open), upload는 녹음 파일 전사(awaiting_upload)로 시작한다.
 * document_id를 주면 회의록을 그 문서 끝에 추가할 대상으로 기억한다.
 */
export async function createMeeting(input: { documentId?: string | null; displayName?: string; source?: MeetingSource }): Promise<MeetingResponse> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "meetings"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({
      source: input.source ?? "live",
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

/** 회의 상태·전사 구간. 녹음 파일 전사(transcribing)가 끝났는지 이 조회로 기다린다. */
export async function fetchMeeting(meetingId: string): Promise<MeetingResponse> {
  const response = await apiFetch(meetingPath(meetingId), { cache: "no-store" });
  return parseJsonOrThrow<MeetingResponse>(response, MEETING_ERROR_MESSAGES.loadFailed);
}

/**
 * 녹음 원본을 S3에 직접 multipart로 올리고 확정한다. 녹음 파일 회의는 확정하면 전사를 시작한다(202, status=transcribing).
 * contentType은 checkRecordingFile이 정한 형식이다.
 *
 * complete는 끊지 않는다. 끊어도 서버가 이미 확정(전사 시작·크레딧 예약)했을 수 있어 결과를 알 수 없게 된다.
 * 대신 complete 중에 취소했으면 202를 받자마자 전사를 취소해(서버는 취소 전까지 쓴 비용만 정산한다) 중단으로 끝낸다.
 * 전사 취소가 실패하면 전사 중인 회의를 그대로 돌려준다(화면이 전사 취소를 다시 받는다).
 */
export async function uploadMeetingRecording(
  meetingId: string,
  file: Blob,
  contentType: string,
  options: DirectMultipartOptions = {}
): Promise<MeetingResponse> {
  const uploaded = await uploadDirectMultipart<MeetingResponse>(meetingPath(meetingId, "recording", "uploads"), file, { content_type: contentType, size: file.size }, options);
  if (!options.signal?.aborted || uploaded.status !== "transcribing") return uploaded;
  const cancelled = await cancelMeetingTranscription(meetingId).catch(() => null);
  if (!cancelled) return uploaded;
  throw new Error("파일 업로드가 중단되었습니다.");
}

/** 전사 중인 녹음 파일 회의를 취소한다. 회의는 failed가 되고 같은 원본을 다시 올릴 수 있다. */
export async function cancelMeetingTranscription(meetingId: string): Promise<MeetingResponse> {
  const response = await apiFetch(meetingPath(meetingId, "transcription", "cancel"), { method: "POST" });
  return parseJsonOrThrow<MeetingResponse>(response, MEETING_ERROR_MESSAGES.transcriptionCancelFailed);
}

/** 녹음 원본을 재생할 5분짜리 서명 주소. 만료되면 다시 받는다. */
export async function fetchMeetingRecordingUrl(meetingId: string): Promise<MeetingRecordingUrlResponse> {
  const response = await apiFetch(meetingPath(meetingId, "recording-url"), { cache: "no-store" });
  return parseJsonOrThrow<MeetingRecordingUrlResponse>(response, MEETING_ERROR_MESSAGES.recordingUrlFailed);
}

/** 회의·전사·회의록 초안·녹음 원본을 지운다(204). 이미 저장한 회의록 문서는 남는다. */
export async function deleteMeeting(meetingId: string): Promise<void> {
  const response = await apiFetch(meetingPath(meetingId), { method: "DELETE" });
  await throwIfNotOk(response, MEETING_ERROR_MESSAGES.deleteFailed);
}
