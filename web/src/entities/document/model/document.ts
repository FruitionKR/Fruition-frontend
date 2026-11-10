import type { DocumentProcessingState, DocumentStatus } from "@/entities/tree/model/tree";

/** 백엔드 DocumentRole. EDITABLE은 편집 가능 Markdown, ORIGINAL은 업로드 원본(PDF 등)이다. */
export type DocumentRole = "EDITABLE" | "ORIGINAL";

/** 문서·폴더에 직접 건 공동 편집 권한. null은 상위 폴더·기본값(edit)을 따른다. */
export type DocumentPermission = "edit" | "view";

/** 스킬 참고 문서 origin. 문서 트리·기본 목록·검색·위키 편입에서 빠지고 전용 조회로만 보인다. Markdown·txt만 받는다. */
export const SKILL_REFERENCE_ORIGIN = "skill_reference";

export type DocumentUploadResponse = {
  id: string;
  filename: string;
  folder_id?: string | null;
  current_version?: number;
  mime_type: string;
  byte_size: number;
  status: DocumentStatus;
  source_uri: string;
  uploaded_at: string;
  document_role: DocumentRole;
  /**
   * 업로드 직후 서버 자동 위키 편입 결과(document #251). 구 서버·멱등 재생 응답·가져오기 세션에는 없다.
   * 값은 서버가 정하므로 그대로 믿지 않고 parseWikiIngestSkip으로 읽는다.
   */
  wiki_ingest?: { status?: unknown; reason?: unknown } | null;
};

export type DocumentItemResponse = DocumentUploadResponse & {
  /** 변환으로 생성된 문서의 원본 ID. 파일명 대신 이 관계로 변환본을 찾는다. */
  source_document_id?: string;
  pipeline_run_id?: string;
  extracted_text_uri?: string;
  processed_at?: string;
  processing_started_at?: string;
  updated_at?: string;
  error_message?: string;
  /** 실패 종류 코드(예: AI_USAGE_LIMIT_EXCEEDED). 코드 없이 실패했거나 구 서버 응답이면 생략된다. */
  error_code?: string;
  processing_state?: DocumentProcessingState;
  processing_stage?: string;
  /** PDF 변환본이고 변환 뒤 서버가 자동 편입하기로 정했으며 그 편입이 아직 시작되지 않았으면 true. 구 서버 응답은 생략된다. */
  auto_ingest_scheduled?: boolean;
  /** 마지막 ingest 이후 편집본이 바뀌어 재분석이 필요한지 */
  needs_reingest?: boolean;
  /** 본문 저장·이름 변경·이동·버전 복원 가능 여부. false면 읽기 전용으로 연다. 구 서버 응답은 생략된다. */
  can_edit?: boolean;
  /** 삭제·휴지통 복구 가능 여부(문서 소유자·워크스페이스 OWNER만 true). */
  can_delete?: boolean;
  /** PDF → Markdown 변환 가능 여부(올린 사람·document.convert 권한·OWNER만 true, 변환 대상이 아니면 false). 구 서버 응답은 생략된다. */
  can_convert?: boolean;
  /** 이 문서에 직접 건 권한. null이면 상위 폴더·기본값을 따른다. */
  permission?: DocumentPermission | null;
  /** 마지막으로 본문을 저장한 사용자 ID */
  updated_by?: string | null;
  /** 문서를 처음 만든 AI 경로. chat_export(채팅 Wiki page화 문서)는 확인 전용이라 본문을 편집할 수 없다. */
  ai_origin?: "agent" | "meeting_notes" | "chat_export" | null;
  /** PDF 변환 문서의 복원 요약. 변환 문서가 아니거나 구 서버 응답이면 생략된다. */
  restoration_summary?: RestorationSummary;
  /** PDF 변환의 그림 설명 집계. requested=false면 그림 설명을 요청하지 않았다. */
  figure_descriptions?: FigureDescriptions;
};

/** 원문 텍스트로 대신한 사유 코드(AI 계약). 모르는 값은 서버가 unknown으로 바꾼다. */
export type FallbackReason =
  | "font_mapping"
  | "replacement_character"
  | "token_mismatch"
  | "extract_failed"
  | "repair_rejected"
  | "provider_error"
  | "unknown";

export type RestorationSummary = {
  broken_pages: number;
  repaired_pages: number;
  /** page는 원본 PDF 기준 1부터. reason은 대표 사유, causes는 그 쪽의 모든 사유(없으면 생략). */
  fallback_pages: { page: number; reason: FallbackReason | string; causes?: string[] }[];
};

export type FigureDescriptions = {
  requested: boolean;
  described: number;
  failed: number;
  skipped: number;
};

export type DocumentListResponse = {
  documents: DocumentItemResponse[];
};

export type NoteContentResponse = {
  document_id: string;
  markdown: string;
  content_version: number;
  updated_at: string;
};

export type SourceBlockHighlight = {
  block_id: string;
  rank: number;
};

/**
 * 원본 block. 줄 범위는 block을 만든 ingest 스냅샷 기준(1부터, 양끝 포함)이다.
 * 위치 정보가 없는 block(chat_export, 위치 저장 이전 데이터)이나 구 응답이면 null 또는 생략된다.
 */
export type DocumentSourceBlock = {
  block_id: string;
  position?: number | null;
  line_start?: number | null;
  line_end?: number | null;
  block_type?: string | null;
  /** 공백 정규화된 block 원문(Markdown 문법 포함) */
  text: string;
};

export type DocumentBlocksResponse = {
  document_id: string;
  source_content_hash?: string | null;
  current_content_hash?: string | null;
  /** block을 만든 뒤 문서가 바뀌었으면 true. 판단할 수 없으면 null(구 응답은 생략) */
  is_stale?: boolean | null;
  blocks: DocumentSourceBlock[];
};
