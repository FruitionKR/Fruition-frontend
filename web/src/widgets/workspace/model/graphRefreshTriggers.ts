import type { DocumentItemResponse } from "@/entities/document";
import { isDocumentPipelineActive } from "@/entities/document/lib/documentKind";

/**
 * 그래프 idle 안전 폴링 주기. 그래프는 편입 완료·Lint 완료·명시적 새로고침 때 바로 다시 받으므로,
 * 이 폴링은 다른 멤버가 만든 변경처럼 이벤트로 잡지 못한 경우만 메운다.
 */
export const GRAPH_IDLE_POLL_INTERVAL_MS = 60_000;

/** 같은 시점에 몰린 완료 이벤트(여러 문서·Lint)를 한 번의 그래프 요청으로 묶는 시간 */
export const GRAPH_REFRESH_DEBOUNCE_MS = 800;

type DocumentState = Pick<DocumentItemResponse, "id" | "status" | "processing_state" | "processed_at">;

/**
 * 이전 목록과 비교해 편입이 새로 끝난(completed) 문서가 있는지.
 * 폴링 사이에 진행 중 상태를 놓친 경우(다른 멤버·다른 탭의 편입)도 status·processed_at 변화로 잡는다.
 * 처음 보는 문서는 비교할 이전 상태가 없어 제외한다.
 */
export function hasNewlyCompletedDocuments(previous: readonly DocumentState[], current: readonly DocumentState[]) {
  const previousById = new Map(previous.map((document) => [document.id, document]));
  return current.some((document) => {
    const before = previousById.get(document.id);
    if (!before || document.status !== "completed" || isDocumentPipelineActive(document)) return false;
    return isDocumentPipelineActive(before) || before.status !== "completed" || before.processed_at !== document.processed_at;
  });
}
