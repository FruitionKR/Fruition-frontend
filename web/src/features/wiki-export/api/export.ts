import { apiFetch, parseJsonOrThrow, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import { getSessionContext } from "@/entities/chat/api/chat";
import type { ChatWikiExportStatus } from "../lib/exportStatus";

export type ChatWikiExportResponse = {
  exportDocumentId: string;
  status: ChatWikiExportStatus;
};

/**
 * 선택한 채팅 내용을 원문 문서로 저장한다. Ingest는 별도로 요청한다.
 * 서버 계약(ChatWikiExportRequest)은 pair_ids만 받고 비어 있으면 400이라, 세션 전체를 내보낼 때도 모든 pair id를 넘긴다.
 */
export async function exportChatWiki(pairIds: string[]): Promise<ChatWikiExportResponse> {
  const { workspaceId, sessionId } = await getSessionContext();
  const response = await apiFetch(
    workspacePath(workspaceId, "chat", "sessions", sessionId, "wiki"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pair_ids: pairIds })
    }
  );
  return parseJsonOrThrow<ChatWikiExportResponse>(response, ERROR_MESSAGES.wikiExportFailed);
}
