import type { DocumentItemResponse } from "@/entities/document/model/document";
import { getWikiReflectState } from "./wikiReflectState";

/**
 * PDF 편입 대기 작업이 다음에 할 일.
 * - waiting: 변환이 진행 중이거나 placeholder가 아직 목록에 실리지 않았다.
 * - ready: 변환이 끝나 위키 편입을 요청할 수 있다.
 * - failed: 변환이 실패해 편입하지 못한다.
 * - missing: placeholder가 목록에서 사라져(삭제 등) 더 기다릴 대상이 없다.
 */
export type PdfIngestTaskStep = "waiting" | "ready" | "failed" | "missing";

/**
 * placeholder가 목록에 없는 채로 지나간 문서 목록 갱신 횟수 기준.
 * 첫 갱신은 변환 요청보다 먼저 시작된 폴링 응답일 수 있어, 두 번째 갱신에서도 없을 때 확정한다.
 */
export const MISSING_SNAPSHOTS_TO_DROP = 2;

export function getPdfIngestTaskStep(
  document: DocumentItemResponse | undefined,
  missingSnapshots: number
): PdfIngestTaskStep {
  if (!document) return missingSnapshots >= MISSING_SNAPSHOTS_TO_DROP ? "missing" : "waiting";
  if (getWikiReflectState(document) === "processing") return "waiting";
  if (document.status === "failed") return "failed";
  return "ready";
}
