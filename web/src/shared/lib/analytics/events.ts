/** 제품 본문·이름·오류 문자열은 이 계약에 포함하지 않는다. */
export type AnalyticsEvents = {
  citation_opened: { query_id: string; rank: number; citation_type: "internal" | "web"; document_id?: string };
  ai_edit_decided: { proposal_id: string; document_id: string; edit_type: "rewrite" | "append" | "replace" | "other"; decision: "rejected" };
  edit_review_shown: { proposal_id: string; document_id: string; edit_type: "rewrite" | "append" | "replace" | "other" };
  restore_previewed: { operation_id: string; operation_type: "document_edit" | "ingest" | "lint" };
  ingest_picker_opened: Record<string, never>;
  chat_export_started: { export_id: string; conversation_id: string; mode: "all" | "selected" };
  upload_failed_shown: { upload_attempt_id: string; reason: "file_too_large" | "unsupported_type" | "network" | "permission" | "server_error" | "unknown" };
  graph_opened: Record<string, never>;
  graph_node_previewed: { node_type: "document" | "wiki_page" | "other" };
};

/** 분석 연결용 UUID. 보안 토큰 용도가 아니며, 제한된 브라우저에서도 제품 동작을 막지 않는다. */
export function newAnalyticsId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch { /* 보안 컨텍스트·브라우저 정책 제한 시 식별자만 대체한다. */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (key) => {
    const value = Math.floor(Math.random() * 16);
    return (key === "x" ? value : (value & 3) | 8).toString(16);
  });
}

export function analyticsEditType(edit: { operation: string; requested_target: { type: string } } | null | undefined): "rewrite" | "append" | "replace" | "other" {
  if (edit?.operation === "insert_after") return "append";
  if (edit?.operation === "replace") return edit.requested_target.type === "whole_document" ? "rewrite" : "replace";
  return "other";
}
