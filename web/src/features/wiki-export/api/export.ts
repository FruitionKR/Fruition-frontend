import { apiFetch, parseJsonOrThrow, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import { getSessionContext } from "@/entities/chat/api/chat";
import type { ChatWikiExportStatus } from "../lib/exportStatus";
import { captureAnalytics, analyticsSessionHeaders } from "@/shared/lib/analytics/client";
import { newAnalyticsId } from "@/shared/lib/analytics/events";

export type ChatWikiExportResponse = {
  exportDocumentId: string;
  status: ChatWikiExportStatus;
  export_id?: string;
};

/**
 * 선택한 채팅 내용을 원문 문서로 저장한다. Ingest는 별도로 요청한다.
 * pair_ids는 필수라 세션 전체를 내보낼 때도 모든 pair id를 넘긴다. export_id와 mode는 후속 편입에 연결된다.
 */
export async function exportChatWiki(pairIds: string[], sessionContext?: { workspaceId: string; sessionId: string }, mode: "all" | "selected" = "selected"): Promise<ChatWikiExportResponse> {
  const { workspaceId, sessionId } = sessionContext ?? await getSessionContext();
  const exportId = newAnalyticsId();
  captureAnalytics("chat_export_started", { export_id: exportId, conversation_id: sessionId, mode }, workspaceId);
  const response = await apiFetch(
    workspacePath(workspaceId, "chat", "sessions", sessionId, "wiki"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...analyticsSessionHeaders() },
      body: JSON.stringify({ pair_ids: pairIds, export_id: exportId, mode })
    }
  );
  return parseJsonOrThrow<ChatWikiExportResponse>(response, ERROR_MESSAGES.wikiExportFailed);
}
