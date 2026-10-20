import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isPdfDocument } from "@/entities/document/lib/documentKind";
import { isGraphIngestEligible } from "@/features/wiki-ingest/model/graphDocuments";
import { getWikiReflectState } from "@/features/wiki-ingest/model/wikiReflectState";

/**
 * 레일 위키 편입 버튼에 불을 켤 문서: 아직 편입하지 않았거나(신규) 마지막 편입 이후 수정된 문서.
 * 편입 알림 카드(usePendingWorkNotifications)와 같은 기준이라 PDF 원본과 실패 문서(재시도)는 세지 않는다.
 * 선택 트리에서 고를 수 없는 문서(변환 중·TXT 등)도 뺀다.
 */
export function selectPendingIngestDocuments(documents: DocumentItemResponse[]): DocumentItemResponse[] {
  return documents.filter((document) => {
    if (isPdfDocument(document) || !isGraphIngestEligible(document, documents)) return false;
    const state = getWikiReflectState(document);
    return state === "not-included" || state === "changed";
  });
}

/** 위키 편입 버튼 불. 선택 중이거나 진행 중·최신화 중이라 막혀 있으면 끈다(스피너·사유가 대신 알린다). */
export function getIngestIndicator({
  pendingCount,
  isSelecting,
  isDisabled
}: {
  pendingCount: number;
  isSelecting: boolean;
  isDisabled: boolean;
}): { isLit: boolean; tooltip: string | null; label: string | null } {
  if (pendingCount === 0 || isSelecting || isDisabled) return { isLit: false, tooltip: null, label: null };
  return {
    isLit: true,
    tooltip: `편입할 위키가 있어요 (${pendingCount}개 문서)`,
    label: `위키 편입, 편입할 문서 ${pendingCount}개`
  };
}

/** 위키 최신화 버튼 불. needs_lint이고 바로 실행할 수 있을 때만 켠다. */
export function getLintIndicator({
  isLintEnabled,
  isSelecting
}: {
  isLintEnabled: boolean;
  isSelecting: boolean;
}): { isLit: boolean; tooltip: string | null; label: string | null } {
  if (!isLintEnabled || isSelecting) return { isLit: false, tooltip: null, label: null };
  return { isLit: true, tooltip: "위키 최신화가 가능해요", label: "위키 최신화, 최신화 가능" };
}

/** 권한이 없어 막힌 레일 버튼의 말풍선 보조줄. */
export const WIKI_INGEST_PERMISSION_HINT = "위키 편입 권한이 없어요";
export const WIKI_LINT_PERMISSION_HINT = "위키 최신화 권한이 없어요";
