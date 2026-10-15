// 회의 받아쓰기 API 응답 타입(Fruition-document docs/api/meetings.md, #148).

export type MeetingSource = "live" | "upload";

/** live는 open으로, upload는 awaiting_upload로 시작한다. 녹음 파일 전사는 transcribing → open | failed. */
export type MeetingStatus = "open" | "awaiting_upload" | "transcribing" | "failed";

export type MeetingSegment = {
  /** `s{stream_order}_{AI 구간 ID}`. 회의록 근거 ID로 쓴다. */
  id: string;
  position: number;
  status: "completed" | "pending";
  /** pending이면 null이다. 연결이 끊긴 뒤에도 남아 있으면 누락이다. */
  text: string | null;
};

export type MeetingStream = {
  stream_order: number;
  /** 진행 중이면 null */
  end_reason: "finished" | "interrupted" | "failed" | null;
};

export type MeetingResponse = {
  meeting_id: string;
  display_name: string;
  document_id: string | null;
  source: MeetingSource;
  status: MeetingStatus;
  live_connected: boolean;
  segments: MeetingSegment[];
  streams: MeetingStream[];
  /** 연결 중이 아니고, pending 구간이 없고, 모든 연결이 finished일 때만 true */
  transcript_complete: boolean;
  /** 녹음 원본이 있는지. 있으면 recording-url로 재생한다. */
  has_recording?: boolean;
  /** 녹음 파일 전사 실패 사유(document가 만든 한국어 문구). 없으면 null */
  error?: string | null;
  created_at: string;
};

/** 녹음 원본 재생 주소(5분 유효 presigned GET) */
export type MeetingRecordingUrlResponse = { url: string; expires_at: string };

export type MeetingLiveTicketResponse = { ticket: string; expires_at: string };

export type MeetingNotesStatus = "generating" | "ready" | "failed" | "applied";

export type MeetingNoteItem = { text: string; source_segment_ids: string[] };

export type MeetingNotesResponse = {
  meeting_id: string;
  version: number;
  status: MeetingNotesStatus;
  partial: boolean;
  display_name: string;
  /** document가 네 배열로 다시 만든 본문. 생성 중·실패면 비어 있을 수 있다. */
  markdown: string | null;
  summary: MeetingNoteItem[];
  decisions: MeetingNoteItem[];
  action_items: MeetingNoteItem[];
  open_questions: MeetingNoteItem[];
  applied: { mode: "create" | "append"; document_id: string; applied_at: string } | null;
  error_code: string | null;
  /** 최신 버전이 failed면 마지막 성공 버전 */
  last_ready_version: number | null;
};

export type MeetingAppendPreviewResponse = { document_id: string; base_revision: number; markdown: string };

export type MeetingNotesApplyRequest =
  | { mode: "create"; display_name?: string; markdown?: string; folder_id?: string }
  | { mode: "append"; base_revision: number; document_id?: string; markdown?: string };
