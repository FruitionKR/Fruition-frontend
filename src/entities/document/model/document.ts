import type { DocumentProcessingState, DocumentStatus } from "@/entities/tree/model/tree";

/** 백엔드 DocumentRole. EDITABLE은 편집 가능 Markdown, ORIGINAL은 업로드 원본(PDF 등)이다. */
export type DocumentRole = "EDITABLE" | "ORIGINAL";

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
  /** 문서 종류상 본문을 편집할 수 있는지(EDITABLE·채팅 문서 아님). 현재 사용자의 권한은 아니다. */
  editable?: boolean;
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
  processing_state?: DocumentProcessingState;
  processing_stage?: string;
  /** 마지막 ingest 이후 편집본이 바뀌어 재분석이 필요한지 */
  needs_reingest?: boolean;
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
