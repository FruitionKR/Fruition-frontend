import type { QueryMessageSummary } from "@/entities/wiki/model/wiki";
import type { RelatedPageBase } from "@/shared/types/relatedPage";

export type ChatSessionResponse = {
  id: string;
  title: string | null;
  created_at: string;
  last_message_at: string;
};

export type ChatSessionListResponse = {
  sessions: ChatSessionResponse[];
};

export type ChatMessageReferenceResponse = {
  id: number;
  reference_type: string;
  rank?: number;
  source_document_id?: string;
  source_block_ids?: string[];
  source_refs?: { source_document_id: string; source_block_id: string }[];
  text?: string;
};

export type ChatMessageRelatedPageResponse = RelatedPageBase & {
  wiki_page_id: string;
  rank: number;
};

export type ChatMessageResponse = QueryMessageSummary & {
  run_id?: string;
  progress?: import("@/shared/lib/runEventStream").RunStageEvent[];
  action?: string;
  /** action=clarify일 때 AI가 되물은 이유 코드. 코드가 없는 되묻기·이 필드 이전 메시지·배포 전 서버는 null이거나 키가 없고, 모르는 코드가 올 수 있다. 사용자 문구로 쓰지 않는다. */
  clarify_reason?: string | null;
  related_pages?: ChatMessageRelatedPageResponse[];
  references: ChatMessageReferenceResponse[];
};

export type ChatMessagesResponse = {
  messages: ChatMessageResponse[];
};
