import { isFileItem, isWikiItem } from "@/entities/tree/lib/treeGuards";
import type { Project, TreeItem } from "@/entities/tree/model/tree";

/** 묶음 작업에서 건너뛴(또는 실패한) 항목과 그 이유. 요약 알림에 그대로 쓴다. */
export type SkippedTreeItem = { label: string; reason: string };

/** 요약 알림에 이름을 몇 개까지 나열할지. 나머지는 "외 N개"로 줄인다. */
const SUMMARY_LIST_LIMIT = 5;

/**
 * 화면에 보이는 행(펼친 폴더의 자식까지)을 위에서 아래 순서로 모은다. Shift+클릭 범위 선택의 기준이다.
 * 위키 행은 이동·삭제 대상이 아니라 범위에 넣지 않지만, 펼쳐져 있으면 그 아래는 계속 본다.
 */
export function visibleSelectableIds(items: readonly TreeItem[], openIds: ReadonlySet<string>): string[] {
  const result: string[] = [];
  const visit = (entries: readonly TreeItem[]) => {
    for (const item of entries) {
      if (!isWikiItem(item)) result.push(item.id);
      if (item.children && openIds.has(item.id)) visit(item.children);
    }
  };
  visit(items);
  return result;
}

/** 기준 행(anchor)부터 대상 행까지 보이는 순서대로 고른다. 기준이 보이지 않으면 대상 하나만 고른다. */
export function rangeSelection(visibleIds: readonly string[], anchorId: string | null, targetId: string): string[] {
  const end = visibleIds.indexOf(targetId);
  if (end < 0) return [];
  const start = anchorId === null ? -1 : visibleIds.indexOf(anchorId);
  if (start < 0) return [targetId];
  return visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/**
 * 선택한 항목을 트리 순서(위→아래)로 돌려준다. 선택한 폴더의 하위 항목은 폴더와 함께 처리되므로 뺀다.
 * 트리에서 사라진 id는 무시한다.
 */
export function selectedRootItems(projects: readonly Project[], selectedIds: ReadonlySet<string>): TreeItem[] {
  const result: TreeItem[] = [];
  const visit = (entries: readonly TreeItem[]) => {
    for (const item of entries) {
      if (selectedIds.has(item.id)) result.push(item);
      else if (item.children) visit(item.children);
    }
  };
  for (const project of projects) visit(project.items);
  return result;
}

/** 업로드가 끝나지 않아 서버 id가 없는 자리표시 행인지 */
function isPendingUpload(item: TreeItem) {
  return item.status === "uploading" || (isFileItem(item) && !item.documentId);
}

/** 묶음 삭제 계획: 실제로 지울 항목(트리 순서)과 지울 수 없어 건너뛸 항목. */
export function planBulkDelete(projects: readonly Project[], selectedIds: ReadonlySet<string>) {
  const items: TreeItem[] = [];
  const skipped: SkippedTreeItem[] = [];
  for (const item of selectedRootItems(projects, selectedIds)) {
    if (isWikiItem(item) || item.generated) skipped.push({ label: item.label, reason: "자동 생성 항목은 삭제할 수 없습니다" });
    else if (isPendingUpload(item)) skipped.push({ label: item.label, reason: "업로드가 끝나지 않았습니다" });
    else if (item.canDelete === false) skipped.push({ label: item.label, reason: "삭제 권한이 없습니다" });
    else items.push(item);
  }
  return { items, skipped };
}

/** 이름 목록을 "a, b, c 외 N개"로 줄인다. */
export function summarizeLabels(labels: readonly string[], limit = SUMMARY_LIST_LIMIT): string {
  const shown = labels.slice(0, limit).map((label) => `「${label}」`).join(", ");
  return labels.length > limit ? `${shown} 외 ${labels.length - limit}개` : shown;
}

/** 묶음 작업 결과를 한 번의 알림 문구로 만든다. 실패·건너뜀은 이유와 함께 나열한다. */
export function bulkResultNotice(action: string, succeeded: number, failures: readonly SkippedTreeItem[]) {
  const failed = failures.length;
  const title = failed === 0 ? `${action} 완료` : succeeded === 0 ? `${action} 실패` : `일부 ${action} 실패`;
  const head = failed === 0 ? `${succeeded}개 항목을 ${action}했습니다.` : `성공 ${succeeded}개, 실패 ${failed}개`;
  const shown = failures.slice(0, SUMMARY_LIST_LIMIT).map((entry) => `「${entry.label}」: ${entry.reason}`);
  if (failed > SUMMARY_LIST_LIMIT) shown.push(`외 ${failed - SUMMARY_LIST_LIMIT}개`);
  return {
    kind: failed === 0 ? "completed" as const : "failed" as const,
    title,
    message: [head, ...shown].join("\n")
  };
}
