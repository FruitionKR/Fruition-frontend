import { isFileItem } from "@/entities/tree/lib/treeGuards";
import { canWriteTreeFolder, folderDeleteBlockedReason } from "@/entities/tree/lib/treePermission";
import type { Project, TreeItem } from "@/entities/tree/model/tree";
import { TREE_SKIP_REASONS } from "@/entities/tree/lib/treeSkipReasons";

/** 묶음 작업에서 건너뛴(또는 실패한) 항목과 그 이유. 요약 알림에 그대로 쓴다. */
export type SkippedTreeItem = { label: string; reason: string };

/** 요약 알림에 이름을 몇 개까지 나열할지. 나머지는 "외 N개"로 줄인다. */
const SUMMARY_LIST_LIMIT = 5;

/**
 * 화면에 보이는 행(펼친 폴더의 자식까지)을 위에서 아래 순서로 모은다. Shift+클릭 범위 선택의 기준이다.
 */
export function visibleSelectableIds(items: readonly TreeItem[], openIds: ReadonlySet<string>): string[] {
  const result: string[] = [];
  const visit = (entries: readonly TreeItem[]) => {
    for (const item of entries) {
      result.push(item.id);
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
export function planBulkDelete(projects: readonly Project[], selectedIds: ReadonlySet<string>, isWorkspaceOwner: boolean | null = null) {
  const items: TreeItem[] = [];
  const skipped: SkippedTreeItem[] = [];
  const treeItems = projects.flatMap((project) => project.items);
  for (const item of selectedRootItems(projects, selectedIds)) {
    const folderReason = item.type === "folder" ? folderDeleteBlockedReason(item, canWriteTreeFolder(treeItems, item.id, isWorkspaceOwner) === false, isWorkspaceOwner) : null;
    if (folderReason) skipped.push({ label: item.label, reason: folderReason });
    else if (item.generated) skipped.push({ label: item.label, reason: TREE_SKIP_REASONS.generatedDelete });
    else if (isPendingUpload(item)) skipped.push({ label: item.label, reason: TREE_SKIP_REASONS.uploadPending });
    else if (item.canDelete === false) skipped.push({ label: item.label, reason: TREE_SKIP_REASONS.noDeletePermission });
    else items.push(item);
  }
  return { items, skipped };
}

/** 이름 목록을 "a, b, c 외 N개"로 줄인다. */
export function summarizeLabels(labels: readonly string[], limit = SUMMARY_LIST_LIMIT): string {
  const shown = labels.slice(0, limit).map((label) => `「${label}」`).join(", ");
  return labels.length > limit ? `${shown} 외 ${labels.length - limit}개` : shown;
}

/**
 * 묶음 작업 결과를 한 번의 알림에 담을 값으로 요약한다. 실패·건너뜀은 앞에서부터 이유와 함께 나열하고 나머지는 개수만 남긴다.
 * 문구는 알림을 띄우는 훅이 언어에 맞춰 만든다.
 */
export function summarizeBulkResult(succeeded: number, failures: readonly SkippedTreeItem[]) {
  const failed = failures.length;
  const outcome: "completed" | "failed" | "partial" = failed === 0 ? "completed" : succeeded === 0 ? "failed" : "partial";
  return {
    outcome,
    succeeded,
    failed,
    listed: failures.slice(0, SUMMARY_LIST_LIMIT),
    restCount: Math.max(0, failed - SUMMARY_LIST_LIMIT)
  };
}
