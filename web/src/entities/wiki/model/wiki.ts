import type { ServerTreeItem } from "@/entities/tree/model/serverTree";
import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { RelatedPageBase } from "@/shared/types/relatedPage";

export type WikiGraphNodeResponse = {
  id: string;
  page_type: "source" | "concept" | string;
  title: string;
  slug: string;
  summary?: string;
  status: string;
  // source page가 연결된 원본 문서 정보 (page_type=source일 때만 내려온다)
  source_document?: {
    id: string;
    filename?: string | null;
  };
};

export type WikiGraphEdgeResponse = {
  from_page_id: string;
  to_page_id: string;
  link_type: string;
  label?: string | null;
  confidence: number;
};

export type WikiGraphResponse = {
  nodes: WikiGraphNodeResponse[];
  edges: WikiGraphEdgeResponse[];
};

export type BackendData = {
  tree?: ServerTreeItem[];
  documents: DocumentItemResponse[];
  graph: WikiGraphResponse;
};

export type QueryRelatedPageResponse = RelatedPageBase & {
  id: string;
};

export type QueryEvidenceSnippetResponse = {
  rank: number;
  source_document_id: string;
  source_block_ids: string[];
  text: string;
};

/**
 * 세션 메시지 상태. cancelled는 진행 중인 agent turn을 취소해 서버가 pending 응답을 닫은 값이다
 * (`error_message: "Agent 작업이 취소되었습니다."`). 모르는 값도 받도록 string을 열어 둔다.
 */
export type ChatMessageStatus = "pending" | "completed" | "failed" | "cancelled" | (string & {});

export type QueryMessageSummary = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: ChatMessageStatus;
  /** 실패·취소된 응답의 서버 안내 문구 */
  error_message?: string | null;
  created_at: string;
  // 같은 문답(Q&A) 쌍을 묶는 id. 채팅 부분 편입(partial export)에서 pair 선택 단위로 쓴다.
  pair_id?: string;
  // Agent turn이 선택한 처리 갈래. 일반 질의 메시지에는 없다.
  action?: string;
};

export type QueryResponse = {
  user_message: QueryMessageSummary;
  assistant_message: QueryMessageSummary;
  related_pages: QueryRelatedPageResponse[];
  evidence_snippets: QueryEvidenceSnippetResponse[];
};

export type WikiPageSourceDocument = {
  id: string;
  filename: string;
  source_uri: string;
  relation_type: string;
  confidence: number;
};

export type WikiPageRelatedPage = {
  id: string;
  page_type: string;
  title: string;
  slug: string;
  link_type: string;
  label?: string | null;
  confidence: number;
};

export type WikiPageDetailResponse = {
  id: string;
  page_type: string;
  title: string;
  slug: string;
  summary?: string;
  markdown_uri?: string;
  markdown?: string;
  status: string;
  /** 이 페이지의 현재 revision(document #84). 버전 이력이 없으면 키가 빠지며 저장 시 0으로 본다. */
  revision?: number;
  updated_at?: string;
  source_documents: WikiPageSourceDocument[];
  related_pages: WikiPageRelatedPage[];
};

/** PUT /wiki/pages/{id}/content 요청(document #130). revision_write_id는 같은 저장의 재시도에 그대로 쓴다. */
export type WikiPageContentSaveRequest = {
  markdown: string;
  base_revision: number;
  revision_write_id: string;
};

export type WikiPageContentSaveResponse = {
  page_id: string;
  revision: number;
  updated_at: string;
  markdown: string;
};

export type GraphNode = {
  id: string;
  label: string;
  kind?: "source" | "concept" | "raw";
  // raw/source 노드가 연결된 문서 ID
  documentId?: string;
};

// FilterChips에서 켜고 끌 수 있는 노드 종류.
export type GraphFilterKind = "raw" | "source" | "concept";

export type GraphLink = {
  from: string;
  to: string;
  dashed?: boolean;
  active?: boolean;
};

export type NodePosition = { x: number; y: number };
export type NodePositionMap = Record<string, NodePosition>;
export type GraphCache = {
  signature: string;
  positions: NodePositionMap;
  pan: NodePosition;
  zoom: number;
};
