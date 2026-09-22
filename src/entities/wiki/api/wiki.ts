import { fetchDocumentTree } from "@/entities/tree/api/folders";
import { readRunEvents, type RunStageEvent } from "@/shared/lib/runEvents";
import { apiFetch, parseJsonOrThrow, parseErrorResponse, getWorkspaceId, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import { getSessionContext } from "@/entities/chat/api/chat";
import type { AiModelSelection } from "@/entities/ai";
import type { BackendData, QueryResponse, WikiGraphResponse, WikiPageDetailResponse } from "@/entities/wiki/model/wiki";
import type { DocumentListResponse } from "@/entities/document/model/document";

export async function fetchDocumentData(): Promise<Pick<BackendData, "documents" | "tree">> {
  const workspaceId = getWorkspaceId();
  const [documentsResponse, tree] = await Promise.all([
    apiFetch(workspacePath(workspaceId, "documents"), { cache: "no-store" }),
    fetchDocumentTree(workspaceId)
  ]);

  const documents = await parseJsonOrThrow<DocumentListResponse>(documentsResponse, ERROR_MESSAGES.documentsLoadFailed);
  return { documents: documents.documents ?? [], tree: tree.items };
}

export async function fetchWikiGraph(): Promise<WikiGraphResponse> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "wiki", "graph"), { cache: "no-store" });
  return parseJsonOrThrow<WikiGraphResponse>(response, ERROR_MESSAGES.wikiGraphLoadFailed);
}

// SSE로 전달되는 질의 진행 단계 이벤트.
export type QueryStageEvent = RunStageEvent;

export type QueryRun = { workspaceId: string; requestId: string };

export class QueryCancelledError extends Error {
  constructor() {
    super("질의를 취소했습니다.");
    this.name = "QueryCancelledError";
  }
}

/** 서버의 변경 복구가 끝난 cancelled 상태까지 확인한다. */
export async function cancelQueryRun(run: QueryRun, signal: AbortSignal): Promise<void> {
  const path = workspacePath(run.workspaceId, "ai", "tasks", run.requestId);
  let response = await apiFetch(`${path}/cancel`, { method: "POST", signal });
  while (true) {
    const task = await parseJsonOrThrow<{ status: string; error_code: string }>(response, "질의 취소 상태를 확인하지 못했습니다.");
    if (task.status === "cancelled") return;
    if (task.status === "rollback_failed") {
      throw new Error("질의 변경을 복구하지 못했습니다. 입력창에서 Esc를 눌러 취소를 다시 시도해주세요.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    signal.throwIfAborted();
    response = await apiFetch(path, { cache: "no-store", signal });
  }
}

/**
 * 비동기 질의(run)를 시작하고 SSE로 진행 단계를 소비한 뒤 최종 결과를 반환한다.
 * 백엔드: POST /chat/sessions/{id}/query/runs → GET /api/query/runs/{id}/events(SSE) → GET /api/query/runs/{id}.
 * Authorization 헤더가 필요해 EventSource 대신 fetch 스트림으로 SSE를 읽는다.
 */
export async function runQueryStream(
  question: string,
  selection: AiModelSelection,
  handlers: {
    onStage: (event: QueryStageEvent) => void;
    onStarted?: (run: QueryRun) => void;
    signal?: AbortSignal;
    allowWebSearch?: boolean;
  }
): Promise<QueryResponse> {
  const { workspaceId, sessionId } = await getSessionContext();

  const createResponse = await apiFetch(
    workspacePath(workspaceId, "chat", "sessions", sessionId, "query", "runs"),
    {
      method: "POST",
      signal: handlers.signal,
      headers: { "Content-Type": "application/json" },
      // provider/model은 백엔드 카탈로그 검증 대상이라 쌍으로 보내야 한다.
      // allow_web_search는 @NotNull 필수 필드라 항상 명시한다. composer의 웹 서칭 토글 값.
      body: JSON.stringify({
        question,
        provider: selection.provider,
        model: selection.model,
        allow_web_search: handlers.allowWebSearch ?? false
      })
    }
  );
  const created = await parseJsonOrThrow<{ request_id: string; status: string }>(createResponse, ERROR_MESSAGES.queryFailed);
  const requestId = created.request_id;
  handlers.onStarted?.({ workspaceId, requestId });

  const eventsResponse = await apiFetch(`/api/query/runs/${encodeURIComponent(requestId)}/events`, {
    headers: { Accept: "text/event-stream" },
    signal: handlers.signal,
    cache: "no-store"
  });
  if (!eventsResponse.ok || !eventsResponse.body) {
    throw new Error(await parseErrorResponse(eventsResponse, ERROR_MESSAGES.queryFailed));
  }

  const terminal = await readRunEvents(eventsResponse, handlers.onStage, ERROR_MESSAGES.queryFailed);
  if (terminal === "cancelled") throw new QueryCancelledError();

  const statusResponse = await apiFetch(`/api/query/runs/${encodeURIComponent(requestId)}`, { cache: "no-store", signal: handlers.signal });
  const status = await parseJsonOrThrow<{ status: string; result: QueryResponse | null }>(statusResponse, ERROR_MESSAGES.queryFailed);
  if (status.status === "cancelled") throw new QueryCancelledError();
  if (!status.result) throw new Error(ERROR_MESSAGES.queryFailed);
  return status.result;
}

export async function fetchWikiPage(pageId: string): Promise<WikiPageDetailResponse> {
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(
    workspacePath(workspaceId, "wiki", "pages", pageId),
    { cache: "no-store" }
  );

  return parseJsonOrThrow<WikiPageDetailResponse>(response, ERROR_MESSAGES.wikiPageLoadFailed);
}
