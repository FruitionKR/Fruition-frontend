import { fetchDocumentTree } from "@/entities/tree/api/documentTree";
import { readRunEvents, type RunStageEvent } from "@/shared/lib/runEventStream";
import { apiFetch, parseJsonOrThrow, parseErrorResponse, parseApiError, getWorkspaceId, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import { ApiError } from "@/shared/lib/apiErrors";
import { getSessionContext } from "@/entities/chat/api/chat";
import type { AiModelSelection } from "@/entities/ai";
import type {
  BackendData,
  QueryResponse,
  WikiGraphResponse,
  WikiPageContentSaveRequest,
  WikiPageContentSaveResponse,
  WikiPageDetailResponse
} from "@/entities/wiki/model/wiki";
import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { ServerTreeItem } from "@/entities/tree/model/serverTree";

/** 폴링이 공유하는 문서·트리 쿼리 키. 계획 미리보기도 이 캐시의 트리를 쓴다. */
export const documentDataQueryKey = (workspaceId: string | null) => ["backendData", workspaceId, "documents"] as const;

/** 트리 문서 항목은 문서 목록 조회와 같은 항목을 싣는다. 서버 목록과 같은 순서로 평탄화한다. */
export function documentsFromTree(items: ServerTreeItem[]): DocumentItemResponse[] {
  const documents: DocumentItemResponse[] = [];
  const order = new Map<string, number>();
  const visit = (nodes: ServerTreeItem[]) => nodes.forEach((node) => {
    if (node.document) {
      documents.push(node.document);
      order.set(node.document.id, node.sort_order);
    }
    visit(node.children ?? []);
  });
  visit(items);
  return documents.sort((a, b) => (order.get(a.id)! - order.get(b.id)!) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** documents 목록 조회는 같은 데이터라 트리 한 번만 받는다(#66). */
export async function fetchDocumentData(): Promise<Pick<BackendData, "documents" | "tree">> {
  const tree = await fetchDocumentTree(getWorkspaceId(), ERROR_MESSAGES.documentsLoadFailed);
  return { documents: documentsFromTree(tree.items), tree: tree.items };
}

// 마지막으로 받은 그래프와 ETag(워크스페이스 위키 버전, document #131). 폴링은 이 값을 If-None-Match로 보내고
// 304면 갖고 있던 그래프를 그대로 쓴다. 서버가 304면 AI 서비스를 부르지 않는다.
let cachedWikiGraph: { workspaceId: string; etag: string; data: WikiGraphResponse } | null = null;

/** 테스트·워크스페이스 전환용. 다음 조회는 조건 없이 받는다. */
export function resetWikiGraphCache(): void {
  cachedWikiGraph = null;
}

export async function fetchWikiGraph(): Promise<WikiGraphResponse> {
  const workspaceId = getWorkspaceId();
  const cached = cachedWikiGraph?.workspaceId === workspaceId ? cachedWikiGraph : null;
  const response = await apiFetch(workspacePath(workspaceId, "wiki", "graph"), {
    cache: "no-store",
    ...(cached ? { headers: { "If-None-Match": cached.etag } } : {})
  });
  if (response.status === 304 && cached) return cached.data;
  const data = await parseJsonOrThrow<WikiGraphResponse>(response, ERROR_MESSAGES.wikiGraphLoadFailed);
  const etag = response.headers.get("ETag");
  cachedWikiGraph = etag ? { workspaceId, etag, data } : null;
  return data;
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

  // SSE가 종결 이벤트 없이 끊겨도 서버는 계속 처리한다. run이 끝날 때까지 상태를 폴링해 실패로 단정하지 않는다(#143).
  while (true) {
    const statusResponse = await apiFetch(`/api/query/runs/${encodeURIComponent(requestId)}`, { cache: "no-store", signal: handlers.signal });
    const status = await parseJsonOrThrow<QueryRunStatusResponse>(statusResponse, ERROR_MESSAGES.queryFailed);
    if (status.status === "cancelled") throw new QueryCancelledError();
    if (status.result) return status.result;
    if (!QUERY_RUN_ACTIVE_STATUSES.has(status.status)) throw new Error(status.error || ERROR_MESSAGES.queryFailed);
    await new Promise((resolve) => setTimeout(resolve, QUERY_RUN_POLL_INTERVAL_MS));
    handlers.signal?.throwIfAborted();
  }
}

const QUERY_RUN_POLL_INTERVAL_MS = 1000;
const QUERY_RUN_ACTIVE_STATUSES = new Set(["queued", "pending", "running", "cancel_requested", "rolling_back"]);

/** GET /api/query/runs/{id} 응답(document QueryRunStatusResponse). error는 실패 사유 문구(document #119 이후 한국어), error_code는 실패 코드. */
export type QueryRunStatusResponse = {
  status: string;
  result: QueryResponse | null;
  error?: string | null;
  error_code?: string | null;
};

export async function fetchWikiPage(pageId: string): Promise<WikiPageDetailResponse> {
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(
    workspacePath(workspaceId, "wiki", "pages", pageId),
    { cache: "no-store" }
  );

  return parseJsonOrThrow<WikiPageDetailResponse>(response, ERROR_MESSAGES.wikiPageLoadFailed);
}

/** 본문 저장 409 WIKI_PAGE_VERSION_CONFLICT. currentRevision은 서버의 지금 revision(error.current_revision)이다. */
export class WikiPageVersionConflictError extends ApiError {
  readonly currentRevision: number | null;

  constructor(message: string, currentRevision: number | null) {
    super(message, 409, "WIKI_PAGE_VERSION_CONFLICT");
    this.name = "WikiPageVersionConflictError";
    this.currentRevision = currentRevision;
  }
}

/**
 * 사람이 고친 본문을 저장한다(document #130). base_revision이 현재 revision과 다르면 409 WIKI_PAGE_VERSION_CONFLICT,
 * 같은 revision_write_id 재시도는 처음 결과를 돌려준다(503 뒤 재시도에 같은 ID를 쓴다).
 */
export async function saveWikiPageContent(pageId: string, request: WikiPageContentSaveRequest): Promise<WikiPageContentSaveResponse> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "wiki", "pages", pageId, "content"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  if (response.status === 409) {
    const body = await response.clone().json().catch(() => null) as { error?: { code?: string; message?: string; current_revision?: unknown } } | null;
    if (body?.error?.code === "WIKI_PAGE_VERSION_CONFLICT") {
      const current = body.error.current_revision;
      throw new WikiPageVersionConflictError(
        body.error.message || ERROR_MESSAGES.wikiPageSaveFailed,
        typeof current === "number" && Number.isFinite(current) ? current : null
      );
    }
    throw await parseApiError(response, ERROR_MESSAGES.wikiPageSaveFailed);
  }
  return parseJsonOrThrow<WikiPageContentSaveResponse>(response, ERROR_MESSAGES.wikiPageSaveFailed);
}
