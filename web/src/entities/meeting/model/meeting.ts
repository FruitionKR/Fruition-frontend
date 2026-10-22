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

/** 회의 목록 항목(GET .../meetings). 구간·연결 기록은 없어 GET .../meetings/{id}로 이어서 조회한다. */
export type MeetingListItem = {
  meeting_id: string;
  display_name: string;
  source: MeetingSource;
  status: MeetingStatus;
  has_recording: boolean;
  /** 만들어졌거나(ready) 저장된(applied) 회의록 초안이 있는지. 생성 중(generating)은 false다. */
  has_notes: boolean;
  created_at: string;
  /** 상태 변경·녹음 저장 시각. 받아쓰기·회의록으로는 바뀌지 않아 "마지막 활동 시각"이 아니다. */
  updated_at: string;
};

/** 최근 생성 순. next_cursor가 null이면 마지막 페이지다. */
export type MeetingListResponse = { items: MeetingListItem[]; next_cursor: string | null };

/** 녹음 원본 재생 주소(5분 유효 presigned GET) */
export type MeetingRecordingUrlResponse = { url: string; expires_at: string };

export type MeetingLiveTicketResponse = { ticket: string; expires_at: string };

export type MeetingNotesStatus = "generating" | "ready" | "failed" | "applied";

export type MeetingNoteItem = { text: string; source_segment_ids: string[] };

/** 주요 논의의 주제(`#### 주제`)와 그 아래 항목 */
export type MeetingNoteDiscussion = { topic: string; items: MeetingNoteItem[] };

/** 해야 할 일. 담당자·기한은 발언으로 확인된 경우만 문자열이다. */
export type MeetingNoteActionItem = MeetingNoteItem & { owner: string | null; due: string | null };

export type MeetingNotesResponse = {
  meeting_id: string;
  version: number;
  status: MeetingNotesStatus;
  partial: boolean;
  display_name: string;
  /**
   * AI가 Figma 시안 구성으로 만든 본문(`# 이름`, `- 날짜:`·`- 참석자:`, `### 회의 요약`·`### 주요 논의`(`####` 주제)·
   * `### 결정 사항`·`### 해야 할 일`(`- [ ] 할 일 · 담당자 · 기한`)·`### 다음 일정`). 이 변경 전 초안은 document가
   * 네 배열로 옛 구성(`## 요약` …)을 다시 만든다. 생성 중·실패면 비어 있을 수 있다.
   */
  markdown: string | null;
  /** 회의 날짜(`YYYY-MM-DD`, 한국 날짜). 옛 초안은 null */
  meeting_date: string | null;
  /** 참석자 이름. 옛 초안은 빈 배열 */
  attendees: string[];
  summary: MeetingNoteItem[];
  /** 옛 초안은 빈 배열 */
  discussion: MeetingNoteDiscussion[];
  decisions: MeetingNoteItem[];
  /** 옛 초안은 owner·due가 null */
  action_items: MeetingNoteActionItem[];
  /** 옛 초안은 빈 배열 */
  next_schedule: MeetingNoteItem[];
  /** 미결 사항. 시안 본문에는 없지만 계속 준다. */
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
