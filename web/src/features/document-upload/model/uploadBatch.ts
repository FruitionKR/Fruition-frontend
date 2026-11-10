import type { DocumentItemResponse } from "@/entities/document/model/document";
import { findServerTreeItem, type ServerTreeItem } from "@/entities/tree/model/serverTree";
import type { TreeItem } from "@/entities/tree/model/tree";
import { ApiError } from "@/shared/lib/apiErrors";

export type UploadBatchProgress = { total: number; completed: number; succeeded: number; failed: number };

export type UploadOutcome<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * 업로드 묶음을 실행한다. 항목을 모두 한꺼번에 넘기고(동시 개수·순서는 uploadDocumentFile의 대기열이 정한다),
 * 하나가 끝날 때마다 진행 상황을 알린다. results는 항목 순서대로(실패는 null), failures는 실패한 항목과 그 오류만 담는다.
 * 다시 올리기는 failures의 항목만 다시 넘긴다.
 */
export async function runUploadBatch<E, R>(
  entries: readonly E[],
  run: (entry: E) => Promise<UploadOutcome<R>>,
  onProgress?: (progress: UploadBatchProgress) => void
): Promise<{ results: (R | null)[]; failures: { entry: E; error: unknown }[]; progress: UploadBatchProgress }> {
  let progress: UploadBatchProgress = { total: entries.length, completed: 0, succeeded: 0, failed: 0 };
  const outcomes = await Promise.all(entries.map((entry) => run(entry).then((outcome) => {
    progress = {
      ...progress,
      completed: progress.completed + 1,
      succeeded: progress.succeeded + (outcome.ok ? 1 : 0),
      failed: progress.failed + (outcome.ok ? 0 : 1)
    };
    onProgress?.(progress);
    return outcome;
  })));
  return {
    results: outcomes.map((outcome) => (outcome.ok ? outcome.value : null)),
    failures: outcomes.flatMap((outcome, index) => (outcome.ok ? [] : [{ entry: entries[index], error: outcome.error }])),
    progress
  };
}

/**
 * 서버 응답을 받지 못했거나(네트워크·시간 초과) 5xx로 끝나 서버에 문서가 만들어졌는지 알 수 없는 실패인지.
 * 이런 실패를 다시 올리기 전에는 서버 트리를 확인해 이미 만들어진 문서를 다시 만들지 않는다(findCreatedUpload).
 */
export function isAmbiguousUploadFailure(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

/** 트리에 이미 보이는 서버 문서 id. 업로드를 시작할 때 찍어 두고, 그 뒤에 생긴 문서를 가려낸다. */
export function documentIdsInTree(items: readonly TreeItem[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: readonly TreeItem[]) => nodes.forEach((node) => {
    if (node.documentId) ids.add(node.documentId);
    walk(node.children ?? []);
  });
  walk(items);
  return ids;
}

const normalizeName = (name: string) => name.trim().normalize("NFC").toLowerCase();

/** 서버는 같은 폴더에 같은 이름이 있으면 `이름 (2).md`처럼 번호를 붙여 저장한다. */
function isSameOrNumberedName(candidate: string, filename: string): boolean {
  const name = normalizeName(filename);
  const target = normalizeName(candidate);
  if (target === name) return true;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  if (!target.startsWith(`${stem} (`) || !target.endsWith(`)${extension}`)) return false;
  return /^\d+$/.test(target.slice(stem.length + 2, target.length - extension.length - 1));
}

/**
 * 결과를 알 수 없이 실패한 업로드가 사실 서버에 만들어졌는지 찾는다. 올릴 폴더(null이면 최상위) 바로 아래에서
 * 업로드를 시작할 때 없던(knownDocumentIds 밖) 문서 중 이름이 같거나 서버가 번호를 붙인 이름인 것.
 */
export function findCreatedUpload(
  items: ServerTreeItem[],
  folderId: string | null,
  filename: string,
  knownDocumentIds: ReadonlySet<string>
): DocumentItemResponse | undefined {
  const siblings = folderId === null ? items : findServerTreeItem(items, folderId)?.children ?? [];
  return siblings.find((item) => item.type === "document" && item.document
    && !knownDocumentIds.has(item.id) && isSameOrNumberedName(item.name, filename))?.document;
}
